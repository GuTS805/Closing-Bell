"use client";

import { useState } from "react";

interface RunResult {
  mode: "reject" | "allow";
  outcome: "blocked" | "filled" | "unknown";
  signature: string;
  explorer: string;
  oraclePrice: number;
  fillPrice: number;
  deviationBps: number | null;
  bandBps: number | null;
  computeUnits: number | null;
  balanceBefore: string;
  balanceAfter: string;
  balanceUnchanged: boolean;
  guardLog: string | null;
  elapsedMs: number;
  error?: string;
}

export default function LiveGuard() {
  const [running, setRunning] = useState<"reject" | "allow" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(mode: "reject" | "allow") {
    setRunning(mode);
    setErr(null);
    setResult(null);
    try {
      const r = await fetch(`/api/guard/run?mode=${mode}`, { method: "POST" });
      const j = await r.json();
      if (j.error) setErr(j.error);
      else setResult(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "request failed");
    } finally {
      setRunning(null);
    }
  }

  const busy = running !== null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => run("reject")}
          disabled={busy}
          className="rounded-sm bg-ink px-4 py-2.5 text-[14px] font-medium text-ground transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running === "reject" ? "Sending…" : "Send a fill 6.8% above the oracle"}
        </button>
        <button
          onClick={() => run("allow")}
          disabled={busy}
          className="rounded-sm border border-rule-bright px-4 py-2.5 text-[14px] text-ink transition-colors hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running === "allow" ? "Sending…" : "Send one at the oracle price"}
        </button>
      </div>

      <div className="mt-4 min-h-[1.25rem]" aria-live="polite">
        {busy ? (
          <p className="text-[13px] text-ink-faint">
            Building the transaction, sending it to devnet, waiting for the cluster to
            confirm. Usually five to fifteen seconds.
          </p>
        ) : err ? (
          <p className="text-[13px] text-signal-red">{err}</p>
        ) : result ? (
          <Outcome r={result} />
        ) : (
          <p className="text-[13px] text-ink-faint">
            Each run is a new transaction on devnet, signed by this site&rsquo;s own
            wallet. Nothing is simulated.
          </p>
        )}
      </div>
    </div>
  );
}

function Outcome({ r }: { r: RunResult }) {
  const blocked = r.outcome === "blocked";
  const unknown = r.outcome === "unknown";

  const headline = unknown
    ? "Sent, but the cluster has not reported back yet"
    : blocked
      ? "The guard rejected it"
      : "The guard allowed it";
  const badge = unknown ? "unconfirmed" : blocked ? "reverted" : "filled";
  const badgeColor = unknown
    ? "text-ink-faint"
    : blocked
      ? "text-signal-red"
      : "text-signal-green";

  return (
    <div className="border-t border-rule pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] text-ink">{headline}</span>
        <span className={`text-[13px] ${badgeColor}`}>{badge}</span>
      </div>

      {unknown ? (
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-dim">
          The transaction is on devnet; the RPC just hasn&rsquo;t indexed it yet. Open it
          below to see how it settled.
        </p>
      ) : null}

      {r.deviationBps !== null && r.bandBps !== null ? (
        <div className="mt-3.5 flex items-center gap-3">
          <div className="relative h-1 flex-1 bg-rule">
            <div
              className={`absolute inset-y-0 left-0 ${blocked ? "bg-signal-red" : "bg-signal-green"}`}
              style={{ width: `${Math.max(1, Math.min(100, (r.deviationBps / 800) * 100))}%` }}
            />
            <div
              className="absolute inset-y-0 w-px bg-ink-dim"
              style={{ left: `${(r.bandBps / 800) * 100}%` }}
            />
          </div>
          <span className="tabular w-28 shrink-0 text-right text-[13px] text-ink-dim">
            {r.deviationBps} of {r.bandBps} bp
          </span>
        </div>
      ) : null}

      {r.guardLog ? (
        <pre className="mt-4 whitespace-pre-wrap break-words border-l-2 border-rule-bright pl-3 font-mono text-[11px] leading-relaxed text-ink-faint">
          {r.guardLog}
        </pre>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1.5 text-[12px] text-ink-faint">
        <span>
          balance{" "}
          <span className="tabular text-ink-dim">
            {r.balanceBefore} → {r.balanceAfter}
          </span>
          {r.balanceUnchanged ? " (unchanged)" : ""}
        </span>
        {r.computeUnits !== null ? (
          <span>
            <span className="tabular text-ink-dim">
              {r.computeUnits.toLocaleString()}
            </span>{" "}
            compute units
          </span>
        ) : null}
        <span>
          <span className="tabular text-ink-dim">
            {(r.elapsedMs / 1000).toFixed(1)}s
          </span>{" "}
          to confirm
        </span>
      </div>

      <a
        href={r.explorer}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block break-all font-mono text-[11px] text-ink-dim underline decoration-rule-bright underline-offset-4 transition-colors hover:text-ink"
      >
        {r.signature}
      </a>

      {blocked ? (
        <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-dim">
          That transaction is on devnet now. The mint and burn ahead of the check had
          already run; the balance is the same either side because the chain discarded the
          whole thing.
        </p>
      ) : null}
    </div>
  );
}
