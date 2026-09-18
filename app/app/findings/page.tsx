import Link from "next/link";

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

const MAX_YIELD = 100;
const MAX_PREMIUM = 60;

const TIMELINE = [
  { t: "03:50", note: "before the open", bps: 70.5 },
  { t: "11:59", note: "after the open", bps: 65.1 },
  { t: "12:11", note: "", bps: 60.5 },
  { t: "15:07", note: "", bps: 53.1 },
];

export default function FindingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <h1 className="max-w-lg font-display text-[32px] font-light leading-tight tracking-tight text-ink">
        We tried to explain the premium and could not
      </h1>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-dim">
        It tracks dividend yield closely enough to look solved, then two stocks break it
        and an experiment we ran on the day came back empty. What follows is what we
        measured, including the parts that do not fit.
      </p>

      {/* correlation, shown rather than asserted */}
      <section className="mt-14">
        <h2 className="font-display text-[19px] text-ink">
          It is not pool size, and it is not liquidity
        </h2>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-dim">
          If demand drove the premium, the biggest wrappers would carry the most of it.
          Sorted by dividend yield, with each stock&rsquo;s premium beside it:
        </p>

        <div className="mt-7">
          <div className="flex items-baseline gap-4 border-b border-rule pb-2 text-[12px] text-ink-faint">
            <span className="w-14 shrink-0">stock</span>
            <span className="flex-1">dividend yield</span>
            <span className="flex-1">premium</span>
            <span className="w-16 shrink-0 text-right">AUM</span>
          </div>

          {ROWS.map((r) => (
            <div key={r.tkr} className="border-b border-rule py-3">
              <div className="flex items-center gap-4">
                <span className="w-14 shrink-0 text-[13px] text-ink">{r.tkr}</span>

                <Bar
                  value={r.yieldBps}
                  max={MAX_YIELD}
                  label={`${(r.yieldBps / 100).toFixed(2)}%`}
                  tone="blue"
                />
                <Bar
                  value={r.premiumBps}
                  max={MAX_PREMIUM}
                  label={`${r.premiumBps.toFixed(1)} bp`}
                  tone={r.breaks ? "red" : "gold"}
                />

                <span className="tabular w-16 shrink-0 text-right text-[12px] text-ink-faint">
                  ${r.aum.toFixed(1)}m
                </span>
              </div>
              {r.breaks ? (
                <p className="mt-2 pl-[4.5rem] text-[12px] text-signal-red">{r.breaks}</p>
              ) : null}
            </div>
          ))}
        </div>

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
      <section className="mt-16">
        <h2 className="font-display text-[19px] text-ink">
          The experiment, and the null result
        </h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-dim">
          SPY went ex-dividend during the build. A $1.90 dividend against a $759 share
          predicts a step of roughly 25 bp at the opening bell — widening, since the share
          drops while the token keeps the claim. We watched it happen.
        </p>

        <div className="mt-7 max-w-md">
          {TIMELINE.map((p, i) => (
            <div
              key={p.t}
              className="flex items-center gap-4 border-b border-rule py-2.5 last:border-b-0"
            >
              <span className="tabular w-12 shrink-0 text-[13px] text-ink-dim">{p.t}</span>
              <span className="w-28 shrink-0 text-[12px] text-ink-faint">{p.note}</span>
              <div className="relative h-1 flex-1 bg-rule">
                <div
                  className="absolute inset-y-0 left-0 bg-gold/70"
                  style={{ width: `${(p.bps / 80) * 100}%` }}
                />
              </div>
              <span className="tabular w-16 shrink-0 text-right text-[13px] text-ink">
                {p.bps} bp
              </span>
              {i === 1 ? (
                <span className="absolute -ml-2 hidden text-[11px] text-ink-faint sm:inline" />
              ) : null}
            </div>
          ))}
        </div>

        <p className="mt-6 max-w-xl border-l-2 border-gold/40 pl-4 text-[14px] leading-relaxed text-ink-dim">
          Across the opening bell the premium moved{" "}
          <span className="tabular text-ink">5.4 bp</span>, and downward. The spread on SPY
          is 3 bp, so a 25 bp step in either direction would have been impossible to miss.
          There was no step.
        </p>
      </section>

      {/* honest ending */}
      <section className="mt-16 border-t border-rule pt-8">
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
          style={{ width: `${Math.max(1.5, (value / max) * 100)}%` }}
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
