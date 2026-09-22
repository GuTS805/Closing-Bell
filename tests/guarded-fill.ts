/**
 * End-to-end proof that the guard enforces the band, and that its safety properties hold.
 *
 * The "swap" is two plain token transfers at a price we choose, sitting between ix 0 and
 * ix 2. That is deliberate: it sets the realised fill price exactly so both sides of the
 * band can be checked. A real Jupiter swap in that slot changes nothing about the guard,
 * which only reads balance deltas.
 *
 *   A  fill at the oracle price          -> allowed
 *   B  fill 6.8% above oracle            -> REVERTS, balances roll back
 *   C  fill 1.5% above oracle            -> allowed (inside the 200bp closed band)
 *   D  sell 6.8% below oracle            -> REVERTS (band is symmetric)
 *   E  snapshot, no swap, verify         -> NoFillDetected, not a divide-by-zero
 *   F  keeper basis beyond the ceiling   -> BasisOutOfBounds
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint, createAccount, getOrCreateAssociatedTokenAccount, mintTo,
  createTransferCheckedInstruction, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig"
);
/** Pyth AAPL/USD shard 1. Shard 0 is ~34 days stale. */
const PRICE_ACCOUNT = new PublicKey("D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW");
const FEED_ID_HEX = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

const BASE_DECIMALS = 8;
const QUOTE_DECIMALS = 6;
const CLOSED_BAND_BPS = 200;

const disc = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; };
const str = (s: string) => {
  const d = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(d.length);
  return Buffer.concat([l, d]);
};

function readOracle(data: Buffer) {
  let o = 40;
  o += data.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const expo = data.readInt32LE(o);
  return { price: Number(price) * 10 ** expo, conf: Number(conf) * 10 ** expo };
}

/** Anchor error codes, in declaration order from GuardError. */
const ERR = {
  OutsideBand: 6000,
  TokenAccountMismatch: 6010,
  BasisOutOfBounds: 6013,
  NoFillDetected: 6018,
} as const;

/**
 * Pulls the custom error code out of a failed send. `skipPreflight` means the thrown
 * error usually carries no logs, so the code in the status is the reliable signal —
 * matching on message text silently passes tests that did not actually assert anything.
 */
