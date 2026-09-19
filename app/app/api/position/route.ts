/**
 * Reads a wallet's real xStock holdings and prices the structural premium sitting in each
 * one — the same wrapper-premium measurement the trade page runs, applied to a position
 * that's already held rather than a hypothetical trade.
 *
 * Read-only. No transaction is ever built here — the address is either pasted or comes
 * from a connected wallet's public key, and every value below is a GET against public
 * mainnet state.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { MARKETS, getTrueCost } from "../../lib/truecost";

export const revalidate = 0;

const RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
/** Small enough that pool impact on this probe is negligible relative to the premium. */
const PROBE_NOTIONAL_USD = 1_000;

interface ParsedTokenAccountInfo {
  info: { tokenAmount: { uiAmount: number | null } };
}

interface Holding {
  ticker: string;
  label: string;
  qty: number;
  oraclePrice: number;
  midPrice: number;
  currentValueUsd: number;
  fairValueUsd: number;
  premiumUsd: number;
  premiumBps: number;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const addressParam = searchParams.get("address");
  if (!addressParam) {
    return NextResponse.json({ error: "connect a wallet or paste an address" }, { status: 400 });
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(addressParam);
  } catch {
    return NextResponse.json({ error: "not a valid Solana address" }, { status: 400 });
  }

  try {
    const conn = new Connection(RPC, "confirmed");

    const holdings: Holding[] = [];
    for (const [ticker, m] of Object.entries(MARKETS)) {
      const accounts = await conn.getParsedTokenAccountsByOwner(owner, {
        mint: new PublicKey(m.mint),
      });
      const qty = accounts.value.reduce((sum, a) => {
        const parsed = a.account.data.parsed as ParsedTokenAccountInfo;
        return sum + (parsed.info.tokenAmount.uiAmount ?? 0);
      }, 0);
      if (qty <= 0) continue;

      const priced = await getTrueCost(ticker, PROBE_NOTIONAL_USD);
      const currentValueUsd = qty * priced.pool.midPrice;
      const fairValueUsd = qty * priced.oracle.price;

      holdings.push({
        ticker,
        label: m.label,
        qty,
        oraclePrice: priced.oracle.price,
        midPrice: priced.pool.midPrice,
        currentValueUsd,
        fairValueUsd,
        premiumUsd: currentValueUsd - fairValueUsd,
        premiumBps: priced.breakdown.wrapperPremiumBps,
      });
    }

    const totals = holdings.reduce(
      (acc, h) => ({
        currentValueUsd: acc.currentValueUsd + h.currentValueUsd,
        fairValueUsd: acc.fairValueUsd + h.fairValueUsd,
        premiumUsd: acc.premiumUsd + h.premiumUsd,
      }),
      { currentValueUsd: 0, fairValueUsd: 0, premiumUsd: 0 }
    );

    return NextResponse.json({
      address: addressParam,
      holdings,
      totals,
      capturedAt: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
