"use client";

import { useEffect, useRef, useState } from "react";
import type { TradeSizeCurveResult } from "../lib/truecost";

export default function TradeSizeChart({ ticker }: { ticker: string }) {
  const [data, setData] = useState<TradeSizeCurveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function measure() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError(null); setData(null);
    try {
      const response = await fetch(`/api/trade-size?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store", signal: request.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Quote sweep failed");
      if (!request.signal.aborted) setData(result);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Quote sweep failed");
    } finally { if (!request.signal.aborted) setLoading(false); }
  }

  const values = data ? [0, data.premiumBps, ...data.points.flatMap(p => p.impactBps === null ? [] : [p.impactBps])] : [0, 1];
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * 0.15, 2);
  const min = low - padding, max = high + padding;
  const y = (v: number) => 275 - (v - min) / (max - min) * 235;
  const sizes = data?.points.map(p => p.notional) ?? [1, 10];
  const logMin = Math.log10(Math.min(...sizes)), logMax = Math.log10(Math.max(...sizes));
  const x = (v: number) => 65 + (Math.log10(v) - logMin) / (logMax - logMin || 1) * 565;
  let connected = false;
  const path = data?.points.map(p => {
    if (p.impactBps === null) { connected = false; return ""; }
    const command = connected ? "L" : "M"; connected = true;
    return `${command} ${x(p.notional)} ${y(p.impactBps)}`;
  }).join(" ");

  return <section className="trade-size-section">
    <div className="research-chart-heading"><div><div className="research-kicker">EXECUTION AT DIFFERENT SIZES</div><h2>Premium vs trade size</h2></div><button type="button" className="curve-load" onClick={measure} disabled={loading}>{loading ? "Measuring..." : data ? "Refresh quotes" : `Measure ${ticker}`}</button></div>
    <p className="text-[13px] text-ink-dim">Compare the wrapper premium with the fill-price impact at five trade sizes, starting with a budget for approximately one token.</p>
    <div aria-live="polite">
      {loading && <p className="curve-message">Requesting Jupiter quotes against one shared pool-mid and Pyth reference...</p>}
      {error && <p className="curve-message text-signal-red">Quotes unavailable: {error}. Try measuring again.</p>}
      {!data && !loading && !error && <p className="curve-message">Run a quote sweep to see measured values for {ticker}.</p>}
    </div>
    {data && <figure className="evidence-chart">
      <div className="evidence-chart-scroll"><svg viewBox="0 0 720 345" role="img" aria-label={`Premium and pool impact by trade size for ${ticker}. Exact quotes and unavailable sizes are listed below.`}>
        {Array.from({ length: 5 }, (_, i) => min + (max-min)*i/4).map(v => <g key={v}><line x1="65" x2="630" y1={y(v)} y2={y(v)} stroke="var(--rule)"/><text x="53" y={y(v)+4} textAnchor="end">{v.toFixed(1)}</text></g>)}
        <line x1="65" x2="630" y1={y(0)} y2={y(0)} stroke="var(--ink-faint)" strokeDasharray="3 4"/>
        <line x1="65" x2="630" y1={y(data.premiumBps)} y2={y(data.premiumBps)} stroke="var(--gold)" strokeWidth="2.5" strokeDasharray="7 4"/>
        <path d={path} fill="none" stroke="var(--blue)" strokeWidth="2.5"/>
        {data.points.map(p => <g key={p.label}>{p.impactBps !== null && <circle cx={x(p.notional)} cy={y(p.impactBps)} r="5" fill="var(--blue)"><title>{`${p.label}: ${p.impactBps.toFixed(2)} bp impact`}</title></circle>}<text x={x(p.notional)} y="299" textAnchor="middle">{p.label}</text></g>)}
        <text x="65" y="23">Basis points</text><text x="350" y="331" textAnchor="middle">Trade notional in USD (logarithmic scale)</text>
      </svg></div>
      <div className="curve-legend"><span><i style={{ background: "var(--gold)" }}/>Wrapper premium (shared baseline)</span><span><i style={{ background: "var(--blue)" }}/>Pool impact (quoted fills)</span></div>
      <figcaption className="research-footnote">The premium line is flat by construction: all fills use the same measured pool mid and underlying price. Impact includes spread and is not forced to rise. Quotes are collected over a window, not simultaneously; connecting lines are guides, not additional quotes. Missing quotes leave gaps. The smallest budget equals one token at the reference mid; actual tokens received may differ.</figcaption>
      <p className="research-footnote">Quote window: {data.startedAt} to {data.capturedAt}. Oracle age at reference: {data.oracleAgeSecs}s.</p>
      <details className="chart-data"><summary>View measured quotes and unavailable sizes</summary><div className="research-table-wrap"><table className="research-table"><thead><tr><th scope="col">Size</th><th scope="col">Budget (USD)</th><th scope="col">Premium</th><th scope="col">Pool impact</th></tr></thead><tbody>{data.points.map(p => <tr key={p.label}><th scope="row">{p.label}</th><td>${p.notional.toFixed(2)}</td><td>{data.premiumBps.toFixed(2)} bp</td><td>{p.impactBps === null ? `Unavailable: ${p.error}` : `${p.impactBps.toFixed(2)} bp`}</td></tr>)}</tbody></table></div></details>
    </figure>}
  </section>;
}
