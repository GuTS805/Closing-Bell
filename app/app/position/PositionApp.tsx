"use client";

/**
 * Points the true-cost measurement at a position that's already held, instead of a
 * hypothetical trade. Read-only end to end: a connected wallet or a pasted address is
 * only ever used to look up public token balances, never to sign anything.
 */
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";

interface Holding {
  ticker: string;
  label: string;
  qty: number;
  oraclePrice: number;
  midPrice: number;
  currentValueUsd: number;
  fairValueUsd: number;
  premiumUsd: number;
  premiumBps: number;
}

interface PositionResult {
  address: string;
  holdings: Holding[];
  totals: { currentValueUsd: number; fairValueUsd: number; premiumUsd: number };
  capturedAt: string;
  error?: string;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function shortAddress(a: string) {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export default function PositionApp() {
  const { publicKey } = useWallet();
  const [input, setInput] = useState("");
  const [queryAddress, setQueryAddress] = useState<string | null>(null);
  const [data, setData] = useState<PositionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connected = publicKey?.toBase58() ?? null;
  const effectiveAddress = connected ?? queryAddress;

  useEffect(() => {
    if (!effectiveAddress) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears any prior result once the address is cleared
      setData(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/position?address=${encodeURIComponent(effectiveAddress)}`)
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
  }, [effectiveAddress]);

  const t = data?.totals;

  return (
    <main className="workspace-page position-page mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <div className="eyebrow page-eyebrow">
        <span className="status-dot" />YOUR POSITION
      </div>
      <h1 className="font-display text-[32px] font-light leading-tight tracking-tight text-ink">
        What your holdings actually cost
      </h1>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-dim">
        Read-only. Nothing here signs a transaction — connect a wallet or paste any address
        and we read its real xStock balances straight from mainnet.
      </p>

      <div className="trade-controls mt-9 space-y-4">
        <div className="flex items-center gap-4">
          <span className="w-10 shrink-0 text-[12px] text-ink-faint">Wallet</span>
          <WalletMultiButton />
        </div>
        <form
          className="position-input"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = input.trim();
            if (trimmed) setQueryAddress(trimmed);
          }}
        >
          <input
            type="text"
            spellCheck={false}
            placeholder={connected ? "Connected wallet in use" : "Or paste a Solana address"}
            value={input}
            disabled={!!connected}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={!!connected}
            className="rounded-sm border border-rule px-4 py-2.5 text-[13px] text-ink-dim transition-colors hover:border-rule-bright hover:text-ink disabled:opacity-40"
          >
            Check
          </button>
        </form>
      </div>

      <section className="measurement-panel mt-10" aria-live="polite">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2.5">
          <span className="tabular text-[13px] text-ink-dim">
            {data ? shortAddress(data.address) : effectiveAddress ? shortAddress(effectiveAddress) : "no address yet"}
          </span>
          {data && !loading ? (
            <span className="text-[12px] text-ink-faint">live mainnet read</span>
          ) : null}
        </div>

        {!effectiveAddress ? (
          <p className="py-10 text-[14px] text-ink-faint">
            Connect a wallet or paste an address above to see what it&apos;s holding.
          </p>
        ) : err ? (
          <p className="py-10 text-[14px] text-signal-red">Could not read that address: {err}</p>
        ) : !data ? (
          <p className="py-10 text-[14px] text-ink-faint">Reading…</p>
        ) : data.holdings.length === 0 ? (
          <p className="py-10 text-[14px] text-ink-faint">
            No SPYx, AAPLx, TSLAx, or NVDAx in this wallet.
          </p>
        ) : (
          <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
            {data.holdings.map((h) => (
              <div key={h.ticker} className="position-row">
                <span className="text-[13px] text-ink-dim">
                  {h.qty.toLocaleString("en-US", { maximumFractionDigits: 4 })} {h.ticker}
                  <span className="text-ink-faint"> · {h.label}</span>
                </span>
                <span className="tabular text-right text-[14px]">
                  <span className="text-ink">{usd(h.currentValueUsd)}</span>{" "}
                  <span className="text-gold-bright">
                    {h.premiumBps >= 0 ? "+" : "−"}
                    {usd(Math.abs(h.premiumUsd))} premium
                  </span>
                </span>
              </div>
            ))}

            <p className="mt-7 max-w-xl border-l-2 border-gold/40 pl-4 text-[14px] leading-relaxed text-ink-dim">
              This position is worth{" "}
              <span className="tabular text-ink">{usd(t!.currentValueUsd)}</span> at the
              pool&apos;s price. Against the equity it wraps, that&apos;s{" "}
              <span className="tabular text-gold-bright">{usd(Math.abs(t!.premiumUsd))}</span> of
              structural premium nobody showed you when you bought it.
            </p>
          </div>
        )}
      </section>

      <div className="mt-12 flex items-center justify-between border-t border-rule pt-6">
        <Link href="/trade" className="text-[13px] text-ink-faint transition-colors hover:text-ink">
          Back to trade calculator
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
