import Link from "next/link";
import ChartReadout from "../components/ChartReadout";
import ExDividendChart from "../components/ExDividendChart";
import BasisChart from "../components/BasisChart";
import seriesData from "../../public/basis-series.json";

interface Row {
  tkr: string;
  aum: number;
  yieldBps: number;
  premiumBps: number;
  /** Set when this row contradicts the dividend reading. */
  breaks?: string;
}

const ROWS: Row[] = [
  { tkr: "SPY", aum: 72.9, yieldBps: 98, premiumBps: 57.1 },
  { tkr: "QQQ", aum: 60.8, yieldBps: 40, premiumBps: 27.3 },
  { tkr: "AAPL", aum: 51.9, yieldBps: 32, premiumBps: 26.6 },
  { tkr: "GOOGL", aum: 56.5, yieldBps: 23, premiumBps: 19.3 },
  {
    tkr: "NVDA",
    aum: 70.6,
    yieldBps: 46,
    premiumBps: 9.2,
    breaks: "pays more than AAPL, carries a third of its premium",
  },
  {
    tkr: "TSLA",
    aum: 83.6,
    yieldBps: 0,
    premiumBps: 0,
    breaks: "largest wrapper here, premium of exactly zero",
  },
];

const SERIES = [
  { tkr: "SPY", n: 227, mean: 53.9, sd: 5.4, lag1: 0.912 },
  { tkr: "AAPL", n: 228, mean: 27.9, sd: 11.6, lag1: 0.848 },
  { tkr: "NVDA", n: 215, mean: 11.9, sd: 10.6, lag1: 0.486 },
  { tkr: "TSLA", n: 225, mean: -4.0, sd: 8.1, lag1: 0.045, control: true },
];

const TIMELINE = [
  { t: "03:50", note: "before the open", bps: 70.5 },
  { t: "11:59", note: "after the open", bps: 65.1 },
  { t: "12:11", note: "", bps: 60.5 },
  { t: "15:07", note: "", bps: 53.1 },
];

// Ordinary least squares with an intercept, using every reported snapshot point.
const meanYield = ROWS.reduce((sum, r) => sum + r.yieldBps, 0) / ROWS.length;
const meanPremium = ROWS.reduce((sum, r) => sum + r.premiumBps, 0) / ROWS.length;
const slope = ROWS.reduce((sum, r) => sum + (r.yieldBps - meanYield) * (r.premiumBps - meanPremium), 0)
  / ROWS.reduce((sum, r) => sum + (r.yieldBps - meanYield) ** 2, 0);
const fittedPremium = (yieldBps: number) => meanPremium + slope * (yieldBps - meanYield);

