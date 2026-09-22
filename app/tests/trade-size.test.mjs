import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real quote/decomposition code with deterministic upstream responses.
function fixture(failAmount) {
  let oracleReads = 0;
  const requests = [];
  const account = Buffer.alloc(128);
  account[40] = 1;
  account.writeBigInt64LE(10000n, 73);
  account.writeBigInt64LE(1n, 81);
  account.writeInt32LE(-2, 89);
  account.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 93);
  class PublicKey { static findProgramAddressSync() { return ['account']; } }
  class Connection { async getAccountInfo() { oracleReads++; return { data: account }; } }
  const exports = {};
  const source = fs.readFileSync(new URL('../app/lib/truecost.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: () => ({ Connection, PublicKey }), Buffer, process: { env: {} }, AbortSignal,
    fetch: async (url) => {
      const params = new URL(url).searchParams;
      const amount = Number(params.get('amount'));
      requests.push(amount);
      if (amount === failAmount) return { ok: false, status: 429 };
      const buy = params.get('inputMint') === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      // Probe buy at 102, sell at 100 => common mid 101; oracle 100 => premium 100 bp.
      const price = amount === 2000e6 ? 102 : 101 + amount / 1e6 / 100000;
      return { ok: true, json: async () => ({ inAmount: amount, outAmount: buy ? amount / 1e6 / price * 1e8 : amount / 1e8 * 100 * 1e6, priceImpactPct: 0, routePlan: [] }) };
    },
  });
  return { run: exports.getTradeSizeCurve, requests, oracleReads: () => oracleReads };
}

test('all sizes use one measured mid/oracle, including the approximate one-token budget', async () => {
  const f = fixture();
  const result = await f.run('SPYx');
  assert.equal(f.oracleReads(), 1);
  assert.equal(f.requests.length, 7);
  assert.equal(result.points.length, 5);
  assert.ok(Math.abs(result.premiumBps - 100) < 1e-8);
  assert.equal(result.points[0].label, '~1 token');
  assert.ok(Math.abs(result.points[0].notional - 101) < 1e-8);
  assert.ok(Math.abs(result.points[4].impactBps - (2.5 / 101 * 10000)) < 1e-8);
});

test('failed size is explicit, not fabricated or silently dropped', async () => {
  const result = await fixture(50000e6).run('SPYx');
  const missing = result.points.find(p => p.notional === 50000);
  assert.equal(missing.impactBps, null);
  assert.equal(missing.error, 'Jupiter 429');
  assert.equal(result.points.filter(p => p.impactBps !== null).length, 4);
});

test('failed reference rejects the sweep', async () => {
  await assert.rejects(fixture(2000e6).run('SPYx'), /Jupiter 429/);
});
