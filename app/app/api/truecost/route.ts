import { NextResponse } from "next/server";
import { getTrueCost } from "../../lib/truecost";

export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker") ?? "AAPLx";
  const notional = Math.max(100, Number(searchParams.get("notional") ?? 50_000));

  try {
    const result = await getTrueCost(ticker, notional);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
