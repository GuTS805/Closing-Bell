/**
 * Turns the sampler's log into the series the findings page charts.
 *
 * Baked into the app as a static file rather than read at request time: the log lives
 * outside the Next.js app directory, and a chart of a fixed historical window has no
 * reason to cost an RPC call on every page view.
 *
 * Sessions matter here. The sampler has died and been restarted, leaving a 62-hour hole,
 * and a line drawn straight across that hole would assert continuity nobody measured. Each
 * run of samples is emitted as its own segment so the chart can break the line instead.
 *
 * Run:  npx tsx scripts/build-series-json.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

const IN = "replay/basis-dense.jsonl";
const OUT = "app/public/basis-series.json";

/** Same rule the analysis uses: wider than this and the two legs saw different markets. */
const MAX_SPREAD_BPS = 100;
/** A hole longer than a few sample intervals is a restart, not a slow sample. */
const SESSION_GAP_SECS = 900;

interface Row {
  t: number;
  sym: string;
  midBps?: number;
  spreadBps?: number;
}

interface Point {
  t: number;
  bps: number;
}

function main() {
  const rows: Row[] = readFileSync(IN, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const usable = rows.filter(
    (r) =>
      typeof r.midBps === "number" &&
      Number.isFinite(r.midBps) &&
      Math.abs(r.spreadBps ?? 0) <= MAX_SPREAD_BPS
  );

  const symbols = [...new Set(usable.map((r) => r.sym))].sort();

  // Session boundaries are global, not per-symbol: every ticker is sampled in the same
  // loop, so they start and stop together and share one timeline.
  const times = [...new Set(usable.map((r) => r.t))].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > SESSION_GAP_SECS) cuts.push(times[i]);
  }

  const sessionOf = (t: number) => {
    let s = 0;
    for (const c of cuts) if (t >= c) s++;
    return s;
  };

  const series: Record<string, Point[][]> = {};
  for (const sym of symbols) {
    const segments: Point[][] = [];
    for (const r of usable
      .filter((x) => x.sym === sym)
      .sort((a, b) => a.t - b.t)) {
      const s = sessionOf(r.t);
      (segments[s] ??= []).push({ t: r.t, bps: Math.round(r.midBps! * 10) / 10 });
    }
    series[sym] = segments.filter(Boolean);
  }

  const observedSecs = times
    .slice(1)
    .reduce((sum, t, i) => (t - times[i] <= SESSION_GAP_SECS ? sum + (t - times[i]) : sum), 0);

  const payload = {
    generatedAt: new Date().toISOString(),
    sampleIntervalSecs: 180,
    usableSamples: usable.length,
    discarded: rows.length - usable.length,
    sessions: cuts.length + 1,
    observedHours: Math.round((observedSecs / 3600) * 10) / 10,
    series,
  };

  writeFileSync(OUT, JSON.stringify(payload));
  console.log(
    `${OUT}: ${usable.length} samples, ${symbols.length} series, ` +
      `${payload.sessions} sessions, ${payload.observedHours}h observed`
  );
  for (const sym of symbols) {
    console.log(`  ${sym.padEnd(6)} ${series[sym].map((s) => s.length).join(" + ")} points`);
  }
}

main();
