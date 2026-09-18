import Link from "next/link";
import PriceLadder from "./components/PriceLadder";
import { getTrueCost } from "./lib/truecost";

export const revalidate = 0;

export default async function Landing() {
  let live: Awaited<ReturnType<typeof getTrueCost>> | null = null;
  try {
    live = await getTrueCost("SPYx", 50_000);
  } catch {
    // The argument still stands without a live quote; the ladder falls back to the
    // figures measured on 2026-09-18, labelled as such.
  }

  const oracle = live?.oracle.price ?? 760.87;
  const mid = live?.pool.midPrice ?? 765.05;
  const fill = live?.pool.fillPrice ?? 765.48;
  const impact = live?.breakdown.poolImpactBps ?? 5.6;
  const premium = live?.breakdown.wrapperPremiumBps ?? 54.9;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:py-20">
      <h1 className="max-w-xl font-display text-[38px] font-light leading-[1.12] tracking-tight text-ink sm:text-[46px]">
        Buying a tokenized stock costs more than the quote says. Here is the part
        nobody prints.
      </h1>

      <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-ink-dim">
        Every aggregator measures price impact against the pool&rsquo;s own mid. The mid
        itself already sits above the share it tracks, so the gap never appears in a
        quote — at any trade size, down to a single share.
      </p>

      <section className="mt-14" aria-label="Cost of buying $50,000 of SPYx">
        <div className="mb-5 flex items-baseline justify-between border-b border-rule pb-2.5">
          <span className="text-[13px] text-ink-dim">$50,000 of SPYx, right now</span>
          <span className="text-[12px] text-ink-faint">
            {live ? `Pyth + Jupiter, live` : `measured 18 Sep 2026`}
          </span>
        </div>

        <PriceLadder
          oracle={oracle}
          mid={mid}
          fill={fill}
          poolImpactBps={impact}
          wrapperPremiumBps={premium}
          underlying="S&P 500"
        />
      </section>

      <div className="mt-12 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/trade"
          className="rounded-sm bg-ink px-5 py-3 text-center text-[14px] font-medium text-ground transition-colors hover:bg-white"
        >
          Price your own trade
        </Link>
        <Link
          href="/proof"
          className="rounded-sm border border-rule-bright px-5 py-3 text-center text-[14px] text-ink transition-colors hover:border-ink-faint"
        >
          See a bad fill rejected on-chain
        </Link>
      </div>

      <div className="mt-20 grid gap-8 border-t border-rule pt-8 sm:grid-cols-3">
        <Waypoint
          title="Price your trade"
          body="Pick a stock and a size. The gap is computed live from Pyth and Jupiter."
        />
        <Waypoint
          title="Watch it enforced"
          body="A program on Solana devnet reverts a fill priced outside the band. The rejection is a public transaction."
        />
        <Waypoint
          title="Read the investigation"
          body="Where the premium comes from, including the experiment that came back negative."
        />
      </div>
    </main>
  );
}

function Waypoint({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="font-display text-[17px] text-ink">{title}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">{body}</p>
    </div>
  );
}
