import ChartReadout from "./ChartReadout";

interface Observation { t: string; note: string; bps: number }

export default function ExDividendChart({ observations }: { observations: Observation[] }) {
  const baseline = observations[0].bps;
  const x = (i: number) => 65 + i * 175;
  const y = (change: number) => 210 - change * 4.5;
  return (
    <figure className="research-plot evidence-chart">
      <div className="research-chart-heading"><h3>The step that did not appear</h3><span>Change from the pre-open premium (bp)</span></div>
      <ChartReadout width={760} height={360} label="Ex-dividend observations" duplicated points={observations.map((p, i) => ({ x: x(i), y: y(p.bps-baseline), text: `${p.t} / ${p.bps} bp / ${p.note || "Later observation"}` }))}>
        <svg viewBox="0 0 760 360" role="img" aria-label="Predicted premium change: plus 25 basis points. Observed first post-open change: minus 5.4 basis points. Difference: approximately 30.4 basis points.">
          {[-20, -10, 0, 10, 20, 30].map(v => <g key={v}><line x1="65" x2="610" y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--ink-faint)" : "var(--rule)"}/><text x="52" y={y(v)+4} textAnchor="end">{v > 0 ? `+${v}` : v}</text></g>)}
          <rect x="145" y="45" width="95" height="265" fill="var(--gold)" opacity="0.05"/>
          <text x="152" y="25">Opening interval</text>
          <path d={`M 65 ${y(0)} H 152 V ${y(25)} H 610`} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeDasharray="7 5"/>
          <path d={observations.map((p,i) => `${i ? "L" : "M"} ${x(i)} ${y(p.bps-baseline)}`).join(" ")} fill="none" stroke="var(--blue)" strokeWidth="2.5"/>
          <line x1="255" x2="255" y1={y(25)} y2={y(-5.4)} stroke="var(--red)" strokeWidth="1.5"/>
          <path d={`M 250 ${y(25)} h 10 M 250 ${y(-5.4)} h 10`} stroke="var(--red)"/>
          <text x="270" y="155" className="research-point-label">~30.4 bp gap</text>
          <text x="625" y={y(25)+4}>Predicted +25</text>
          {observations.map((p,i) => <g key={p.t}><circle cx={x(i)} cy={y(p.bps-baseline)} r="5" fill="var(--blue)"/><text x={x(i)} y={y(p.bps-baseline)+22} textAnchor="middle">{i === 0 ? "Baseline" : `${(p.bps-baseline).toFixed(1)} bp`}</text><text x={x(i)} y="333" textAnchor="middle">{p.t}</text></g>)}
          <text x="625" y={y(-17.4)+4}>Observed</text>
        </svg>
      </ChartReadout>
      <figcaption>Dashed gold: the hypothesized +25 bp step, held constant for comparison. Solid blue: the four recorded observations, joined as a visual guide. Observations are evenly spaced; the opening marker is schematic, not an exact event timestamp. The first post-open observation is -5.4 bp from the 70.5 bp baseline.</figcaption>
      <details className="chart-data"><summary>View the four recorded values</summary><div className="research-table-wrap"><table className="research-table"><thead><tr><th scope="col">Recorded time</th><th scope="col">Observation</th><th scope="col">Premium</th></tr></thead><tbody>{observations.map(p => <tr key={p.t}><th scope="row">{p.t}</th><td>{p.note || "Later observation"}</td><td>{p.bps.toFixed(1)} bp</td></tr>)}</tbody></table></div></details>
    </figure>
  );
}
