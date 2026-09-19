/**
 * Works out which mainnet accounts the fork needs, by asking Jupiter to build a real SPYx
 * swap and reading back every account the resulting transaction references.
 *
 * Deriving the set this way rather than by hand is what keeps tick arrays honest: a CLMM
 * swap crosses whichever tick arrays the price range demands, and the route already names
 * them. A hand-written list would be a guess that happens to work at one price.
 *
 * Run:  npx tsx scripts/derive-clone-set.ts
 */
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

const RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Any pubkey works; we only want the account list, never to send this. */
const PROBE_USER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/** Present in every validator already, so cloning them only causes errors. */
const BUILT_IN = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "SysvarRent111111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  PROBE_USER,
]);

async function main() {
  const conn = new Connection(RPC, "confirmed");

  const quote = await (
    await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${SPYX}` +
        `&amount=2000000000&slippageBps=100&dexes=Raydium%20CLMM&onlyDirectRoutes=true`
    )
  ).json();
  if (quote.error) throw new Error(`quote: ${quote.error}`);

  const swap = await (
    await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: PROBE_USER,
        wrapAndUnwrapSol: true,
      }),
    })
  ).json();
  if (!swap.swapTransaction) throw new Error(`swap: ${JSON.stringify(swap).slice(0, 200)}`);

  const msg = VersionedTransaction.deserialize(
    Buffer.from(swap.swapTransaction, "base64")
  ).message;

  const used = new Set(msg.staticAccountKeys.map((k) => k.toBase58()));

  // Only the indexes the transaction actually references, not the whole table — a Jupiter
  // lookup table holds well over a hundred addresses and almost none of them are touched.
  for (const lookup of msg.addressTableLookups ?? []) {
    const table = await conn.getAddressLookupTable(lookup.accountKey);
    if (!table.value) continue;
    for (const i of [...lookup.writableIndexes, ...lookup.readonlyIndexes]) {
      used.add(table.value.state.addresses[i].toBase58());
    }
  }

  const list = [...used].filter((a) => !BUILT_IN.has(a));
  const infos = await conn.getMultipleAccountsInfo(list.map((a) => new PublicKey(a)));

  const programs: string[] = [];
  const accounts: string[] = [];
  list.forEach((a, i) => {
    const info = infos[i];
    if (!info) return;
    (info.executable ? programs : accounts).push(a);
  });

  console.log(`route: ${quote.routePlan.map((h: any) => h.swapInfo.label).join(" + ")}`);
  console.log(`\nPROGRAMS=(\n${programs.map((p) => "  " + p).join("\n")}\n)`);
  console.log(`\nACCOUNTS=(\n${accounts.map((a) => "  " + a).join("\n")}\n)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
