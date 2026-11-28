// One-time release preparation. Dry-run by default; --apply requires an approved rollout.
// Run from firebase-signature/functions with Firebase Admin credentials for the production project.
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import '../lib/flower-branch.js';

const apply=process.argv.includes('--apply');
const days=Number(process.env.BATCH_LOOKBACK_DAYS || 30);
if(!Number.isInteger(days)||days<1||days>180)throw Error('BATCH_LOOKBACK_DAYS must be 1..180');
const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days);
const since=cutoff.toISOString().slice(0,10);
const key=value=>globalThis.FlowerBranch.batchKey(value)||String(value||'').normalize('NFKC').replace(/\s/g,'');
initializeApp({credential:applicationDefault(),projectId:'hotel-inventory-3a1ad'});
const db=getFirestore();
const [receipts,inventory]=await Promise.all([
 db.collection('logistics_records').where('date','>=',since).get(),
 db.collection('inventory_records').where('date','>=',since).get()
]);
const signed=new Map();
for(const doc of receipts.docs){const data=doc.data();if(data.manualDeletedReceipt||!(data.clientSig||data.driverSig))continue;
 const hotel=key(data.hotelKeyword),date=String(data.date||'').slice(0,10);if(!hotel||hotel==='喜達絲'||!date)continue;
 const current=signed.get(hotel);if(!current||date>current.date)signed.set(hotel,{hotel,date,id:doc.id});
}
const rows=[];
for(const receipt of signed.values()){
 const dates=[...new Set(inventory.docs.filter(doc=>{
  const data=doc.data(),name=key(data.baseHotel||data.hotel);
  return name.startsWith(receipt.hotel)&&String(data.date||'').slice(0,10)>receipt.date&&
   (data.count!==undefined&&data.count!==''||data.doubleCount!==undefined&&data.doubleCount!=='');
 }).map(doc=>String(doc.data().date).slice(0,10)))].sort();
 rows.push({...receipt,lockedDate:dates.length===1?dates[0]:'',conflict:dates.length>1?dates:null});
}
const conflicts=rows.filter(row=>row.conflict);
console.log(JSON.stringify({project:'hotel-inventory-3a1ad',since,receiptsRead:receipts.size,inventoryRead:inventory.size,
 hotels:rows.length,conflicts,states:rows.map(({hotel,date,lockedDate})=>({hotel,signedDate:date,lockedDate}))},null,2));
if(conflicts.length)throw Error('Multiple unfinished dates require back-office review; no state was written');
if(!apply){console.log('Dry run only. No Firestore documents were changed.');process.exit(0);}
for(const row of rows){const ref=db.collection('inventory_batch_states').doc(row.hotel);
 await db.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists)return;
  tx.create(ref,{latestSignedReceiptDate:row.date,latestSignedReceiptId:row.id,
   lockedDate:row.lockedDate,updatedAt:Date.now(),initializedFrom:'migration'});
 });
}
console.log('Initialized only missing state documents.');
