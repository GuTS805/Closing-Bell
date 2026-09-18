/** Which Pyth feeds have a usable on-chain account on devnet? Decides the devnet demo. */
import { Connection, PublicKey } from "@solana/web3.js";
const PO = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const acc=(s:number,f:string)=>{const b=Buffer.alloc(2);b.writeUInt16LE(s,0);
  return PublicKey.findProgramAddressSync([b,Buffer.from(f,"hex")],PO)[0];};
function parse(d:Buffer){let o=40;o+=d.readUInt8(o)===0?2:1;o+=32;
  const p=d.readBigInt64LE(o);o+=8;d.readBigUInt64LE(o);o+=8;
  const e=d.readInt32LE(o);o+=4;const t=d.readBigInt64LE(o);
  return{price:Number(p)*10**e,t:Number(t)};}
const FEEDS:Record<string,string>={
  "Crypto.SOL/USD":"ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "Crypto.BTC/USD":"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "Crypto.USDC/USD":"eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  "Equity.US.AAPL/USD":"49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
};
async function main(){
  const url=process.env.SCAN_RPC ?? "https://api.devnet.solana.com";
  const conn=new Connection(url,"confirmed");
  const now=Math.floor(Date.now()/1000);
  console.log(`cluster ${url}`);
  console.log("feed                   shard  age        price      address");
  console.log("-".repeat(78));
  for(const [sym,id] of Object.entries(FEEDS)){
    let any=false;
    for(const s of [0,1,2,3]){
      const a=acc(s,id);
      const i=await conn.getAccountInfo(a);
      if(!i)continue;
      const p=parse(i.data);const age=now-p.t;
      const h=Math.abs(age)<7200?`${age}s`:`${(age/86400).toFixed(1)}d`;
      console.log(`${sym.padEnd(22)} ${s}   ${h.padStart(7)}  ${p.price.toFixed(4).padStart(10)}  ${a.toBase58()}`);
      any=true;
    }
    if(!any)console.log(`${sym.padEnd(22)} -   none on shards 0-3`);
  }
}
main().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
