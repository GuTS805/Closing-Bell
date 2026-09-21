# Closing Bell

**The true cost of a tokenized stock trade is pool impact plus a wrapper premium, and only
one of the two is shown anywhere.**

![True cost breakdown](docs/img/truecost.png)

## The finding

Every xStock trades at a structural premium to the equity it wraps, because only
authorized participants can arbitrage redemption 1:1 and retail cannot. Pyth publishes the
ratio, but nothing on Solana applies it to a quote.

Measured 2026-09-18 against mainnet. The pool mid is isolated by quoting both directions at
the same notional, which cancels the spread: `mid = (buy_dev + sell_dev) / 2`.

| ticker | pool mid vs equity | Pyth published ratio | diff | spread |
|---|---|---|---|---|
| SPY | **+60 bp** | +57 bp | +3 | 3 bp |
| TSLA | **+2 bp** | 0 bp | +2 | 10 bp |
| NVDA | +19 bp | +9 bp | +9 | 10 bp |
| AAPL | +35 bp | +27 bp | +9 | 43 bp |
| GOOGL | +7 bp | +19 bp | −12 | 49 bp |

**Correlation 0.931 over n=5.** The discriminator is TSLA against SPY: TSLA's published
ratio is 1.00000 and its pool mid is +2 bp; SPY's is 1.00571 and its mid is +60 bp. A
feed-construction artifact would offset both alike. The premium is in the price people
actually trade at.

Jupiter measures impact against the pool's own mid, so the premium never appears in a
quote. A $50,000 SPYx buy shows **+0.06% impact** and costs **+0.58% against SPY** — the
invisible term is roughly ten times the visible one, and unlike impact it is present at
every size, including one share.

### It is a persistent state, not a number

The table above is one measurement per ticker at one moment, which cannot separate a
structural premium from whatever happened to be on screen. Sampling every three minutes
asks a better question — does each sample predict the next?

| tkr | premium | persistence (lag-1) |
|---|---|---|
| SPY | 53.5 ± 5.6 bp | **0.918** |
| AAPL | 27.4 ± 12.0 bp | **0.857** |
| NVDA | 11.5 ± 11.2 bp | 0.479 |
| TSLA | −4.4 ± 8.1 bp | **0.059** |

**TSLA is the control that makes the rest readable.** Every ticker carrying a premium
predicts itself three minutes later at ~0.86 to 0.92. TSLA, which carries none, sits at 0.06 —
indistinguishable from noise. The instrument finds structure where a premium exists and
finds none where it does not, which rules out the measurement itself as the source.

Two robustness checks:

- **Oracle staleness is not producing it.** Premium against the oracle's own age
  correlates −0.35 to +0.06. A stale-price artifact would be strongly positive.
- **Three samples discarded** by a stated 1% spread rule. One is a genuine after-hours
  route failure at a 36% implied spread; the other two are merely wide, at ~1.2%. The
  99th percentile of every other sample is 0.80%.

778 usable samples over **10.4 hours across two sessions**, as of 2026-09-22 — intraday
only, with no overnight or weekend coverage. The sampler is still running, so a fresh run
reports more samples than the table above. Reproduce with `npx tsx scripts/analyze-basis.ts`.

### We tried to explain it, and could not

The premium orders by dividend yield and is **exactly zero** for the one ticker in the set
that pays no dividend:

| tkr | AUM $m | liquidity $k | dividend yield | premium |
|---|---|---|---|---|
| SPY | 72.9 | 7,343 | 0.98% | 57.1 bp |
| QQQ | 60.8 | 1,808 | 0.40% | 27.3 bp |
| AAPL | 51.9 | 656 | 0.32% | 26.6 bp |
| GOOGL | 56.5 | 457 | 0.23% | 19.3 bp |
| NVDA | 70.6 | 2,065 | 0.46% | **9.2 bp** |
| TSLA | **83.6** | 1,345 | 0.00% | **0.0 bp** |