export default function FindingsPage() {
  return (
    <main className="workspace-page findings-page mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <header className="research-hero">
      <div className="eyebrow page-eyebrow"><span className="status-dot" />RESEARCH & FINDINGS</div>
      <h1 className="max-w-lg font-display text-[32px] font-light leading-tight tracking-tight text-ink">
        We tried to explain the premium and could not
      </h1>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-dim">
        It tracks dividend yield closely enough to look solved, then two stocks break it
        and an experiment we ran on the day came back empty. What follows is what we
        measured, including the parts that do not fit.
      </p>

      <div className="research-scope"><span>Intraday research</span><span>1 bp = 0.01%</span><span>Explanation unresolved</span></div>
      </header>
      <dl className="research-summary">
        <div><dt>Usable samples</dt><dd>{seriesData.usableSamples.toLocaleString("en-US")}</dd><small>Across four stocks</small></div>
        <div><dt>Observed time</dt><dd>{seriesData.observedHours}<span> hours</span></dd><small>{seriesData.sessions} sampling sessions</small></div>
        <div><dt>Sampling cadence</dt><dd>{seriesData.sampleIntervalSecs / 60}<span> minutes</span></dd><small>Intraday coverage only</small></div>
        <div><dt>Research status</dt><dd className="research-status">Unresolved</dd><small>Measured, not explained</small></div>
      </dl>
      <nav className="research-nav" aria-label="Research sections">
        <a href="#stability"><span>01</span> Stability</a><a href="#comparison"><span>02</span> Cross-stock evidence</a><a href="#experiment"><span>03</span> The experiment</a><a href="#conclusion"><span>04</span> Conclusion</a>
      </nav>

      {/* the premium as a series, not a snapshot */}
      <section id="stability" className="research-section mt-14">
        <div className="research-kicker">01 / THE TIME SERIES</div>
        <h2 className="font-display text-[19px] text-ink">First, is it even stable?</h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-dim">
          Everything below this is one measurement per stock at one moment, which cannot
          tell a structural premium from a number that happened to be there when we
          looked. So we sampled every three minutes and asked a different question: does
          each sample predict the next one?
        </p>

        <div className="mt-7">
          <BasisChart data={seriesData} />
        </div>

        <p className="mt-6 max-w-xl text-[14px] leading-relaxed text-ink-dim">
          The shape is the argument. SPY holds a band roughly five basis points wide for
          hours at a time; Tesla crosses its own zero line again and again. Same sampler,
          same three-minute cadence, same moments.
        </p>

        <div className="research-table-wrap">
          <table className="research-table">
            <caption>Series summary - premium in basis points</caption>
            <thead><tr><th scope="col">Stock</th><th scope="col">Samples</th><th scope="col">Mean &plusmn; SD</th><th scope="col">Persistence (lag 1)</th></tr></thead>
            <tbody>{SERIES.map(r => <tr key={r.tkr}>
              <th scope="row">{r.tkr}{r.control && <span className="research-tag">Control</span>}</th>
              <td>{r.n}</td><td>{r.mean.toFixed(1)} &plusmn; {r.sd.toFixed(1)} bp</td>
              <td><Bar value={r.lag1 * 100} max={100} label={r.lag1.toFixed(3)} tone={r.control ? "red" : "gold"} /></td>
            </tr>)}</tbody>
          </table>
          <p className="research-footnote">Persistence is the correlation with the next sample. TSLA control: the one stock with no premium, and the only one with no structure.</p>
        </div>

        <p className="mt-6 max-w-xl border-l-2 border-gold/40 pl-4 text-[14px] leading-relaxed text-ink-dim">
          Tesla is what makes the rest readable. Every stock carrying a premium predicts
          itself three minutes later at{" "}
          <span className="tabular text-ink">0.85 to 0.91</span>. Tesla, which carries none,
          sits at <span className="tabular text-ink">0.05</span> — indistinguishable from
          noise. The sampler finds structure where a premium exists and none where it does
          not, which is what rules out our own measurement as the thing producing it.
        </p>

        <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-ink-faint">
          {seriesData.usableSamples.toLocaleString("en-US")} usable samples over{" "}
          {seriesData.observedHours} hours in {seriesData.sessions} sessions. Three were discarded by a
          stated 1% spread rule — one a genuine after-hours route failure at 36%, two
          merely wide at 1.2%; the 99th percentile of every other sample is 0.80%. Premium
          correlates with oracle staleness at −0.36 to +0.04, so a stale price is not it.
          This is intraday evidence only — we have no overnight or weekend coverage.
        </p>
      </section>
      {/* correlation, shown rather than asserted */}
      <section id="comparison" className="research-section mt-14">
        <div className="research-kicker">02 / CROSS-STOCK EVIDENCE</div>
        <h2 className="font-display text-[19px] text-ink">
          It is not pool size, and it is not liquidity
        </h2>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-dim">
          If demand drove the premium, the biggest wrappers would carry the most of it.
          Dividend yield plotted against each stock&rsquo;s premium:
        </p>

        <div className="research-evidence-grid">
          <figure className="research-plot">
            <div className="research-chart-heading"><h3>Dividend yield vs premium</h3><span>6-stock snapshot</span></div>
            <ChartReadout width={480} height={320} label="Dividend yield and premium" duplicated points={ROWS.map(r => ({ x: 50+r.yieldBps*3.65, y: 260-r.premiumBps*3.5, text: `${r.tkr} / ${(r.yieldBps / 100).toFixed(2)}% yield / ${r.premiumBps} bp premium` }))}>
            <svg viewBox="0 0 480 320" role="img" aria-label="Scatter plot of the six reported dividend yields and premiums. Exact values are in the adjacent table.">
              {[0,20,40,60].map(v => <g key={v}><line x1="50" x2="435" y1={260-v*3.5} y2={260-v*3.5} stroke="var(--rule)"/><text x="40" y={264-v*3.5} textAnchor="end">{v}</text></g>)}
              {[0,25,50,75,100].map(v => <g key={v}><line x1={50+v*3.65} x2={50+v*3.65} y1="40" y2="260" stroke="var(--rule)" strokeDasharray="3 5"/><text x={50+v*3.65} y="282" textAnchor="middle">{(v/100).toFixed(2)}%</text></g>)}
              <text x="50" y="23">Premium (bp)</text><text x="240" y="311" textAnchor="middle">Dividend yield</text>
              <line x1="50" x2="415" y1={260-fittedPremium(0)*3.5} y2={260-fittedPremium(100)*3.5} stroke="var(--ink-faint)" strokeWidth="1.5" strokeDasharray="6 5" />
              {ROWS.map(r => <g key={r.tkr}>{r.breaks && <circle cx={50+r.yieldBps*3.65} cy={260-r.premiumBps*3.5} r="12" fill="none" stroke="var(--red)" strokeWidth="1.5" />}<circle cx={50+r.yieldBps*3.65} cy={260-r.premiumBps*3.5} r="6" fill={r.breaks ? "var(--red)" : "var(--gold)"}><title>{`${r.tkr}: ${(r.yieldBps/100).toFixed(2)}% yield, ${r.premiumBps} bp premium`}</title></circle><text x={50+r.yieldBps*3.65+(["SPY", "AAPL"].includes(r.tkr) ? -12 : 10)} y={260-r.premiumBps*3.5-10} textAnchor={["SPY", "AAPL"].includes(r.tkr) ? "end" : "start"} className="research-point-label">{r.tkr}</text></g>)}
            </svg>
            </ChartReadout>
            <figcaption>Dashed line: ordinary least-squares fit across all six stocks, with an intercept. Circled NVDA falls below the dividend trend. Circled TSLA is the zero-yield control that challenges the size/demand explanation; it does not break the dividend trend. Correlation is not a causal explanation.</figcaption>
          </figure>
          <div className="research-table-wrap">
            <table className="research-table">
              <caption>Reported snapshot - original stock order</caption>
              <thead><tr><th scope="col">Stock</th><th scope="col">Yield</th><th scope="col">Premium</th><th scope="col">AUM</th></tr></thead>
              <tbody>{ROWS.map(r => <tr key={r.tkr}><th scope="row">{r.tkr}</th><td>{(r.yieldBps/100).toFixed(2)}%</td><td className={r.breaks ? "text-signal-red" : ""}>{r.premiumBps.toFixed(1)} bp</td><td>${r.aum.toFixed(1)}m</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="research-exceptions">{ROWS.filter(r => r.breaks).map(r => <div key={r.tkr}><span>{r.tkr} / EXCEPTION</span><p>{r.breaks}</p></div>)}</div>

        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
          <Stat k="premium vs yield" v="0.887" strong />
          <Stat k="excluding NVDA" v="0.986" strong />
          <Stat k="premium vs liquidity" v="0.780" />
          <Stat k="premium vs AUM" v="−0.235" />
        </dl>

        <p className="mt-6 max-w-xl text-[14px] leading-relaxed text-ink-dim">
          Tesla settles it. It is the largest wrapper in the set, it trades actively, and
          its premium is zero to the decimal. No size or demand variable predicts that.
          Paying no dividend does.
        </p>
      </section>

      {/* the experiment */}
      <section id="experiment" className="research-section mt-16">
        <div className="research-kicker">03 / THE NATURAL EXPERIMENT</div>
        <h2 className="font-display text-[19px] text-ink">
          The experiment, and the null result
        </h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-dim">
          SPY went ex-dividend during the build. A $1.90 dividend against a $759 share
          predicts a step of roughly 25 bp at the opening bell — widening, since the share
          drops while the token keeps the claim. We watched it happen.
        </p>

        <div className="research-experiment-summary"><div><span>Predicted opening step</span><strong>~25 bp <small>upward</small></strong></div><div><span>Observed opening move</span><strong>5.4 bp <small>downward</small></strong></div><div><span>SPY spread</span><strong>3 bp</strong></div></div>
        <ExDividendChart observations={TIMELINE} />

        <p className="mt-6 max-w-xl border-l-2 border-gold/40 pl-4 text-[14px] leading-relaxed text-ink-dim">
          Across the opening bell the premium moved{" "}
          <span className="tabular text-ink">5.4 bp</span>, and downward. The spread on SPY
          is 3 bp, so a 25 bp step in either direction would have been impossible to miss.
          There was no step.
        </p>
      </section>

      {/* honest ending */}
      <section id="conclusion" className="research-section research-conclusion mt-16 border-t border-rule pt-8">
        <div className="research-kicker">04 / AN OPEN QUESTION</div>
        <h2 className="font-display text-[19px] text-ink">Where that leaves it</h2>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-dim">
          The premium follows dividend yield and sits at zero for the one stock paying
          none. It also ignores an ex-dividend date, implies seven to ten months of
          accrual on a wrapper that launched fourteen months ago, and inverts on Nvidia.
          We did not force a story onto that.
        </p>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink">
          What holds without qualification: the premium is measurable, it reproduces, and
          no quote anywhere shows it. That is what the guard checks against — not the
          reason behind it.
        </p>
      </section>

      <div className="mt-12 flex items-center justify-between border-t border-rule pt-6">
        <Link
          href="/proof"
          className="text-[13px] text-ink-faint transition-colors hover:text-ink"
        >
          Back
        </Link>
        <Link
          href="/trade"
          className="text-[13px] text-ink-faint transition-colors hover:text-ink"
        >
          Price another trade
        </Link>
      </div>
    </main>
  );
}

function Bar({
  value,
  max,
  label,
  tone,
}: {
  value: number;
  max: number;
  label: string;
  tone: "blue" | "gold" | "red";
}) {
  const color =
    tone === "blue" ? "bg-blue/70" : tone === "red" ? "bg-signal-red/80" : "bg-gold/80";
  return (
    <div className="flex flex-1 items-center gap-2.5">
      <div className="relative h-1.5 flex-1 bg-rule">
        <div
          className={`absolute inset-y-0 left-0 ${color}`}
          style={{ width: `${Math.max(0, (value / max) * 100)}%` }}
        />
      </div>
      <span className="tabular w-14 shrink-0 text-[12px] text-ink-dim">{label}</span>
    </div>
  );
}

function Stat({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-faint">{k}</dt>
      <dd
        className={`tabular font-display text-[22px] leading-tight ${
          strong ? "text-ink" : "text-ink-dim"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}
