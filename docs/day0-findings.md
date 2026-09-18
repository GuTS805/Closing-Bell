# Day-0 findings

Run date: 2026-09-18, ~07:20-07:40 UTC (03:20 ET, Friday - NYSE shut).
Everything below was measured, not assumed, and is reproducible from this repo.

---

## 1. Section 12 feasibility test - oracle half PASSES

Ran the guard against a local validator with the real mainnet Pyth account cloned in
(`npm run day0`). Measured with `sol_log_compute_units()` either side of each step.

| Step | CU |
|---|---|
| Pyth read (`get_price_no_older_than`, incl. deserialization + feed-id + staleness check) | **2,970** |
| Band math (confidence ratio, band widening) | **399** |
| Program total | **7,417** |
| Transaction total | **7,567** |

Section 12's bar is ~250k CU. The oracle read plus band derivation is **~1.4% of it**,
leaving roughly 242k CU for the swap CPI. On this axis the architecture is confirmed with
a very large margin - compute budget is not the binding constraint, and the Section 16
risk "compute-unit budget exceeded" can be downgraded from High to Low.

Live values observed: `price=337.1725 conf=0.0775 (2 bps) expo=-5 age=23s band=202bps`.

**What this does not test:** the Meteora swap CPI (see section 5 below - no eligible pool
exists to CPI into). Section 12 is therefore **half answered**. The half that is answered
is the half that was quantifiable; the remaining half is blocked on a pool, not on
compute.

---

## 2. Pyth shard selection is a correctness bug waiting to happen

`Equity.US.AAPL/USD` (`49f6b65c...`) has **multiple on-chain accounts at different shards,
and they disagree badly**:

| Shard | Address | Age | Price |
|---|---|---|---|
| 0 | `DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy` | **34.5 days** | 305.92 |
| 1 | `D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW` | **5 s** | 337.10 |

Shard 0 is the default in most examples, and it is a month stale and **10% wrong**. A
guard banding against it would reject good fills and allow bad ones. The control feed
(`Crypto.SOL/USD`) shows the same pattern: shards 0 and 1 fresh, shard 2 stale by 889
days.

**Action:** pin shard 1, and have the keeper assert freshness of the specific account it
pushes to rather than trusting a derivation. This confirms Section 6.2's "known trap" -
but the trap is shard choice, not the feed.

Derivation note: sponsored accounts are PDAs of
**`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`** (push oracle), seeds
`[shard_u16_le, feed_id]`, while the account **owner** is
`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` (receiver). Deriving against the receiver
finds nothing - that cost time.

---

## 3. The market-state derivation in Section 5.3 does not work as written

Section 5.3 step 4 derives `market_open` from two signals, one being oracle `publish_time`
staleness. **Measured at 03:21 ET on a Friday with NYSE shut, the equity feed was 23
seconds old.** The feed publishes around the clock.

So oracle staleness does **not** distinguish open from closed. The "two independent
signals, fail safe if either says closed" design collapses to one signal - the
keeper-maintained `MarketClock` - and the fail-safe is weaker than the doc claims.

Staleness is still worth checking (it catches a dead feed) but it cannot carry
market-state. Either accept the keeper as the single source and say so honestly, or add a
genuinely independent second signal.

Related: there is a second feed, `Equity.Index.AAPL/USD` (`aaba35e6...`), described as
"PYTH PRICE IN USD FOR AAPL 24/7". **It has no on-chain account on shards 0-3**, so it is
not usable by the program today without pushing it yourself.

---

## 4. The Critical risk is mostly not real - the transfer hook is disabled

Read directly off the mainnet mints with `spl-token display`:

| Mint | Transfer Hook | Permanent delegate | Freeze authority | Transfer fee | ScaledUiAmount |
|---|---|---|---|---|---|
| AAPLx `Xsb...zJp` | present, **Program Id: Disabled** | yes `5aMNN...` | yes `JDq14...` | none | **absent** |
| TSLAx `XsDo...zoB` | present, **Program Id: Disabled** | yes (same) | yes (same) | none | **absent** |
| SPYx `Xso...F2W` | present, **Program Id: Disabled** | yes (same) | yes (same) | none | **absent** |

Consequences for the architecture document:

