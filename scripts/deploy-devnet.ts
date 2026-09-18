/**
 * Devnet: create Token-2022 mints, register a market, and produce the clickable
 * blocked-fill transaction.
 *
 * Run AFTER `solana program deploy` has put the program on devnet:
 *
 *   PROGRAM_ID=<deployed id> npx tsx scripts/deploy-devnet.ts
 *
 * Two deliberate substitutions, both stated in the README rather than hidden:
 *
 *  1. ORACLE. Devnet has no live equity feed — `Equity.US.AAPL/USD` exists there but was
 *     78 days stale. The fresh devnet feeds are crypto, so the market is registered
 *     against `Crypto.SOL/USD`. The enforcement mechanism is byte-for-byte what mainnet
 *     would run; only the reference asset differs.
 *     Note also that devnet's fresh shard is 0, the inverse of mainnet, where shard 0 was
 *     34.5 days stale and shard 1 fresh. Shard choice has to be verified per cluster.
 *
 *  2. MINTS. Test Token-2022 mints reproduce the xStock extension set that matters here —
 *     permanent delegate and freeze authority. The transfer hook is left off because on
 *     mainnet every xStock carries it DISABLED, so this is functionally identical.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  createTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID,
  ExtensionType, getMintLen, createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig"
);
/** Crypto.SOL/USD, devnet shard 0 — the fresh one on this cluster. */
const PRICE_ACCOUNT = new PublicKey(
  process.env.PRICE_ACCOUNT ?? "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);
const FEED_ID_HEX =
  process.env.FEED_ID ?? "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

const BASE_DECIMALS = 8;   // xStocks are 8
const QUOTE_DECIMALS = 6;  // USDC is 6
const CLOSED_BAND_BPS = 200;

const disc = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; };
const str = (s: string) => {
  const d = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(d.length);
  return Buffer.concat([l, d]);
};
const link = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

function readOracle(data: Buffer) {
  let o = 40;
  o += data.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const expo = data.readInt32LE(o); o += 4;
  const t = data.readBigInt64LE(o);
  return { price: Number(price) * 10 ** expo, conf: Number(conf) * 10 ** expo, publishTime: Number(t) };
}

