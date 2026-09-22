"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The band, applied to a real mainnet trade.
 *
 * Nothing here signs or submits. It asks the server to derive the band and, when the trade
 * fits inside it, to build the transaction that carries it — then decodes that transaction
 * and shows the threshold Jupiter's route instruction will enforce on-chain. The point is
 * that the number is checkable rather than claimed.
 *
 * A refusal is the product working, so it is rendered as a result and not as an error.
 */

interface Derivation {
  maxPriceUsd: number;
  minOutRaw: number;
  quotedOutRaw: number;
  slippageBps: number | null;
  buildable: boolean;
  quotedDeviationBps: number;
  refusal: string | null;
}

interface Quote {
  ticker: string;
  notionalUsd: number;
  bandBps: number;
  oracle: { priceUsd: number; ageSecs: number; shard: number };
  derivation: Derivation;
  capturedAt: string;
}

const BANDS = [10, 25, 50, 100];

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function GuardedSwap({ ticker, notional }: { ticker: string; notional: number }) {
  const [bandBps, setBandBps] = useState(50);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setLoading(true);
    setError(null);

    fetch(`/api/guarded-swap?ticker=${ticker}&notional=${notional}&band=${bandBps}`, {
      signal: ac.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        return body as Quote;
      })
      .then((q) => { if (!ac.signal.aborted) { setQuote(q); setLoading(false); } })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setQuote(null);
        setError(e instanceof Error ? e.message : "could not derive the band");
        setLoading(false);
      });

    return () => ac.abort();
  }, [ticker, notional, bandBps]);

  const d = quote?.derivation;
  const decimals = 8;

  return (
    <section className="guarded-swap" aria-live="polite">
      <div className="research-chart-heading">
        <h3>Enforce the band on this trade</h3>
        <span>Mainnet · no program deployed</span>
      </div>

      <p className="guarded-intro">
        Every swap already carries an on-chain minimum-output check. Jupiter&rsquo;s route
        instruction reverts with <code>SlippageToleranceExceeded</code> when the fill lands
        below it. That threshold is normally taken from the pool&rsquo;s own mid, which is why
        the premium never shows. Taking it from the Pyth oracle instead turns the same check
        into an oracle band.
      </p>

      <div className="guarded-bands" role="group" aria-label="Band width">
        <span className="guarded-bands-label">Band</span>
        {BANDS.map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={bandBps === b}
            onClick={() => setBandBps(b)}
            className="guarded-band-toggle"
          >
            {b} bp
          </button>
        ))}
      </div>

      {loading && <p className="guarded-message">Reading the oracle and quoting…</p>}
      {error && <p className="guarded-message guarded-error">{error}</p>}

      {d && quote && !loading && (
        <>
          <div className={d.buildable ? "guarded-verdict is-allowed" : "guarded-verdict is-refused"}>
            <strong>{d.buildable ? "Inside the band" : "Refused"}</strong>
            <p>
              {d.buildable
                ? `${ticker} quotes ${d.quotedDeviationBps.toFixed(1)} bp from the oracle, inside the ${quote.bandBps} bp band. The transaction is built with a ${d.slippageBps} bp tolerance, which is the band expressed as a minimum output.`
                : d.refusal}
            </p>
          </div>

          <dl className="guarded-figures">
            <div>
              <dt>Oracle price</dt>
              <dd>{usd(quote.oracle.priceUsd)}</dd>
              <small>Pyth shard {quote.oracle.shard} · {quote.oracle.ageSecs}s old</small>
            </div>
            <div>
              <dt>Most this may cost</dt>
              <dd>{usd(d.maxPriceUsd)}</dd>
              <small>oracle + {quote.bandBps} bp</small>
            </div>
            <div>
              <dt>Tokens the band demands</dt>
              <dd>{(d.minOutRaw / 10 ** decimals).toFixed(4)}</dd>
              <small>for {usd(quote.notionalUsd)}</small>
            </div>
            <div>
              <dt>Tokens the pool offers</dt>
              <dd>{(d.quotedOutRaw / 10 ** decimals).toFixed(4)}</dd>
              <small>
                {d.buildable ? "enough" : "short by "}
                {d.buildable
                  ? ""
                  : `${((d.minOutRaw - d.quotedOutRaw) / 10 ** decimals).toFixed(4)}`}
              </small>
            </div>
          </dl>

          <p className="guarded-footnote">
            {d.buildable
              ? "Nothing is signed or submitted here. The transaction is built unsigned so the threshold inside it can be read before anyone commits funds."
              : "No transaction is built. Widening the band is a choice this makes you take deliberately, rather than one it takes for you by quietly raising the tolerance."}
            {" "}This path bounds the output amount only. The guard program additionally
            checks oracle staleness, confidence, market clock and keeper basis drift, and
            verifies the realised price from balance deltas after the fill.
          </p>
        </>
      )}
    </section>
  );
}