- **Section 16 row 1 ("Token-2022 transfer hook breaks the swap CPI", Critical) is largely
  void.** There is no hook program to invoke and no extra accounts to resolve. Pivots
  A/B/C were sized against a risk that is currently inert.
- **Section 7.1's ScaledUiAmount row names the wrong mechanism, but its number is real.**
  The extension is not present and decimals are a plain 8, so Section 9.2's multiplier work
  is unnecessary. However the "AAPLx ~ 1.00266" figure is exactly the value of the Pyth
  feed `Crypto.AAPLX/AAPL.RR` - a redemption ratio, not a UI scaling factor. An earlier
  draft of this document claimed the figure had no on-chain basis; that was wrong. See
  section 10.
- **Section 7.1's zero-transfer-fee requirement is satisfied** - no `TransferFeeConfig`.
- **Permanent delegate confirmed**, so the Section 7.1 disclosure obligation stands. Add
  freeze authority and a **Confidential transfer** extension (undocumented in the
  architecture) to the same disclosure.

Caveat to state honestly: the hook authority (`5aMNN...`) can enable a hook later. It is
"disabled today", not "impossible". Keep the CPI hook-tolerant; just stop treating it as
the project's central risk.

---

## 5. The Meteora bounty and the product describe two different pools

**Corrected from the first draft of this document.** The original claim here was "no
Meteora pool holds an xStock". The routing measurement behind it was right, but the
conclusion was wrong and hid the actual problem.

Stock-quoted DBC pools exist in quantity - hundreds of them, and Meteora announced on
15 September that DBC supports Backpack-issued equities as quote assets, with StockLaunch
listing twenty. Live examples include a DBC virtual pool sGME/AAPLx at
`J1gcmbH3QthJahRdXqEAXc7eDbYE6JoWYqGVViGvFLbm`, graduated to DAMM v2 at
`7FGmDHJNPhTu4VbRLQL7b5RKMXDD1p8Sm7hDKPWby4gA`.

The distinction that matters is **which side of the pair the equity sits on**:

- Closing Bell guards someone **buying AAPLx**. That needs an **AAPLx/USDC** pool, where
  the equity is the asset being traded. Jupiter routes that to **Raydium CLMM and Byreal**
  - no Meteora leg at any size tested.
- The Meteora bounty wants a pool where **AAPLx is the quote token**, as in sGME/AAPLx.
  There, the asset being traded is sGME. **There is no oracle for sGME, so the band has
  nothing to check.**

Section 7.2 and Sections 2-3 therefore describe two different pools, and the architecture
document never noticed. Three ways out, none free:

1. **Guard AAPLx/USDC on Raydium CLMM.** Coherent product, real liquidity, real users.
   Drops the Meteora bounty entirely; the CPI target changes to Raydium.
2. **Create and seed an AAPLx/USDC DAMM v2 pool on Meteora.** Keeps both tracks, but you
   are the only LP - which turns "we protect real traders" into "we protect traders in the
   pool we made", and a judge will ask.
3. **Drop the Meteora bounty, keep Pyth plus the main track.** Cleanest. It was already
   priority 3 and day-5-only.

Recommended: (1) or (3). The Meteora bounty is $5K against a $100K main track, and forcing
it is what created the incoherence.

