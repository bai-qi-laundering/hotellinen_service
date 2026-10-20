const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js'),date='2026-10-20',html=fs.readFileSync('index.html','utf8');
function fixture(dept,pending=true){
 const base='承億'+dept,hotel=base+' '+dept,item=dept==='休閒'?'浴巾(泳池)':'浴巾';
 const inputs={},tables={sendwash_records:pending?{source:{hotel:base,department:dept,inventoryHotel:hotel,targetDate:date,items:[{item,quantity:'8',unit:'條'}]}}:{},inventory_records:{}};
 const api={doc:(_,name,id)=>({name,id}),collection:(_,name)=>({name}),where(){},query:q=>q,onSnapshot:(q,fn)=>{fn({forEach:visit=>Object.entries(tables[q.name]).forEach(([id,data])=>visit({id,data:()=>structuredClone(data)}))});return()=>{};},runTransaction:async(_,fn)=>{const writes=[];const result=await fn({get:async r=>({exists:()=>!!tables[r.name]?.[r.id],data:()=>structuredClone(tables[r.name]?.[r.id])}),set:(r,d)=>writes.push([r,d]),update:(r,d)=>writes.push([r,d])});for(const [r,d] of writes)tables[r.name][r.id]={...tables[r.name][r.id],...d};return result;}};
 const elements={};for(const id of ['datePicker','itemsList','signModal','signModalTitle','signCancelBtn','signConfirmBtn','signUploadStatus','calcModal','calcTitle','calcDisplay'])elements[id]={value:date,children:[],dataset:{},classList:{add(){},remove(){},toggle(){}}};
 const c=vm.createContext({window:{SendwashCore:core,getSafeId:x=>x},SendwashCore:core,userInputs:inputs,apiFixture:api,renderItems(){},showMessage:message=>c.error=message,showToast(){},document:{getElementById:id=>elements[id]},currentHotelName:hotel,currentBaseHotel:base,masterData:[{hotel,item}],requestAnimationFrame:fn=>fn(),canvas:{offsetWidth:300,toDataURL:()=> 'data:image/jpeg;base64,test'},ctx:{fillRect(){},clearRect(){},getImageData:()=>({data:[0,0,0,255]})},activeCategory:'',activeItem:'',activeRole:'',isFirebaseLoaded:true,db:{},getLocalTimeString:()=>date,getLocalDateString:()=>date,saveToLocal(){},doc:api.doc,runTransaction:api.runTransaction,setDoc:async(r,d)=>tables[r.name][r.id]={...tables[r.name][r.id],...d},collection(){},addDoc:async()=>{},closeSign(){},handleInput:(d,h,i,k,v)=>{inputs[d]||={};inputs[d][h]||={};inputs[d][h][i]||={count:'',doubleCount:''};inputs[d][h][i][k]=v;}});
 vm.runInContext(fs.readFileSync('sendwash-verification.js','utf8').replace("await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')",'apiFixture'),c);
 vm.runInContext(html.slice(html.indexOf('        function openSign('),html.indexOf('        function addNewItem()')),c);
 vm.runInContext(html.slice(html.indexOf('                window.firebaseSubmit = async function('),html.indexOf('                window.syncSettingsFromSheet =')),c);
 c.window.uploadSignatureToStorage=async()=> 'supervisor-url';
 return {c,hotel,item,inputs,tables,elements,async start(){await c.window.startSendwashVerification({});await c.window.attachSendwashListener([date]);c.window.prepareSendwashInputs(date,hotel);},render(){vm.runInContext(html.slice(html.indexOf('        function renderItems('),html.indexOf('        function handleInput(')),c);c.renderItems(true);return elements.itemsList.innerHTML;}};
}
test('only designated Cheng Yi linen departments skip first signature, including legacy inventory names',()=>{
 for(const dept of ['休閒','健身房'])for(const record of [{hotel:'承億'+dept,department:dept},{hotel:'承億'+dept+' '+dept},{baseHotel:'承億',department:dept}])assert.equal(core.recheckOnly(record),true);
 for(const record of [{hotel:'承億 制服'},{hotel:'承億 BARKAO'},{hotel:'承億 房務'},{hotel:'H2O 制服'},{hotel:'其他飯店 休閒'},{hotel:'承億健身房',department:'制服'}])assert.equal(core.recheckOnly(record),false);
});
for(const dept of ['休閒','健身房']){
 test(dept+' pending sendwash saves zero with only the supervisor signature',async()=>{
  const f=fixture(dept);await f.start();const {c,hotel,item}=f;
  const card=f.render();assert(!card.includes('第一步-簽名'));assert(card.includes('免簽名'));assert(card.includes('複點簽名'));
  c.openSign(hotel,item,'aunt');assert.match(c.error,/右側複點簽名/);c.error=undefined;
  c.openSign(hotel,item,'sup');assert.equal(f.elements.signModalTitle.innerText,'複點人員簽名');await c.confirmSignature();vm.runInContext("calcExpr='0'",c);c.calcConfirm();
  for(let i=0;i<30&&!f.tables.inventory_records[core.inventoryId(date,hotel,item)];i++)await new Promise(resolve=>setImmediate(resolve));
  const saved=f.tables.inventory_records[core.inventoryId(date,hotel,item)];assert(saved,c.error);assert.equal(saved.count,'8');assert.equal(saved.doubleCount,'0');assert.equal(saved.signature,'');assert.equal(saved.doubleSignature,'supervisor-url');assert(f.tables.sendwash_records.source.acceptedAt);
  const patch=core.sendwashInventoryPatch(saved,{count:'8',doubleCount:'7',doubleSignature:'new-supervisor'},'8','0');assert.equal(patch.doubleCount,'7');assert.throws(()=>core.sendwashInventoryPatch(saved,{count:'9',doubleCount:'7'},'8','0'),/鎖定/);
 });
 test(dept+' manual item skips first signature without settings or orders',async()=>{
  const f=fixture(dept,false);await f.start();assert(!f.render().includes('第一步-簽名'));
  f.c.openSign(f.hotel,f.item,'sup');assert.equal(f.c.error,undefined);await f.c.confirmSignature();vm.runInContext("calcExpr='12'",f.c);f.c.calcConfirm();
  for(let i=0;i<30&&!f.tables.inventory_records[core.inventoryId(date,f.hotel,f.item)];i++)await new Promise(resolve=>setImmediate(resolve));
  const saved=f.tables.inventory_records[core.inventoryId(date,f.hotel,f.item)];assert(saved,f.c.error);assert.equal(saved.doubleCount,'12');assert.equal(saved.doubleSignature,'supervisor-url');assert.equal(saved.signature,undefined);
 });
}
