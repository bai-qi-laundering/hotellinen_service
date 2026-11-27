import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as mod from '../special-receipt.js';
const html=fs.readFileSync(new URL('../sendwash.html',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const prepareBody=html.split('async function prepareSpecialWrites(tx, plan, previousItems) {')[1].split('\nfunction writeSpecialChanges')[0].replace(/}\s*$/,'');
const handlerBody=html.split("$('form').onsubmit=async e=>{")[1].split('\n};\ntry{')[0];
async function submit({previous=true,answer=true,accepted=false,revision=1,retries=1,concurrent=false}={}){
 const hotel='巨蛋',date='2026-11-27',time='2026-11-27T01:00:00Z';
 const input={hotel,receivedDate:date,lines:[{item:'特處床單',qty:3}],time};
 const original={...mod.buildReceiptSpecialDocs(input)[0],status:'已送出',sentAt:'old',officeSignature:'keep'};
 const store=new Map(previous?[[original.id,original]]:[]);
 let old=previous?{hotel,department:'特處',revision,submittedAt:time,items:[{item:'特處床單',quantity:'3'}],...(accepted?{acceptedAt:'old',receivedItems:{x:3}}:{})}:{};
 const current=previous?structuredClone(old):null;
 if(concurrent)old.revision++;
 const elements={department:{value:'特處'},sourceDate:{value:date},qty0:{value:'3'},target:{textContent:'特處單不填送回日期。送出後先到洗滌部點收；出貨日由辦公室依收送規則寫進盤點。'},message:{textContent:''}};
 const $=id=>elements[id] ||= {};
 let prompts=0,transactions=0;
 const doc=(_db,col,id)=>({col,id}),snap=data=>({exists:()=>!!data,data:()=>data});
 const rows=[{item:'特處床單',inventoryHotel:'巨蛋 特處'}],settings=[{hotel,department:'特處',item:'特處床單'}];
 const core={submissionItems:()=>[{item:'特處床單',quantity:'3'}],settings:()=>settings,targetDate:()=>date,submissionId:()=> 'submission'};
 const prepare=new AsyncFunction('tx','plan','previousItems','doc','db','settings','hotel',prepareBody);
 const specialDocsFor=async (dept,sourceDate,items,submissionKey='')=>({mod,docs:mod.buildReceiptSpecialDocs({...input,submissionKey}),time,sourceDate,dept,resend:!!submissionKey});
 const runTransaction=async (_db,callback)=>{
  transactions++;
  for(let i=0;i<retries;i++){
   const pending=[];
   await callback({get:async ref=>snap(ref.col==='sendwash_records'?old:store.get(ref.id)),set:(ref,fields)=>pending.push({ref,fields})});
   if(i===retries-1)for(const {ref,fields}of pending){if(ref.col==='special_items')store.set(ref.id,fields);else old=fields;}
  }
 };
 const args={busy:false,disable:()=>{},rows,$,batchEnabled:()=>false,submitBatch:()=>{},core,getDocFromServer:async()=>snap({sendwashSettings:settings,items:[]}),doc,db:{},hotel,settings,specialDept:()=>true,activeOutlet:'',current,specialDocsFor,confirm:()=>{prompts++;return answer;},runTransaction,adminMode:false,prepareSpecialWrites:(tx,plan,items)=>prepare(tx,plan,items,doc,{},settings,hotel),writeSpecialChanges:(tx,c)=>c.writes.forEach(w=>tx.set(w.ref,w.fields,{merge:w.merge})),shownBatchId:null,batchDrafts:new Map(),load:async()=>{},showError:e=>{$('message').textContent=e.message;},locked:()=>false};
 await new AsyncFunction('e',...Object.keys(args),handlerBody)({preventDefault(){}},...Object.values(args));
 return {store,original,prompts,transactions,message:$('message').textContent};
}
test('cancelled resend asks once and writes nothing',async()=>{
 const r=await submit({answer:false});
 assert.equal(r.prompts,1);assert.equal(r.transactions,0);assert.equal(r.store.size,1);assert.match(r.message,/已取消/);
 assert.deepEqual(r.store.get(r.original.id),r.original);
});
test('confirmed resend preserves shipped signatures and creates one washing batch despite transaction retry',async()=>{
 const r=await submit({accepted:true,retries:2});
 assert.equal(r.prompts,1);assert.equal(r.store.size,2);assert.deepEqual(r.store.get(r.original.id),r.original);
 const fresh=[...r.store.entries()].find(([id])=>id!==r.original.id)[1];
 assert.equal(fresh.status,'待洗滌');assert.equal(fresh.receivedDate,'2026-11-27');assert.equal(fresh.qty,3);
 assert.equal(fresh.officeSignature,'');assert.equal(fresh.washSignedAt,'');assert.match(r.message,/已再次傳送/);
});
test('later resends get separate batches',async()=>{
 const a=await submit({revision:1}),b=await submit({revision:2});
 const ids=r=>[...r.store.keys()].find(id=>id!==r.original.id);assert.notEqual(ids(a),ids(b));
});
test('concurrent update prevents new washing records',async()=>{
 const r=await submit({concurrent:true});assert.equal(r.store.size,1);assert.match(r.message,/其他人已更新/);
});
test('first submission needs no resend confirmation and enters washing',async()=>{
 const r=await submit({previous:false});assert.equal(r.prompts,0);assert.equal(r.store.size,1);assert.equal([...r.store.values()][0].status,'待洗滌');
});
