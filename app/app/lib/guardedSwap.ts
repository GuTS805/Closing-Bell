/**
 * Enforces the oracle band on mainnet without deploying anything.
 *
 * Every Solana swap already carries an on-chain minimum-output check: Jupiter's `route`
 * instruction reverts with SlippageToleranceExceeded (6001) when the fill lands below the
 * threshold. That threshold is normally derived from the POOL'S OWN MID, which is exactly
 * why the wrapper premium is invisible — a pool sitting 54 bp rich reports 0 bp of
 * slippage, because it is measuring against itself.
 *
 * Derive the same threshold from the Pyth oracle instead and the primitive becomes an
 * oracle band. No program of ours runs; the router enforces our number.
 *
 * This is the weaker of the two enforcement paths and is not a replacement for the guard
 * program, which additionally checks oracle staleness, confidence, market clock and keeper
 * basis drift, and which verifies the REALISED price from balance deltas after the fill.
 * This one only bounds the output amount. It is here because it works on mainnet today.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { MARKETS } from "./truecost";

const RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const SHARD = 1;
const USDC_DECIMALS = 6;

/** Matches the guard program's open-market band. */
export const DEFAULT_BAND_BPS = 50;
export const MAX_BAND_BPS = 1_000;
/** Jupiter rejects anything outside this. */
const SLIPPAGE_CEILING_BPS = 10_000;

export interface BandDerivation {
  /** The most a token may cost and still sit inside the band. */
  maxPriceUsd: number;
  /** Tokens the band demands for this notional, in raw units. */
  minOutRaw: number;
  /** What Jupiter says the pool will actually deliver, in raw units. */
  quotedOutRaw: number;
  /** The slippage tolerance that encodes the band, or null when unbuildable. */
  slippageBps: number | null;
  buildable: boolean;
  /** How far the quoted fill sits from the oracle. Positive means expensive. */
  quotedDeviationBps: number;
  /** Present only when the trade is refused. */
  refusal: string | null;
}

/**
 * Pure, so it can be tested without touching the network or anyone's funds.
 *
 * Both roundings deliberately favour the user. minOutRaw rounds UP, so the demanded
 * amount is never less than the band allows. slippageBps rounds DOWN, because a larger
 * tolerance is a weaker guarantee — the enforced threshold must land at or above our
 * minimum, never below it.
 */
export function deriveBand(args: {
  oraclePriceUsd: number;
  notionalUsd: number;
  quotedOutRaw: number;
  decimals: number;
  bandBps: number;
}): BandDerivation {
  const { oraclePriceUsd, notionalUsd, quotedOutRaw, decimals, bandBps } = args;

  if (!(oraclePriceUsd > 0)) throw new Error("oracle price must be positive");
  if (!(notionalUsd > 0)) throw new Error("notional must be positive");
  if (!(quotedOutRaw > 0)) throw new Error("quoted output must be positive");
  if (!Number.isFinite(bandBps) || bandBps < 0 || bandBps > MAX_BAND_BPS) {
    throw new Error(`band must be between 0 and ${MAX_BAND_BPS} bps`);
  }

  const scale = 10 ** decimals;
  const maxPriceUsd = oraclePriceUsd * (1 + bandBps / 10_000);
  const minOutRaw = Math.ceil((notionalUsd / maxPriceUsd) * scale);

  const quotedPriceUsd = notionalUsd / (quotedOutRaw / scale);
  const quotedDeviationBps = ((quotedPriceUsd - oraclePriceUsd) / oraclePriceUsd) * 10_000;

  if (minOutRaw > quotedOutRaw) {
    return {
      maxPriceUsd, minOutRaw, quotedOutRaw, slippageBps: null, buildable: false,
      quotedDeviationBps,
      refusal:
        `The quoted fill is ${quotedDeviationBps.toFixed(1)} bp above the oracle, outside ` +
        `the ${bandBps} bp band. No tolerance can make this trade land inside the band, so ` +
        `no transaction is built.`,
    };
  }

  const slippageBps = Math.floor((1 - minOutRaw / quotedOutRaw) * 10_000);
  return {
    maxPriceUsd, minOutRaw, quotedOutRaw, buildable: true, quotedDeviationBps,
    slippageBps: Math.max(0, Math.min(SLIPPAGE_CEILING_BPS, slippageBps)),
    refusal: null,
  };
}

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

export interface GuardedQuote {
  ticker: string;
  notionalUsd: number;
  bandBps: number;
  oracle: { priceUsd: number; ageSecs: number; shard: number };
  derivation: BandDerivation;
  /** The quote Jupiter returned, carried through so /swap can build from it. */
  quoteResponse: Record<string, unknown>;
  capturedAt: string;
}

/**
 * Quotes at the widest tolerance Jupiter allows so the number coming back is the pool's
 * honest output rather than one already shaped by a slippage assumption. The band is
 * applied afterwards, here.
 */