Correlation with dividend yield is **0.887**, against **−0.235** for AUM and 0.780 for
liquidity. Size and demand are ruled out by TSLA: the largest wrapper in the set by AUM,
with healthy liquidity, carries a premium of exactly zero.

But the dividend story does not close either:

- **SPY's ex-dividend date fell inside the build window.** A ~$1.90 dividend on a $759
  spot predicts a **~25 bp step** at the open — widening, for an accumulating wrapper.
  Measured across the open: **−5.4 bp.** SPY's spread is 3 bp, so a 25 bp step would have
  been unmissable. **No step.**
- **NVDA yields 0.46%**, more than AAPL or GOOGL, yet carries the smallest premium of the
  three. That inversion is unexplained.
- The implied accrual window clusters at **7–10 months** against a wrapper that launched
  roughly 14 months ago.

**The mechanism is unresolved. The premium is measured, reproducible, and not shown
anywhere.** The product does not depend on which explanation wins.

Reproduce: `npx tsx replay/pool-vs-equity.ts`

## The product

A Next.js app that prices the trade you are actually doing, against the asset you think you
are buying. Live mainnet data — Jupiter for pool prices, Pyth shard 1 read directly on-chain
for equity prices.

| page | what it shows |
|---|---|
| `/` | Overview — the headline breakdown for a reference trade |
| `/trade` | Calculator — pool impact vs. wrapper premium for any ticker and size |
| `/position` | A held xStock's true cost, looked up read-only by wallet connect or pasted address — never signs anything |
| `/proof` | The guard's devnet rejection, with a live "send a fill" button |
| `/findings` | The dividend-yield investigation, including the null results |

```bash
cd app && cp .env.example .env.local   # fill in an RPC URL at minimum
npm install && npm run dev
```

## The program

Showing the number is enough for a human reading a quote. Agents, DCA bots, treasury
execution and liquidations against stock collateral never read one, so the band has to be
enforced where the trade settles.

The guard does not route swaps. It brackets one inside a single transaction:

```
ix 0   record_pre_state    snapshot balances + oracle price + band
ix 1   any swap            Jupiter, unmodified, real routing, any venue
ix 2   verify_fill         balance deltas -> realised price -> band check -> revert
```

Atomicity does the enforcement. The guard never moves a token, so Token-2022 extensions
cannot affect it, and it inherits real aggregated liquidity rather than needing a pool of
its own.

| | |
|---|---|
| Pyth read + band derivation | 3,369 CU |
| Full guarded fill | ~33,000 CU |
| Test suite | 6 cases, all passing |

### Live on devnet — click the rejection

