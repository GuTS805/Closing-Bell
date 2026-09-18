/**
 * Does the off-hours dislocation thesis survive contact with size?
 *
 * The day-0 measurement (1 AAPLx, 9 bps from oracle) tested the single most liquid,
 * most arbed case available and proved nothing. This measures the cases where the
 * claim could actually be true:
 *
 *   - size:       $1k / $10k / $50k / $250k notional, not 1 share
 *   - thin names: long-tail xStocks, not the top of the book
 *
 * Run it off-hours and again during the session; the delta is the real number.
 *
 * Oracle side reads the on-chain Pyth account directly (shard 1 — shard 0 is stale),
 * because Hermes now requires auth.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Shard 1. Shard 0 was 34.5 days stale and 10% wrong on 2026-09-18. */
const SHARD = 1;

/** Notional tiers in USDC. */
const TIERS = [1_000, 10_000, 50_000, 250_000];

interface Ticker {
  symbol: string;
  mint: string;
  liquidity: number;
}

/** Deepest to thinnest, from Jupiter's reported liquidity on 2026-09-18. */
const TICKERS: Ticker[] = [
  { symbol: "SPYx", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", liquidity: 7_343_371 },
  { symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", liquidity: 2_064_716 },
  { symbol: "TSLAx", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", liquidity: 1_344_772 },
  { symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", liquidity: 655_523 },
  { symbol: "GOOGLx", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", liquidity: 457_374 },
  { symbol: "METAx", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", liquidity: 350_266 },
  { symbol: "PLTRx", mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", liquidity: 346_651 },
  { symbol: "GMEx", mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", liquidity: 264_982 },
  { symbol: "AMZNx", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", liquidity: 221_571 },
  { symbol: "KOx", mint: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ", liquidity: 156_254 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function priceFeedAccount(shard: number, feedIdHex: string): PublicKey {
  const feedId = Buffer.from(feedIdHex, "hex");
  const shardBuf = Buffer.alloc(2);
  shardBuf.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([shardBuf, feedId], PYTH_PUSH_ORACLE)[0];
}

function parsePriceUpdateV2(data: Buffer) {
  let o = 8 + 32;
  const variant = data.readUInt8(o);
  o += variant === 0 ? 2 : 1;
  const feedId = data.subarray(o, o + 32).toString("hex"); o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const exponent = data.readInt32LE(o); o += 4;
  const publishTime = data.readBigInt64LE(o);
  return {
    feedId,
    price: Number(price) * 10 ** exponent,
    conf: Number(conf) * 10 ** exponent,
    publishTime: Number(publishTime),
  };
}

/** Feed metadata is still public even though price updates are not. */
async function findFeedId(symbol: string): Promise<string | null> {
  const base = symbol.replace(/x$/, "");
  const res = await fetch(
    `https://hermes.pyth.network/v2/price_feeds?query=${base}&asset_type=equity`
  );
  if (!res.ok) return null;
  const feeds = (await res.json()) as any[];
  const want = `Equity.US.${base}/USD`;
  const hit = feeds.find((f) => f?.attributes?.symbol === want);
  return hit?.id ?? null;
}

async function quoteBuy(mint: string, usdcNotional: number) {
  const amount = Math.round(usdcNotional * 1e6);
  const url =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${mint}` +
    `&amount=${amount}&slippageBps=10000`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const q = (await res.json()) as any;
  if (!q || q.error || !q.outAmount) return null;
  const tokensOut = Number(q.outAmount) / 1e8; // xStocks are 8 decimals
  if (tokensOut <= 0) return null;
  return {
    effPrice: usdcNotional / tokensOut,
    impactPct: Number(q.priceImpactPct ?? 0) * 100,
    venues: (q.routePlan ?? []).map((r: any) => r.swapInfo?.label).join("+"),
  };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const now = Math.floor(Date.now() / 1000);
  const et = new Date(now * 1000).toLocaleString("en-US", { timeZone: "America/New_York" });

  console.log(`when (UTC) ${new Date(now * 1000).toISOString()}`);
  console.log(`when (ET)  ${et}`);
  console.log(`session    ${process.env.SESSION_LABEL ?? "(set SESSION_LABEL=open|closed)"}\n`);

  const rows: any[] = [];
  const header =
    "ticker   liq($k)  oracle    age    " + TIERS.map((t) => `$${t / 1000}k`.padStart(9)).join("");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const t of TICKERS) {
    const feedId = await findFeedId(t.symbol);
    if (!feedId) {
      console.log(`${t.symbol.padEnd(8)} no pyth equity feed found`);
      continue;
    }
    const addr = priceFeedAccount(SHARD, feedId);
    const info = await conn.getAccountInfo(addr);
    if (!info) {
      console.log(`${t.symbol.padEnd(8)} no shard-${SHARD} account`);
      continue;
    }
    const p = parsePriceUpdateV2(info.data);
    const age = now - p.publishTime;

    const cells: string[] = [];
    const tierData: any = {};
    for (const tier of TIERS) {
      const q = await quoteBuy(t.mint, tier);
      if (!q) {
        cells.push("     n/a");
        tierData[tier] = null;
      } else {
        // Buying: positive bps means you paid ABOVE oracle.
        const devBps = ((q.effPrice - p.price) / p.price) * 10_000;
        cells.push(`${devBps >= 0 ? "+" : ""}${devBps.toFixed(0)}bp`.padStart(9));
        tierData[tier] = { devBps, effPrice: q.effPrice, impactPct: q.impactPct, venues: q.venues };
      }
      await sleep(400);
    }

    console.log(
      `${t.symbol.padEnd(8)} ${String(Math.round(t.liquidity / 1000)).padStart(6)}  ` +
        `${p.price.toFixed(2).padStart(8)}  ${String(age + "s").padStart(5)}  ` +
        cells.join("")
    );

    rows.push({
      symbol: t.symbol,
      liquidity: t.liquidity,
      feedId,
      oracle: p.price,
      conf: p.conf,
      oracleAgeSecs: age,
      tiers: tierData,
    });
    await sleep(300);
  }

  const out = {
    capturedAtUnix: now,
    capturedAtET: et,
    sessionLabel: process.env.SESSION_LABEL ?? "unlabelled",
    rows,
  };
  const path = `replay/depth-${process.env.SESSION_LABEL ?? "unlabelled"}-${now}.json`;
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nsaved ${path}`);
  console.log(
    "\nPositive bps = you paid above oracle. Compare this table against a session-hours run."
  );
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