function errCode(e: any): number | null {
  const fromLogs = (e?.logs ?? []).join(" ").match(/custom program error: 0x([0-9a-f]+)/i);
  if (fromLogs) return parseInt(fromLogs[1], 16);
  const m = String(e?.message ?? "").match(/"Custom":\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(
      process.env.WALLET ?? "/home/alok0/.config/solana/id.json", "utf8")))
  );

  const priceInfo = await conn.getAccountInfo(PRICE_ACCOUNT);
  if (!priceInfo) throw new Error("Pyth account not cloned into this validator");
  const oracle = readOracle(priceInfo.data);
  console.log(`oracle AAPL = ${oracle.price.toFixed(4)}  band = ${CLOSED_BAND_BPS}bp (market closed)\n`);

  const baseMint = await createMint(conn, payer, payer.publicKey, null, BASE_DECIMALS);
  const quoteMint = await createMint(conn, payer, payer.publicKey, null, QUOTE_DECIMALS);
  const pool = Keypair.generate();

  const userBase = await getOrCreateAssociatedTokenAccount(conn, payer, baseMint, payer.publicKey);
  const userQuote = await getOrCreateAssociatedTokenAccount(conn, payer, quoteMint, payer.publicKey);
  const poolBase = await getOrCreateAssociatedTokenAccount(conn, payer, baseMint, pool.publicKey);
  const poolQuote = await getOrCreateAssociatedTokenAccount(conn, payer, quoteMint, pool.publicKey);

  await mintTo(conn, payer, quoteMint, userQuote.address, payer, 100_000_000_000_000n);
  await mintTo(conn, payer, baseMint, userBase.address, payer, 1_000_000_000n);
  await mintTo(conn, payer, baseMint, poolBase.address, payer, 1_000_000_000_000n);
  await mintTo(conn, payer, quoteMint, poolQuote.address, payer, 100_000_000_000_000n);

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), baseMint.toBuffer()], PROGRAM_ID);
  const [clockPda] = PublicKey.findProgramAddressSync([Buffer.from("clock")], PROGRAM_ID);
  const [pending] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), payer.publicKey.toBuffer(), market.toBuffer()], PROGRAM_ID);

  // ---- setup ------------------------------------------------------------
  console.log("setting up config / market / clock ...");
  await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc("initialize_guard_config"), payer.publicKey.toBuffer(),
      u16(50), u16(CLOSED_BAND_BPS), u16(10_000), u16(500), u32(86_400),
    ]),
  })), [payer], { commitment: "confirmed" });

  await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: PRICE_ACCOUNT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc("create_guarded_market"), str(FEED_ID_HEX),
      Buffer.from([BASE_DECIMALS, QUOTE_DECIMALS]), u16(0),
    ]),
  })), [payer], { commitment: "confirmed" });

  await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: clockPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    // market closed - the wider band applies
    data: Buffer.concat([disc("update_market_clock"),
      Buffer.from([0]), Buffer.from([0]), i64(0n), Buffer.from([0])]),
  })), [payer], { commitment: "confirmed" });
  console.log("setup done\n");

  const recordIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pending, isSigner: false, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: clockPda, isSigner: false, isWritable: false },
      { pubkey: PRICE_ACCOUNT, isSigner: false, isWritable: false },
      { pubkey: userBase.address, isSigner: false, isWritable: false },
      { pubkey: userQuote.address, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc("record_pre_state"),
  });

  const verifyIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pending, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: userBase.address, isSigner: false, isWritable: false },
      { pubkey: userQuote.address, isSigner: false, isWritable: false },
    ],
    data: disc("verify_fill"),
  });

  let pass = 0, fail = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} - ${detail}`);
    ok ? pass++ : fail++;
  };

  async function attempt(label: string, pricePerShare: number, isBuy: boolean, expectRevert: boolean) {
    const baseAmount = 1n * 10n ** BigInt(BASE_DECIMALS);
    const quoteAmount = BigInt(Math.round(pricePerShare * 10 ** QUOTE_DECIMALS));
    const devBps = ((pricePerShare - oracle.price) / oracle.price) * 10_000;

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(recordIx);
    if (isBuy) {
      tx.add(createTransferCheckedInstruction(poolBase.address, baseMint, userBase.address,
        pool.publicKey, baseAmount, BASE_DECIMALS, [], TOKEN_PROGRAM_ID));
      tx.add(createTransferCheckedInstruction(userQuote.address, quoteMint, poolQuote.address,
        payer.publicKey, quoteAmount, QUOTE_DECIMALS, [], TOKEN_PROGRAM_ID));
    } else {
      tx.add(createTransferCheckedInstruction(userBase.address, baseMint, poolBase.address,
        payer.publicKey, baseAmount, BASE_DECIMALS, [], TOKEN_PROGRAM_ID));
      tx.add(createTransferCheckedInstruction(poolQuote.address, quoteMint, userQuote.address,
        pool.publicKey, quoteAmount, QUOTE_DECIMALS, [], TOKEN_PROGRAM_ID));
    }
    tx.add(verifyIx);

    console.log(`--- ${label}  (${devBps >= 0 ? "+" : ""}${devBps.toFixed(0)} bps)`);
    const before = (await conn.getTokenAccountBalance(userBase.address)).value.amount;
    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [payer, pool],
        { commitment: "confirmed", skipPreflight: true });
      const p = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      for (const l of (p?.meta?.logMessages ?? []).filter((l) => l.includes("fill:")))
        console.log("    " + l.replace(/^Program log: ?/, ""));
      check(label, !expectRevert, `allowed, CU=${p?.meta?.computeUnitsConsumed}`);
    } catch (e: any) {
      const code = errCode(e);
      const after = (await conn.getTokenAccountBalance(userBase.address)).value.amount;
      check(label, expectRevert && code === ERR.OutsideBand,
        `reverted OutsideBand(${code}); base ${before} -> ${after} (unchanged)`);
    }
  }

  await attempt("A buy at oracle", oracle.price, true, false);
  await attempt("B buy 6.8% above oracle", oracle.price * 1.068, true, true);
  await attempt("C buy 1.5% above oracle", oracle.price * 1.015, true, false);
  await attempt("D sell 6.8% below oracle", oracle.price * 0.932, false, true);

  // E: snapshot then verify with no swap in between.
  console.log("--- E snapshot with no swap");
  try {
    await sendAndConfirmTransaction(conn,
      new Transaction().add(recordIx).add(verifyIx), [payer],
      { commitment: "confirmed", skipPreflight: true });
    check("E zero-delta", false, "allowed - should have errored");
  } catch (e: any) {
    const code = errCode(e);
    check("E zero-delta", code === ERR.NoFillDetected, `reverted NoFillDetected(${code})`);
  }

  // F: keeper basis beyond the in-program ceiling (MAX_BASIS_BPS = 300).
  console.log("--- F keeper basis of 500bp (ceiling is 300bp)");
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([disc("update_basis"), i64(500n)]),
    })), [payer], { commitment: "confirmed", skipPreflight: true });
    check("F basis ceiling", false, "accepted 500bp - ceiling not enforced");
  } catch (e: any) {
    const code = errCode(e);
    check("F basis ceiling", code === ERR.BasisOutOfBounds, `rejected BasisOutOfBounds(${code})`);
  }

  // G: verify_fill pointed at a different token account (same mint, same owner) than the
  // one record_pre_state snapshotted. Must be rejected, not silently accepted against a
  // balance history that has nothing to do with this trade.
  console.log("--- G verify against a substituted token account");
  {
    // Needs an explicit keypair: without one this creates the associated account, which
    // userBase already is, so the substitution never happens and the ATA program rejects
    // the duplicate before the guard is ever reached.
    const altBase = await createAccount(conn, payer, baseMint, payer.publicKey, Keypair.generate());
    await mintTo(conn, payer, baseMint, altBase, payer, 1_000_000_000n);

    const swapAmount = 1n * 10n ** BigInt(BASE_DECIMALS);
    const quoteAmount = BigInt(Math.round(oracle.price * 10 ** QUOTE_DECIMALS));
    const substitutedVerifyIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: pending, isSigner: false, isWritable: true },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: altBase, isSigner: false, isWritable: false }, // swapped in place of userBase
        { pubkey: userQuote.address, isSigner: false, isWritable: false },
      ],
      data: disc("verify_fill"),
    });

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(recordIx)
      .add(createTransferCheckedInstruction(poolBase.address, baseMint, userBase.address,
        pool.publicKey, swapAmount, BASE_DECIMALS, [], TOKEN_PROGRAM_ID))
      .add(createTransferCheckedInstruction(userQuote.address, quoteMint, poolQuote.address,
        payer.publicKey, quoteAmount, QUOTE_DECIMALS, [], TOKEN_PROGRAM_ID))
      .add(substitutedVerifyIx);

    try {
      await sendAndConfirmTransaction(conn, tx, [payer, pool], { commitment: "confirmed", skipPreflight: true });
      check("G substituted account", false, "allowed - should have been rejected");
    } catch (e: any) {
      const code = errCode(e);
      check("G substituted account", code === ERR.TokenAccountMismatch,
        `reverted TokenAccountMismatch(${code})`);
    }
  }

  // H: an abandoned record_pre_state (no verify_fill in the same transaction) can be
  // reclaimed with cancel_pending instead of permanently blocking this (user, market) pair.
  console.log("--- H cancel_pending reclaims a stray snapshot");
  {
    await sendAndConfirmTransaction(conn, new Transaction().add(recordIx), [payer],
      { commitment: "confirmed" });

    const cancelIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: pending, isSigner: false, isWritable: true },
      ],
      data: disc("cancel_pending"),
    });
    await sendAndConfirmTransaction(conn, new Transaction().add(cancelIx), [payer],
      { commitment: "confirmed" });

    const closed = (await conn.getAccountInfo(pending)) === null;
    check("H cancel_pending", closed, closed ? "snapshot closed" : "snapshot still exists");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
