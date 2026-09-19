/**
 * Runs a real guarded fill on Solana devnet, on demand.
 *
 * The two transactions linked on the proof page are historical. This builds and sends a
 * fresh one per request, so the rejection can be watched happening rather than read about
 * afterwards.
 *
 * The "swap" in the middle is a mint of the base token and a burn of the quote, both
 * signed by the same authority. The guard only ever reads balance deltas — it has no
 * opinion on how they were produced — so this exercises exactly the enforcement path a
 * real swap would, without needing a counterparty on devnet. The original devnet run used
 * two token transfers, which were themselves standing in for a swap.
 *
 * The signing keypair never leaves the server.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  createMintToInstruction,
  createBurnInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const revalidate = 0;
export const maxDuration = 60;

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH =
  process.env.GUARD_KEYPAIR_PATH ?? "/home/alok0/.config/solana/id.json";

/** Deployment addresses, read from the record the devnet script writes. */
interface Deployment {
  programId: string;
  priceAccount: string;
  baseMint: string;
  quoteMint: string;
}

const FALLBACK: Deployment = {
  programId: "DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig",
  priceAccount: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
  baseMint: "4AicvUDdc1bkDUQ77zMDs6y2m1bRfCN4Z4CtmbNeT1rv",
  quoteMint: "D52eyUCRpACUFuxwmFYHkjmswGJdKEyZp34cQBfx7Kwm",
};

function loadDeployment(): Deployment {
  try {
    const p = path.join(process.cwd(), "..", "docs", "devnet-deployment.json");
    const d = JSON.parse(readFileSync(p, "utf8"));
    if (d.programId && d.baseMint && d.quoteMint && d.priceAccount) return d;
  } catch {
    // The committed fallback is the same deployment; this only matters after a redeploy.
  }
  return FALLBACK;
}

const BASE_DECIMALS = 8;
const QUOTE_DECIMALS = 6;

const disc = (n: string) =>
  createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);

function parseOracle(d: Buffer) {
  let o = 8 + 32;
  o += d.readUInt8(o) === 0 ? 2 : 1;
  o += 32;
  const price = d.readBigInt64LE(o); o += 8;
  const conf = d.readBigUInt64LE(o); o += 8;
  const expo = d.readInt32LE(o); o += 4;
  const publishTime = d.readBigInt64LE(o);
  return {
    price: Number(price) * 10 ** expo,
    conf: Number(conf) * 10 ** expo,
    publishTime: Number(publishTime),
  };
}

/** Sending costs devnet SOL, so requests are spaced out. */
let lastRun = 0;
const MIN_GAP_MS = 4_000;

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") === "allow" ? "allow" : "reject";

  const since = Date.now() - lastRun;
  if (since < MIN_GAP_MS) {
    return NextResponse.json(
      { error: `Give it a moment — ${Math.ceil((MIN_GAP_MS - since) / 1000)}s.` },
      { status: 429 }
    );
  }
  lastRun = Date.now();

  const started = Date.now();

  try {
    const dep = loadDeployment();
    const PROGRAM_ID = new PublicKey(dep.programId);
    const PRICE_ACCOUNT = new PublicKey(dep.priceAccount);
    const baseMint = new PublicKey(dep.baseMint);
    const quoteMint = new PublicKey(dep.quoteMint);

    const conn = new Connection(RPC, "confirmed");
    const payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")))
    );

    const priceInfo = await conn.getAccountInfo(PRICE_ACCOUNT);
    if (!priceInfo) throw new Error("oracle account not found on devnet");
    const oracle = parseOracle(priceInfo.data);

    const ata = (m: PublicKey) =>
      getAssociatedTokenAddressSync(m, payer.publicKey, true, TOKEN_2022_PROGRAM_ID);
    const userBase = ata(baseMint);
    const userQuote = ata(quoteMint);

    const [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      PROGRAM_ID
    );
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), baseMint.toBuffer()],
      PROGRAM_ID
    );
    const [clockPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("clock")],
      PROGRAM_ID
    );
    const [pending] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), payer.publicKey.toBuffer(), market.toBuffer()],
      PROGRAM_ID
    );

    const recordIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: pending, isSigner: false, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: false },
        { pubkey: clockPda, isSigner: false, isWritable: false },
        { pubkey: PRICE_ACCOUNT, isSigner: false, isWritable: false },
        { pubkey: userBase, isSigner: false, isWritable: false },
        { pubkey: userQuote, isSigner: false, isWritable: false },
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
        { pubkey: userBase, isSigner: false, isWritable: false },
        { pubkey: userQuote, isSigner: false, isWritable: false },
      ],
      data: disc("verify_fill"),
    });

    // One unit of base, paid for at either the oracle price or 6.8% above it.
    const overpay = mode === "reject" ? 1.068 : 1.0;
    const fillPrice = oracle.price * overpay;
    const baseAmount = BigInt(10 ** BASE_DECIMALS);
    const quoteAmount = BigInt(Math.round(fillPrice * 10 ** QUOTE_DECIMALS));

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(recordIx)
      .add(
        createMintToInstruction(
          baseMint, userBase, payer.publicKey, baseAmount, [], TOKEN_2022_PROGRAM_ID
        )
      )
      .add(
        createBurnInstruction(
          userQuote, quoteMint, payer.publicKey, quoteAmount, [], TOKEN_2022_PROGRAM_ID
        )
      )
      .add(verifyIx);

    const before = (await conn.getTokenAccountBalance(userBase)).value.amount;

    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(payer);

    // skipPreflight so a rejected fill still lands on chain and stays linkable.
    const signature = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });

    try {
      await conn.confirmTransaction(signature, "confirmed");
    } catch {
      // A rejected fill is the expected outcome in reject mode.
    }

    // A confirmed transaction is not immediately indexed, so getTransaction can return
    // null for a moment. Treating null as "no error" would report a rejected fill as a
    // successful one, which is the opposite of the truth — so poll, then say plainly
    // that the result is unknown rather than guessing at it.
    let parsed = null;
    for (let attempt = 0; attempt < 8 && parsed === null; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
      parsed = await conn.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    }

    const after = (await conn.getTokenAccountBalance(userBase)).value.amount;

    const logs = parsed?.meta?.logMessages ?? [];
    const guardLog =
      logs.find((l) => l.includes("fill:"))?.replace(/^Program log: ?/, "") ?? null;
    const deviationBps = Number(guardLog?.match(/deviation=(\d+)bps/)?.[1] ?? NaN);
    const bandBps = Number(guardLog?.match(/band=(\d+)bps/)?.[1] ?? NaN);
    const outcome =
      parsed === null ? "unknown" : parsed.meta?.err ? "blocked" : "filled";

    return NextResponse.json({
      mode,
      outcome,
      signature,
      explorer: `https://solscan.io/tx/${signature}?cluster=devnet`,
      oraclePrice: oracle.price,
      fillPrice,
      deviationBps: Number.isFinite(deviationBps) ? deviationBps : null,
      bandBps: Number.isFinite(bandBps) ? bandBps : null,
      computeUnits: parsed?.meta?.computeUnitsConsumed ?? null,
      balanceBefore: before,
      balanceAfter: after,
      balanceUnchanged: before === after,
      guardLog,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
