"use client";

import { useEffect, useState } from "react";

const TICKERS = ["AAPLx", "SPYx", "TSLAx", "NVDAx"] as const;
const SIZES = [1_000, 10_000, 50_000, 250_000];

interface Result {
  ticker: string;
  label: string;
  notional: number;
  oracle: { price: number; conf: number; ageSecs: number; feed: string; shard: number };
  pool: { midPrice: number; fillPrice: number; venues: string[]; jupiterImpactPct: number; spreadBps: number };
  breakdown: {
    poolImpactBps: number;
    wrapperPremiumBps: number;
    trueCostBps: number;
    publishedRrBps: number | null;
  };
  capturedAt: string;
  error?: string;
}

const pct = (bps: number) => `${bps >= 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(2)}%`;
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function Home() {
  const [ticker, setTicker] = useState<string>("SPYx");
  const [notional, setNotional] = useState<number>(50_000);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/truecost?ticker=${ticker}&notional=${notional}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) { setErr(j.error); setData(null); }
        else setData(j);
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [ticker, notional]);

  const b = data?.breakdown;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight">Closing Bell</h1>
          <p className="mt-1 text-sm text-neutral-400">
            The true cost of a tokenized stock trade — including the part nothing else shows.
          </p>
        </header>

        {/* controls */}
        <section className="mb-8 space-y-4">
          <div className="flex flex-wrap gap-2">
            {TICKERS.map((t) => (
              <button
                key={t}
                onClick={() => setTicker(t)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  ticker === t
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => setNotional(s)}
                className={`rounded-md px-3 py-1.5 text-sm tabular-nums transition ${
                  notional === s
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                ${s.toLocaleString()}
              </button>
            ))}
          </div>
        </section>

        {/* the three numbers */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
          <p className="text-sm text-neutral-400">
            You are buying{" "}
            <span className="text-neutral-100">{usd(notional)}</span> of{" "}
            <span className="text-neutral-100">{ticker}</span>
            {data ? <span className="text-neutral-500"> · {data.label}</span> : null}
          </p>

          {err ? (
            <p className="mt-6 text-sm text-amber-400">Could not price this right now: {err}</p>
          ) : !data || loading ? (
            <p className="mt-6 text-sm text-neutral-500">Reading Jupiter and Pyth…</p>
          ) : (
            <>
              <dl className="mt-6 space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-neutral-300">
                    Pool impact
                    <span className="ml-2 text-xs text-neutral-500">Jupiter shows this</span>
                  </dt>
                  <dd className="tabular-nums text-neutral-100">{pct(b!.poolImpactBps)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-neutral-300">
                    Wrapper premium
                    <span className="ml-2 text-xs text-amber-500/90">nobody shows this</span>
                  </dt>
                  <dd className="tabular-nums text-amber-400">{pct(b!.wrapperPremiumBps)}</dd>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-neutral-800 pt-3">
                  <dt className="font-medium text-neutral-100">
                    True cost vs {ticker.replace(/x$/, "")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums text-neutral-100">
                    {pct(b!.trueCostBps)}
                  </dd>
                </div>
              </dl>

              <p className="mt-6 border-t border-neutral-800 pt-4 text-xs leading-relaxed text-neutral-500">
                Jupiter measures impact against the pool&rsquo;s own mid. The pool&rsquo;s mid
                already sits above the underlying equity, so that premium never appears in the
                quote — at any size, including one share.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-neutral-800 pt-4 text-xs text-neutral-500 sm:grid-cols-3">
                <Fact k={`${data.oracle.feed}`} v={`$${data.oracle.price.toFixed(2)}`} />
                <Fact k="Oracle age" v={`${data.oracle.ageSecs}s · shard ${data.oracle.shard}`} />
                <Fact k="Pool mid" v={`$${data.pool.midPrice.toFixed(2)}`} />
                <Fact k="Your fill" v={`$${data.pool.fillPrice.toFixed(2)}`} />
                <Fact k="Spread" v={`${Math.abs(data.pool.spreadBps).toFixed(0)} bp`} />
                <Fact
                  k="Pyth published ratio"
                  v={b!.publishedRrBps === null ? "no feed" : `${b!.publishedRrBps.toFixed(0)} bp`}
                />
                {data.pool.venues.length > 0 ? (
                  <Fact k="Routed via" v={data.pool.venues.join(" + ")} />
                ) : null}
              </div>
            </>
          )}
        </section>

        {/* guard */}
        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-100">Enforced on-chain, not displayed</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            Showing the number is enough for a human reading a quote. Agents, DCA bots, treasury
            execution and liquidations against stock collateral never read one. For those, the band
            has to be enforced where the trade settles.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            The guard brackets an unmodified swap inside one transaction — snapshot, swap, verify.
            If the realised fill lands outside the oracle band, the whole transaction reverts.
          </p>
          <pre className="mt-4 overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed text-neutral-400">
{`ix 0  record_pre_state   snapshot balances + oracle price
ix 1  any swap           Jupiter, unmodified, any venue
ix 2  verify_fill        deltas -> realised price -> revert`}
          </pre>
        </section>

        <footer className="mt-8 text-xs text-neutral-600">
          Live mainnet data. Pool prices from Jupiter; equity prices from Pyth shard 1 read directly
          on-chain. Wrapper premium is the pool mid against the underlying, with the spread removed
          by quoting both directions.
        </footer>
      </div>
    </main>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-neutral-600">{k}</div>
      <div className="tabular-nums text-neutral-300">{v}</div>
    </div>
  );
}
