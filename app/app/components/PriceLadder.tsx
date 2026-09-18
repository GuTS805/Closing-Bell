/**
 * A price ladder with dimension lines, drawn the way a measured distance is drawn.
 *
 * Three levels: what the equity is worth, where the pool's mid actually sits, and what
 * you end up paying. The two gaps between them are the whole product — one is shown by
 * every aggregator, the other by none.
 *
 * The gaps are sized RELATIVE TO EACH OTHER rather than to price. In absolute terms both
 * are fractions of a percent and would be invisible; against each other, a premium ten
 * times the impact looks ten times the impact, which is the honest comparison and the
 * one worth making.
 */

interface Props {
  /** Underlying equity price from the oracle. */
  oracle: number;
  /** The pool's own mid, spread removed. */
  mid: number;
  /** What this trade actually fills at. */
  fill: number;
  poolImpactBps: number;
  wrapperPremiumBps: number;
  /** Ticker without the x suffix, e.g. SPY. */
  underlying: string;
  /** Animate the gaps in when a fresh measurement arrives. */
  animate?: boolean;
}

const MIN_SEGMENT = 52;
const SHARED_HEIGHT = 148;

function pct(bps: number) {
  const sign = bps >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

function usd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PriceLadder({
  oracle,
  mid,
  fill,
  poolImpactBps,
  wrapperPremiumBps,
  underlying,
  animate = false,
}: Props) {
  const a = Math.abs(poolImpactBps);
  const b = Math.abs(wrapperPremiumBps);
  const total = a + b || 1;
  const impactHeight = MIN_SEGMENT + (SHARED_HEIGHT * a) / total;
  const premiumHeight = MIN_SEGMENT + (SHARED_HEIGHT * b) / total;

  return (
    <div className="w-full select-none">
      <Level label="you pay" price={usd(fill)} emphasis="ink" />

      <Segment
        height={impactHeight}
        tone="dim"
        measure={pct(poolImpactBps)}
        caption="pool impact"
        note="shown in every quote"
        animate={animate}
        delay={0}
      />

      <Level label="pool mid" price={usd(mid)} emphasis="dim" />

      <Segment
        height={premiumHeight}
        tone="gold"
        measure={pct(wrapperPremiumBps)}
        caption="wrapper premium"
        note="shown in none"
        animate={animate}
        delay={120}
      />

      <Level label={underlying} price={usd(oracle)} emphasis="blue" />
    </div>
  );
}

function Level({
  label,
  price,
  emphasis,
}: {
  label: string;
  price: string;
  emphasis: "ink" | "dim" | "blue";
}) {
  const priceColor =
    emphasis === "ink" ? "text-ink" : emphasis === "blue" ? "text-blue" : "text-ink-dim";
  const ruleColor = emphasis === "dim" ? "bg-rule" : "bg-rule-bright";

  return (
    <div className="relative">
      <div className={`h-px w-full ${ruleColor}`} />
      <div className="flex items-baseline justify-between py-2">
        <span className="text-[13px] text-ink-dim">{label}</span>
        <span className={`tabular font-display text-[19px] ${priceColor}`}>{price}</span>
      </div>
    </div>
  );
}

function Segment({
  height,
  tone,
  measure,
  caption,
  note,
  animate,
  delay,
}: {
  height: number;
  tone: "gold" | "dim";
  measure: string;
  caption: string;
  note: string;
  animate: boolean;
  delay: number;
}) {
  const gold = tone === "gold";
  const stroke = gold ? "bg-gold" : "bg-rule-bright";

  return (
    <div className="relative flex" style={{ height }}>
      {/* A dimension line: a measured span closed by a cap at each end. */}
      <div className="relative w-7 shrink-0">
        <div
          className={`absolute inset-y-0 left-3 origin-bottom ${animate ? "gap-grow" : ""}`}
          style={animate ? { animationDelay: `${delay}ms` } : undefined}
        >
          <div className={`absolute -left-1.5 top-0 h-px w-4 ${stroke}`} />
          <div
            className={`absolute inset-y-0 left-0 ${gold ? "w-[3px] -translate-x-[1px]" : "w-px"} ${stroke}`}
          />
          <div className={`absolute -left-1.5 bottom-0 h-px w-4 ${stroke}`} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span
            className={`tabular font-display ${
              gold
                ? "text-[30px] leading-none text-gold-bright"
                : "text-[17px] leading-none text-ink-dim"
            }`}
          >
            {measure}
          </span>
          <span className={`text-[13px] ${gold ? "text-gold" : "text-ink-faint"}`}>
            {caption}
          </span>
        </div>
        <span className={`text-[12px] ${gold ? "text-gold/70" : "text-ink-faint"}`}>{note}</span>
      </div>
    </div>
  );
}
