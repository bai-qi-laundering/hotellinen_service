import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRemovedSignature } from '../inventory-batch-reconcile.js';

function fixture({sameDaySigned=false, lockedDate='', inventory=true}={}) {
    const state={latestSignedReceiptDate:'2026-11-26',latestSignedReceiptId:'2026-11-26_好六_房務',lockedDate};
    const rows=[
        {id:'2026-11-25_好六_房務',ref:{id:'2026-11-25_好六_房務'},data:()=>({date:'2026-11-25',hotelKeyword:'好六',driverSig:'signed'})},
        {id:'2026-11-26_好六_房務',ref:{id:'2026-11-26_好六_房務'},data:()=>({date:'2026-11-26',hotelKeyword:'好六',manualDeletedReceipt:true,driverSig:'old'})}
    ];
    if(sameDaySigned) rows.push({id:'2026-11-26_好六_特處',ref:{id:'2026-11-26_好六_特處'},data:()=>({date:'2026-11-26',hotelKeyword:'好六',driverSig:'signed'})});
    const writes=[];
    const scopedReads={names:()=>['好六'],read:async(_api,_db,name)=>name==='logistics_records'?
        [{forEach:fn=>rows.forEach(fn)}]:[{docs:inventory?[{data:()=>({count:3})}]:[]}]};
    const api={
        doc:(_db,_collection,id)=>({id}),getDocFromServer:async()=>({exists:()=>true,data:()=>state}),
        runTransaction:async(_db,fn)=>fn({get:async ref=>ref.id==='好六'?{exists:()=>true,data:()=>state}:
            {exists:()=>true,data:rows.find(r=>r.id===ref.id).data},set:(_ref,patch)=>writes.push(patch)})
    };
    return {state,rows,writes,scopedReads,api};
}
const batchState={key:name=>name};
const args=f=>({db:{},api:f.api,hotel:'好六',date:'2026-11-26',templateRows:[],batchState,scopedReads:f.scopedReads});

test('撤銷好六誤簽後，保留當日盤點並退回上一張有效簽收',async()=>{
    const f=fixture();
    assert.deepEqual(await reconcileRemovedSignature(args(f)),{changed:true,lockedDate:'2026-11-26'});
    assert.equal(f.writes[0].latestSignedReceiptDate,'2026-11-25');
    assert.equal(f.writes[0].lockedDate,'2026-11-26');
});
test('同批其他部門仍簽收時不退回',async()=>{
    const f=fixture({sameDaySigned:true});
    assert.equal((await reconcileRemovedSignature(args(f))).reason,'same-day-signature');
    assert.equal(f.writes.length,0);
});
test('後續批次已有盤點日期時拒絕覆寫',async()=>{
    const f=fixture({lockedDate:'2026-11-27'});
    await assert.rejects(reconcileRemovedSignature(args(f)),/下一批已有盤點/);
    assert.equal(f.writes.length,0);
});
