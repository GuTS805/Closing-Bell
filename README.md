# Closing Bell

On-chain oracle-banded execution guard for tokenized equities on Solana.

Every fill is checked on-chain against the live Pyth price before it is allowed to
execute, with a wider band and a higher fee while the reference market is shut.

**Status: day 0 complete.** Band enforcement works end to end on a local validator with
mainnet oracle data. See [docs/day0-findings.md](docs/day0-findings.md) for every measured
result, including the several places where day-0 evidence contradicts the original
architecture document.

## How it works

The guard does not route your swap. It brackets it inside one transaction:

```
ix 0   record_pre_state    snapshot balances + oracle price + band
ix 1   any swap            Jupiter, unmodified, real routing, any venue
ix 2   verify_fill         balance deltas -> realised price -> band check -> revert
```

Solana's atomicity does the enforcement. The guard never moves a token, so Token-2022
extensions cannot affect it, and it inherits real aggregated liquidity rather than
requiring a pool of its own.

## Day-0 results

| | |
|---|---|
| Pyth read + band derivation | 3,369 CU |
| Full guarded fill (both guard ix + 2 transfers) | 24,767 CU |
| Fill at oracle price | allowed |
| Fill 6.8% above oracle | **reverted**, balances rolled back |
| Fill 1.5% above oracle (inside a 200bp closed band) | allowed |

## Layout

```
programs/closing-bell-guard/   Anchor program: probe_oracle, record_pre_state, verify_fill
scripts/probe-pyth-accounts.ts Pyth on-chain account + staleness probe
scripts/day0-feasibility.ts    Section 12 CU measurement
tests/guarded-fill.ts          Band enforcement: allowed / reverted / inside-band
replay/depth-at-size.ts        Off-hours depth across notional tiers and thin names
replay/basis.ts                Equity vs xStock vs RR feed comparison
replay/feed-staleness.ts       Which feeds have a usable on-chain account
keeper/  app/                  Not started
```

## Prerequisites

Built and run from WSL2 (Ubuntu 24.04). Anchor 0.31.1 does not build this project - see
the toolchain notes in the findings doc.

```
anchor-cli 1.2.0   solana-cli 4.1.2   node 20
```

## Running

```bash
npm install

# Which on-chain Pyth accounts exist, and how stale is each?
npm run probe:pyth

# Section 12: build, start a validator with the mainnet Pyth account cloned in,
# deploy, invoke, and report compute units.
anchor build
npm run day0
```

`npm run day0` expects a local validator started with the Pyth account cloned:

```bash
solana-test-validator \
  --url https://api.mainnet-beta.solana.com \
  --clone D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW \
  --bpf-program <PROGRAM_ID> target/deploy/closing_bell_guard.so \
  --reset
```

## Known blockers

- No mainnet SOL, so the mainnet leg of the feasibility test has not run.
- Pyth Hermes now returns 401 without a key; the keeper needs Pyth Pro access.
- Public RPC rate-limits; a Helius or Triton endpoint is needed before the keeper runs.