export async function getGuardedQuote(
  ticker: string,
  notionalUsd: number,
  bandBps: number = DEFAULT_BAND_BPS,
): Promise<GuardedQuote> {
  const market = MARKETS[ticker];
  if (!market) throw new Error(`unknown ticker ${ticker}`);

  const amount = Math.round(notionalUsd * 10 ** USDC_DECIMALS);
  const url =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${market.mint}` +
    `&amount=${amount}&slippageBps=${SLIPPAGE_CEILING_BPS}`;

  const conn = new Connection(RPC, "confirmed");
  const [info, response] = await Promise.all([
    conn.getAccountInfo(priceFeedAccount(SHARD, market.feedId)),
    fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) }),
  ]);

  if (!info) throw new Error(`no shard-${SHARD} Pyth account for ${ticker}`);
  if (!response.ok) throw new Error(`Jupiter ${response.status}`);
  const quoteResponse = await response.json();
  if (!quoteResponse || quoteResponse.error || !quoteResponse.outAmount) {
    throw new Error(quoteResponse?.error ?? "no route");
  }

  const oracle = parsePriceUpdateV2(info.data);
  const derivation = deriveBand({
    oraclePriceUsd: oracle.price,
    notionalUsd,
    quotedOutRaw: Number(quoteResponse.outAmount),
    decimals: market.decimals,
    bandBps,
  });

  // Jupiter builds the transaction from the quote's own slippageBps, so the band has to be
  // written back into the quote rather than passed alongside it.
  if (derivation.buildable) {
    quoteResponse.slippageBps = derivation.slippageBps;
    quoteResponse.otherAmountThreshold = String(derivation.minOutRaw);
  }

  return {
    ticker,
    notionalUsd,
    bandBps,
    oracle: {
      priceUsd: oracle.price,
      ageSecs: Math.floor(Date.now() / 1000) - oracle.publishTime,
      shard: SHARD,
    },
    derivation,
    quoteResponse,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Builds the transaction. Refuses rather than widening the band, which is the whole point:
 * a trade that cannot land inside the band is not a trade this will help you make.
 */
export async function buildGuardedSwap(quote: GuardedQuote, userPublicKey: string) {
  if (!quote.derivation.buildable) throw new Error(quote.derivation.refusal ?? "outside band");

  const response = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote.quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Jupiter swap ${response.status}`);

  const built = await response.json();
  if (!built?.swapTransaction) throw new Error(built?.error ?? "no transaction returned");
  return { swapTransaction: built.swapTransaction as string, lastValidBlockHeight: built.lastValidBlockHeight };
}

/** Jupiter's route instruction rejects a fill under the threshold with this. */
const JUPITER_SLIPPAGE_ERROR = 6001;

export interface Simulation {
  ok: boolean;
  /** Which kind of failure, so the page never reports a funding problem as a band problem. */
  reason: "ok" | "insufficient-funds" | "band-rejected" | "failed";
  message: string;
  unitsConsumed: number | null;
  logs: string[];
}

/**
 * Runs the built transaction against live mainnet state without signing or spending.
 *
 * The reason matters more than the pass/fail. An unfunded wallet fails here on balance,
 * which says nothing about the band, and reporting that as a rejected band would be a lie
 * in the direction that flatters the project. A fill refused under the threshold fails with
 * Jupiter's 6001 instead, and that is the case worth showing.
 */
export async function simulateGuardedSwap(swapTransaction: string): Promise<Simulation> {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const conn = new Connection(RPC, "confirmed");
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));

  const { value } = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  const logs = value.logs ?? [];
  if (!value.err) {
    return {
      ok: true, reason: "ok", unitsConsumed: value.unitsConsumed ?? null, logs,
      message: "Simulated against live mainnet state: this fill would land inside the band.",
    };
  }

  const text = JSON.stringify(value.err);
  const joined = logs.join("\n");

  if (joined.includes(`custom program error: 0x${JUPITER_SLIPPAGE_ERROR.toString(16)}`)
    || joined.includes("SlippageToleranceExceeded")) {
    return {
      ok: false, reason: "band-rejected", unitsConsumed: value.unitsConsumed ?? null, logs,
      message: "The router refused the fill: it would have landed outside the oracle band.",
    };
  }

  // AccountNotFound means the wallet has no USDC token account at all, which is the same
  // problem as an empty one from the trader's point of view and should not be reported as
  // a bare error code.
  if (/insufficient (lamports|funds)/i.test(joined)
    || /InsufficientFunds/i.test(text)
    || /AccountNotFound/i.test(text)) {
    return {
      ok: false, reason: "insufficient-funds", unitsConsumed: value.unitsConsumed ?? null, logs,
      message: "This wallet does not hold the USDC for the trade, so the fill could not be "
        + "simulated. The band itself was never tested — fund the wallet to check it.",
    };
  }

  return {
    ok: false, reason: "failed", unitsConsumed: value.unitsConsumed ?? null, logs,
    message: `Simulation failed before reaching the band check: ${text}`,
  };
}
