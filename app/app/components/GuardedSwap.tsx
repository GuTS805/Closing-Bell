"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";

/**
 * The band, applied to a real mainnet trade.
 *
 * The server derives the band, and where the trade fits inside it, builds the transaction
 * carrying that threshold and simulates it against live mainnet state. Everything up to
 * the signature costs nothing, so the number can be checked before anyone commits funds.
 *
 * Signing is the one step that spends, and it is offered only after the same transaction
 * has simulated cleanly — a signature is never requested for a fill already known not to
 * land. The wallet signs; this never holds a key.
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

interface Simulation {
  ok: boolean;
  reason: "ok" | "insufficient-funds" | "band-rejected" | "failed";
  message: string;
}

interface BuildResult {
  refused: boolean;
  reason?: string;
  derivation: Derivation;
  simulation?: Simulation;
  swapTransaction?: string;
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

  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [build, setBuild] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState<null | "checking" | "sending">(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setLoading(true);
    setError(null);
    setBuild(null);
    setSent(null);
    setSendError(null);

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

  /** Builds and simulates against live mainnet. Spends nothing and signs nothing. */
  async function check() {
    if (!publicKey) return;
    setBusy("checking");
    setSendError(null);
    try {
      const r = await fetch(`/api/guarded-swap?ticker=${ticker}&notional=${notional}&band=${bandBps}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPublicKey: publicKey.toBase58() }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setBuild(body as BuildResult);
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "could not build the transaction");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Only reachable once the same transaction has simulated cleanly, so the signature is
   * never requested for a fill already known not to land.
   */
  async function sign() {
    if (!signTransaction || !build?.swapTransaction) return;
    setBusy("sending");
    setSendError(null);
    try {
      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(build.swapTransaction), (c) => c.charCodeAt(0)),
      );
      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 3,
      });
      setSent(signature);
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "the transaction was not sent");
    } finally {
      setBusy(null);
    }
  }

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

          {d.buildable && (
            <div className="guarded-execute">
              {!publicKey && (
                <div className="guarded-connect">
                  <WalletMultiButton />
                  <span>Connect a wallet to simulate this fill against live mainnet. Simulating costs nothing.</span>
                </div>
              )}

              {publicKey && (
                <div className="guarded-actions">
                  <button type="button" className="guarded-action" onClick={check} disabled={busy !== null}>
                    {busy === "checking" ? "Simulating…" : "Simulate this fill"}
                  </button>
                  {build?.simulation?.ok && (
                    <button type="button" className="guarded-action is-primary" onClick={sign} disabled={busy !== null}>
                      {busy === "sending" ? "Waiting for the wallet…" : `Sign and send ${usd(notional)}`}
                    </button>
                  )}
                </div>
              )}

              {build?.simulation && (
                <p className={build.simulation.ok ? "guarded-sim is-ok" : "guarded-sim"}>
                  {build.simulation.message}
                </p>
              )}

              {sendError && <p className="guarded-sim guarded-error">{sendError}</p>}

              {sent && (
                <p className="guarded-sim is-ok">
                  Sent.{" "}
                  <a href={`https://solscan.io/tx/${sent}`} target="_blank" rel="noopener noreferrer">
                    View the transaction
                  </a>
                  . If the fill drifted outside the band it reverts, and nothing moves.
                </p>
              )}
            </div>
          )}

          <p className="guarded-footnote">
            {d.buildable
              ? "Simulating is free and spends nothing. Signing sends a real mainnet transaction with your own funds, and is offered only once the same transaction has simulated cleanly."
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