/** Token-2022 mint carrying permanent delegate + freeze authority, like an xStock. */
async function createXStockLikeMint(
  conn: Connection, payer: Keypair, decimals: number
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const len = getMintLen([ExtensionType.PermanentDelegate]);
  const lamports = await conn.getMinimumBalanceForRentExemption(len);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: len,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializePermanentDelegateInstruction(
      mint.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mint.publicKey, decimals, payer.publicKey,
      payer.publicKey, // freeze authority, as xStocks have
      TOKEN_2022_PROGRAM_ID
    )
  );
  await sendAndConfirmTransaction(conn, tx, [payer, mint], { commitment: "confirmed" });
  return mint.publicKey;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(
      process.env.WALLET ?? "/home/alok0/.config/solana/id.json", "utf8")))
  );

  const bal = await conn.getBalance(payer.publicKey);
  console.log(`wallet  ${payer.publicKey.toBase58()}`);
  console.log(`balance ${(bal / 1e9).toFixed(3)} SOL`);
  if (bal < 0.5e9) throw new Error("need at least ~0.5 SOL for setup; fund at https://faucet.solana.com");

  const priceInfo = await conn.getAccountInfo(PRICE_ACCOUNT);
  if (!priceInfo) throw new Error(`price account ${PRICE_ACCOUNT.toBase58()} not found on devnet`);
  const oracle = readOracle(priceInfo.data);
  const age = Math.floor(Date.now() / 1000) - oracle.publishTime;
  console.log(`oracle  ${oracle.price.toFixed(4)}  age=${age}s  ${PRICE_ACCOUNT.toBase58()}`);
  if (age > 300) console.log(`WARNING: oracle is ${age}s old; the guard may reject on staleness`);

  console.log("\ncreating Token-2022 mints (permanent delegate + freeze) ...");
  const baseMint = await createXStockLikeMint(conn, payer, BASE_DECIMALS);
  const quoteMint = await createXStockLikeMint(conn, payer, QUOTE_DECIMALS);
  console.log(`  base  ${baseMint.toBase58()}`);
  console.log(`  quote ${quoteMint.toBase58()}`);

  const pool = Keypair.generate();
  const mk = (m: PublicKey, o: PublicKey) =>
    getOrCreateAssociatedTokenAccount(conn, payer, m, o, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  const userBase = await mk(baseMint, payer.publicKey);
  const userQuote = await mk(quoteMint, payer.publicKey);
  const poolBase = await mk(baseMint, pool.publicKey);
  const poolQuote = await mk(quoteMint, pool.publicKey);

  const mt = (m: PublicKey, a: any, amt: bigint) =>
    mintTo(conn, payer, m, a, payer, amt, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  await mt(quoteMint, userQuote.address, 100_000_000_000_000n);
  await mt(baseMint, userBase.address, 1_000_000_000n);
  await mt(baseMint, poolBase.address, 1_000_000_000_000n);
  await mt(quoteMint, poolQuote.address, 100_000_000_000_000n);

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), baseMint.toBuffer()], PROGRAM_ID);
  const [clockPda] = PublicKey.findProgramAddressSync([Buffer.from("clock")], PROGRAM_ID);
  const [pending] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), payer.publicKey.toBuffer(), market.toBuffer()], PROGRAM_ID);

  const send = async (ix: TransactionInstruction, label: string) => {
    try {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer],
        { commitment: "confirmed" });
      console.log(`  ${label}: ${sig}`);
      return sig;
    } catch (e: any) {
      if (String(e.message).includes("already in use")) { console.log(`  ${label}: already exists`); return null; }
      throw e;
    }
  };

  console.log("\ninitializing config / market / clock ...");
  await send(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("initialize_guard_config"), payer.publicKey.toBuffer(),
      u16(50), u16(CLOSED_BAND_BPS), u16(10_000), u16(500), u32(86_400)]),
  }), "config");

  await send(new TransactionInstruction({
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
    data: Buffer.concat([disc("create_guarded_market"), str(FEED_ID_HEX),
      Buffer.from([BASE_DECIMALS, QUOTE_DECIMALS]), u16(0)]),
  }), "market");

  await send(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: clockPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("update_market_clock"),
      Buffer.from([0]), Buffer.from([0]), i64(0n), Buffer.from([0])]),
  }), "clock");

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

  async function attempt(label: string, pricePerUnit: number) {
    const baseAmount = 1n * 10n ** BigInt(BASE_DECIMALS);
    const quoteAmount = BigInt(Math.round(pricePerUnit * 10 ** QUOTE_DECIMALS));
    const dev = ((pricePerUnit - oracle.price) / oracle.price) * 10_000;
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(recordIx)
      .add(createTransferCheckedInstruction(poolBase.address, baseMint, userBase.address,
        pool.publicKey, baseAmount, BASE_DECIMALS, [], TOKEN_2022_PROGRAM_ID))
      .add(createTransferCheckedInstruction(userQuote.address, quoteMint, poolQuote.address,
        payer.publicKey, quoteAmount, QUOTE_DECIMALS, [], TOKEN_2022_PROGRAM_ID))
      .add(verifyIx);

    const before = (await conn.getTokenAccountBalance(userBase.address)).value.amount;
    console.log(`
--- ${label}  (${dev >= 0 ? "+" : ""}${dev.toFixed(0)} bps vs oracle)`);

    // sendRawTransaction rather than sendAndConfirmTransaction: a rejected fill still
    // lands on chain with skipPreflight, and the signature has to be in hand BEFORE
    // confirmation reports the failure. That signature is the artifact - it makes the
    // guard's rejection publicly verifiable instead of a local log line.
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(payer, pool);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    try {
      await conn.confirmTransaction(sig, "confirmed");
    } catch {
      /* a rejected fill is the expected outcome for the out-of-band case */
    }

    const parsed = await conn.getTransaction(sig, {
      commitment: "confirmed", maxSupportedTransactionVersion: 0,
    });
    const errored = Boolean(parsed?.meta?.err);
    const after = (await conn.getTokenAccountBalance(userBase.address)).value.amount;
    const guardLog = (parsed?.meta?.logMessages ?? [])
      .find((l) => l.includes("fill:"))?.replace(/^Program log: ?/, "");

    console.log(`    ${errored ? "BLOCKED" : "ALLOWED"}   base ${before} -> ${after}` +
      `${before === after ? "  (unchanged)" : ""}`);
    if (guardLog) console.log(`    ${guardLog}`);
    console.log(`    CU ${parsed?.meta?.computeUnitsConsumed ?? "?"}`);
    console.log(`    ${link(sig)}`);

    return {
      outcome: errored ? "blocked" : "allowed",
      sig, before, after,
      err: parsed?.meta?.err ?? null,
      computeUnits: parsed?.meta?.computeUnitsConsumed ?? null,
      explorer: link(sig),
    };
  }

  const caseA = await attempt("CASE A: fill at the oracle price", oracle.price);
  const caseB = await attempt("CASE B: fill 6.8% above oracle", oracle.price * 1.068);

  const out = {
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    priceAccount: PRICE_ACCOUNT.toBase58(),
    feed: "Crypto.SOL/USD (devnet shard 0)",
    baseMint: baseMint.toBase58(),
    quoteMint: quoteMint.toBase58(),
    config: config.toBase58(),
    market: market.toBase58(),
    oracle: oracle.price,
    caseA, caseB,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync("docs/devnet-deployment.json", JSON.stringify(out, null, 2));
  console.log(`\nwrote docs/devnet-deployment.json`);
  if (caseB.sig) console.log(`\nPUT THIS IN THE README:\n  ${link(caseB.sig)}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
