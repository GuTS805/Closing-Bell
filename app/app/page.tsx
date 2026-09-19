import Link from "next/link";
import BrandLogo, { type Brand } from "./components/BrandLogo";
import { getTrueCost } from "./lib/truecost";

export const revalidate = 0;
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default async function Landing() {
  let live: Awaited<ReturnType<typeof getTrueCost>> | null = null;
  try { live = await getTrueCost("SPYx", 50_000); } catch { /* Clearly labelled historical fallback. */ }
  const oracle = live?.oracle.price ?? 760.87;
  const mid = live?.pool.midPrice ?? 765.05;
  const fill = live?.pool.fillPrice ?? 765.48;
  const impact = live?.breakdown.poolImpactBps ?? 5.6;
  const premium = live?.breakdown.wrapperPremiumBps ?? 54.9;

  return (
    <main className="landing-shell reference-landing">
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="eyebrow hero-pill"><span className="status-dot" /> REAL PRICES. REAL ANSWERS.</div>
          <h1>The quote is only<br />half the <em>story.</em></h1>
          <p className="hero-description">See what your tokenized stock trade really costs. Uncover the premium hiding between the share price and the price you pay on-chain.</p>
          <div className="hero-actions"><Link href="/trade" className="button-primary"><Icon kind="search" />Price your trade <span aria-hidden="true">→</span></Link><Link href="/proof" className="button-secondary"><Icon kind="bars" /> Explore the proof</Link></div>
          <div className="trust-row"><div><Icon kind="shield" /><span>Transparent<br />calculations</span></div><div><Icon kind="link" /><span>On-chain<br />evidence</span></div><div><Icon kind="document" /><span>Uncover hidden<br />premiums</span></div></div>
        </div>
        <section className="quote-card" aria-label="Cost breakdown for 50,000 dollars of SPYx">
          <div className="quote-heading"><div className="asset-title"><span className="asset-icon">S</span><div><strong>SPYx</strong><span>Tokenized S&P 500</span></div></div><span className={`data-badge ${live ? "is-live" : ""}`}><span className="badge-dot" />{live ? "Live snapshot" : "Historical snapshot"}</span></div>
          <dl className="price-breakdown">
            <div className="pay-row"><dt>You pay</dt><dd>{usd(fill)}</dd></div>
            <div><dt><span className="cost-icon"><Icon kind="impact" /></span><span>Pool impact<small>Your trade moves the pool price</small></span></dt><dd>{usd(fill - mid)}<small>({percent(impact)})</small></dd></div>
            <div><dt><span className="cost-icon premium-icon"><Icon kind="layers" /></span><span>Wrapper premium<small>The gap above the underlying share</small></span></dt><dd>{usd(mid - oracle)}<small>({percent(premium)})</small></dd></div>
            <div className="reference-row"><dt>Real S&P 500 price</dt><dd>{usd(oracle)}</dd></div>
          </dl>
          <div className="quote-total"><span>Total extra cost<small>You pay <b>{percent(impact + premium)}</b> more than the real stock price.</small></span><strong>{usd(fill - oracle)}<small>({percent(impact + premium)})</small></strong></div>
          <p className="quote-source" title={`$50,000 trade ? USD per share ? Pool mid-price ${usd(mid)}`}>{live ? "Source: Pyth + Jupiter · captured on page load" : "Measured 18 Sep 2026 · Live feeds unavailable"}</p>
        </section>
      </section>
      <section className="token-section" aria-label="Popular tokens"><div className="token-heading"><span>POPULAR TOKENS</span><Link href="/trade">View all tokens <span aria-hidden="true">&rarr;</span></Link></div><div className="token-strip">
        {([
          { brand: "spy", ticker: "SPYx", premium: "+0.57%", href: "/trade" },
          { brand: "apple", ticker: "AAPLx", premium: "+0.27%", href: "/trade" },
          { brand: "tesla", ticker: "TSLAx", premium: "0.00%", href: "/trade" },
          { brand: "nvidia", ticker: "NVDAx", premium: "+0.09%", href: "/trade" },
          { brand: "microsoft", ticker: "MSFTx", premium: null, href: "/findings" },
          { brand: "amazon", ticker: "AMZNx", premium: null, href: "/findings" },
        ] satisfies { brand: Brand; ticker: string; premium: string | null; href: string }[]).map((token) => <Link href={token.href} className="token-card" key={token.ticker} title={token.premium ? `${token.ticker}: reference wrapper premium, measured 18 Sep 2026` : `${token.ticker}: no price feed available in this calculator; explore the research`}><BrandLogo brand={token.brand} /><strong>{token.ticker}</strong><span className={token.premium && token.premium !== "0.00%" ? "token-premium" : "token-premium neutral"}>{token.premium ?? "\u2014"}</span></Link>)}
      </div><p className="token-source">Reference premiums &middot; 18 Sep 2026. &mdash; indicates an unavailable feed.</p></section>
      <section className="explore-section"><div className="section-heading"><div><span className="eyebrow">FROM QUOTE TO CONFIDENCE</span><h2>Look a little <em>closer.</em></h2></div><p>Understand the gap. See the evidence.<br />Make a more informed trade.</p></div><div className="feature-grid">
        <Feature n="01" href="/trade" title="Know your real cost" body="Choose a stock and trade size. Compare the underlying share price with the price you actually pay." action="Open the calculator" icon="calculator" />
        <Feature n="02" href="/proof" title="See the guard in action" body="Explore how a Solana program rejects a fill outside its permitted price band, with public transactions as proof." action="Inspect the proof" icon="network" />
        <Feature n="03" href="/findings" title="Follow the evidence" body="Read the investigation into wrapper premiums, including the experiment that challenged our first explanation." action="Read the research" icon="document" />
      </div></section>
      <section className="method-strip" aria-label="Data sources"><span>AN INDEPENDENT LOOK<br /><strong>at the price you pay.</strong></span><div><span className="source-mark">◎</span> Pyth <small>Reference price</small></div><div><span className="source-mark">≋</span> Jupiter <small>Pool execution</small></div><div><span className="source-mark">▱</span> Solana <small>On-chain verification</small></div></section>
      <section className="explainer" id="faq"><div><span className="eyebrow">THE DETAILS MATTER</span><h2>One trade.<br />Two different costs.</h2></div><div className="faq-list"><details open><summary>What is the wrapper premium?<span aria-hidden="true">+</span></summary><p>The tokenized stock can trade above or below the underlying share. That difference is the wrapper premium, and it exists before your trade moves the pool price.</p></details><details><summary>How is it different from price impact?<span aria-hidden="true">+</span></summary><p>Pool impact measures how far your execution price moves from the pool’s own mid-price. The wrapper premium compares that mid-price with the underlying share. Together, they reveal the full price deviation.</p></details><details><summary>Does Closing Bell execute trades?<span aria-hidden="true">+</span></summary><p>The calculator measures prices using Pyth and Jupiter. The proof page separately demonstrates an execution guard on Solana devnet. No wallet is required to explore the data.</p></details></div></section>
    </main>
  );
}

