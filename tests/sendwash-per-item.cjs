const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
function fixture(){
 const source={targetDate:'2026-10-13',inventoryHotel:'hotel',sourceDate:'2026-10-12',items:[{item:'廚衣',quantity:'1',unit:'件'},{item:'圍裙',quantity:'1',unit:'件'}],revision:1};
 const tables={sendwash_records:{source},inventory_records:{}};const inputs={};let writes=0;
 const api={doc:(_,name,id)=>({name,id}),collection:(_,name)=>({name}),where(){},query:c=>c,onSnapshot:(q,fn)=>{fn({forEach:visit=>Object.entries(tables[q.name]).forEach(([id,data])=>visit({id,data:()=>structuredClone(data)}))});return()=>{};},runTransaction:async(_,fn)=>{const pending=[];const result=await fn({get:async ref=>({exists:()=>!!tables[ref.name]?.[ref.id],data:()=>structuredClone(tables[ref.name]?.[ref.id])}),set:(ref,data)=>pending.push([ref,data]),update:(ref,data)=>pending.push([ref,data])});pending.forEach(([r,d])=>{tables[r.name] ||= {};tables[r.name][r.id]={...tables[r.name][r.id],...d};writes++;});return result;}};
 const context=vm.createContext({window:{SendwashCore:core},userInputs:inputs,apiFixture:api,renderItems(){},showMessage:msg=>context.error=msg,showToast(){}});
 vm.runInContext(fs.readFileSync('sendwash-verification.js','utf8').replace("await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')",'apiFixture'),context);
 return{context,tables,inputs,api,get writes(){return writes},async start(){await context.window.startSendwashVerification({});await context.window.attachSendwashListener(['2026-10-13']);context.window.prepareSendwashInputs('2026-10-13','hotel');},async save(item='廚衣',qty='1'){const u=inputs['2026-10-13'].hotel[item];return context.window.persistPendingSendwash('2026-10-13','hotel',item,{date:'2026-10-13',hotel:'hotel',item,count:qty,doubleCount:'',signature:'signature-'+item,note:u.note||''},u.sendwashPending,u.sendwashLoadedCount,u.sendwashLoadedDoubleCount);}};
}
test('pending quantities are supplied to ordinary cards, no alternate bulk signature UI exists',async()=>{
 const f=fixture();await f.start();assert.equal(f.inputs['2026-10-13'].hotel.廚衣.count,'1');assert.equal(f.inputs['2026-10-13'].hotel.廚衣.signature,undefined);assert.equal(f.context.window.sendwashCard(),null);assert(!fs.readFileSync('sendwash-verification.js','utf8').includes('sendwashVerify'));
});
test('one item saves its own signature/quantity while other items remain pending',async()=>{
 const f=fixture();await f.start();await f.save('廚衣','2');const saved=f.tables.inventory_records['2026-10-13_hotel_廚衣'];assert.equal(saved.count,'2');assert.equal(saved.signature,'signature-廚衣');assert.equal(saved.doubleSignature,'');assert.equal(saved.doubleCount,'');assert.equal(Object.keys(f.tables.inventory_records).length,1);assert(f.tables.sendwash_records.source.receivedItems.廚衣);assert(!f.tables.sendwash_records.source.receivedItems.圍裙);assert(!f.tables.sendwash_records.source.acceptedAt);
 await f.save('圍裙','1');assert(f.tables.sendwash_records.source.acceptedAt);assert.equal(f.tables.inventory_records['2026-10-13_hotel_圍裙'].signature,'signature-圍裙');
});
test('field key ordering, unrelated item changes and source revision do not falsely block selected item',async()=>{
 const f=fixture();await f.start();f.tables.sendwash_records.source.items=[{unit:'件',quantity:'1',item:'廚衣'},{quantity:'3',item:'圍裙',unit:'件'}];f.tables.sendwash_records.source.revision=2;await f.save();assert.equal(f.tables.inventory_records['2026-10-13_hotel_廚衣'].count,'1');
});
test('actual selected quantity change is rejected atomically instead of silently overwriting',async()=>{
 const f=fixture();await f.start();f.tables.sendwash_records.source.items[0].quantity='9';await assert.rejects(f.save(),/此品項數量/);assert.equal(f.writes,0);assert.equal(Object.keys(f.tables.inventory_records).length,0);
});
test('retrying same item save is idempotent; ordinary manual/supervisor-signed data stay protected',async()=>{
 const f=fixture();await f.start();await f.save();const count=f.writes;await f.save();assert.equal(f.writes,count);
 for(const old of [{date:'2026-10-13',hotel:'hotel',item:'廚衣',count:'5',signature:'existing'},{date:'2026-10-13',hotel:'hotel',item:'廚衣',count:'1',doubleSignature:'sup'}]){const g=fixture();await g.start();g.tables.inventory_records['2026-10-13_hotel_廚衣']=old;await assert.rejects(g.save());assert.equal(g.writes,0);assert.equal(g.tables.inventory_records['2026-10-13_hotel_廚衣'].count,old.count);}
});
test('cached first signature and stale pending flag allow independent supervisor save without rewriting sources',async()=>{
 const f=fixture();await f.start();await f.save('廚衣','22');const u=f.inputs['2026-10-13'].hotel.廚衣;
 const sourceBefore=structuredClone(f.tables.sendwash_records.source),writes=f.writes;
 const saved=await f.context.window.persistPendingSendwash('2026-10-13','hotel','廚衣',{date:'2026-10-13',hotel:'hotel',item:'廚衣',count:'22',doubleCount:'21',doubleSignature:'supervisor',note:''},u.sendwashPending,u.sendwashLoadedCount,u.sendwashLoadedDoubleCount);
 assert.equal(saved.signature,'signature-廚衣');assert.equal(saved.doubleSignature,'supervisor');assert.equal(saved.doubleCount,'21');assert.equal(saved.sendwashStage,'ready');assert.equal(f.writes,writes+1);assert.equal(JSON.stringify(f.tables.sendwash_records.source),JSON.stringify(sourceBefore));
 // Retrying again with both signature URLs omitted retains the database signatures.
 const again=await f.context.window.persistPendingSendwash('2026-10-13','hotel','廚衣',{date:'2026-10-13',hotel:'hotel',item:'廚衣',count:'22',doubleCount:'21',note:''},u.sendwashPending,'','');assert.equal(again.doubleSignature,'supervisor');assert.equal(f.writes,writes+1);
});
test('pending source cannot replace a signed inventory quantity or signatures during rendering',async()=>{
 const f=fixture();await f.start();const old={countSource:'sendwash',count:'22',doubleCount:'22',signature:'CACHED',doubleSignature:'CACHED',isSubmitted:true};f.inputs['2026-10-13'].hotel.廚衣=old;f.context.window.prepareSendwashInputs('2026-10-13','hotel');assert.equal(f.inputs['2026-10-13'].hotel.廚衣,old);assert.equal(old.sendwashPending,undefined);
});
test('cached placeholder alone cannot authorize a new receipt',async()=>{
 const f=fixture();await f.start();const u=f.inputs['2026-10-13'].hotel.廚衣;await assert.rejects(f.context.window.persistPendingSendwash('2026-10-13','hotel','廚衣',{count:'1',doubleCount:'',note:''},u.sendwashPending,'',''),/簽名尚未成功儲存/);assert.equal(f.writes,0);
});
test('note before signature saves without inventory write, and survives individual item save',async()=>{
 const f=fixture();await f.start();await f.context.window.savePendingSendwashNote('2026-10-13','hotel','廚衣','破損');assert.equal(Object.keys(f.tables.inventory_records).length,0);f.inputs['2026-10-13'].hotel.廚衣.note='破損';await f.save();assert.equal(f.tables.inventory_records['2026-10-13_hotel_廚衣'].note,'破損');
});
test('actual original openSign, confirmSignature, calculator and firebaseSubmit save pending item',async()=>{
 const f=fixture();await f.start();const code=fs.readFileSync('index.html','utf8'),ctx=f.context;
 const el={};for(const id of ['datePicker','signModal','signModalTitle','signCancelBtn','signConfirmBtn','signUploadStatus','calcModal','calcTitle','calcDisplay'])el[id]={value:'2026-10-13',offsetWidth:300,classList:{hidden:true,remove(){this.hidden=false},add(){this.hidden=true}}};
 Object.assign(ctx,{document:{getElementById:id=>el[id]},canvas:{offsetWidth:300,width:300,height:220,toDataURL:()=> 'data:image/jpeg;base64,test'},ctx:{fillRect(){},clearRect(){},getImageData:()=>({data:[0,0,0,255]})},activeCategory:'',activeItem:'',activeRole:'',currentBaseHotel:'hotel',isFirebaseLoaded:true,db:{},requestAnimationFrame:fn=>fn(),getLocalTimeString:()=> '2026-10-12 22:50:00',getLocalDateString:()=> '2026-10-12',handleInput:(date,hotel,item,key,value)=>f.inputs[date][hotel][item][key]=value,saveToLocal(){},doc:f.api.doc,runTransaction:f.api.runTransaction,addDoc:async()=>{},collection(){},SendwashCore:core,calcExpr:''});
 ctx.window.uploadSignatureToStorage=async()=> 'uploaded-signature';
 const begin=code.indexOf('        function openSign('),end=code.indexOf('        function addNewItem()',begin);vm.runInContext(code.slice(begin,end),ctx);
 const start=code.indexOf('                window.firebaseSubmit = async function('),finish=code.indexOf('                window.syncSettingsFromSheet =',start);vm.runInContext(code.slice(start,finish),ctx);
 ctx.openSign('hotel','廚衣','aunt');assert.equal(el.signModal.classList.hidden,false);assert.equal(el.signModalTitle.innerText,'第一步：現場人員簽名解鎖');
 // closeSign is part of the original UI; only DOM cleanup is stubbed here.
 ctx.closeSign=()=>{};await ctx.confirmSignature();assert.equal(el.calcDisplay.innerText,'1');vm.runInContext("calcExpr='2'",ctx);ctx.calcConfirm();for(let i=0;i<20&&!f.tables.inventory_records['2026-10-13_hotel_廚衣'];i++)await new Promise(resolve=>setImmediate(resolve));
 const saved=f.tables.inventory_records['2026-10-13_hotel_廚衣'];assert(saved,ctx.error);assert.equal(saved.count,'2');assert.equal(saved.signature,'uploaded-signature');assert.equal(saved.doubleCount,'');assert.equal(Object.keys(f.tables.inventory_records).length,1);
});

