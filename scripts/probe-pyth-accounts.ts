/**
 * Day-0 probe: does a usable on-chain Pyth price account exist for our equity feed,
 * and how stale is it right now?
 *
 * Architecture doc SS6.2 "Known trap": push accounts for equities are often months old.
 * The guard rejects every fill if this is stale, so this is a go/no-go check.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";

/** Pyth Solana Receiver — owner of PriceUpdateV2 accounts. */
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

const FEEDS: Record<string, string> = {
  "Equity.US.AAPL/USD":
    "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  "Equity.Index.AAPL/USD (24/7)":
    "aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36",
  "Crypto.SOL/USD (control)":
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

/** Sponsored feeds live at PDA(seeds = [shard_id u16 LE, feed_id]). */
function priceFeedAccount(shard: number, feedIdHex: string): PublicKey {
  const feedId = Buffer.from(feedIdHex, "hex");
  const shardBuf = Buffer.alloc(2);
  shardBuf.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([shardBuf, feedId], PYTH_PUSH_ORACLE)[0];
}

interface Parsed {
  feedId: string;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
  verification: string;
}

/** PriceUpdateV2: disc(8) | write_authority(32) | verification_level | PriceFeedMessage | posted_slot(8) */
function parsePriceUpdateV2(data: Buffer): Parsed {
  let o = 8 + 32;
  const variant = data.readUInt8(o);
  let verification: string;
  if (variant === 0) {
    verification = `Partial(${data.readUInt8(o + 1)} sigs)`;
    o += 2;
  } else {
    verification = "Full";
    o += 1;
  }
  const feedId = data.subarray(o, o + 32).toString("hex"); o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const exponent = data.readInt32LE(o); o += 4;
  const publishTime = data.readBigInt64LE(o);
  return { feedId, price, conf, exponent, publishTime, verification };
}

function human(p: Parsed) {
  const px = Number(p.price) * 10 ** p.exponent;
  const cf = Number(p.conf) * 10 ** p.exponent;
  return { px, cf, confBps: px !== 0 ? (cf / Math.abs(px)) * 10_000 : NaN };
}

function age(secs: number): string {
  const a = Math.abs(secs);
  if (a < 120) return `${secs}s`;
  if (a < 7200) return `${(secs / 60).toFixed(1)}m`;
  if (a < 172800) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86400).toFixed(1)}d`;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const now = Math.floor(Date.now() / 1000);
  console.log(`RPC        : ${RPC}`);
  console.log(`now (unix) : ${now}  ${new Date(now * 1000).toISOString()}\n`);

  for (const [name, feedId] of Object.entries(FEEDS)) {
    console.log(`=== ${name}`);
    console.log(`    feed_id ${feedId}`);
    let found = false;
    for (const shard of [0, 1, 2, 3]) {
      const addr = priceFeedAccount(shard, feedId);
      const info = await conn.getAccountInfo(addr);
      if (!info) continue;
      found = true;
      const p = parsePriceUpdateV2(info.data);
      const h = human(p);
      const ageSecs = now - Number(p.publishTime);
      const ok = p.feedId === feedId ? "" : "  <-- FEED ID MISMATCH";
      console.log(`    shard ${shard} ${addr.toBase58()}${ok}`);
      console.log(
        `      price=${h.px.toFixed(4)}  conf=${h.cf.toFixed(4)} (${h.confBps.toFixed(1)}bps)  ${p.verification}`
      );
      console.log(
        `      publish_time=${p.publishTime}  AGE=${age(ageSecs)}  ${
          ageSecs < 60 ? "FRESH" : ageSecs < 3600 ? "USABLE" : "STALE"
        }`
      );
    }
    if (!found) console.log("    NO SPONSORED ACCOUNT FOUND on shards 0-3");
    console.log("");
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
