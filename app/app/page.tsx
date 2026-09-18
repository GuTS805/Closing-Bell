import Link from "next/link";
import { getTrueCost } from "./lib/truecost";

export const revalidate = 0;

export default async function Landing() {
  let headline: { pct: string; ticker: string } | null = null;
  try {
    const r = await getTrueCost("SPYx", 50_000);
    headline = {
      pct: (Math.abs(r.breakdown.wrapperPremiumBps) / 100).toFixed(2),
      ticker: "SPYx",
    };
  } catch {
    // live fetch failed — the page still makes its point without the number
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-49px)] w-full max-w-2xl flex-col justify-center px-5 py-16">
      <p className="text-xs uppercase tracking-widest text-neutral-500">
        Stocklana · on-chain execution guard
      </p>

      <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Every quote for a
        <br />
        tokenized stock hides
        <br />
        <span className="text-amber-400">a cost nothing shows.</span>
      </h1>

      <p className="mt-6 max-w-lg text-base leading-relaxed text-neutral-400">
        Jupiter tells you the price impact of your trade. It measures that impact against
        the pool&rsquo;s own mid price. What it never tells you is that the pool&rsquo;s mid
        already sits above the stock it&rsquo;s supposed to track.
      </p>

      {headline ? (
        <p className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-300">
          Right now, buying <span className="text-neutral-100">$50,000</span> of{" "}
          <span className="text-neutral-100">{headline.ticker}</span> costs{" "}
          <span className="font-semibold text-amber-400">{headline.pct}%</span> more than
          the S&amp;P 500 it wraps — and that number appears in no quote, anywhere.
        </p>
      ) : null}

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/trade"
          className="rounded-md bg-neutral-100 px-5 py-3 text-center text-sm font-medium text-neutral-900 transition hover:bg-white"
        >
          See the true cost of a trade →
        </Link>
        <Link
          href="/proof"
          className="rounded-md border border-neutral-800 px-5 py-3 text-center text-sm text-neutral-300 transition hover:bg-neutral-900"
        >
          Watch the guard block a bad fill
        </Link>
      </div>

      <p className="mt-14 text-xs leading-relaxed text-neutral-600">
        Three stops: the calculator shows what you&rsquo;d actually pay. The proof page is a
        live devnet program that reverts a trade priced outside the band — on-chain, not in
        a UI. The findings page is the investigation into where the hidden cost comes from,
        including an experiment that came back negative.
      </p>
    </main>
  );
}
