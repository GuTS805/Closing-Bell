#!/usr/bin/env bash
# Boots a local validator forked from mainnet, carrying the real Raydium CLMM pool that
# SPYx actually trades in and the real Pyth price account the guard reads.
#
# The account list is not guesswork: it is every account a real Jupiter swap transaction
# references, read back off the transaction Jupiter itself builds. That is why no tick
# arrays are listed by hand — the route already names the ones it crosses.
#
# Usage:  scripts/fork-mainnet.sh [ledger-dir]
set -euo pipefail

LEDGER="${1:-/tmp/cb-fork}"
URL="${MAINNET_RPC:-https://api.mainnet-beta.solana.com}"

# The token programs, the ATA program and the memo program ship with the test validator,
# so only the two that do not are cloned.
PROGRAMS=(
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK
)

# Pool state, vaults, tick arrays, observation state, mints, Jupiter's event authority,
# and the Pyth feed the guard bands against.
ACCOUNTS=(
  4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw
  XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  CRDaGwcVnKdRNRtx6fjHtvrBgKM5U55AhbqBWhtPMDA
  585WvHT4x1pS8hLQXwWLe8Hy2UXpWcvGFazeVhbG8WjC
  9C2M6X2MzqXy8woBRwmET71FDCKmW2TPLD9YKLY95LQ1
  9hGdsny7q6d3wYWe9M8qAuEnZaBjA5K43ZmNygkKPxPF
  FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B
  D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf
  92aTAYGnUCH28J96EFzD8ELa6ZpdzXw4zqEuX1nD6oD7
  9EF8Jq2brNcdm9nfJz7PnrAELxVGyctjDiinYwEsmY3C
  AUhtN1KPdVEQ1mh7gy3oHzjWyqHo5RQx1KEiFJdyqAeN
  F8DJtK4wZAu8qEqbz5cpFCpz8z6gcNSk4AmK9GX87GBQ
  9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x
)

args=(--reset --ledger "$LEDGER" --url "$URL" --quiet)
for p in "${PROGRAMS[@]}"; do args+=(--clone-upgradeable-program "$p"); done
for a in "${ACCOUNTS[@]}"; do args+=(--clone "$a"); done

echo "forking mainnet -> $LEDGER"
exec solana-test-validator "${args[@]}"
