/**
 * Decomposes the true cost of a tokenized-stock buy into its two parts.
 *
 *   pool impact      = fill price vs the POOL'S OWN MID      <- Jupiter shows this
 *   wrapper premium  = pool mid vs the UNDERLYING EQUITY     <- nobody shows this
 *   true cost        = fill price vs the underlying equity
 *
 * Mid is isolated by quoting both directions at a small notional, which cancels the
 * spread: mid = (buy_dev + sell_dev) / 2.
 *
 * Shared by the landing page (server component, no HTTP round-trip needed) and the
 * /api/truecost route (used by the client-side trade page).
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Mainnet's fresh shard. Shard 0 was 34.5 days stale and 10% wrong. */
const SHARD = 1;
/** Small enough that impact is negligible when estimating the mid. */
const MID_PROBE_USD = 2_000;

export interface Market {
  label: string;
  mint: string;
  feedId: string;
  /** Pyth Crypto.<T>X/<T>.RR observed 2026-09-18, for reference. */
  rr: number | null;
  decimals: number;
}

export const MARKETS: Record<string, Market> = {
  AAPLx: {
    label: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    rr: 1.00266, decimals: 8,
  },
  SPYx: {
    label: "S&P 500", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    rr: 1.00571, decimals: 8,
  },
  TSLAx: {
    label: "Tesla", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    rr: 1.0, decimals: 8,
  },
  NVDAx: {
    label: "Nvidia", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    rr: 1.00092, decimals: 8,
  },
};

function priceFeedAccount(shard: number, feedIdHex: string): PublicKey {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([b, Buffer.from(feedIdHex, "hex")], PYTH_PUSH_ORACLE)[0];
}

function parsePriceUpdateV2(d: Buffer) {
  let o = 8 + 32;
  o += d.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = d.readBigInt64LE(o); o += 8;
  const conf = d.readBigUInt64LE(o); o += 8;
  const expo = d.readInt32LE(o); o += 4;
  const publishTime = d.readBigInt64LE(o);
  return {
    price: Number(price) * 10 ** expo,
    conf: Number(conf) * 10 ** expo,
    publishTime: Number(publishTime),
  };
}

async function jupQuote(inputMint: string, outputMint: string, amount: number) {
  const url =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=10000`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Jupiter ${r.status}`);
  const q = await r.json();
  if (!q || q.error || !q.outAmount) throw new Error(q?.error ?? "no route");
  return {
    inAmount: Number(q.inAmount),
    outAmount: Number(q.outAmount),
    impactPct: Number(q.priceImpactPct ?? 0),
    venues: (q.routePlan ?? []).map((r: { swapInfo?: { label?: string } }) => r.swapInfo?.label).filter(Boolean) as string[],
  };
}

export interface TrueCostResult {
  ticker: string;
  label: string;
  notional: number;
  oracle: { price: number; conf: number; ageSecs: number; feed: string; shard: number };
  pool: { midPrice: number; fillPrice: number; venues: string[]; jupiterImpactPct: number; spreadBps: number };
  breakdown: {
    poolImpactBps: number;
    wrapperPremiumBps: number;
    trueCostBps: number;
    publishedRrBps: number | null;
  };
  capturedAt: string;
}

export async function getTrueCost(ticker: string, notional: number): Promise<TrueCostResult> {
  const m = MARKETS[ticker];
  if (!m) throw new Error(`unknown ticker ${ticker}`);

  const conn = new Connection(RPC, "confirmed");
  const scale = 10 ** m.decimals;

  // The oracle read, the notional fill quote, and the buy leg of the mid probe are all
  // independent — only the probe's sell leg depends on the buy leg's output.
  const [info, fill, probeBuy] = await Promise.all([
    conn.getAccountInfo(priceFeedAccount(SHARD, m.feedId)),
    jupQuote(USDC, m.mint, Math.round(notional * 1e6)),
    jupQuote(USDC, m.mint, Math.round(MID_PROBE_USD * 1e6)),
  ]);
  if (!info) throw new Error(`no shard-${SHARD} Pyth account for ${ticker}`);
  const oracle = parsePriceUpdateV2(info.data);
  const oracleAge = Math.floor(Date.now() / 1000) - oracle.publishTime;

  const fillPrice = notional / (fill.outAmount / scale);

  const probeTokens = probeBuy.outAmount;
  const probeSell = await jupQuote(m.mint, USDC, probeTokens);
  const buyPx = MID_PROBE_USD / (probeTokens / scale);
  const sellPx = probeSell.outAmount / 1e6 / (probeTokens / scale);
  const midPrice = (buyPx + sellPx) / 2;

  const bps = (a: number, b: number) => ((a - b) / b) * 10_000;
  const wrapperPremiumBps = bps(midPrice, oracle.price);
  const poolImpactBps = bps(fillPrice, midPrice);
  const trueCostBps = bps(fillPrice, oracle.price);

  return {
    ticker,
    label: m.label,
    notional,
    oracle: {
      price: oracle.price, conf: oracle.conf, ageSecs: oracleAge,
      feed: `Equity.US.${ticker.replace(/x$/, "")}/USD`, shard: SHARD,
    },
    pool: {
      midPrice, fillPrice, venues: fill.venues,
      jupiterImpactPct: fill.impactPct, spreadBps: bps(buyPx, sellPx),
    },
    breakdown: {
      poolImpactBps, wrapperPremiumBps, trueCostBps,
      publishedRrBps: m.rr === null ? null : (m.rr - 1) * 10_000,
    },
    capturedAt: new Date().toISOString(),
  };
}
