/** Which tokenized-equity Pyth feeds actually have a fresh on-chain account? */
import { Connection, PublicKey } from "@solana/web3.js";
const PO = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const acc=(s:number,f:string)=>{const b=Buffer.alloc(2);b.writeUInt16LE(s,0);
  return PublicKey.findProgramAddressSync([b,Buffer.from(f,"hex")],PO)[0];};
function parse(d:Buffer){let o=40;o+=d.readUInt8(o)===0?2:1;o+=32;
  const p=d.readBigInt64LE(o);o+=8;d.readBigUInt64LE(o);o+=8;
  const e=d.readInt32LE(o);o+=4;const t=d.readBigInt64LE(o);
  return{price:Number(p)*10**e,t:Number(t)};}
const sleep=(m:number)=>new Promise(r=>setTimeout(r,m));
async function main(){
  const conn=new Connection(process.env.RPC_URL??"https://api.mainnet-beta.solana.com","confirmed");
  const now=Math.floor(Date.now()/1000);
  const ids:Record<string,string>={};
  for(const t of ["AAPL","SPY","NVDA","TSLA","GOOGL","QQQ"]){
    const r=await fetch(`https://hermes.pyth.network/v2/price_feeds?query=${t}X`);
    if(r.ok) for(const f of await r.json() as any[]){
      const s=f?.attributes?.symbol; if(s) ids[s]=f.id;}
    await sleep(1200);
  }
  console.log("feed                          shard    age        value");
  console.log("-".repeat(58));
  for(const [sym,id] of Object.entries(ids).sort()){
    if(!/\/USD$|\.RR$/.test(sym))continue;
    let found=false;
    for(const s of [0,1,2,3]){
      const i=await conn.getAccountInfo(acc(s,id));
      if(!i)continue;
      const p=parse(i.data);const age=now-p.t;
      const h=Math.abs(age)<7200?`${age}s`:`${(age/86400).toFixed(1)}d`;
      console.log(`${sym.padEnd(28)} ${s}   ${h.padStart(7)}   ${p.price.toFixed(5)}`);
      found=true;
    }
    if(!found)console.log(`${sym.padEnd(28)} -   no on-chain account`);
  }
}
main().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