Both Meteora program IDs verified executable on mainnet:
`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` (DBC),
`cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (DAMM v2).

---

## 6. The premise holds - but only at size, and the demo script is what is wrong

> **Superseded in part by section 12.** The size effect below is real and large. The
> *off-hours* part of the thesis did not survive the session-hours comparison: the same
> dislocation is present during market hours. Read this section with section 12.

The first draft of this document reported "9 bps from oracle at 3am" and concluded the
premise was weaker than Section 2.1 claims. **That measurement tested one share of the
single most liquid, most arbed xStock available, and proved nothing.** It falsifies the
demo script, which dramatises exactly that case, not the thesis.

Re-measured at size and across thin names (`replay/depth-at-size.ts`), 03:50 ET Friday,
market shut. Buying with USDC; positive = paid above oracle:

| ticker | liq $k | $1k | $10k | $50k | $250k |
|---|---|---|---|---|---|
| SPYx | 7,343 | +70bp | +72bp | +77bp | +105bp |
| NVDAx | 2,065 | +21bp | +21bp | +28bp | +107bp |
| TSLAx | 1,345 | +6bp | +6bp | +15bp | +127bp |
| AAPLx | 656 | +38bp | +51bp | +123bp | **+1439bp** |
| GOOGLx | 457 | +45bp | +64bp | +137bp | +441bp |
| METAx | 350 | +28bp | +53bp | +292bp | **+10592bp** |
| AMZNx | 222 | +18bp | +37bp | +137bp | +794bp |

**Off-hours depth collapses, and it collapses non-linearly.** AAPLx costs 14.4% above
oracle at $250k. METAx costs 2.9% at $50k and 106% at $250k. A 2% band blocks every one of
those fills. This is the number the pitch needs, and it is a far stronger one than the
original framing.

Two things this does **not** establish, which must not be overclaimed:

- It measures **available depth**, not **realised fills**. It shows a trader attempting
  size off-hours gets destroyed; it does not show that anyone did. Proving that still
  needs actual on-chain swap history, which is the real Section 10 replay.
- **No session-hours comparison yet.** The market opens 13:30 UTC. Re-run with
  `SESSION_LABEL=open` and diff; the delta is the headline, not the absolute level.

Secondary observations:

- **SPYx carries a standing ~70 bp premium even at $1k**, flat across sizes. That is not
  impact, it is a persistent offset - worth understanding before quoting SPYx numbers.
- **PLTRx, GMEx and KOx have no shard-1 Pyth account at all.** Not every xStock can be
  guarded. Oracle coverage, not liquidity, is the binding constraint on which tickers the
  product supports.
- Several oracle `publish_time` values read **ahead of local clock** (-1 s to -13 s). The
  guard must tolerate negative age rather than assuming `now >= publish_time`.

Still untested, and worth doing before building further: **event windows.** A
Friday-close-to-Monday-open span covering an earnings release or news event. Steady-state
numbers say nothing about the gap case, which is where the largest dislocation should be.

---

## 7. Blockers and environment

- **No mainnet SOL.** Dev wallet `aCvwfxrMfV6apmHjLdo2nxP9GgcQZEZ3n9EpwKnYcc2`, balance 0.
  The mainnet leg of Section 12 (a real tx; program deploy is roughly 2-5 SOL) is blocked
  on funding.
- **Pyth Hermes now requires auth** - `401 unauthorized` for *all* feeds tested, crypto
  included, not just equities. The keeper cannot push fresh prices without a key. Claim
  the Pyth Pro bounty perk immediately; Section 8's entire keeper design depends on it.
- **Public RPC is rate-limiting** (`getTokenLargestAccounts` refused). Get a Helius or
  Triton endpoint before the keeper runs on a 10-30 s cadence.

### Toolchain that actually works

Anchor 0.31.1 is a dead end: its platform-tools ships cargo 1.79, and transitive deps now
require `edition2024`. Pinning `block-buffer`/`digest` does not clear it.

Working combination, installed in WSL2 Ubuntu 24.04:

```
anchor-cli 1.2.0        anchor-lang 1.2.0
solana-cli 4.1.2        pyth-solana-receiver-sdk 2.0.0
                        solana-program 5.0.0