type IconKind = "search" | "bars" | "layers" | "network" | "eye" | "link" | "shield" | "impact" | "calculator" | "document";
function Icon({ kind }: { kind: IconKind }) {
  const paths: Record<IconKind, React.ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    bars: <><path d="M4 16v5m5-10v10m5-15v15m5-19v19" strokeWidth="2.8" /></>,
    layers: <><path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5" /></>,
    network: <><path d="m7 6 5 5m1 2 5 5m-5-7 5-5M6 18l5-5" /><circle cx="4" cy="4" r="3" /><circle cx="20" cy="4" r="3" /><circle cx="4" cy="20" r="3" /><circle cx="20" cy="20" r="3" /><circle cx="12" cy="12" r="3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    link: <><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 0 6 6l4-4a4 4 0 0 0-1-6M8 12a4 4 0 0 1-1-6l4-4a4 4 0 0 1 6 6l-1 1" transform="translate(0 0) scale(.92)" /></>,
    shield: <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />,
    impact: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM12 2v5m0 10v5M3 7l4 2m10 6 4 2M3 17l4-2m10-6 4-2" /><circle cx="12" cy="12" r="4" /></>,
    calculator: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h1m3 0h1m3 0h.1M8 15h1m3 0h1m3 0h.1M8 18h1m3 0h1m3 0h.1" /></>,
    document: <><path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
function Feature({ n, href, title, body, action, icon }: { n: string; href: string; title: string; body: string; action: string; icon: IconKind }) {
  return <Link href={href} className="feature-card"><span className="feature-number">{n}</span><div className="feature-content"><Icon kind={icon} /><h3>{title}</h3><p>{body}</p><span className="feature-action">{action} <span aria-hidden="true">→</span></span></div></Link>;
}
