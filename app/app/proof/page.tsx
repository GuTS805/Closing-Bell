import Link from "next/link";

const PROGRAM_ID = "DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig";

const CASES = [
  {
    label: "Fill at the oracle price",
    deviation: "0 bps",
    band: "301 bps",
    outcome: "ALLOWED",
    balance: "1000000000 → 1100000000",
    cu: "36,102",
    ok: true,
    href: "https://solscan.io/tx/5KK2pPnAks22g3tPJHYdAhtuhJbwFbk7FKWFVwLiJmGi8VxWwJWSy8fjw23MFWQ3WGp3q3tiA2sQqzyDBndobYy9?cluster=devnet",
  },
  {
    label: "Fill 6.8% above the oracle price",
    deviation: "679 bps",
    band: "301 bps",
    outcome: "REJECTED",
    balance: "1100000000 → 1100000000",
    cu: "36,769",
    ok: false,
    href: "https://solscan.io/tx/2VKxFk8Lnim9pe59pev9NNhyYk3TrRQ7ZyrF5amiCqKR5yUbZ2woLS5KcGXmMrwjqrQxBN44oeGyLAA6e4T9wjS6?cluster=devnet",
  },
];

export default function ProofPage() {
  return (
    <main className="min-h-screen px-5 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs text-neutral-500">Step 2 of 2</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Enforced on-chain, not displayed
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-neutral-400">
          Showing the number on the trade page is enough for a human reading a quote.
          Agents, DCA bots, treasury execution, and lending liquidations against stock
          collateral never read one. For those, the band has to be enforced where the trade
          actually settles.
        </p>

        <section className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-100">How the guard works</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            It doesn&rsquo;t route your swap. It brackets an unmodified swap inside one
            transaction:
          </p>
          <pre className="mt-4 overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed text-neutral-400">
{`ix 0  record_pre_state   snapshot balances + oracle price + band
ix 1  any swap           Jupiter, unmodified, any venue
ix 2  verify_fill        deltas -> realised price -> revert`}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            Solana&rsquo;s atomicity does the enforcement. If the realised fill lands outside
            the band in <code className="text-neutral-400">verify_fill</code>, the entire
            transaction reverts — including the swap that already ran.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          {CASES.map((c) => (
            <a
              key={c.href}
              href={c.href}
              target="_blank"
              rel="noreferrer"
              className="group block rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 transition hover:border-neutral-700 hover:bg-neutral-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-200">{c.label}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    c.ok
                      ? "bg-emerald-950 text-emerald-400"
                      : "bg-red-950 text-red-400"
                  }`}
                >
                  {c.outcome}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-neutral-500 sm:grid-cols-4">
                <div>
                  <div className="text-neutral-600">deviation</div>
                  <div className="tabular-nums text-neutral-300">{c.deviation}</div>
                </div>
                <div>
                  <div className="text-neutral-600">band</div>
                  <div className="tabular-nums text-neutral-300">{c.band}</div>
                </div>
                <div>
                  <div className="text-neutral-600">compute units</div>
                  <div className="tabular-nums text-neutral-300">{c.cu}</div>
                </div>
                <div>
                  <div className="text-neutral-600">buyer&rsquo;s balance</div>
                  <div className="tabular-nums text-neutral-300">{c.balance}</div>
                </div>
              </div>
              <p className="mt-3 text-xs text-neutral-600 transition group-hover:text-neutral-400">
                view on Solscan ↗
              </p>
            </a>
          ))}
        </section>

        <p className="mt-5 text-xs leading-relaxed text-neutral-500">
          In the rejected case, the two token transfers ahead of{" "}
          <code className="text-neutral-400">verify_fill</code> had already executed — the
          buyer&rsquo;s balance is identical before and after because the whole transaction
          rolled back. The 301 bp band is 200 bp closed-market width, plus 1 bp confidence
          widening, plus 100 bp because no basis had been pushed for this market yet — the
          guard widening itself rather than assuming its center is exact.
        </p>

        <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/20 p-4 text-xs text-neutral-500">
          Program{" "}
          <a
            href={`https://solscan.io/account/${PROGRAM_ID}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="text-neutral-300 underline decoration-neutral-700 underline-offset-2 hover:text-neutral-100"
          >
            {PROGRAM_ID}
          </a>{" "}
          on Solana devnet. Registered against{" "}
          <code className="text-neutral-400">Crypto.SOL/USD</code> because devnet has no
          live equity feed — the enforcement path is identical to what mainnet would run,
          only the reference asset differs.
        </div>

        <div className="mt-8 flex items-center justify-between">
          <Link href="/trade" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← back to the calculator
          </Link>
          <Link
            href="/findings"
            className="rounded-md bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-white"
          >
            Where does the premium come from? →
          </Link>
        </div>
      </div>
    </main>
  );
}
