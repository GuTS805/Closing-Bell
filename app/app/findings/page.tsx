import Link from "next/link";

const ROWS = [
  { tkr: "SPY", aum: "72.9", liq: "7,343", yield: "0.98%", premium: "57.1 bp", flag: false },
  { tkr: "QQQ", aum: "60.8", liq: "1,808", yield: "0.40%", premium: "27.3 bp", flag: false },
  { tkr: "AAPL", aum: "51.9", liq: "656", yield: "0.32%", premium: "26.6 bp", flag: false },
  { tkr: "GOOGL", aum: "56.5", liq: "457", yield: "0.23%", premium: "19.3 bp", flag: false },
  { tkr: "NVDA", aum: "70.6", liq: "2,065", yield: "0.46%", premium: "9.2 bp", flag: true },
  { tkr: "TSLA", aum: "83.6", liq: "1,345", yield: "0.00%", premium: "0.0 bp", flag: true },
];

const OPENING = [
  { time: "03:50 ET — pre-open", value: "70.5 bp" },
  { time: "11:59 ET — post-open", value: "65.1 bp" },
  { time: "12:11 ET", value: "60.5 bp (mid)" },
  { time: "15:07 ET", value: "53.1 bp (mid)" },
];

export default function FindingsPage() {
  return (
    <main className="min-h-screen px-5 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs text-neutral-500">The investigation</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          We tried to explain the premium. We couldn&rsquo;t, fully.
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-neutral-400">
          A persistent premium exists between every tokenized stock and the equity it
          wraps. Here is what we ruled out, what fits, and what still doesn&rsquo;t.
        </p>

        {/* falsified: size/demand */}
        <section className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-100">
            Ruled out: pool size and liquidity
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            If demand or wrapper size drove the premium, AUM or liquidity should predict it
            better than dividends do. They don&rsquo;t.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-500">
                  <th className="py-2 pr-4 font-normal">ticker</th>
                  <th className="py-2 pr-4 font-normal">AUM $m</th>
                  <th className="py-2 pr-4 font-normal">liquidity $k</th>
                  <th className="py-2 pr-4 font-normal">dividend yield</th>
                  <th className="py-2 font-normal">premium</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.tkr} className="border-b border-neutral-900">
                    <td className="py-2 pr-4 text-neutral-300">{r.tkr}</td>
                    <td className={`py-2 pr-4 tabular-nums ${r.tkr === "TSLA" ? "text-amber-400" : "text-neutral-400"}`}>
                      {r.aum}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-neutral-400">{r.liq}</td>
                    <td className="py-2 pr-4 tabular-nums text-neutral-400">{r.yield}</td>
                    <td className={`py-2 tabular-nums ${r.flag ? "text-amber-400" : "text-neutral-300"}`}>
                      {r.premium}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat k="RR vs dividend yield" v="0.887" good />
            <Stat k="RR vs AUM" v="−0.235" />
            <Stat k="RR vs liquidity" v="0.780" />
            <Stat k="excl. NVDA" v="0.986" good />
          </div>

          <p className="mt-4 text-xs leading-relaxed text-neutral-500">
            TSLA decides it: the <span className="text-neutral-300">largest</span> wrapper
            in the set by AUM ($83.6m), with healthy liquidity, carries a premium of{" "}
            <span className="text-neutral-300">exactly zero</span>. No size variable
            predicts that. &ldquo;Pays no dividend&rdquo; does.
          </p>
        </section>

        {/* the dividend hypothesis, and its problems */}
        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-100">
            Fits, but doesn&rsquo;t close: dividends
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            The premium orders by dividend yield with 0.887 correlation. But two things
            about it don&rsquo;t fit a clean accrual story:
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-neutral-500">
            <li>
              <span className="text-amber-400">NVDA yields 0.46%</span> — more than AAPL
              (0.32%) or GOOGL (0.23%) — yet carries the{" "}
              <span className="text-amber-400">smallest</span> premium of the three. That
              inversion is unexplained.
            </li>
            <li>
              The implied accrual window clusters at{" "}
              <span className="text-neutral-300">7–10 months</span> across SPY, QQQ and
              AAPL, against a wrapper that launched roughly 14 months ago. If this were
              accrual-since-launch, it should cluster at 14.
            </li>
          </ul>
        </section>

        {/* the ex-dividend experiment */}
        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-100">
            The experiment: SPY&rsquo;s ex-dividend date
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            SPY went ex-dividend inside our build window — a ~$1.90 dividend on a ~$759
            spot predicts roughly a{" "}
            <span className="text-neutral-300">25 bp step</span> at the open. An
            accumulating wrapper should <em>widen</em> by that much, since the equity leg
            drops while the token keeps the claim.
          </p>

          <div className="mt-4 space-y-1.5 text-xs">
            {OPENING.map((o) => (
              <div key={o.time} className="flex items-baseline justify-between border-b border-neutral-900 py-1.5">
                <span className="text-neutral-500">{o.time}</span>
                <span className="tabular-nums text-neutral-300">{o.value}</span>
              </div>
            ))}
          </div>

          <p className="mt-4 rounded-md bg-neutral-950 px-3 py-2 text-xs leading-relaxed text-neutral-400">
            Measured across the open: <span className="text-amber-400">−5.4 bp</span>,
            against a predicted move of ~25 bp in either direction. SPY&rsquo;s spread is
            3 bp — a real step would have been unmissable.{" "}
            <span className="text-neutral-200">There was no step.</span>
          </p>
        </section>

        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/20 p-6">
          <h2 className="text-sm font-medium text-neutral-100">Where this leaves us</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            The mechanism is unresolved. The premium orders by dividend yield and hits
            exactly zero for the one ticker that pays none — but it doesn&rsquo;t respond
            to an ex-dividend date, doesn&rsquo;t fit accrual-since-launch, and NVDA
            inverts it. We didn&rsquo;t force a story onto the data.
          </p>
          <p className="mt-3 text-sm font-medium text-neutral-200">
            What we can say without qualification: the premium is measured, reproducible,
            and shown in no quote, anywhere. That&rsquo;s what the guard enforces against
            — not the mechanism behind it.
          </p>
        </section>

        <div className="mt-8 flex items-center justify-between">
          <Link href="/proof" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← back
          </Link>
          <Link href="/trade" className="text-xs text-neutral-500 hover:text-neutral-300">
            run the calculator again →
          </Link>
        </div>
      </div>
    </main>
  );
}

function Stat({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="text-neutral-600">{k}</div>
      <div className={`mt-0.5 tabular-nums ${good ? "text-emerald-400" : "text-neutral-300"}`}>{v}</div>
    </div>
  );
}
