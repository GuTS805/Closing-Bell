/**
 * Public read-only endpoint: the true cost of a tokenized-stock buy, decomposed.
 *
 * Documented in the README as an API other projects can call, so the status codes have to
 * mean what they say: a bad ticker or size is the caller's problem (400), while a feed or
 * route that could not be reached is ours (502). Collapsing both into 502 would tell an
 * integrator to retry a request that will never succeed.
 */
import { NextResponse } from "next/server";
import { getTrueCost, MARKETS } from "../../lib/truecost";

export const revalidate = 0;

/** Above this, the mid probe stops being a reliable reference for the fill. */
const MAX_NOTIONAL_USD = 10_000_000;
const MIN_NOTIONAL_USD = 100;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker") ?? "AAPLx";
  const rawNotional = searchParams.get("notional");

  if (!(ticker in MARKETS)) {
    return NextResponse.json(
      {
        error: `unknown ticker ${ticker}`,
        supported: Object.keys(MARKETS),
      },
      { status: 400 }
    );
  }

  const notional = rawNotional === null ? 50_000 : Number(rawNotional);
  if (!Number.isFinite(notional) || notional < MIN_NOTIONAL_USD || notional > MAX_NOTIONAL_USD) {
    return NextResponse.json(
      {
        error: `notional must be a number between ${MIN_NOTIONAL_USD} and ${MAX_NOTIONAL_USD}`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await getTrueCost(ticker, notional);
    return NextResponse.json(result, {
      // Cheap to serve, and the premium moves on the order of basis points per minute, so
      // a short shared cache protects the upstream RPC without making the number stale.
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
