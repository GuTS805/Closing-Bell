/**
 * Two-feed basis measurement.
 *
 * Pyth publishes three related feeds per tokenized equity:
 *
 *   Equity.US.<T>/USD        the underlying equity
 *   Crypto.<T>X/USD          the xStock itself
 *   Crypto.<T>X/<T>.RR       the xStock priced in units of the underlying (the basis)
 *
 * This matters for correctness, not just for the Pyth track. If the xStock trades at a
 * persistent premium or discount to the equity — plausible, since only authorized
 * participants can arbitrage redemption 1:1 and retail cannot — then a band centered on
 * the *equity* feed systematically blocks one side of every trade. The band must be
 * centered on the xStock feed, with the basis tracked as a separate quantity.
 *
 * Run this repeatedly (open and closed sessions) to establish whether the basis is
 * constant, mean-reverting, or drifting.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const SHARDS = [0, 1, 2, 3];

const TICKERS = ["AAPL", "SPY", "META", "NVDA", "TSLA", "GOOGL", "AMZN", "MSFT", "QQQ", "COIN"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function priceFeedAccount(shard: number, feedIdHex: string): PublicKey {
  const feedId = Buffer.from(feedIdHex, "hex");
  const shardBuf = Buffer.alloc(2);
  shardBuf.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([shardBuf, feedId], PYTH_PUSH_ORACLE)[0];
}

function parse(data: Buffer) {
  let o = 8 + 32;
  const variant = data.readUInt8(o);
  o += variant === 0 ? 2 : 1;
  o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const exponent = data.readInt32LE(o); o += 4;
  const publishTime = data.readBigInt64LE(o);
  return {
    price: Number(price) * 10 ** exponent,
    conf: Number(conf) * 10 ** exponent,
    publishTime: Number(publishTime),
  };
}

const feedCache = new Map<string, string | null>();

async function feedId(symbol: string): Promise<string | null> {
  if (feedCache.has(symbol)) return feedCache.get(symbol)!;
  const q = symbol.split(/[./]/)[1] ?? symbol;
  const res = await fetch(`https://hermes.pyth.network/v2/price_feeds?query=${q}`);
  let id: string | null = null;
  if (res.ok) {
    const feeds = (await res.json()) as any[];
    id = feeds.find((f) => f?.attributes?.symbol === symbol)?.id ?? null;
  }
  feedCache.set(symbol, id);
  return id;
}

/** Reads a feed from whichever shard holds the freshest account. */
async function readFreshest(conn: Connection, symbol: string, now: number) {
  const id = await feedId(symbol);
  if (!id) return { symbol, status: "no feed" as const };
  let best: any = null;
  for (const shard of SHARDS) {
    const info = await conn.getAccountInfo(priceFeedAccount(shard, id));
    if (!info) continue;
    const p = parse(info.data);
    const age = now - p.publishTime;
    if (!best || age < best.age) best = { ...p, age, shard };
  }
  if (!best) return { symbol, status: "no account" as const, feedId: id };
  return { symbol, status: "ok" as const, feedId: id, ...best };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const now = Math.floor(Date.now() / 1000);
  const et = new Date(now * 1000).toLocaleString("en-US", { timeZone: "America/New_York" });
  const label = process.env.SESSION_LABEL ?? "unlabelled";

  console.log(`when (ET) ${et}   session=${label}\n`);
  const head =
    "ticker  equity$    age   xStock$    age   basis_bps    RR       RR_bps  agree";
  console.log(head);
  console.log("-".repeat(head.length));

  const rows: any[] = [];

  for (const t of TICKERS) {
    const eq = await readFreshest(conn, `Equity.US.${t}/USD`, now);
    const xs = await readFreshest(conn, `Crypto.${t}X/USD`, now);
    const rr = await readFreshest(conn, `Crypto.${t}X/${t}.RR`, now);

    if (eq.status !== "ok" || xs.status !== "ok") {
      console.log(
        `${t.padEnd(7)} ${eq.status === "ok" ? "ok" : eq.status.padEnd(10)}  ` +
          `${xs.status === "ok" ? "ok" : "xStock " + xs.status}`
      );
      rows.push({ ticker: t, equity: eq, xstock: xs, rr });
      await sleep(250);
      continue;
    }

    // Basis derived from the two USD feeds.
    const basisBps = ((xs.price - eq.price) / eq.price) * 10_000;
    // Basis as published directly by the RR feed, if it exists on-chain.
    const rrBps = rr.status === "ok" ? (rr.price - 1) * 10_000 : null;
    const agree =
      rrBps === null ? "-" : Math.abs(rrBps - basisBps) < 25 ? "yes" : "NO";

    console.log(
      `${t.padEnd(7)} ${eq.price.toFixed(2).padStart(8)} ${String(eq.age + "s").padStart(5)}  ` +
        `${xs.price.toFixed(2).padStart(8)} ${String(xs.age + "s").padStart(5)}  ` +
        `${(basisBps >= 0 ? "+" : "") + basisBps.toFixed(0)}`.padStart(10) +
        `  ${rr.status === "ok" ? rr.price.toFixed(5) : "   -   "}` +
        `  ${rrBps === null ? "     -" : ((rrBps >= 0 ? "+" : "") + rrBps.toFixed(0)).padStart(6)}` +
        `  ${agree}`
    );

    rows.push({ ticker: t, equity: eq, xstock: xs, rr, basisBps, rrBps });
    await sleep(250);
  }

  const snapshot = { capturedAtUnix: now, capturedAtET: et, sessionLabel: label, rows };
  writeFileSync(`replay/basis-${label}-${now}.json`, JSON.stringify(snapshot, null, 2));

  // Append to a time series so repeated runs answer "constant or mean-reverting?".
  const series = "replay/basis-series.jsonl";
  if (!existsSync(series)) writeFileSync(series, "");
  for (const r of rows) {
    if (r.basisBps === undefined) continue;
    appendFileSync(
      series,
      JSON.stringify({
        t: now,
        session: label,
        ticker: r.ticker,
        basisBps: r.basisBps,
        rrBps: r.rrBps,
      }) + "\n"
    );
  }

  console.log(`\nsaved replay/basis-${label}-${now}.json and appended to ${series}`);
  console.log(
    "\nbasis_bps = xStock premium over the underlying equity.\n" +
      "RR is Pyth's directly published ratio; RR_bps is (RR - 1). 'agree' checks the two\n" +
      "agree within 25bp — a persistent disagreement means one feed is stale."
  );
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
