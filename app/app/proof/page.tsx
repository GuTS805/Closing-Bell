import Link from "next/link";
import LiveGuard from "../components/LiveGuard";

const PROGRAM_ID = "DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig";

const CASES = [
  {
    label: "Priced at the oracle",
    deviation: 0,
    band: 301,
    outcome: "filled",
    before: "1000000000",
    after: "1100000000",
    cu: "36,102",
    ok: true,
    href: "https://solscan.io/tx/5KK2pPnAks22g3tPJHYdAhtuhJbwFbk7FKWFVwLiJmGi8VxWwJWSy8fjw23MFWQ3WGp3q3tiA2sQqzyDBndobYy9?cluster=devnet",
  },
  {
    label: "Priced 6.8% above the oracle",
    deviation: 679,
    band: 301,
    outcome: "reverted",
    before: "1100000000",
    after: "1100000000",
    cu: "36,769",
    ok: false,
    href: "https://solscan.io/tx/2VKxFk8Lnim9pe59pev9NNhyYk3TrRQ7ZyrF5amiCqKR5yUbZ2woLS5KcGXmMrwjqrQxBN44oeGyLAA6e4T9wjS6?cluster=devnet",
  },
];

export default function ProofPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <h1 className="max-w-lg font-display text-[32px] font-light leading-tight tracking-tight text-ink">
        A number on a screen only helps whoever is reading it
      </h1>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-dim">
        Agents, DCA bots, treasury execution and liquidations against stock collateral
        never read a quote. For them the band has to hold where the trade settles, so the
        guard runs as a program and refuses the fill itself.
      </p>

      <section className="mt-12">
        <h2 className="font-display text-[19px] text-ink">How it holds</h2>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-dim">
          The guard never routes your swap and never moves a token. It brackets an
          untouched swap inside one transaction and checks what actually happened.
        </p>

        <ol className="mt-6 space-y-0">
          <Step
            n="0"
            call="record_pre_state"
            does="Snapshot balances, oracle price and the permitted band"
          />
          <Step n="1" call="any swap" does="Jupiter, unmodified, any venue" muted />
          <Step
            n="2"
            call="verify_fill"
            does="Compare balance deltas against the band, or revert everything"
          />
        </ol>

        <p className="mt-5 max-w-lg text-[13px] leading-relaxed text-ink-faint">
          Solana settles a transaction whole or not at all, so a failed check in step 2
          unwinds the swap in step 1 that had already run.
        </p>
      </section>

      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-rule pb-2.5">
          <h2 className="font-display text-[19px] text-ink">Try it against the cluster</h2>
          <span className="text-[12px] text-ink-faint">devnet</span>
        </div>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-ink-dim">
          Price a fill outside the band and send it. The program decides, the cluster
          settles it, and you get the transaction back either way.
        </p>
        <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-ink-faint">
          Devnet has no tokenized-stock pool to trade against, so the middle instruction
          mints the base and burns the quote instead of swapping. The guard reads balance
          deltas and has no opinion on what moved them, so the check it performs is the
          one it would perform on a real swap.
        </p>
        <div className="mt-6">
          <LiveGuard />
        </div>
      </section>

      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-rule pb-2.5">
          <h2 className="font-display text-[19px] text-ink">Two we ran earlier</h2>
          <span className="text-[12px] text-ink-faint">band 301 bp</span>
        </div>

        <div className="mt-1">
          {CASES.map((c) => (
            <a
              key={c.href}
              href={c.href}
              target="_blank"
              rel="noreferrer"
              className="group block border-b border-rule py-5 transition-colors hover:bg-ground-raised"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] text-ink">{c.label}</span>
                <span
                  className={`text-[13px] ${c.ok ? "text-signal-green" : "text-signal-red"}`}
                >
                  {c.outcome}
                </span>
              </div>

              {/* deviation against the band, drawn to scale */}
              <div className="mt-3.5 flex items-center gap-3">
                <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-rule">
                  <div
                    className={`absolute inset-y-0 left-0 ${c.ok ? "bg-signal-green" : "bg-signal-red"}`}
                    style={{ width: `${Math.max(1, Math.min(100, (c.deviation / 800) * 100))}%` }}
                  />
                  <div
                    className="absolute inset-y-0 w-px bg-ink-dim"
                    style={{ left: `${(c.band / 800) * 100}%` }}
                    title="band limit"
                  />
                </div>
                <span className="tabular w-24 shrink-0 text-right text-[13px] text-ink-dim">
                  {c.deviation} bp
                </span>
              </div>

              <div className="mt-3.5 flex flex-wrap gap-x-8 gap-y-1.5 text-[12px] text-ink-faint">
                <span>
                  balance{" "}
                  <span className="tabular text-ink-dim">
                    {c.before} → {c.after}
                  </span>
                  {c.before === c.after ? " (unchanged)" : ""}
                </span>
                <span>
                  <span className="tabular text-ink-dim">{c.cu}</span> compute units
                </span>
                <span className="text-ink-faint transition-colors group-hover:text-ink-dim">
                  open on Solscan
                </span>
              </div>
            </a>
          ))}
        </div>

        <p className="mt-5 max-w-xl text-[13px] leading-relaxed text-ink-faint">
          Both token transfers in the rejected fill had already executed when the check
          failed. The balance is identical either side of it because the chain threw the
          whole transaction away.
        </p>
      </section>

      <section className="mt-12 border-t border-rule pt-6">
        <dl className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-[12px] text-ink-faint">Program, Solana devnet</dt>
            <dd className="mt-1">
              <a
                href={`https://solscan.io/account/${PROGRAM_ID}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-[12px] text-ink-dim underline decoration-rule-bright underline-offset-4 transition-colors hover:text-ink"
              >
                {PROGRAM_ID}
              </a>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[12px] text-ink-faint">Reference feed</dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-ink-dim">
              Crypto.SOL/USD, because devnet carries no live equity feed. The enforcement
              path is the one mainnet would run; only the asset being referenced differs.
            </dd>
          </div>
        </dl>
      </section>

      <div className="mt-12 flex items-center justify-between border-t border-rule pt-6">
        <Link
          href="/trade"
          className="text-[13px] text-ink-faint transition-colors hover:text-ink"
        >
          Back
        </Link>
        <Link
          href="/findings"
          className="rounded-sm bg-ink px-5 py-2.5 text-[14px] font-medium text-ground transition-colors hover:bg-white"
        >
          Where the premium comes from
        </Link>
      </div>
    </main>
  );
}

function Step({
  n,
  call,
  does,
  muted,
}: {
  n: string;
  call: string;
  does: string;
  muted?: boolean;
}) {
  return (
    <li className="flex gap-4 border-b border-rule py-3 last:border-b-0">
      <span className="tabular w-4 shrink-0 text-[12px] text-ink-faint">{n}</span>
      <span
        className={`w-40 shrink-0 font-mono text-[13px] ${muted ? "text-ink-faint" : "text-ink"}`}
      >
        {call}
      </span>
      <span className="text-[13px] leading-relaxed text-ink-dim">{does}</span>
    </li>
  );
}
