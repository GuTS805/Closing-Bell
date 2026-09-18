/**
 * Decomposes the true cost of a tokenized-stock buy into its two parts.
 *
 *   pool impact      = fill price vs the POOL'S OWN MID      <- Jupiter shows this
 *   wrapper premium  = pool mid vs the UNDERLYING EQUITY     <- nobody shows this
 *   true cost        = fill price vs the underlying equity
 *
 * The second term is the point. Jupiter measures impact against the pool's mid, and the
 * pool's mid already sits above the equity — measured 2026-09-18, +60bp for SPYx and +2bp
 * for TSLAx, tracking Pyth's published redemption ratio at correlation 0.931. So a user
 * buying SPYx at "0.01% price impact" still pays ~57bp over SPY, at any size.
 *
 * Mid is isolated by quoting both directions at a small notional, which cancels the
 * spread: mid = (buy_dev + sell_dev) / 2.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

export const revalidate = 0;

const RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Mainnet's fresh shard. Shard 0 was 34.5 days stale and 10% wrong. */
const SHARD = 1;
/** Small enough that impact is negligible when estimating the mid. */
const MID_PROBE_USD = 2_000;

interface Market {
  label: string;
  mint: string;
  /** Equity.US.<T>/USD feed id. */
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
    venues: (q.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker") ?? "AAPLx";
  const notional = Math.max(100, Number(searchParams.get("notional") ?? 50_000));
  const m = MARKETS[ticker];
  if (!m) return NextResponse.json({ error: `unknown ticker ${ticker}` }, { status: 400 });

  try {
    const conn = new Connection(RPC, "confirmed");
    const info = await conn.getAccountInfo(priceFeedAccount(SHARD, m.feedId));
    if (!info) throw new Error(`no shard-${SHARD} Pyth account for ${ticker}`);
    const oracle = parsePriceUpdateV2(info.data);
    const oracleAge = Math.floor(Date.now() / 1000) - oracle.publishTime;

    const scale = 10 ** m.decimals;

    // The trade the user is actually doing.
    const fill = await jupQuote(USDC, m.mint, Math.round(notional * 1e6));
    const fillPrice = notional / (fill.outAmount / scale);

    // Mid, isolated by quoting both directions small.
    const probeBuy = await jupQuote(USDC, m.mint, Math.round(MID_PROBE_USD * 1e6));
    const probeTokens = probeBuy.outAmount;
    const probeSell = await jupQuote(m.mint, USDC, probeTokens);
    const buyPx = MID_PROBE_USD / (probeTokens / scale);
    const sellPx = probeSell.outAmount / 1e6 / (probeTokens / scale);
    const midPrice = (buyPx + sellPx) / 2;

    const bps = (a: number, b: number) => ((a - b) / b) * 10_000;
    const wrapperPremiumBps = bps(midPrice, oracle.price);
    const poolImpactBps = bps(fillPrice, midPrice);
    const trueCostBps = bps(fillPrice, oracle.price);

    return NextResponse.json({
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
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "failed" }, { status: 502 });
  }
}