Program [`DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig`](https://solscan.io/account/DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig?cluster=devnet)

| | fill | guard | on-chain |
|---|---|---|---|
| at the oracle price | 0 bp | allowed | [tx](https://solscan.io/tx/5KK2pPnAks22g3tPJHYdAhtuhJbwFbk7FKWFVwLiJmGi8VxWwJWSy8fjw23MFWQ3WGp3q3tiA2sQqzyDBndobYy9?cluster=devnet) |
| **6.8% above oracle** | 679 bp | **rejected** | [**tx**](https://solscan.io/tx/2VKxFk8Lnim9pe59pev9NNhyYk3TrRQ7ZyrF5amiCqKR5yUbZ2woLS5KcGXmMrwjqrQxBN44oeGyLAA6e4T9wjS6?cluster=devnet) |

The rejected transaction carries the guard's own reasoning in its logs:

```
fill: BUY base_delta=100000000 quote_delta=119939292
      realised=1199392920000 expected=1123027080300
      deviation=679bps band=301bps
```

`Custom: 6000` is `OutsideBand`. The two token transfers ahead of `verify_fill` had already
executed, and the buyer's balance is **unchanged at 1100000000** — the whole transaction
rolled back. Whole guarded fill costs ~36,800 CU.

The 301 bp band is 200 bp closed-market, plus 1 bp confidence widening, plus 100 bp because
no basis had been pushed for this market — the ageing path widening the band rather than
assuming the centre is exact.

### Running the tests

```bash
anchor build && npx tsx tests/guarded-fill.ts   # needs a local validator, see below
```

Cases: fill at oracle (allowed), 6.8% above (reverts, balances roll back), 1.5% above
(allowed inside band), sell 6.8% below (reverts — the band is symmetric), snapshot with no
swap (`NoFillDetected`, not a divide-by-zero), keeper basis above the ceiling
(`BasisOutOfBounds`).

The local validator needs the mainnet Pyth account cloned in:

```bash
solana-test-validator --url https://api.mainnet-beta.solana.com \
  --clone D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW \
  --bpf-program <PROGRAM_ID> target/deploy/closing_bell_guard.so --reset
```

## Honest limits

- **Deployed to devnet, not mainnet.** The enforcement path is real and publicly
  verifiable, but against test mints and a crypto reference feed rather than a live xStock
  market.
- **The basis is keeper-supplied**, because the source feeds are not maintained on-chain:
  `Crypto.*X/USD` was 5.8 days stale and `Crypto.*X/*.RR` ~59 days stale, shard 0 only. It
  is bounded in-program rather than trusted — a 300 bp ceiling against measured values of
  57 bp and 27 bp, a 10 bp/min drift limit, and ageing out after an hour with the band
  widened rather than the centre silently assumed exact.
- **Devnet has no live equity feed** (`Equity.US.AAPL/USD` was 78 days stale there), so the
  devnet demo bands against `Crypto.SOL/USD`. The mechanism is identical; only the
  reference asset differs. Note devnet's fresh shard is 0, the inverse of mainnet.
- **Devnet test mints** reproduce the xStock extensions that matter — permanent delegate
  and freeze authority. The transfer hook is omitted because on mainnet every xStock
  carries it *disabled*.
- **The off-hours thesis did not survive measurement.** A session-hours comparison found no
  off-hours penalty; several names are worse mid-session. The dislocation at size is a
  thin-AMM property that holds around the clock. See `docs/day0-findings.md` section 12.
- **The guard binds only transactions that include its two instructions.** For your own
  users that holds by construction; as a protocol others integrate, it is an instruction
  they append, not protection for a pool as a whole.

## A pattern worth naming: the evidence broke twice, the code didn't

Two independent bugs in this build had the same shape — the thing being tested worked, and
the *proof* of it was what failed.

1. **The test suite asserted on error message strings.** `skipPreflight` suppresses logs on
   the thrown error, so those assertions matched nothing and would have passed on *any*
   failure, including the wrong one. Two cases read as failing when the program was
   correct. Now asserts on Anchor error codes.
2. **The first devnet run lost the rejected transaction's signature.**
   `sendAndConfirmTransaction` throws on a rejected fill, and the signature was being
   scraped from the error text by a regex that did not match. The guard blocked the fill
   exactly as intended and the artifact proving it was thrown away. Now sends via
   `sendRawTransaction` so the signature is in hand before confirmation reports failure.

Both were caught by checking the evidence rather than the outcome. The same habit caught
two bad numbers in the analysis: an estimated NVDA dividend yield that reversed a
conclusion once verified, and a fabricated Pyth feed id that silently corrupted a
correlation to −0.016. Figures that drive a conclusion here were checked against their
source; figures that are estimates are labelled.

Full measured record, including where evidence contradicted the original design:
[docs/day0-findings.md](docs/day0-findings.md).

## Layout

```
programs/closing-bell-guard/   Anchor program: config, market, clock, record/verify
app/                           Next.js true-cost frontend
scripts/deploy-devnet.ts       Devnet setup + the blocked-fill transaction
tests/guarded-fill.ts          Six enforcement cases
replay/pool-vs-equity.ts       The basis measurement above
replay/depth-at-size.ts        Depth across notional tiers and thin names
keeper/sample-feed-freshness.ts  Is the Pyth push path needed at all?
```

Built with Anchor 1.2.0, solana-cli 4.1.2, pyth-solana-receiver-sdk 2.0.0, under WSL2.
Anchor 0.31.1 cannot build this — see the toolchain notes in the findings doc.
