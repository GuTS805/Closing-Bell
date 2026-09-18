/**
 * Day-0 feasibility test (architecture doc SS12).
 *
 * Runs against a local validator that has the real mainnet Pyth account cloned
 * into it, so the oracle read exercises real data without spending mainnet SOL.
 *
 * Reports the number SS12 actually asks for: compute units consumed.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig"
);
/** Pyth AAPL/USD, shard 1 — the fresh one. Shard 0 is ~34 days stale. */
const PRICE_ACCOUNT = new PublicKey("D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW");
const FEED_ID_HEX =
  "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

/** Anchor instruction discriminator: first 8 bytes of sha256("global:<name>"). */
function discriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeArgs(feedIdHex: string, maxStaleness: bigint, marketOpen: boolean) {
  const s = Buffer.from(feedIdHex, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(s.length, 0);
  const staleness = Buffer.alloc(8);
  staleness.writeBigUInt64LE(maxStaleness, 0);
  return Buffer.concat([len, s, staleness, Buffer.from([marketOpen ? 1 : 0])]);
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(process.env.WALLET ?? "/home/alok0/.config/solana/id.json", "utf8"))
    )
  );

  console.log(`RPC        ${RPC}`);
  console.log(`program    ${PROGRAM_ID.toBase58()}`);
  console.log(`price acct ${PRICE_ACCOUNT.toBase58()}`);

  const acct = await conn.getAccountInfo(PRICE_ACCOUNT);
  if (!acct) throw new Error("Pyth account not present on the validator — clone it first.");
  console.log(`price acct owner=${acct.owner.toBase58()} len=${acct.data.length}\n`);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: PRICE_ACCOUNT, isSigner: false, isWritable: false }],
    data: Buffer.concat([
      discriminator("probe_oracle"),
      // Generous staleness: the cloned account's publish_time is frozen at clone time
      // while the validator clock keeps moving.
      encodeArgs(FEED_ID_HEX, 86_400n, false),
    ]),
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(ix);

  const sim = await conn.simulateTransaction(tx, [payer]);
  console.log("=== simulation ===");
  for (const l of sim.value.logs ?? []) console.log("  " + l);
  if (sim.value.err) {
    console.log("\nSIM ERROR:", JSON.stringify(sim.value.err));
    process.exit(1);
  }
  console.log(`\nunitsConsumed (simulated): ${sim.value.unitsConsumed}`);

  const sig = await sendAndConfirmTransaction(conn, tx, [payer], {
    commitment: "confirmed",
  });
  console.log(`\nsignature ${sig}`);

  const parsed = await conn.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const used = parsed?.meta?.computeUnitsConsumed;
  console.log(`\n=== SS12 RESULT ===`);
  console.log(`compute units consumed: ${used}`);
  const budget = 250_000;
  console.log(
    used !== undefined && used < budget
      ? `PASS — under the ${budget} CU bar, leaving ${budget - used} CU of headroom for the swap CPI.`
      : `Above the ${budget} CU bar — see SS12 outcome table.`
  );
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
