const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const received={countSource:'sendwash',count:'98',doubleCount:'',signature:'receiver-signature',doubleSignature:'',sendwashStage:'received'};
test('receiving leaves outbound empty, supervisor later supplies independent number and signature',()=>{
 const note=core.sendwashInventoryPatch(received,{count:'98',doubleCount:'',note:'髒布品少2件'},'98','');assert.equal(note.sendwashStage,'received');assert.equal(note.doubleCount,'');assert.equal(note.doubleSignature,undefined);
 const ready=core.sendwashInventoryPatch(received,{count:'98',doubleCount:'97',doubleSignature:'supervisor-signature'},'98','');assert.equal(ready.sendwashStage,'ready');assert.equal(ready.count,'98');assert.equal(ready.doubleCount,'97');assert.notEqual(ready.doubleSignature,received.signature);
});
test('reception can be corrected before outbound signing, but outbound-signed first count and signature are locked',()=>{
 assert.equal(core.sendwashInventoryPatch(received,{count:'96',doubleCount:'',signature:'receiver-new'},'98','').count,'96');
 const latest={...received,doubleCount:'97',doubleSignature:'supervisor'};
 assert.throws(()=>core.sendwashInventoryPatch(latest,{count:'96',doubleCount:'97'},'98','97'),/鎖定/);
 assert.throws(()=>core.sendwashInventoryPatch(latest,{count:'98',doubleCount:'97',signature:'someone-new'},'98','97'),/鎖定/);
});
test('stale values and incomplete signatures cannot save outbound completion',()=>{
 assert.throws(()=>core.sendwashInventoryPatch({...received,count:'99'},{count:'98',doubleCount:''},'98',''),/更新/);
 assert.throws(()=>core.sendwashInventoryPatch(received,{count:'98',doubleCount:'97'},'98',''),/複點簽名/);
 assert.throws(()=>core.sendwashInventoryPatch(received,{count:'98',doubleCount:'',doubleSignature:'sup'},'98',''),/複點數量/);
 assert.throws(()=>core.sendwashInventoryPatch({...received,signature:''},{count:'98',doubleCount:''},'98',''),/現場簽名/);
});
test('logistics never treats received dirty count as outbound; original non-sendwash records stay compatible',()=>{
 const source=fs.readFileSync('logistics.html','utf8');const code=source.slice(source.indexOf('        function extractQty(obj)'),source.indexOf('        function isValidItemName'));
 const ctx=vm.createContext({});vm.runInContext(code,ctx);
 assert.equal(ctx.extractQty(received),'0');assert.equal(ctx.extractQty({...received,doubleCount:'98'}),'0');assert.equal(ctx.extractQty({...received,doubleSignature:'sup'}),'0');assert.equal(ctx.extractQty({...received,doubleSignature:'sup',doubleCount:'97'}),'97');assert.equal(ctx.extractQty({...received,doubleSignature:'sup',doubleCount:'0'}),'0');assert.equal(ctx.extractQty({count:'98'}),'98');
});
test('original calculator prefills second check from first actual but does not auto-save second count',()=>{
 const source=fs.readFileSync('index.html','utf8');
 const elements={datePicker:{value:'2026-10-13'},calcTitle:{},calcDisplay:{},calcModal:{classList:{remove(){},add(){}}}};
 const inputs={'2026-10-13':{hotel:{浴巾:{...received}}}};
 const ctx=vm.createContext({document:{getElementById:id=>elements[id]},userInputs:inputs,handleInput:(date,hotel,item,k,v)=>inputs[date][hotel][item][k]=v,renderItems(){},window:{firebaseSubmit(){}},activeCategory:'hotel',activeItem:'浴巾',activeRole:'aunt',calcExpr:'96'});
 const a=source.slice(source.indexOf('        function openCalc('),source.indexOf('        function addNewItem()'));
 vm.runInContext(a,ctx);ctx.openCalc('hotel','浴巾','sup');assert.equal(elements.calcDisplay.innerText,'98');assert.equal(inputs['2026-10-13'].hotel.浴巾.doubleCount,'');
 vm.runInContext("activeRole='aunt';calcExpr='96'",ctx);ctx.calcConfirm();assert.equal(inputs['2026-10-13'].hotel.浴巾.count,'96');assert.equal(inputs['2026-10-13'].hotel.浴巾.doubleCount,'');
});
test('actual inventory save transaction persists supervisor completion with a separate signature',async()=>{
 const source=fs.readFileSync('index.html','utf8');const start=source.indexOf('                window.firebaseSubmit = async function('),end=source.indexOf('                window.syncSettingsFromSheet =',start);
 const stored={...received,date:'2026-10-13',hotel:'hotel',item:'浴巾'};
 const input={...received,doubleCount:'97',doubleSignature:'supervisor-signature',doubleSignDate:'2026-10-13 10:00:00',sendwashLoadedCount:'98',sendwashLoadedDoubleCount:'',note:''};
 const inputs={'2026-10-13':{hotel:{浴巾:input}}};
 const ctx=vm.createContext({window:{},isFirebaseLoaded:true,db:{},SendwashCore:core,userInputs:inputs,document:{getElementById:()=>({value:'2026-10-13'})},doc:(_,collection,id)=>({collection,id}),runTransaction:async(_,fn)=>{const pending=[];await fn({get:async()=>({exists:()=>true,data:()=>({...stored})}),set:(ref,p)=>pending.push(p)});pending.forEach(p=>Object.assign(stored,p));},setDoc:async()=>{throw Error('must use transaction for sendwash')},handleInput:(date,hotel,item,k,v)=>inputs[date][hotel][item][k]=v,renderItems(){},saveToLocal(){},collection(){},addDoc:async()=>{},getLocalDateString:()=> '2026-10-13',getLocalTimeString:()=> '2026-10-13 10:00:00',showMessage:message=>ctx.error=message});
 vm.runInContext(source.slice(start,end),ctx);await ctx.window.firebaseSubmit('hotel','浴巾');assert(!ctx.error,ctx.error);assert.equal(stored.count,'98');assert.equal(stored.doubleCount,'97');assert.equal(stored.signature,'receiver-signature');assert.equal(stored.doubleSignature,'supervisor-signature');assert.equal(stored.sendwashStage,'ready');
 input.count='96';input.signature='new-receiver';await ctx.window.firebaseSubmit('hotel','浴巾');assert(ctx.error.includes('鎖定'));assert.equal(stored.count,'98');assert.equal(stored.signature,'receiver-signature');
});
