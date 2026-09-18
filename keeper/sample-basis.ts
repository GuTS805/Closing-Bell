/**
 * Dense basis sampler, built for one non-repeatable experiment.
 *
 * SPY's ex-dividend date falls inside the build window. If the wrapper premium is accrued
 * dividend, it should step down by roughly (dividend / spot) when the underlying goes
 * ex — about 25 bp on a ~$1.90 dividend against a mid-700s SPY. If it is friction, the
 * premium should not move at all.
 *
 * Arithmetic already argues against PURE accrual: AAPL pays ~$0.26 quarterly on ~$337, so
 * a full quarter of accrual is ~8 bp against a measured 27 bp. Both tickers carry more
 * premium than accrual can explain, so the expected result is a partial drop — premium =
 * structural base + accrued component.
 *
 * Controls matter as much as the subject:
 *   TSLA  pays no dividend, so it should not move at all
 *   AAPL  pays one, but is not ex today, so it should not step today either
 *
 * Cadence is minutes, not days: a step change needs the shape of the transition, not two
 * endpoints.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { appendFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const SHARD = 1;
const NOTIONAL_USD = Number(process.env.NOTIONAL ?? 2_000);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 180_000);
const OUT = process.env.OUT ?? "replay/basis-dense.jsonl";

interface T { sym: string; mint: string; feedId: string; role: string; decimals: number }

const TICKERS: T[] = [
  { sym: "SPY", role: "subject: ex-dividend in window",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", decimals: 8 },
  { sym: "TSLA", role: "control: pays no dividend",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", decimals: 8 },
  { sym: "AAPL", role: "control: pays one, not ex today",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", decimals: 8 },
  { sym: "NVDA", role: "control: negligible dividend",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", decimals: 8 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function feedAccount(shard: number, feedIdHex: string): PublicKey {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([b, Buffer.from(feedIdHex, "hex")], PYTH_PUSH_ORACLE)[0];
}

function parse(d: Buffer) {
  let o = 40;
  o += d.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = d.readBigInt64LE(o); o += 8;
  const conf = d.readBigUInt64LE(o); o += 8;
  const expo = d.readInt32LE(o); o += 4;
  const t = d.readBigInt64LE(o);
  return { price: Number(price) * 10 ** expo, conf: Number(conf) * 10 ** expo, publishTime: Number(t) };
}

async function quote(inputMint: string, outputMint: string, amount: number) {
  const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}` +
    `&outputMint=${outputMint}&amount=${amount}&slippageBps=10000`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const q = await r.json();
  if (!q || (q as any).error || !(q as any).outAmount) return null;
  return { outAmount: Number((q as any).outAmount) };
}

async function sampleOne(conn: Connection, t: T, now: number) {
  const info = await conn.getAccountInfo(feedAccount(SHARD, t.feedId));
  if (!info) return { t: now, sym: t.sym, error: "no oracle account" };
  const o = parse(info.data);
  const scale = 10 ** t.decimals;

  const buy = await quote(USDC, t.mint, Math.round(NOTIONAL_USD * 1e6));
  if (!buy) return { t: now, sym: t.sym, oracle: o.price, error: "buy quote failed" };
  await sleep(400);
  const sell = await quote(t.mint, USDC, buy.outAmount);
  if (!sell) return { t: now, sym: t.sym, oracle: o.price, error: "sell quote failed" };

  const tokens = buy.outAmount / scale;
  const buyPx = NOTIONAL_USD / tokens;
  const sellPx = sell.outAmount / 1e6 / tokens;
  const midPx = (buyPx + sellPx) / 2;
  const bps = (a: number, b: number) => ((a - b) / b) * 10_000;

  return {
    t: now,
    sym: t.sym,
    oracle: o.price,
    oracleAge: now - o.publishTime,
    buyBps: bps(buyPx, o.price),
    sellBps: bps(sellPx, o.price),
    midBps: bps(midPx, o.price),
    spreadBps: bps(buyPx, sellPx),
  };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log(`dense basis sampling every ${INTERVAL_MS / 1000}s -> ${OUT}`);
  console.log(TICKERS.map((t) => `${t.sym} (${t.role})`).join("\n"));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Math.floor(Date.now() / 1000);
    const et = new Date(now * 1000).toLocaleString("en-US", { timeZone: "America/New_York" });
    const parts: string[] = [];
    for (const t of TICKERS) {
      try {
        const row = await sampleOne(conn, t, now);
        appendFileSync(OUT, JSON.stringify(row) + "\n");
        parts.push(
          "midBps" in row && typeof (row as any).midBps === "number"
            ? `${t.sym} ${(row as any).midBps.toFixed(0)}bp`
            : `${t.sym} -`
        );
      } catch (e: any) {
        appendFileSync(OUT, JSON.stringify({ t: now, sym: t.sym, error: e.message }) + "\n");
        parts.push(`${t.sym} err`);
      }
      await sleep(600);
    }
    console.log(`${et}  ${parts.join("  ")}`);
    await sleep(INTERVAL_MS);
  }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
