import { Connection, PublicKey } from '@solana/web3.js';

const feedId = process.argv[2];
if (!/^[0-9a-f]{64}$/i.test(feedId ?? '')) {
  console.error('Usage: node scripts/check-oracle-shards.mjs <64-character feed ID>');
  process.exit(1);
}

const program = new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');
const rpc = process.env.MAINNET_RPC ?? 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpc, 'confirmed');
const shards = [0, 1, 2, 3];
const addresses = shards.map(shard => {
  const shardBytes = Buffer.alloc(2);
  shardBytes.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([shardBytes, Buffer.from(feedId, 'hex')], program)[0];
});
const accounts = await connection.getMultipleAccountsInfo(addresses);
const now = Math.floor(Date.now() / 1000);

for (const [index, account] of accounts.entries()) {
  if (!account) {
    console.log(`shard ${shards[index]}: no account`);
    continue;
  }
  const data = account.data;
  let offset = 8 + 32;
  offset += data.readUInt8(offset) === 0 ? 2 : 1;
  offset += 32;
  const price = data.readBigInt64LE(offset); offset += 8;
  offset += 8; // confidence
  const exponent = data.readInt32LE(offset); offset += 4;
  const publishTime = Number(data.readBigInt64LE(offset));
  console.log(`shard ${shards[index]}: price=${Number(price) * 10 ** exponent} age=${now - publishTime}s published=${new Date(publishTime * 1000).toISOString()} account=${addresses[index]}`);
}
