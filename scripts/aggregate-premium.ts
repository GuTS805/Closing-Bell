/**
 * Totals the wrapper premium sitting inside circulating supply right now.
 *
 * The rest of this repo proves the premium exists on a single trade, which is the
 * rigorous claim but a small one. This is the same measurement at the scale that decides
 * whether it matters: every token in existence, priced against the equity it wraps.
 *
 * Two things this number is NOT, and the page says so too:
 *   - it is premium CARRIED, not losses taken. The tokens really are worth pool mid
 *     on-chain; the gap only becomes real on conversion, or if the premium converges.
 *   - circulating supply includes the pools' own inventory, so part of the total is the
 *     market making the price rather than someone holding it.
 *
 * Run:  npx tsx scripts/aggregate-premium.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Mainnet's fresh shard. Shard 0 was 34.5 days stale and 10% wrong. */
const SHARD = 1;
/** Small enough that pool impact on the mid probe is negligible. */
const MID_PROBE_USD = 2_000;

const MARKETS = [
  { tkr: "SPYx", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", decimals: 8 },
  { tkr: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", decimals: 8 },
  { tkr: "TSLAx", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", feedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", decimals: 8 },
  { tkr: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", decimals: 8 },
];

function priceFeedAccount(shard: number, feedIdHex: string) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync(
    [b, Buffer.from(feedIdHex, "hex")],
    PYTH_PUSH_ORACLE
  )[0];
}

function parsePriceUpdateV2(d: Buffer) {
  let o = 8 + 32;
  o += d.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = d.readBigInt64LE(o); o += 8;
  o += 8;
  const expo = d.readInt32LE(o);
  return Number(price) * 10 ** expo;
}

async function jupQuote(inputMint: string, outputMint: string, amount: number) {
  const url =
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=10000`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Jupiter ${r.status}`);
  const q = await r.json();
  if (!q?.outAmount) throw new Error(q?.error ?? "no route");
  return Number(q.outAmount);
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

async function main() {
  const conn = new Connection(RPC, "confirmed");

  let totalValue = 0;
  let totalPremium = 0;

  console.log("tkr     supply        market value      premium bp     premium carried");

  for (const m of MARKETS) {
    const scale = 10 ** m.decimals;

    const info = await conn.getAccountInfo(priceFeedAccount(SHARD, m.feedId));
    if (!info) throw new Error(`no shard-${SHARD} Pyth account for ${m.tkr}`);
    const oracle = parsePriceUpdateV2(info.data);

    // Both legs at the same notional, so the spread cancels out of the midpoint.
    const bought = await jupQuote(USDC, m.mint, MID_PROBE_USD * 1e6);
    const soldBack = await jupQuote(m.mint, USDC, bought);
    const buyPx = MID_PROBE_USD / (bought / scale);
    const sellPx = soldBack / 1e6 / (bought / scale);
    const mid = (buyPx + sellPx) / 2;

    const supply = (await conn.getTokenSupply(new PublicKey(m.mint))).value.uiAmount ?? 0;
    const premiumBps = ((mid - oracle) / oracle) * 10_000;
    const value = supply * mid;
    const premium = value - supply * oracle;

    totalValue += value;
    totalPremium += premium;

    console.log(
      m.tkr.padEnd(7) +
        supply.toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(10) +
        usd(value).padStart(18) +
        premiumBps.toFixed(1).padStart(14) +
        usd(premium).padStart(20)
    );
  }

  console.log("-".repeat(69));
  console.log(
    "total".padEnd(17) + usd(totalValue).padStart(18) + usd(totalPremium).padStart(34)
  );
  console.log(`
Premium CARRIED, not lost: the tokens are worth pool mid on-chain, and the gap becomes
real only on conversion or if the premium converges. Circulating supply also includes the
pools' own inventory, so part of this is the market making the price.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