```

Two gotchas worth keeping: pin `anchor_version` and `solana_version` in `Anchor.toml`
(Anchor otherwise maps the `solana-program` *crate* version to a nonexistent agave
release), and `sol_log_compute_units` is not in Anchor's curated `solana_program`
re-export - depend on `solana-program` directly.

Builds use `CARGO_TARGET_DIR=/home/alok0/.cb-target` so cargo writes to the Linux
filesystem while source stays on the Windows side.

---

## 8. What Section 12 still owes

The CPI half - against whichever venue survives the section 5 decision.

Note that **devnet cannot answer the TokenBadge question**, because AAPLx does not exist
there. Testing it requires a synthetic Token-2022 mint reproducing the extension set
(permanent delegate + freeze authority + confidential transfer + hook disabled). That
tests the *structural* question - can a mint with these extensions be a quote token - but
not whether Meteora would actually badge the real mint.

Given the hook is disabled and the oracle read costs ~3.4k CU, a CPI pass is the expected
outcome. The real unknowns are now **venue choice and pool eligibility**, not compute or
Token-2022.

---

## 9. Regulatory: SEC Innovation Exemption, issued 2026-09-17

Verified against the primary source (SEC press release 2026-90), not secondary reporting.
Issued **yesterday**, runs five years. Tokenized Securities Venues (TSVs) may trade
tokenized NMS stock using "permissioned automated market makers and liquidity pools"
without registering as an exchange.

Conditions that touch this project:

- *"Smart contracts used by a TSV must be auditable, public, and deployed on a public,
  permissionless distributed ledger."* Closing Bell satisfies this by construction.
- *"A TSV must stop trading in a tokenized NMS stock concurrently with any stoppage of
  trading in the underlying NMS stock on the primary listing exchange."*

That second condition is the interesting one, and it cuts both ways:

- **For the project:** it creates a concrete, regulator-stated need for **on-chain halt
  propagation** - a mechanism that stops on-chain trading when the primary exchange halts.
  That is structurally what `MarketClock` plus `set_paused` already are. It converges with
  the tail-event circuit-breaker framing, and it is a narrower and more defensible claim
  than "we fix off-hours pricing".
- **Against the premise:** if "any stoppage" is read to include the ordinary 16:00 ET
  close, then a TSV could not offer the 24/7 trading that Section 2 is built on. Read
  narrowly (halts only), it just requires halt propagation. **This ambiguity is
  unresolved** and should not be papered over.

Two limits on how far this can be leaned on:

- The order **says nothing about pricing mechanisms, price bands, market hours or
  oracles.** There is no regulatory mandate for oracle banding. Claiming the SEC requires
  what this project builds would be overreach.
- It applies to **TSVs** seeking exemption from exchange registration. xStocks as they
  trade today are not obviously TSVs under this order, and a hackathon project is not one
  either.

---

## 10. There are three feed families, and the xStock ones are not maintained

Pyth publishes three related feeds per tokenized equity. The Pyth track explicitly invites
using one, comparing both, or building a "price-comparison surface":

| feed | what it is | freshest on-chain account |
|---|---|---|
| `Equity.US.<T>/USD` | the underlying equity | shard 1, **seconds old** |
| `Crypto.<T>X/USD` | the xStock itself | shard 0 only, **5.8 days stale** |
| `Crypto.<T>X/<T>.RR` | xStock priced in units of the underlying (the basis) | shard 0 only, **~59 days stale** |

Measured 2026-09-18 04:00 ET:

| ticker | RR value | implied basis |
|---|---|---|
| SPY | 1.00571 | **+57 bp** |
| QQQ | 1.00273 | +27 bp |
| AAPL | 1.00266 | +27 bp |
| GOOGL | 1.00193 | +19 bp |
| NVDA | 1.00092 | +9 bp |
| TSLA | 1.00000 | 0 bp |

### This explains the SPYx anomaly

Section 6 reported an unexplained standing ~70 bp premium on SPYx, flat across trade
sizes. `Crypto.SPYX/SPY.RR` = 1.00571 says **+57 bp of it is structural basis** - the
xStock trades at a persistent premium to the underlying because only authorized
participants can arbitrage redemption 1:1; retail cannot. The remaining ~13 bp is route
cost. It was never a stale pool.

### Why this is a correctness issue, not trivia

A band centered on `Equity.US.<T>/USD` is centered on the wrong price. For SPYx it would
sit 57 bp away from where the asset actually trades and **systematically block one side of
every trade** while waving through the other. That is a real bug, and it would have
shipped.

The band must be centered on the xStock's own value. But **the xStock feeds cannot carry
that on-chain today** - 5.8 days and ~59 days stale respectively, shard 0 only. So the
basis is a keeper-maintained `basis_bps` on the market account, updated on the same
machinery that pushes prices, and disclosed as such. `PendingFill.basis_bps` carries it.

Coverage does not improve: PLTRx, GMEx and KOx have no feed in *any* of the three
families. Oracle coverage remains the binding constraint on which tickers are supportable.

---

## 11. Architecture change: bracket the swap, do not route it

The guard no longer CPIs into a venue. It brackets an unmodified swap inside one
transaction:

```
ix 0   record_pre_state    snapshot balances + oracle price + band into a PDA
ix 1   any swap            Jupiter, unmodified, real routing, any venue
ix 2   verify_fill         balance deltas -> realised price -> band check -> revert
```

Solana's atomicity does the enforcement. This removes the entire class of problems day 0
surfaced:

- **No CPI to prove.** The unproven cost of a Raydium CLMM or Meteora swap CPI with a
  Token-2022 input is not paid at all.
- **Token-2022 extensions become irrelevant.** The guard never moves a token, so transfer
  hooks, permanent delegate and confidential transfer cannot affect it.
- **Real liquidity, no bootstrapping.** It inherits Jupiter's routing across Raydium CLMM
  and Byreal instead of seeding a pool where you are the only LP.
- **The quote-vs-base incoherence in section 5 dissolves.** The guard protects AAPLx/USDC
  trades wherever they route; a Meteora DBC launch becomes a genuinely optional side
  artifact rather than an architectural contortion.

### Measured, on a validator with the mainnet Pyth account cloned

`npx tsx tests/guarded-fill.ts`, oracle at 336.5713, closed-market band 200 bp:

| case | fill price | deviation | outcome |
|---|---|---|---|
| A | at oracle | 0 bp | allowed, **24,767 CU** total |
| B | +6.8% | 680 bp | **REVERTED**, `OutsideBand` |
| C | +1.5% | 149 bp | allowed, 24,896 CU |

Case B is the one that matters: the two token transfers ahead of `verify_fill` had already
executed, and the user's base balance was **unchanged** afterwards
(`100000000 -> 100000000`). The whole transaction rolled back.

Whole-transaction cost including both guard instructions and two token transfers is under
25k CU; `verify_fill` itself is ~3,988 CU.

### The honest limitation

This binds only users whose transaction includes the two instructions. You build the
transaction in the app, so it holds for your own users by construction; for the "protocol
others integrate" story, you are offering an instruction others append - a cleaner
integration surface than asking them to reroute swaps through you, but it is not, and
should not be claimed as, protection for a pool as a whole.

---

## 12. The session-hours comparison does not support the off-hours thesis

Same probe, same tickers, same notional tiers. Closed run 03:50 ET; open run 11:59 ET,
mid-session. Deviation from oracle when buying:

| ticker | $50k closed | $50k open | $250k closed | $250k open |
|---|---|---|---|---|
| SPYx | +77 | +78 | +105 | **+88** |
| NVDAx | +28 | **+65** | +107 | **+212** |
| TSLAx | +15 | **+63** | +127 | **+277** |
| AAPLx | +123 | +142 | +1439 | +1560 |
| GOOGLx | +137 | +145 | +441 | +465 |
| METAx | +292 | **+177** | +10592 | **+5608** |
| AMZNx | +137 | +134 | +794 | +881 |

**There is no off-hours penalty.** Several names are materially *worse* during the regular
session — NVDAx +107 to +212 and TSLAx +127 to +277 at $250k — and the two that improve
(METAx, SPYx) do not establish a pattern in the other direction either.

### What this breaks

Section 2 predicts that with the reference market shut and the pool the only
price-discovery mechanism, off-hours execution should be materially worse. Measured twice,
eight hours apart, it is not. The dislocation at size is **a thin-AMM-liquidity property
that holds around the clock**, not a market-hours phenomenon.

That is fatal to the framing, not to the product:

- **Does not survive:** "trade at 3am and not get picked off", the closing-bell metaphor,
  the market-open/closed fee premium as the headline feature, and the Section 15 demo
  script, which stakes everything on the 3am contrast.
- **Does survive, and is large:** oracle-banded slippage protection at size on thin
  tokenized-equity AMMs. A trader putting $250k into AAPLx pays 15% over oracle whenever
  they do it. A 2% band blocks that fill at 3am and at noon alike. This is a bigger
  addressable problem than the off-hours one, because it is always on.

The market-state machinery (`MarketClock`, closed-band widening, halt propagation) is still
worth keeping — it is cheap, it is what the SEC order in section 9 gestures at, and a wider
band when the reference market is shut is defensible prudence. It just cannot be the pitch.

### Caveats, stated because they could change the conclusion

- **n = 1 per session.** Two snapshots, one day. The series in `replay/` accumulates; run
  it repeatedly before treating this as settled.
- The closed sample was 03:50 ET Friday, among the quietest hours of the week. A weekend
  sample, when the underlying has been shut for two days, is a different and fairer test of
  the thesis.
- During the session the underlying is moving, so pool prices chase a moving reference.
  That may be *why* open-hours depth looks worse, and it is a real effect rather than an
  artefact — but it is the opposite of what Section 2 predicts.
- **Event windows remain untested**, and remain the strongest remaining chance for the
  off-hours thesis: a Friday-close-to-Monday-open span covering an earnings release is
  where a stale pool should genuinely gap. If that shows nothing either, reframe fully
  around all-hours slippage protection.

---

## 13. The wrapper premium is in the pool, not just between two feeds

This was the check that decides the pitch, and it passes.

Buying always pays the spread, so a buy quote cannot isolate the pool mid. Quoting both
directions at the same notional cancels it: `mid = (buy_dev + sell_dev) / 2`. Measured
at $2,000 notional, 12:11 ET, against `Equity.US.<T>/USD`:

| ticker | buy | sell | **pool mid** | RR feed | diff | spread |
|---|---|---|---|---|---|---|
| SPY | +62 | +59 | **+60 bp** | +57 | +3 | 3 bp |
| TSLA | +7 | -3 | **+2 bp** | 0 | +2 | 10 bp |
| NVDA | +24 | +14 | +19 bp | +9 | +9 | 10 bp |
| AAPL | +57 | +14 | +35 bp | +27 | +9 | 43 bp |
| GOOGL | +32 | -17 | +7 bp | +19 | -12 | 49 bp |

**Correlation(pool mid, RR) = 0.931 over n=5.** Mean pool mid 24.9 bp against mean RR
22.4 bp — the same level, not a constant offset.

The discriminator is TSLA against SPY. TSLA's RR is 1.00000 and its pool mid is +2 bp;
SPY's is 1.00571 and its pool mid is +60 bp. A feed-construction artifact would show a
similar offset on both. Instead the pool premium tracks the published redemption ratio
ticker by ticker. **The premium is real and it is in the price people actually trade at.**

Fit quality inversely tracks spread width — SPY and TSLA have 3 bp and 10 bp spreads and
fit within 3 bp, while GOOGL and AAPL have ~45 bp spreads and fit worst. That is the
expected behaviour if the signal is real and the wide-spread mids are simply noisy
estimates, and it is a reason to weight tight-spread names when quoting the finding.

### Why this is the wedge, and why depth is not

Jupiter already displays price impact. A trader placing a $250k AAPLx buy sees the ~15%
before signing, so a guard that blocks it is refusing a trade they could already see was
bad — no information asymmetry, and that objection lands in a judge's first question.

The basis is different in kind:

- Jupiter's impact is measured against **the pool's own mid**.
- The pool mid itself sits **above the underlying equity**, by an amount nothing on Solana
  displays.
- So a user buying SPYx at "0.01% price impact" sees an excellent fill and pays **57 bp
  over SPY**. Invisible, structural, and present **at every size, including one share**.

The true cost of a tokenized-stock trade is pool impact *plus* wrapper premium, and only
the first is shown anywhere. The guard bands against the **underlying equity**, not the
pool mid, which is the only way to catch the second term — a claim Jupiter's number
structurally cannot make. It also survives section 12 entirely, because the basis is
time-invariant by construction rather than a market-hours effect.

### Who this repositions the product for

For a human reading a quote, display would be enough. For **programmatic flow** — agents,
DCA bots, treasury execution, and lending liquidations against stock collateral — nobody
reads a quote, and an on-chain band is the only enforcement available. That user needs a
program rather than a dashboard.

### Caveats

- n = 5 with an RR to compare against, single sample.
- The RR feeds are ~59 days stale. Today's pool mid still matching a two-month-old ratio
  argues the basis is stable, but it is not a like-for-like comparison and should be said
  that way.
- METAx (+50 bp) and AMZNx (-25 bp) have no RR feed. AMZNx's negative mid comes with a
  52 bp spread, so that number is noise rather than a discount.

---

## 14. The mechanism: tested, narrowed, unresolved

Two experiments, run 2026-09-18. Both are reproducible from this repo.

### Experiment 1 — SPY ex-dividend: null result

SPY's ex-dividend date fell inside the build window, with a projected dividend of
$1.8083-1.9987. Against a live spot of $759.13 that predicts a **23.8-26.3 bp** step.

Direction matters and is easy to get backwards. Ex-dividend takes effect at the **open**:

- An **accumulating** wrapper should see the premium **widen** by ~25 bp, because the
  equity leg drops by the dividend and the token retains the claim.
- A **distributing** wrapper should see **no change**, because both legs drop together.
- A **decline** is predicted by neither.

Measured, like-for-like across the open (buy side, $1k):

| time | SPY premium |
|---|---|
| 03:50 ET — pre-open | **70.5 bp** |
| 11:59 ET — post-open | **65.1 bp** |
| 12:11 ET | 60.5 bp (mid) |
| 15:07 ET | 53.1 bp (mid) |

**−5.4 bp across the open, against an expected magnitude of ~25 bp in either direction.**
SPY's bid-ask is 3 bp, so the mid is precise to a few bp and a 25 bp step would have been
unmissable. There is no step — only a slow intraday drift consistent with ordinary flow.

**The ex-dividend hypothesis is not supported for this event.**

### Experiment 2 — is it dividends, or is it size?

If the premium were driven by demand, depth or wrapper maturity rather than dividends, a
size variable should explain it better. All six tickers, verified yields:

| tkr | AUM $m | liquidity $k | yield | RR bp | implied accrual |
|---|---|---|---|---|---|
| SPY | 72.9 | 7,343 | 0.98% | 57.1 | 7.0 mo |
| QQQ | 60.8 | 1,808 | 0.40% | 27.3 | 8.2 mo |
| AAPL | 51.9 | 656 | 0.32% | 26.6 | 10.0 mo |
| GOOGL | 56.5 | 457 | 0.23% | 19.3 | 10.1 mo |
| NVDA | 70.6 | 2,065 | 0.46% | **9.2** | **2.4 mo** |
| TSLA | **83.6** | 1,345 | 0.00% | **0.0** | — |

| correlation with RR | |
|---|---|
| dividend yield | **0.887** (0.986 excluding NVDA) |
| liquidity | 0.780 |
| AUM | **−0.235** |
| supply | −0.732 |

**Size and demand are falsified.** The decisive row is TSLA: the **largest AUM in the
set**, healthy liquidity, and a premium of **exactly zero**. No size or demand variable
predicts zero there; "pays no dividend" does. NVDA breaks the liquidity story as well —
second-highest liquidity, fifth-highest premium — so it is an outlier under every variable
tested rather than evidence for an alternative.

### What remains unexplained

- **NVDA.** Its yield is 0.46%, *higher* than AAPL (0.32%) and GOOGL (0.23%), so under any
  common-window accrual model it should carry the **largest** premium of the three. It
  carries the smallest. That inversion is unexplained.
- **The implied window is ~7-10 months**, consistently, against xStocks launching roughly
  14 months ago. If this were accrual-since-launch it should cluster at 14. It does not.
- **No ex-dividend step**, where accrual predicts a clear one.

### The honest position

A persistent premium exists between every tokenized stock and its underlying. It orders by
dividend yield and is exactly zero for the one ticker that pays no dividend. It is not
explained by AUM, supply or liquidity. But it does not respond to an ex-dividend date, it
does not fit accrual-since-launch, and NVDA inverts it.

**The mechanism is unresolved. The premium is measured, reproducible, and invisible in
every quote.** That is the claim the product rests on, and it does not depend on the
mechanism.

### A note on verification

An earlier pass through this analysis used an estimated NVDA yield of ~0.02%/yr and
concluded NVDA implied 55 months of accrual. The verified figure is 0.46%, which reverses
the direction of the discrepancy entirely. A second pass used a fabricated Pyth feed id for
GOOGL, which returned no price and silently corrupted the AUM correlation to −0.016. Both
were caught by checking figures that carried weight against their sources. Any number in
this document that drives a conclusion was verified; where a figure is an estimate it is
labelled as one.
