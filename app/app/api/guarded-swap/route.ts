import { NextResponse } from "next/server";
import { MARKETS } from "../../lib/truecost";
import { getGuardedQuote, buildGuardedSwap, simulateGuardedSwap, DEFAULT_BAND_BPS, MAX_BAND_BPS } from "../../lib/guardedSwap";

export const maxDuration = 60;

const MIN_NOTIONAL_USD = 100;
const MAX_NOTIONAL_USD = 10_000_000;

function readParams(url: URL) {
  const ticker = url.searchParams.get("ticker") ?? "SPYx";
  if (!Object.hasOwn(MARKETS, ticker)) {
    return { error: `unknown ticker ${ticker}`, supported: Object.keys(MARKETS) };
  }

  const notional = Number(url.searchParams.get("notional") ?? 10_000);
  if (!Number.isFinite(notional) || notional < MIN_NOTIONAL_USD || notional > MAX_NOTIONAL_USD) {
    return { error: `notional must be between ${MIN_NOTIONAL_USD} and ${MAX_NOTIONAL_USD} USD` };
  }

  const raw = url.searchParams.get("band");
  const bandBps = raw === null ? DEFAULT_BAND_BPS : Number(raw);
  if (!Number.isFinite(bandBps) || bandBps < 0 || bandBps > MAX_BAND_BPS) {
    return { error: `band must be between 0 and ${MAX_BAND_BPS} bps` };
  }

  return { ticker, notional, bandBps };
}

/** Read-only: the band and what it would demand. Builds nothing, signs nothing. */
export async function GET(request: Request) {
  const params = readParams(new URL(request.url));
  if (params.error) return NextResponse.json(params, { status: 400 });

  try {
    const quote = await getGuardedQuote(params.ticker!, params.notional!, params.bandBps!);
    // quoteResponse is Jupiter's payload, needed only to build a transaction. Returning it
    // here would be noise on an endpoint whose job is to explain the band.
    const { quoteResponse, ...readable } = quote;
    void quoteResponse;
    return NextResponse.json(readable, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "quote failed" },
      { status: 502 },
    );
  }
}

/**
 * Builds a real mainnet transaction carrying the oracle-derived threshold. Returns it
 * unsigned — this never holds a key and never submits anything.
 */
export async function POST(request: Request) {
  const params = readParams(new URL(request.url));
  if (params.error) return NextResponse.json(params, { status: 400 });

  let userPublicKey: string;
  try {
    ({ userPublicKey } = await request.json());
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof userPublicKey !== "string" || !userPublicKey) {
    return NextResponse.json({ error: "userPublicKey is required" }, { status: 400 });
  }

  try {
    const quote = await getGuardedQuote(params.ticker!, params.notional!, params.bandBps!);
    if (!quote.derivation.buildable) {
      // The refusal is the product working, not an error, so it carries the numbers that
      // justify it rather than a bare status.
      return NextResponse.json(
        {
          refused: true,
          reason: quote.derivation.refusal,
          oracle: quote.oracle,
          derivation: quote.derivation,
          bandBps: quote.bandBps,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const built = await buildGuardedSwap(quote, userPublicKey);

    // Simulated before it is handed over, so the page can refuse to offer a signature for
    // a fill that would not land. Costs nothing and spends nothing.
    let simulation = null;
    try {
      simulation = await simulateGuardedSwap(built.swapTransaction);
    } catch (error) {
      simulation = {
        ok: false, reason: "failed" as const, unitsConsumed: null, logs: [],
        message: error instanceof Error ? error.message : "could not simulate",
      };
    }

    return NextResponse.json(
      {
        refused: false,
        oracle: quote.oracle,
        derivation: quote.derivation,
        bandBps: quote.bandBps,
        simulation,
        ...built,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "build failed" },
      { status: 502 },
    );
  }
}
