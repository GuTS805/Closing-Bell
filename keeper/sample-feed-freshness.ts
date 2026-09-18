/**
 * Does the Pyth price-push path need to exist at all?
 *
 * Day-0 sampling found shard-1 equity accounts 5-23 seconds old, i.e. somebody is already
 * keeping them current. If that holds continuously across the supported tickers, the
 * keeper's hardest dependency disappears: no Hermes key, no price push, and the keeper is
 * reduced to maintaining the market clock and the basis — both of which are our own data.
 *
 * This samples shard-1 age on a loop and appends to a JSONL series. Let it run for a day,
 * then check the max observed age per ticker. Any sustained staleness means the push path
 * stays.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { appendFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const SHARD = 1;
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 180_000); // 3 minutes
const OUT = process.env.OUT ?? "keeper/feed-freshness.jsonl";

/** Feed ids resolved on 2026-09-18; hard-coded so the loop needs no Hermes calls. */
const FEEDS: Record<string, string> = {
  AAPL: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
};

const EXTRA = (process.env.EXTRA_FEEDS ?? "")
  .split(",")
  .filter(Boolean)
  .reduce((acc, pair) => {
    const [k, v] = pair.split(":");
    if (k && v) acc[k] = v;
    return acc;
  }, {} as Record<string, string>);

Object.assign(FEEDS, EXTRA);

function priceFeedAccount(shard: number, feedIdHex: string): PublicKey {
  const feedId = Buffer.from(feedIdHex, "hex");
  const b = Buffer.alloc(2);
  b.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([b, feedId], PYTH_PUSH_ORACLE)[0];
}

function parse(data: Buffer) {
  let o = 8 + 32;
  o += data.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const expo = data.readInt32LE(o); o += 4;
  const publishTime = data.readBigInt64LE(o);
  return {
    price: Number(price) * 10 ** expo,
    conf: Number(conf) * 10 ** expo,
    publishTime: Number(publishTime),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tick(conn: Connection) {
  const now = Math.floor(Date.now() / 1000);
  for (const [ticker, feedId] of Object.entries(FEEDS)) {
    try {
      const info = await conn.getAccountInfo(priceFeedAccount(SHARD, feedId));
      const row = info
        ? (() => {
            const p = parse(info.data);
            return { t: now, ticker, shard: SHARD, age: now - p.publishTime, price: p.price, conf: p.conf };
          })()
        : { t: now, ticker, shard: SHARD, age: null, error: "no account" };
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.log(
        `${new Date(now * 1000).toISOString()}  ${ticker.padEnd(6)} age=${
          (row as any).age ?? "n/a"
        }s`
      );
    } catch (e: any) {
      appendFileSync(OUT, JSON.stringify({ t: now, ticker, error: e.message }) + "\n");
      console.log(`${new Date(now * 1000).toISOString()}  ${ticker} ERROR ${e.message}`);
    }
    await sleep(500);
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log(`sampling ${Object.keys(FEEDS).join(",")} every ${INTERVAL_MS / 1000}s -> ${OUT}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick(conn);
    await sleep(INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
