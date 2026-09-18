/**
 * What actually explains the wrapper premium?
 *
 * The dividend story orders correctly on five of six tickers, so the test is whether a
 * size/demand variable explains all six — including NVDA, which breaks the dividend story.
 *
 * All dividend yields below are verified from public sources, not estimated. That matters:
 * an earlier pass used a guessed NVDA yield of ~0.02%/yr and concluded NVDA implied 55
 * months of accrual. The real figure is 0.46%, which is HIGHER than AAPL (0.32%) and
 * GOOGL (0.23%) — so under any common-accrual-window model NVDA should carry the largest
 * premium of those three, and it carries the smallest. The inversion is the finding.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

function feedAccount(shard: number, hex: string): PublicKey {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(shard, 0);
  return PublicKey.findProgramAddressSync([b, Buffer.from(hex, "hex")], PYTH_PUSH_ORACLE)[0];
}
function parse(d: Buffer) {
  let o = 40;
  o += d.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const p = d.readBigInt64LE(o); o += 8;
  d.readBigUInt64LE(o); o += 8;
  const e = d.readInt32LE(o);
  return { price: Number(p) * 10 ** e };
}

interface Row {
  sym: string; mint: string; feed: string;
  /** Crypto.<T>X/<T>.RR, read on-chain 2026-09-18, in bps over 1.0 */
  rr: number;
  /** Annual dividend yield in bps. Verified, not estimated. */
  yieldBps: number;
  /** Jupiter reported liquidity, 2026-09-18 */
  liq: number;
}

const T: Row[] = [
  { sym: "SPY",  rr: 57.1, yieldBps: 98, liq: 7_343_371,
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    feed: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5" },
  { sym: "QQQ",  rr: 27.3, yieldBps: 40, liq: 1_808_058,
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    feed: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d" },
  { sym: "AAPL", rr: 26.6, yieldBps: 32, liq: 655_523,
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    feed: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" },
  { sym: "GOOGL", rr: 19.3, yieldBps: 23, liq: 457_374,
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    feed: "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6" },
  { sym: "NVDA", rr: 9.2,  yieldBps: 46, liq: 2_064_716,
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    feed: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593" },
  { sym: "TSLA", rr: 0.0,  yieldBps: 0,  liq: 1_344_772,
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    feed: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1" },
];

const sleep = (m: number) => new Promise((r) => setTimeout(r, m));

function corr(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.map((x, i) => (x - mx) * (ys[i] - my)).reduce((a, b) => a + b, 0) / n;
  const sx = Math.sqrt(xs.map((x) => (x - mx) ** 2).reduce((a, b) => a + b, 0) / n);
  const sy = Math.sqrt(ys.map((y) => (y - my) ** 2).reduce((a, b) => a + b, 0) / n);
  return cov / (sx * sy);
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const out: any[] = [];

  console.log("tkr    supply     price     AUM $m   liq $k   yield   RR bp   implied accrual");
  console.log("-".repeat(82));

  for (const t of T) {
    let price = 0;
    const i = await conn.getAccountInfo(feedAccount(1, t.feed));
    if (i) price = parse(i.data).price;
    await sleep(500);
    let supply = 0;
    try {
      const s = await conn.getTokenSupply(new PublicKey(t.mint));
      supply = Number(s.value.uiAmountString);
    } catch { /* rate limited */ }
    const aum = supply * price;
    const impliedMonths = t.yieldBps > 0 ? (t.rr / t.yieldBps) * 12 : null;

    console.log(
      `${t.sym.padEnd(6)}${supply.toFixed(0).padStart(9)}${price.toFixed(2).padStart(10)}` +
      `${(aum / 1e6).toFixed(1).padStart(10)}${(t.liq / 1e3).toFixed(0).padStart(9)}` +
      `${(t.yieldBps / 100).toFixed(2).padStart(7)}%${t.rr.toFixed(1).padStart(8)}` +
      `${(impliedMonths === null ? "n/a" : impliedMonths.toFixed(1) + " mo").padStart(16)}`
    );
    out.push({ ...t, price, supply, aum, impliedMonths });
    await sleep(700);
  }

  const ok = out.filter((o) => o.price > 0 && o.supply > 0);
  const rr = ok.map((o) => o.rr);
  console.log(`\nusable rows: ${ok.length}/${out.length}`);
  console.log(`RR vs dividend yield : ${corr(ok.map((o) => o.yieldBps), rr).toFixed(3)}`);
  console.log(`RR vs AUM            : ${corr(ok.map((o) => o.aum), rr).toFixed(3)}`);
  console.log(`RR vs liquidity      : ${corr(ok.map((o) => o.liq), rr).toFixed(3)}`);
  console.log(`RR vs supply         : ${corr(ok.map((o) => o.supply), rr).toFixed(3)}`);

  const noNvda = ok.filter((o) => o.sym !== "NVDA");
  console.log(
    `\nRR vs yield, excluding NVDA : ${corr(noNvda.map((o) => o.yieldBps), noNvda.map((o) => o.rr)).toFixed(3)}`
  );

  writeFileSync("replay/wrapper-size.json", JSON.stringify(out, null, 2));
  console.log("\nwrote replay/wrapper-size.json");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
