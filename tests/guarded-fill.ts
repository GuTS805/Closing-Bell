/**
 * Proves the record/verify sandwich enforces the band.
 *
 * The "swap" here is two plain token transfers at a price we choose, sitting between
 * ix 0 and ix 2. That is deliberate: it lets us set the realised fill price exactly and
 * check both sides of the band. A real Jupiter swap in that slot changes nothing about
 * the guard, which only ever reads balance deltas.
 *
 *   case A  fill at the oracle price      -> transaction succeeds
 *   case B  fill 6.8% above oracle        -> verify_fill reverts the WHOLE transaction,
 *                                            including the transfers that already ran
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig"
);
const PRICE_ACCOUNT = new PublicKey("D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW");
const FEED_ID_HEX =
  "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

const BASE_DECIMALS = 8; // xStocks
const QUOTE_DECIMALS = 6; // USDC

const disc = (n: string) =>
  createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);

function encodeRecordArgs(
  feedIdHex: string,
  maxStaleness: bigint,
  marketOpen: boolean,
  basisBps: bigint
) {
  const s = Buffer.from(feedIdHex, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(s.length, 0);
  const st = Buffer.alloc(8);
  st.writeBigUInt64LE(maxStaleness, 0);
  const basis = Buffer.alloc(8);
  basis.writeBigInt64LE(basisBps, 0);
  return Buffer.concat([
    len,
    s,
    st,
    Buffer.from([marketOpen ? 1 : 0]),
    basis,
    Buffer.from([BASE_DECIMALS, QUOTE_DECIMALS]),
  ]);
}

/** Reads the live oracle price out of the cloned account so the test tracks reality. */
function readOracle(data: Buffer) {
  let o = 8 + 32;
  o += data.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const expo = data.readInt32LE(o);
  return { price: Number(price) * 10 ** expo, conf: Number(conf) * 10 ** expo };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(process.env.WALLET ?? "/home/alok0/.config/solana/id.json", "utf8")
      )
    )
  );

  const priceInfo = await conn.getAccountInfo(PRICE_ACCOUNT);
  if (!priceInfo) throw new Error("Pyth account not cloned into this validator");
  const oracle = readOracle(priceInfo.data);
  console.log(`oracle AAPL = ${oracle.price.toFixed(4)} (conf ${oracle.conf.toFixed(4)})\n`);

  // Two local mints standing in for AAPLx and USDC.
  const baseMint = await createMint(conn, payer, payer.publicKey, null, BASE_DECIMALS);
  const quoteMint = await createMint(conn, payer, payer.publicKey, null, QUOTE_DECIMALS);
  const pool = Keypair.generate();

  const userBase = await getOrCreateAssociatedTokenAccount(conn, payer, baseMint, payer.publicKey);
  const userQuote = await getOrCreateAssociatedTokenAccount(conn, payer, quoteMint, payer.publicKey);
  const poolBase = await getOrCreateAssociatedTokenAccount(conn, payer, baseMint, pool.publicKey);
  const poolQuote = await getOrCreateAssociatedTokenAccount(conn, payer, quoteMint, pool.publicKey);

  await mintTo(conn, payer, quoteMint, userQuote.address, payer, 10_000_000_000_000n); // 10M quote
  await mintTo(conn, payer, baseMint, poolBase.address, payer, 1_000_000_000_000n); // 10k base

  const [pending] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), payer.publicKey.toBuffer(), userBase.address.toBuffer()],
    PROGRAM_ID
  );

  const recordIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pending, isSigner: false, isWritable: true },
      { pubkey: PRICE_ACCOUNT, isSigner: false, isWritable: false },
      { pubkey: userBase.address, isSigner: false, isWritable: false },
      { pubkey: userQuote.address, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc("record_pre_state"),
      encodeRecordArgs(FEED_ID_HEX, 86_400n, false, 0n),
    ]),
  });

  const verifyIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pending, isSigner: false, isWritable: true },
      { pubkey: userBase.address, isSigner: false, isWritable: false },
      { pubkey: userQuote.address, isSigner: false, isWritable: false },
    ],
    data: disc("verify_fill"),
  });

  /** One whole base token bought for `pricePerShare` quote. */
  async function attemptFill(label: string, pricePerShare: number) {
    const baseAmount = 1n * 10n ** BigInt(BASE_DECIMALS);
    const quoteAmount = BigInt(Math.round(pricePerShare * 10 ** QUOTE_DECIMALS));

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(recordIx)
      // the "swap": base in, quote out, at a price we control
      .add(
        createTransferCheckedInstruction(
          poolBase.address, baseMint, userBase.address, pool.publicKey,
          baseAmount, BASE_DECIMALS, [], TOKEN_PROGRAM_ID
        )
      )
      .add(
        createTransferCheckedInstruction(
          userQuote.address, quoteMint, poolQuote.address, payer.publicKey,
          quoteAmount, QUOTE_DECIMALS, [], TOKEN_PROGRAM_ID
        )
      )
      .add(verifyIx);

    const devBps = ((pricePerShare - oracle.price) / oracle.price) * 10_000;
    console.log(`--- ${label}`);
    console.log(`    fill @ ${pricePerShare.toFixed(4)}  (${devBps >= 0 ? "+" : ""}${devBps.toFixed(0)} bps vs oracle)`);

    const baseBefore = (await conn.getTokenAccountBalance(userBase.address)).value.amount;
    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [payer, pool], {
        commitment: "confirmed",
        skipPreflight: true,
      });
      const parsed = await conn.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = parsed?.meta?.logMessages ?? [];
      for (const l of logs.filter((l) => l.includes("fill:") || l.includes("consumption"))) {
        console.log("    " + l.replace(/^Program (log|consumption): ?/, ""));
      }
      console.log(`    RESULT: allowed. CU=${parsed?.meta?.computeUnitsConsumed}`);
    } catch (e: any) {
      const logs: string[] = e?.logs ?? [];
      const hit = logs.find((l) => l.includes("OutsideBand") || l.includes("Error Message"));
      console.log(`    RESULT: REVERTED - ${hit?.replace(/^Program log: ?/, "") ?? e.message}`);
    }
    const baseAfter = (await conn.getTokenAccountBalance(userBase.address)).value.amount;
    console.log(`    user base balance ${baseBefore} -> ${baseAfter}\n`);
  }

  await attemptFill("CASE A: fill at the oracle price", oracle.price);
  await attemptFill("CASE B: fill 6.8% above oracle", oracle.price * 1.068);
  await attemptFill("CASE C: fill 1.5% above oracle (inside the 202bp closed band)", oracle.price * 1.015);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
