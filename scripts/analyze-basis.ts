/**
 * Turns the basis sampler's rows into the statistics quoted on the findings page.
 *
 * The cross-sectional table elsewhere in this repo is one measurement per ticker at one
 * moment. It cannot tell a structural premium from a number that happened to be there
 * when we looked. A time series can, and the discriminator is not the mean — it is the
 * autocorrelation: a premium that persists is highly autocorrelated, while a measurement
 * artifact is not.
 *
 * TSLA is the control that makes the rest readable. It is the one ticker with no premium,
 * so if the sampler manufactured structure we would see it there too.
 *
 * Run:  npx tsx scripts/analyze-basis.ts [path]
 */
import { readFileSync } from "node:fs";

/**
 * Both legs of the mid probe must see the same market for their midpoint to mean
 * anything. A spread this wide means one leg failed to find a real route — which happened
 * once, on thin after-hours liquidity, at an implied spread of 3,572 bp. The 99th
 * percentile of every other sample is 82 bp, so this cut is not close to a judgement call.
 */
const MAX_SPREAD_BPS = 100;

interface Row {
  t: number;
  sym: string;
  midBps?: number;
  spreadBps?: number;
  oracleAge?: number;
  error?: string;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

function sd(a: number[]) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

function corr(a: number[], b: number[]) {
  if (a.length < 3) return NaN;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

const fmt = (n: number, dp = 1) => (Number.isFinite(n) ? n.toFixed(dp) : "-");

function main() {
  const path = process.argv[2] ?? "replay/basis-dense.jsonl";
  const all: Row[] = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const failed = all.filter((r) => r.error).length;
  const priced = all.filter(
    (r) => typeof r.midBps === "number" && Number.isFinite(r.midBps)
  );
  const rows = priced.filter((r) => Math.abs(r.spreadBps ?? 0) <= MAX_SPREAD_BPS);

  console.log(`samples          ${all.length}`);
  console.log(`  quote failed   ${failed}`);
  console.log(`  spread > ${MAX_SPREAD_BPS}bp  ${priced.length - rows.length}`);
  console.log(`  usable         ${rows.length}`);

  // First-to-last is not time observed. The sampler has died and been restarted, and
  // reporting the span would silently claim credit for the hours it was not running, so
  // gaps longer than a few sample intervals are measured and subtracted.
  const GAP_SECS = 900;
  const times = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b);
  const span = (times[times.length - 1] - times[0]) / 3600;
  let covered = 0;
  let gaps = 0;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d <= GAP_SECS) covered += d;
    else gaps++;
  }
  console.log(`first to last    ${span.toFixed(1)} h`);
  console.log(`actually observed ${(covered / 3600).toFixed(1)} h in ${gaps + 1} sessions\n`);

  const syms = [...new Set(rows.map((r) => r.sym))].sort();

  console.log("sym      n     mean       sd      min      max     lag1   vs age");
  for (const s of syms) {
    const series = rows.filter((r) => r.sym === s).sort((a, b) => a.t - b.t);
    const v = series.map((r) => r.midBps!);
    const ages = series.map((r) => r.oracleAge ?? 0);
    console.log(
      s.padEnd(6) +
        String(v.length).padStart(4) +
        fmt(mean(v)).padStart(9) +
        fmt(sd(v)).padStart(9) +
        fmt(Math.min(...v)).padStart(9) +
        fmt(Math.max(...v)).padStart(9) +
        fmt(corr(v.slice(0, -1), v.slice(1)), 3).padStart(9) +
        fmt(corr(v, ages), 3).padStart(9)
    );
  }

  console.log(`
lag1    correlation of each sample with the one before it. High means the premium
        persists between samples; near zero means it is noise.
vs age  correlation with the oracle's own staleness. If the premium were an artifact
        of reading a stale price, this would be strongly positive. It is not.`);
}

main();
