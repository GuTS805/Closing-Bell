"use client";

import { useState } from "react";

/**
 * The premium over time, which is the finding the rest of the page only asserts.
 *
 * Two things this drawing has to get right or it lies:
 *
 *   The zero line is the subject, not decoration. TSLA's whole claim is that it sits on
 *   zero while the others sit above it, so zero is drawn as a real axis rather than
 *   letting the y-range float to fit the data.
 *
 *   The sampler has stopped and restarted, leaving holes of hours. A line drawn across a
 *   hole would assert continuity nobody measured, so each run is its own polyline and the
 *   breaks are marked. The x-axis is observed time, not wall-clock — the gaps are removed
 *   rather than compressed, which is why it is labelled as elapsed sampling.
 */

interface Point {
  t: number;
  bps: number;
}

interface SeriesFile {
  usableSamples: number;
  sessions: number;
  observedHours: number;
  sampleIntervalSecs: number;
  series: Record<string, Point[][]>;
}

interface Props {
  data: SeriesFile;
}

const W = 720;
const H = 300;
const PAD = { top: 16, right: 54, bottom: 30, left: 40 };

/** Gold is this project's colour for the wrapper premium; the control gets the red. */
const STYLE: Record<string, { stroke: string; width: number; label: string }> = {
  SPY: { stroke: "var(--gold-bright)", width: 1.8, label: "SPY" },
  AAPL: { stroke: "var(--gold)", width: 1.4, label: "AAPL" },
  NVDA: { stroke: "var(--blue)", width: 1.4, label: "NVDA" },
  TSLA: { stroke: "var(--red)", width: 1.6, label: "TSLA — control" },
};

const ORDER = ["SPY", "AAPL", "NVDA", "TSLA"];

export default function BasisChart({ data }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  // One x-step per sample, sessions laid end to end. Wall-clock spacing would devote most
  // of the chart to hours when nothing was running.
  const counts = ORDER.map((s) => (data.series[s] ?? []).flat().length);
  const steps = Math.max(...counts, 1);

  const all = ORDER.flatMap((s) => (data.series[s] ?? []).flat().map((p) => p.bps));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.12 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const x = (i: number) =>
    PAD.left + (i / Math.max(1, steps - 1)) * (W - PAD.left - PAD.right);
  const y = (bps: number) =>
    PAD.top + ((yMax - bps) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  // Session boundaries, taken from the longest series so the marks line up with the axis.
  const reference = data.series[ORDER[0]] ?? [];
  const breaks: number[] = [];
  let running = 0;
  for (let s = 0; s < reference.length - 1; s++) {
    running += reference[s].length;
    breaks.push(running);
  }

  const ticks = [-40, -20, 0, 20, 40, 60, 80].filter((t) => t >= yMin && t <= yMax);

  return (
    <figure className="research-series m-0">
      <div className="research-chart-heading"><h3>Premium over the sampling period</h3><span>Basis points · session gaps removed</span></div>
      <div className="research-series-scroll">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Recorded wrapper premiums over ${data.observedHours} observed hours across ${data.sessions} sessions. Negative premiums and sampling restarts are shown. Select a stock below to highlight its series.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--ink-faint)" : "var(--rule)"}
              strokeWidth={t === 0 ? 1 : 0.5}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize="10"
              fill="var(--ink-faint)"
            >
              {t}
            </text>
          </g>
        ))}

        {breaks.map((b) => (
          <g key={b}>
            <line
              x1={x(b)}
              x2={x(b)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--rule-bright)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={x(b) + 4}
              y={PAD.top + 9}
              fontSize="9"
              fill="var(--ink-faint)"
            >
              restart
            </text>
          </g>
        ))}

        {ORDER.map((sym) => {
          const segments = data.series[sym] ?? [];
          const style = STYLE[sym];
          let offset = 0;
          return (
            <g key={sym} opacity={selected && selected !== sym ? 0.15 : 1}>
              {segments.map((seg, si) => {
                const start = offset;
                offset += seg.length;

                // A freshly restarted sampler has one sample in its newest session, and a
                // one-point path draws nothing at all — the sample would silently vanish
                // from a chart that claims to show every usable one. Draw it as a dot.
                if (seg.length === 1) {
                  return (
                    <circle
                      key={si}
                      cx={x(start)}
                      cy={y(seg[0].bps)}
                      r={style.width}
                      fill={style.stroke}
                    />
                  );
                }

                const d = seg
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${x(start + i).toFixed(1)} ${y(p.bps).toFixed(1)}`)
                  .join(" ");
                return (
                  <path
                    key={si}
                    d={d}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={style.width}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          );
        })}

        {/* End labels, nudged apart where two series finish close together — NVDA and
            TSLA can end within a few basis points of each other and overlap illegibly. */}
        {(() => {
          const MIN_GAP = 11;
          const placed = ORDER.map((sym) => {
            const flat = (data.series[sym] ?? []).flat();
            return flat.length
              ? { sym, at: y(flat[flat.length - 1].bps) }
              : null;
          })
            .filter((v): v is { sym: string; at: number } => v !== null)
            .sort((a, b) => a.at - b.at);

          for (let i = 1; i < placed.length; i++) {
            if (placed[i].at - placed[i - 1].at < MIN_GAP) {
              placed[i].at = placed[i - 1].at + MIN_GAP;
            }
          }

          return placed.map(({ sym, at }) => (
            <text
              key={sym}
              x={W - PAD.right + 6}
              y={at + 3.5}
              fontSize="10"
              fill={STYLE[sym].stroke}
            >
              {sym}
            </text>
          ));
        })()}

        <text x={PAD.left} y={H - 8} fontSize="10" fill="var(--ink-faint)">
          {data.observedHours}h of sampling across {data.sessions} sessions, gaps removed
        </text>
        <text
          x={PAD.left - 8}
          y={PAD.top - 5}
          textAnchor="end"
          fontSize="10"
          fill="var(--ink-faint)"
        >
          bp
        </text>
      </svg>
      </div>

      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-faint">
        {ORDER.map((sym) => (
          <button type="button" key={sym} aria-pressed={selected === sym} onClick={() => setSelected(selected === sym ? null : sym)} className="research-series-toggle flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-[2px] w-4"
              style={{ background: STYLE[sym].stroke }}
            />
            {STYLE[sym].label}
          </button>
        ))}
        <span className="research-legend-hint">Select a stock to highlight · select again to reset</span>
      </figcaption>
    </figure>
  );
}