test('actual red-button retry with CACHED signatures saves supervisor quantity',async()=>{
 const f=fixture();await f.start();await f.save('廚衣','22');const ctx=f.context,u=f.inputs['2026-10-13'].hotel.廚衣;Object.assign(u,{count:'22',doubleCount:'21',signature:'CACHED',doubleSignature:'supervisor',doubleHasSigned:true,saveError:true});
 Object.assign(ctx,{document:{getElementById:()=>({value:'2026-10-13'})},isFirebaseLoaded:true,db:{},handleInput:(date,hotel,item,key,value)=>f.inputs[date][hotel][item][key]=value,saveToLocal(){},doc:f.api.doc,runTransaction:f.api.runTransaction,addDoc:async()=>{},collection(){},getLocalDateString:()=> '2026-10-12',getLocalTimeString:()=> '2026-10-12 23:00:00',SendwashCore:core});
 const code=fs.readFileSync('index.html','utf8'),start=code.indexOf('                window.firebaseSubmit = async function('),end=code.indexOf('                window.syncSettingsFromSheet =',start);vm.runInContext(code.slice(start,end),ctx);await ctx.window.firebaseSubmit('hotel','廚衣');
 const saved=f.tables.inventory_records['2026-10-13_hotel_廚衣'];assert.equal(saved.count,'22');assert.equal(saved.doubleCount,'21');assert.equal(saved.signature,'signature-廚衣');assert.equal(saved.doubleSignature,'supervisor');assert.equal(u.saveError,false);assert.equal(u.sendwashPending,null);assert.equal(u.doubleHasSigned,false);assert.equal(ctx.error,undefined);
});
