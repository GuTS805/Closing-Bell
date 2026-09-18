/**
 * Does the wrapper premium exist in the POOL, or only between two Pyth feeds?
 *
 * This decides the pitch. The claim is that a tokenized-stock trade costs pool impact
 * PLUS a structural wrapper premium, and that only the first is displayed anywhere. That
 * holds only if the AMM mid genuinely sits above the underlying equity. If the pool tracks
 * the equity and only the feeds disagree, the premium is a feed-construction artifact and
 * there is no wedge.
 *
 * Buying always pays the spread, so a buy quote alone cannot isolate the mid. Quoting both
 * directions at the same small notional cancels it:
 *
 *   buy_dev   = basis + half_spread + impact
 *   sell_dev  = basis - half_spread - impact
 *   mid_dev   = (buy_dev + sell_dev) / 2   ->  the basis
 *
 * The test is then whether mid_dev tracks Crypto.<T>X/<T>.RR ACROSS tickers — TSLA's RR is
 * 1.00000 and SPY's is 1.00571, so a real basis should show near zero for TSLAx and ~57bp
 * for SPYx. A constant offset across all tickers would instead suggest a systematic
 * artifact.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Small enough that impact is negligible; large enough to get a real route. */
const NOTIONAL_USD = Number(process.env.NOTIONAL ?? 2_000);

interface T {
  symbol: string;
  mint: string;
  /** Pyth Crypto.<T>X/<T>.RR value observed 2026-09-18, or null if no feed exists. */
  rr: number | null;
}

const TICKERS: T[] = [
  { symbol: "SPY", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", rr: 1.00571 },
  { symbol: "AAPL", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", rr: 1.00266 },
  { symbol: "QQQ", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", rr: 1.00273 },
  { symbol: "GOOGL", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", rr: 1.00193 },
  { symbol: "NVDA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", rr: 1.00092 },
  { symbol: "TSLA", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", rr: 1.0 },
  { symbol: "META", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", rr: null },
  { symbol: "AMZN", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", rr: null },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function priceFeedAccount(shard: number, feedIdHex: string): PublicKey {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([b, Buffer.from(feedIdHex, "hex")], PYTH_PUSH_ORACLE)[0];
}

function parse(d: Buffer) {
  let o = 40;
  o += d.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = d.readBigInt64LE(o); o += 8;
  d.readBigUInt64LE(o); o += 8;
  const expo = d.readInt32LE(o); o += 4;
  const t = d.readBigInt64LE(o);
  return { price: Number(price) * 10 ** expo, publishTime: Number(t) };
}

async function equityFeedId(symbol: string): Promise<string | null> {
  const r = await fetch(
    `https://hermes.pyth.network/v2/price_feeds?query=${symbol}&asset_type=equity`
  );
  if (!r.ok) return null;
  const feeds = (await r.json()) as any[];
  return feeds.find((f) => f?.attributes?.symbol === `Equity.US.${symbol}/USD`)?.id ?? null;
}

async function quote(inputMint: string, outputMint: string, amount: number) {
  const url =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=10000`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const q = (await r.json()) as any;
  if (!q || q.error || !q.outAmount) return null;
  return { inAmount: Number(q.inAmount), outAmount: Number(q.outAmount), impact: Number(q.priceImpactPct ?? 0) };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const now = Math.floor(Date.now() / 1000);
  const et = new Date(now * 1000).toLocaleString("en-US", { timeZone: "America/New_York" });
  const label = process.env.SESSION_LABEL ?? "unlabelled";
  console.log(`when (ET) ${et}   session=${label}   notional=$${NOTIONAL_USD}\n`);

  const head =
    "ticker  equity$    buy_bps  sell_bps   MID_bps   RR_bps   diff";
  console.log(head);
  console.log("-".repeat(head.length));

  const rows: any[] = [];

  for (const t of TICKERS) {
    const fid = await equityFeedId(t.symbol);
    if (!fid) { console.log(`${t.symbol.padEnd(7)} no equity feed`); continue; }
    const info = await conn.getAccountInfo(priceFeedAccount(1, fid));
    if (!info) { console.log(`${t.symbol.padEnd(7)} no shard-1 account`); continue; }
    const oracle = parse(info.data).price;

    // BUY: spend NOTIONAL usdc, receive tokens.
    const buy = await quote(USDC, t.mint, Math.round(NOTIONAL_USD * 1e6));
    await sleep(500);
    if (!buy) { console.log(`${t.symbol.padEnd(7)} buy quote failed`); continue; }
    const tokensBought = buy.outAmount / 1e8;
    const buyPrice = NOTIONAL_USD / tokensBought;

    // SELL: the same token quantity back to usdc.
    const sell = await quote(t.mint, USDC, buy.outAmount);
    await sleep(500);
    if (!sell) { console.log(`${t.symbol.padEnd(7)} sell quote failed`); continue; }
    const sellPrice = sell.outAmount / 1e6 / tokensBought;

    const buyBps = ((buyPrice - oracle) / oracle) * 10_000;
    const sellBps = ((sellPrice - oracle) / oracle) * 10_000;
    const midBps = (buyBps + sellBps) / 2;
    const rrBps = t.rr === null ? null : (t.rr - 1) * 10_000;
    const diff = rrBps === null ? null : midBps - rrBps;

    console.log(
      `${t.symbol.padEnd(7)} ${oracle.toFixed(2).padStart(8)}  ` +
        `${buyBps.toFixed(0).padStart(8)} ${sellBps.toFixed(0).padStart(9)}  ` +
        `${midBps.toFixed(0).padStart(8)} ` +
        `${(rrBps === null ? "-" : rrBps.toFixed(0)).padStart(8)} ` +
        `${(diff === null ? "-" : (diff >= 0 ? "+" : "") + diff.toFixed(0)).padStart(6)}`
    );

    rows.push({ ticker: t.symbol, oracle, buyBps, sellBps, midBps, rrBps, diff });
  }

  writeFileSync(
    `replay/pool-vs-equity-${label}-${now}.json`,
    JSON.stringify({ capturedAtUnix: now, capturedAtET: et, sessionLabel: label, notionalUsd: NOTIONAL_USD, rows }, null, 2)
  );

  const withRr = rows.filter((r) => r.rrBps !== null);
  if (withRr.length >= 3) {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mx = mean(withRr.map((r) => r.rrBps));
    const my = mean(withRr.map((r) => r.midBps));
    const cov = mean(withRr.map((r) => (r.rrBps - mx) * (r.midBps - my)));
    const sx = Math.sqrt(mean(withRr.map((r) => (r.rrBps - mx) ** 2)));
    const sy = Math.sqrt(mean(withRr.map((r) => (r.midBps - my) ** 2)));
    console.log(`\ncorrelation(mid_bps, RR_bps) = ${(cov / (sx * sy)).toFixed(3)}  over n=${withRr.length}`);
    console.log(`mean mid ${my.toFixed(1)}bp vs mean RR ${mx.toFixed(1)}bp`);
    console.log(
      "\nIf mid tracks RR across tickers (TSLA near 0, SPY near +57), the premium is in\n" +
        "the pool and the wedge is real. A flat offset regardless of RR means it is not."
    );
  }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
