const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const lock = require('../inventory-date-lock.js');
const inv=(date,count='2',hotel='喜達絲 房務')=>({date,count,hotel,item:'浴巾'});
const receipt=(date,sig={})=>({date,hotelKeyword:'喜達絲',...sig});
assert.equal(lock.date([inv('2026-11-17'),inv('2026-11-18')],[]),'2026-11-17');
assert.equal(lock.date([inv('2026-11-17','0')],[]),'2026-11-17');
assert.equal(lock.date([inv('2026-11-17','')],[]),'');
for(const field of ['clientSig','driverSig']) {
 assert.equal(lock.date([inv('2026-11-17')],[receipt('2026-11-17',{[field]:'signature'})]),'');
 assert.equal(lock.date([inv('2026-11-17'),inv('2026-11-18')],[receipt('2026-11-17',{[field]:'signature'})]),'2026-11-18');
}
assert.equal(lock.date([inv('2026-11-15'),inv('2026-11-18')],[receipt('2026-11-17',{clientSig:'signature'})]),'2026-11-18');
assert.equal(lock.date([inv('2026/11/7')],[]),'2026-11-07');
assert.equal(lock.date([inv('2026-11-19')],[]),'2026-11-19'); // backend moved original date
assert.equal(lock.date([],[]),'');
assert.equal(lock.date([inv('2026-11-17','2','鉑麗 房務')],[]),'');
assert.equal(lock.date([inv('2026-11-17','2','喜達絲 特處')],[]),'');
assert.equal(lock.date([inv('2026-11-17')],[receipt('2026-11-17',{clientSig:'signature',manualDeletedReceipt:true})]),'2026-11-17');
const page=fs.readFileSync('index.html','utf8');
const elements=new Map();
const el=id=>{if(!elements.has(id))elements.set(id,{value:'2026-11-16',getContext:()=>({}),addEventListener(){},classList:{contains:()=>false,add(){},remove(){}}});return elements.get(id);};
const context={window:{InventoryDateLock:lock,InventorySave:require('../inventory-save.js'),addEventListener(){}},document:{getElementById:el,addEventListener(){}},localStorage:{setItem(){},getItem(){return null;}},setTimeout,clearTimeout,console};
context.window.window=context.window;
vm.createContext(context);
const scripts=[...page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
for(const m of scripts)if(!m[1].includes('src=')&&!m[1].includes('module'))vm.runInContext(m[2],context);
assert.equal(vm.runInContext("isFieldInventoryHotel('喜達絲')",context),true);
assert.equal(vm.runInContext("getTargetDateStr('喜達絲','2026-11-16','房務')",context),'2026-11-17');
vm.runInContext("currentBaseHotel='喜達絲';handleInput('2026-11-17','喜達絲 房務','浴巾','count','0')",context);
assert.equal(el('datePicker').disabled,true);
assert.equal(vm.runInContext("getTargetDateStr('喜達絲','2026-11-17','房務')",context),'2026-11-17');
vm.runInContext("xidasiDateLock='';updateXidasiDateControl()",context);
assert.equal(el('datePicker').disabled,false);
assert.equal(vm.runInContext("getTargetDateStr('喜達絲','2026-11-17','房務')",context),'2026-11-18');
vm.runInContext("currentBaseHotel='鉑麗';handleInput('2026-11-18','鉑麗 房務','浴巾','count','3')",context);
assert.equal(el('datePicker').disabled,false);
console.log('Passed: existing date, zero, either signature, next batch, backend date change, and other hotels.');
