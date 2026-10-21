const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const date='2026-10-16',hotel='H2O 制服',item='廚衣';
async function fixture(){
 const source={hotel:'H2O',department:'制服',inventoryHotel:hotel,targetDate:date,items:[{item,quantity:'5',unit:'件'}]};
 const tables={sendwash_records:{source},inventory_records:{}};const inputs={};let save;
 const api={doc:(_,name,id)=>({name,id}),collection:(_,name)=>({name}),where(){},query:c=>c,onSnapshot:(q,fn)=>{fn({forEach:visit=>Object.entries(tables[q.name]).forEach(([id,data])=>visit({id,data:()=>structuredClone(data)}))});return()=>{};},runTransaction:async(_,fn)=>{const pending=[];const result=await fn({get:async r=>({exists:()=>!!tables[r.name]?.[r.id],data:()=>structuredClone(tables[r.name]?.[r.id])}),set:(r,d)=>pending.push([r,d]),update:(r,d)=>pending.push([r,d])});pending.forEach(([r,d])=>{tables[r.name][r.id]={...tables[r.name][r.id],...d};});return result;}};
 const elements={datePicker:{value:date},calcTitle:{},calcDisplay:{},calcModal:{classList:{remove(){},add(){}}}};
 const context=vm.createContext({window:{InventorySave:require('../inventory-save.js'),SendwashCore:core},SendwashCore:core,apiFixture:api,userInputs:inputs,document:{getElementById:id=>elements[id]},renderItems(){},showMessage:message=>context.error=message,showToast(){},handleInput:(d,h,i,k,v)=>inputs[d][h][i][k]=v,saveToLocal(){},isFirebaseLoaded:true,db:{},doc:api.doc,runTransaction:api.runTransaction,collection(){},addDoc:async()=>{},getLocalDateString:()=>date,getLocalTimeString:()=>date,activeCategory:hotel,activeItem:item,activeRole:'aunt',calcExpr:''});
 vm.runInContext(fs.readFileSync('sendwash-verification.js','utf8').replace("await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')",'apiFixture'),context);
 await context.window.startSendwashVerification({});await context.window.attachSendwashListener([date]);context.window.prepareSendwashInputs(date,hotel);
 Object.assign(inputs[date][hotel][item],{signature:'receiver-signature',hasSigned:true});
 const sourceCode=fs.readFileSync('index.html','utf8');vm.runInContext(sourceCode.slice(sourceCode.indexOf('        function openCalc('),sourceCode.indexOf('        function addNewItem()')),context);
 vm.runInContext(sourceCode.slice(sourceCode.indexOf('                window.firebaseSubmit = async function('),sourceCode.indexOf('                window.syncSettingsFromSheet =')),context);
 context.setDoc=async(ref,payload)=>{tables[ref.name][ref.id]={...tables[ref.name][ref.id],...payload};};
 const submit=context.window.firebaseSubmit;context.window.firebaseSubmit=(...args)=>(save=submit(...args));
 return{context,elements,tables,inputs,async confirm(){context.calcConfirm();await save;},saved:()=>tables.inventory_records[core.inventoryId(date,hotel,item)]};
}
test('clearing the prefilled quantity and confirming saves a real first-count zero, never blank or hotel quantity',async()=>{
 const f=await fixture();f.context.openCalc(hotel,item,'aunt');assert.equal(f.elements.calcDisplay.innerText,'5');
 f.context.calcClear();assert.equal(f.elements.calcDisplay.innerText,'0');await f.confirm();assert(f.saved(),f.context.error);assert.equal(f.saved().count,'0');assert.equal(f.saved().doubleCount,'');assert.equal(f.saved().signature,'receiver-signature');assert.equal(f.tables.sendwash_records.source.receivedItems[item].aggregateActual,'0');
});
test('typing zero after clear remains zero and survives calculator reload and driver receipt fallback',async()=>{
 const f=await fixture();f.context.openCalc(hotel,item,'aunt');f.context.calcClear();f.context.calcPress('0');await f.confirm();assert.equal(f.saved().count,'0');
 f.context.openCalc(hotel,item,'aunt');assert.equal(f.elements.calcDisplay.innerText,'0');
 const logistics=fs.readFileSync('logistics.html','utf8');vm.runInContext(logistics.slice(logistics.indexOf('        function extractQty(obj)'),logistics.indexOf('        function isValidItemName')),f.context);assert.equal(f.context.extractQty(f.saved()),'0');
});
test('explicit not-received action replaces prefilled quantity with zero; later digit entry still allows 10',async()=>{
 const f=await fixture();f.context.openCalc(hotel,item,'aunt');f.context.calcSetZero();assert.equal(f.elements.calcDisplay.innerText,'0');f.context.calcPress('1');f.context.calcPress('0');assert.equal(f.elements.calcDisplay.innerText,'10');
 f.context.calcSetZero();await f.confirm();assert.equal(f.saved().count,'0');
});
test('blank and backspace-to-empty are visibly different from zero and cannot save accidental zero',async()=>{
 const f=await fixture();f.context.openCalc(hotel,item,'aunt');f.context.calcBackspace();assert.notEqual(f.elements.calcDisplay.innerText,'0');await f.confirm();assert(!f.saved());assert.match(f.context.error,/0/);
});
test('zero second-check signature and receipt quantity do not fall back to nonzero actual count',async()=>{
 const f=await fixture();f.context.openCalc(hotel,item,'aunt');await f.confirm();const u=f.inputs[date][hotel][item];Object.assign(u,{doubleSignature:'supervisor-signature',doubleHasSigned:true});
 f.context.openCalc(hotel,item,'sup');f.context.calcClear();await f.confirm();assert.equal(f.saved().count,'5');assert.equal(f.saved().doubleCount,'0');assert.equal(f.saved().doubleSignature,'supervisor-signature');
 const logistics=fs.readFileSync('logistics.html','utf8');vm.runInContext(logistics.slice(logistics.indexOf('        function extractQty(obj)'),logistics.indexOf('        function isValidItemName')),f.context);assert.equal(f.context.extractQty(f.saved()),'0');
});
test('ordinary manual inventory also saves zero, and subtraction to zero remains a valid count',async()=>{
 const f=await fixture(),u=f.inputs[date][hotel][item];Object.assign(u,{countSource:'',sendwashPending:null});f.context.openCalc(hotel,item,'aunt');f.context.calcSetZero();await f.confirm();assert.equal(f.saved().count,'0');assert.equal(f.saved().doubleCount,'0');
 const g=await fixture();g.context.openCalc(hotel,item,'aunt');g.context.calcClear();for(const key of ['5','-','5'])g.context.calcPress(key);await g.confirm();assert.equal(g.saved().count,'0');
});
