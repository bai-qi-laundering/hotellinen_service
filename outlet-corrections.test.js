import test from 'node:test';
import assert from 'node:assert/strict';
import { outletReceiptDetails } from './logistics-items.js';
import { restaurantInventoryRows, correctedOutletGroups, outletCorrectionPatch } from './outlet-corrections.js';

const date='2026-11-12';
const receipt={date,hotelKeyword:'洲際',deptName:'餐廳',clientSig:'hotel-signature',driverSig:'driver-signature',timestamp:'signed-time',items:[{itemName:'椅套',originalQty:'21',actualQty:'21',price:8}]};
const records=[
    {hotel:'洲際 餐廳',item:'【CLUB】椅套',count:'100',doubleCount:'17'},
    {hotel:'洲際 餐廳',item:'【宴會廳】椅套',doubleCount:'4'},
    {hotel:'洲際 制服',item:'【CLUB】椅套',doubleCount:'500'},
    {hotel:'其他飯店 餐廳',item:'【CLUB】椅套',doubleCount:'90'}
];
const groups=outletReceiptDetails(restaurantInventoryRows(records),[receipt],'洲際');
const move={date,id:'move-1',createdAt:'2026-11-12T08:00:00Z',from:'俱樂部',to:'宴會廳',item:'椅套',quantity:17,reason:'部門歸屬填錯'};
const quantities=groups=>Object.fromEntries(groups.map(group=>[group.outlet,group.items.find(row=>row.itemName==='椅套')?.quantity]));

test('moves 17 chair covers from CLUB to Banquet while signed items, price and signatures stay untouched',()=>{
    const patch=outletCorrectionPatch(receipt,date,groups,move);
    assert.deepEqual(Object.keys(patch),['outletCorrections']);
    const saved={...receipt,...patch};
    assert.equal(saved.items,receipt.items);
    assert.equal(saved.clientSig,receipt.clientSig);
    assert.equal(saved.driverSig,receipt.driverSig);
    assert.equal(saved.timestamp,receipt.timestamp);
    assert.deepEqual(quantities(correctedOutletGroups(groups,[saved])),{CLUB:'0',宴會廳:'21'});
    assert.deepEqual(quantities(groups),{CLUB:'17',宴會廳:'4'});
    assert.equal(outletCorrectionPatch(saved,date,groups,move),null);
    assert.throws(()=>outletCorrectionPatch(saved,date,groups,{...move,id:'move-2'}),/只有 0 件/);
});

test('can move to a configured department with no prior detail row and reverse the move with a second audit entry',()=>{
    const base=groups.slice(0,1);
    const saved={...receipt,...outletCorrectionPatch(receipt,date,base,move)};
    assert.deepEqual(quantities(correctedOutletGroups(base,[saved])),{CLUB:'0',宴會廳:'17'});
    const undo={...move,id:'undo',from:'宴會廳',to:'CLUB',reason:'還原'};
    const patched={...saved,...outletCorrectionPatch(saved,date,base,undo)};
    assert.deepEqual(quantities(correctedOutletGroups(base,[patched])),{CLUB:'17',宴會廳:'0'});
    assert.equal(patched.outletCorrections.length,2);
});

test('rejects unsigned or deleted receipts, wrong dates, aliases of the same outlet, invalid quantities and mismatched rollups',()=>{
    for(const bad of [{...receipt,clientSig:''},{...receipt,driverSig:''},{...receipt,manualDeletedReceipt:true},{...receipt,hotelKeyword:'其他飯店'}])
        assert.throws(()=>outletCorrectionPatch(bad,date,groups,move),/單據已變更/);
    assert.throws(()=>outletCorrectionPatch(receipt,'2026-11-13',groups,move),/單據已變更/);
    assert.throws(()=>outletCorrectionPatch(receipt,date,groups,{...move,to:'Club'}),/不同/);
    for(const quantity of [0,-1,1.5,NaN,18])assert.throws(()=>outletCorrectionPatch(receipt,date,groups,{...move,quantity}));
    assert.throws(()=>outletCorrectionPatch(receipt,date,groups,{...move,item:'雞尾酒巾'}),/品項歸類不同/);
});
