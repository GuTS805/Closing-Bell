import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real derivation. This is the code that decides what a user's money buys,
// so it is tested against the compiled source rather than a copy of the arithmetic.
function load() {
  const exports = {};
  const source = fs.readFileSync(new URL('../app/lib/guardedSwap.ts', import.meta.url), 'utf8');
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: () => ({
        Connection: class {},
        PublicKey: class { static findProgramAddressSync() { return ['account']; } },
        MARKETS: {},
      }),
      Buffer, process: { env: {} }, AbortSignal, fetch: async () => { throw new Error('no network'); },
    },
  );
  return exports;
}

const SPY_ORACLE = 773.56;
const SPY_DECIMALS = 8;
const SCALE = 10 ** SPY_DECIMALS;
/** The measured mainnet fill: 777.86, a ~54 bp premium over the oracle. */
const quotedAt = (price) => Math.floor((10_000 / price) * SCALE);

test('refuses when the pool sits outside the band, and says how far', () => {
  const { deriveBand } = load();
  const d = deriveBand({
    oraclePriceUsd: SPY_ORACLE, notionalUsd: 10_000,
    quotedOutRaw: quotedAt(777.86), decimals: SPY_DECIMALS, bandBps: 50,
  });

  assert.equal(d.buildable, false);
  assert.equal(d.slippageBps, null);
  assert.ok(d.minOutRaw > d.quotedOutRaw, 'band must demand more than the pool offers');
  assert.ok(Math.abs(d.quotedDeviationBps - 55.6) < 0.5, `got ${d.quotedDeviationBps}`);
  assert.match(d.refusal, /outside the 50 bp band/);
});

test('builds when the band is wide enough to contain the quoted fill', () => {
  const { deriveBand } = load();
  const d = deriveBand({
    oraclePriceUsd: SPY_ORACLE, notionalUsd: 10_000,
    quotedOutRaw: quotedAt(777.86), decimals: SPY_DECIMALS, bandBps: 60,
  });

  assert.equal(d.buildable, true);
  assert.equal(d.refusal, null);
  assert.ok(d.slippageBps >= 0 && d.slippageBps <= 10_000);
  // A wide oracle band becomes a very tight slippage tolerance, because the quote is
  // already most of the way to the band's edge.
  assert.ok(d.slippageBps < 20, `expected a tight tolerance, got ${d.slippageBps}`);
});

test('the enforced threshold never falls below the band minimum', () => {
  const { deriveBand } = load();
  // Sweep prices and bands; the rounding must never round against the user.
  for (const fillPrice of [773.56, 774.1, 775.0, 776.4, 777.86, 779.2]) {
    for (const bandBps of [0, 1, 25, 60, 90, 250]) {
      const quotedOutRaw = quotedAt(fillPrice);
      const d = deriveBand({
        oraclePriceUsd: SPY_ORACLE, notionalUsd: 10_000,
        quotedOutRaw, decimals: SPY_DECIMALS, bandBps,
      });
      if (!d.buildable) continue;

      // Reproduce what Jupiter enforces on-chain from the slippage we hand it.
      const enforced = Math.floor(quotedOutRaw * (1 - d.slippageBps / 10_000));
      assert.ok(
        enforced >= d.minOutRaw,
        `band ${bandBps} at ${fillPrice}: enforced ${enforced} < required ${d.minOutRaw}`,
      );

      // And the worst permitted fill must still respect the band.
      const worstPrice = 10_000 / (enforced / SCALE);
      assert.ok(
        worstPrice <= d.maxPriceUsd + 1e-6,
        `band ${bandBps} at ${fillPrice}: worst fill ${worstPrice} > max ${d.maxPriceUsd}`,
      );
    }
  }
});

test('a zero band admits only a fill strictly better than the oracle', () => {
  const { deriveBand } = load();
  const zeroBand = (quotedOutRaw) => deriveBand({
    oraclePriceUsd: SPY_ORACLE, notionalUsd: 10_000,
    quotedOutRaw, decimals: SPY_DECIMALS, bandBps: 0,
  });

  assert.equal(zeroBand(quotedAt(SPY_ORACLE * 0.9999)).buildable, true);
  assert.equal(zeroBand(quotedAt(SPY_ORACLE)).maxPriceUsd, SPY_ORACLE);
  assert.equal(zeroBand(quotedAt(SPY_ORACLE * 1.0001)).buildable, false);

  // A fill one raw unit short of the oracle is refused, not waved through. Rounding always
  // resolves against the trade and never against the user, so a zero band is a real zero.
  const exact = Math.ceil((10_000 / SPY_ORACLE) * SCALE);
  assert.equal(zeroBand(exact).buildable, true);
  assert.equal(zeroBand(exact - 1).buildable, false);
});

test('a fill better than the oracle is allowed and leaves room to spare', () => {
  const { deriveBand } = load();
  const d = deriveBand({
    oraclePriceUsd: SPY_ORACLE, notionalUsd: 10_000,
    quotedOutRaw: quotedAt(770.0), decimals: SPY_DECIMALS, bandBps: 50,
  });
  assert.equal(d.buildable, true);
  assert.ok(d.quotedDeviationBps < 0, 'a cheap fill should read as negative deviation');
  assert.ok(d.slippageBps > 0, 'room below the band should become usable tolerance');
});

test('rejects inputs that would silently produce a meaningless threshold', () => {
  const { deriveBand, MAX_BAND_BPS } = load();
  const base = {
    oraclePriceUsd: SPY_ORACLE, notionalUsd: 10_000,
    quotedOutRaw: quotedAt(775), decimals: SPY_DECIMALS, bandBps: 50,
  };
  assert.throws(() => deriveBand({ ...base, oraclePriceUsd: 0 }), /oracle price/);
  assert.throws(() => deriveBand({ ...base, notionalUsd: 0 }), /notional/);
  assert.throws(() => deriveBand({ ...base, quotedOutRaw: 0 }), /quoted output/);
  assert.throws(() => deriveBand({ ...base, bandBps: -1 }), /band must be/);
  assert.throws(() => deriveBand({ ...base, bandBps: MAX_BAND_BPS + 1 }), /band must be/);
});
