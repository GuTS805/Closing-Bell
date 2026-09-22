import { NextResponse } from "next/server";
import { getTradeSizeCurve, MARKETS } from "../../lib/truecost";

export const maxDuration = 60;

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker") ?? "SPYx";
  if (!Object.hasOwn(MARKETS, ticker)) {
    return NextResponse.json({ error: "Unknown ticker" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getTradeSizeCurve(ticker), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Quote sweep failed" }, { status: 502 });
  }
}
