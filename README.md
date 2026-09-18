# Closing Bell

On-chain oracle-banded execution guard for tokenized equities on Solana.

Every fill is checked on-chain against the live Pyth price before it is allowed to
execute, with a wider band and a higher fee while the reference market is shut.

**Status: day 0.** The oracle half of the feasibility test passes; the swap-CPI half is
not yet run. See [docs/day0-findings.md](docs/day0-findings.md) for measured results and
for the several places where day-0 evidence contradicts the original architecture
document.

## Day-0 result in one line

The Pyth read plus band derivation costs **3,369 CU** (2,970 + 399), about 1.4% of the
250k budget, leaving ~242k CU for the swap CPI.

## Layout

```
programs/closing-bell-guard/   Anchor program (currently the feasibility probe)
scripts/probe-pyth-accounts.ts Pyth on-chain account + staleness probe
scripts/day0-feasibility.ts    The section 12 test
docs/day0-findings.md          Measured day-0 results
keeper/  app/  replay/         Not started
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
