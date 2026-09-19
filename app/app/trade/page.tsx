"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PriceLadder from "../components/PriceLadder";

const TICKERS = ["SPYx", "AAPLx", "TSLAx", "NVDAx"] as const;
const SIZES = [1_000, 10_000, 50_000, 250_000];

interface Result {
  ticker: string;
  label: string;
  notional: number;
  oracle: { price: number; conf: number; ageSecs: number; feed: string; shard: number };
  pool: {
    midPrice: number;
    fillPrice: number;
    venues: string[];
    jupiterImpactPct: number;
    spreadBps: number;
  };
  breakdown: {
    poolImpactBps: number;
    wrapperPremiumBps: number;
    trueCostBps: number;
    publishedRrBps: number | null;
  };
  capturedAt: string;
  error?: string;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function TradePage() {
  const [ticker, setTicker] = useState<string>("SPYx");
  const [notional, setNotional] = useState<number>(50_000);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets loading/error state for the new request before it lands
    setLoading(true);
    setErr(null);
    fetch(`/api/truecost?ticker=${ticker}&notional=${notional}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) {
          setErr(j.error);
          setData(null);
        } else setData(j);
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticker, notional]);

  const b = data?.breakdown;
  const underlying = ticker.replace(/x$/, "");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <h1 className="font-display text-[32px] font-light leading-tight tracking-tight text-ink">
        Price your trade
      </h1>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-dim">
        Read live from Pyth for the share price and Jupiter for the pool. Nothing here is
        cached.
      </p>

      <div className="mt-9 space-y-3">
        <Choices
          options={TICKERS.map((t) => ({ value: t, label: t }))}
          selected={ticker}
          onSelect={(v) => setTicker(String(v))}
          name="Stock"
        />
        <Choices
          options={SIZES.map((s) => ({ value: s, label: usd(s) }))}
          selected={notional}
          onSelect={(v) => setNotional(Number(v))}
          name="Size"
        />
      </div>

      <section className="mt-10" aria-live="polite">
        <div className="mb-5 flex items-baseline justify-between border-b border-rule pb-2.5">
          <span className="text-[13px] text-ink-dim">
            {usd(notional)} of {ticker}
            {data ? <span className="text-ink-faint"> · {data.label}</span> : null}
          </span>
          {data && !loading ? (
            <span className="text-[12px] text-ink-faint">
              oracle {data.oracle.ageSecs}s old
            </span>
          ) : null}
        </div>

        {err ? (
          <p className="py-10 text-[14px] text-signal-red">
            Could not reach the price feeds: {err}
          </p>
        ) : !data ? (
          <p className="py-10 text-[14px] text-ink-faint">Measuring…</p>
        ) : (
          <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <PriceLadder
              key={`${ticker}-${notional}-${data.capturedAt}`}
              oracle={data.oracle.price}
              mid={data.pool.midPrice}
              fill={data.pool.fillPrice}
              poolImpactBps={b!.poolImpactBps}
              wrapperPremiumBps={b!.wrapperPremiumBps}
              underlying={underlying}
              animate
            />

            <p className="mt-7 max-w-xl border-l-2 border-gold/40 pl-4 text-[14px] leading-relaxed text-ink-dim">
              You pay{" "}
              <span className="tabular text-ink">
                {(Math.abs(b!.trueCostBps) / 100).toFixed(2)}%
              </span>{" "}
              over {underlying}. Your aggregator reports{" "}
              <span className="tabular text-ink">
                {(Math.abs(b!.poolImpactBps) / 100).toFixed(2)}%
              </span>{" "}
              of that.
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3.5 border-t border-rule pt-6 sm:grid-cols-3">
              <Fact k={data.oracle.feed} v={`$${data.oracle.price.toFixed(2)}`} />
              <Fact k="Pyth shard" v={String(data.oracle.shard)} />
              <Fact k="Pool spread" v={`${Math.abs(data.pool.spreadBps).toFixed(0)} bp`} />
              <Fact
                k="Pyth redemption ratio"
                v={b!.publishedRrBps === null ? "no feed" : `${b!.publishedRrBps.toFixed(0)} bp`}
              />
              {data.pool.venues.length ? (
                <Fact k="Routed through" v={data.pool.venues.join(", ")} wide />
              ) : null}
            </dl>
          </div>
        )}
      </section>

      <div className="mt-12 flex items-center justify-between border-t border-rule pt-6">
        <Link href="/" className="text-[13px] text-ink-faint transition-colors hover:text-ink">
          Back
        </Link>
        <Link
          href="/proof"
          className="rounded-sm bg-ink px-5 py-2.5 text-[14px] font-medium text-ground transition-colors hover:bg-white"
        >
          See this enforced on-chain
        </Link>
      </div>
    </main>
  );
}

function Choices({
  options,
  selected,
  onSelect,
  name,
}: {
  options: { value: string | number; label: string }[];
  selected: string | number;
  onSelect: (v: string | number) => void;
  name: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-10 shrink-0 text-[12px] text-ink-faint">{name}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.value === selected;
          return (
            <button
              key={o.value}
              onClick={() => onSelect(o.value)}
              aria-pressed={on}
              className={`tabular rounded-sm px-3 py-1.5 text-[13px] transition-colors ${
                on
                  ? "bg-ink text-ground"
                  : "border border-rule text-ink-dim hover:border-rule-bright hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Fact({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-1" : ""}>
      <dt className="text-[12px] text-ink-faint">{k}</dt>
      <dd className="tabular mt-0.5 text-[13px] text-ink-dim">{v}</dd>
    </div>
  );
}
