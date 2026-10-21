const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const save=require('../inventory-save.js'),html=fs.readFileSync('index.html','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let sequence=0;
function fixture({write=async()=>{},log=async()=>{}}={}){
 const date='2026-10-21',hotel='連線測試'+ ++sequence,item='浴巾',input={count:'0',doubleCount:'',signature:'data:image/jpeg;base64,'+'a'.repeat(120),hasSigned:true,note:'保留備註'},inputs={[date]:{[hotel]:{[item]:input}}};
 const saver={...save,withTimeout:(promise,ms,message)=>save.withTimeout(promise,ms===25000?12:ms===10000?4:8,message)};
 const elements={datePicker:{value:date}};let writes=0,logs=0;
 const c=vm.createContext({window:{InventorySave:saver},userInputs:inputs,isFirebaseLoaded:true,db:{},document:{getElementById:id=>elements[id]},handleInput:(d,h,i,k,v)=>inputs[d][h][i][k]=v,renderItems(){},saveToLocal(){c.cached=save.cacheItem(input);},showMessage:message=>c.message=message,doc:()=>({}),setDoc:async(_,payload)=>{writes++;c.payload=payload;await write(payload);},collection:()=>({}),addDoc:()=>{logs++;return log();},getLocalDateString:()=>date,getLocalTimeString:()=>date,console});
 const begin=html.indexOf('                window.firebaseSubmit = async function('),end=html.indexOf('                window.syncSettingsFromSheet =',begin);vm.runInContext(html.slice(begin,end),c);
 return{c,input,inputs,date,hotel,item,elements,saver,get writes(){return writes;},get logs(){return logs;},submit:()=>c.window.firebaseSubmit(hotel,item)};
}
test('write timeout ends the spinner, preserves zero and signature, and retry shares the pending write until a real acknowledgement',async()=>{
 let acknowledge;const f=fixture({write:()=>new Promise(resolve=>acknowledge=resolve)});await f.submit();
 assert.equal(f.input.isSaving,false);assert.equal(f.input.saveError,true);assert.equal(f.input.isSubmitted,false);assert.equal(f.input.count,'0');assert.equal(f.c.cached.signature,f.input.signature);assert.match(f.c.message,/尚未收到雲端確認/);assert.equal(f.writes,1);
 const retry=f.submit();await tick();assert.equal(f.writes,1);acknowledge();await retry;await tick();assert.equal(f.input.isSaving,false);assert.equal(f.input.saveError,false);assert.equal(f.input.isSubmitted,true);assert.equal(f.logs,1);assert.equal(f.saver.pending(f.saver.key(f.date,f.hotel,f.item)),false);
});
test('a write acknowledged after the UI timed out still marks the unchanged card as saved without a second submission',async()=>{
 let acknowledge;const f=fixture({write:()=>new Promise(resolve=>acknowledge=resolve)});await f.submit();assert.equal(f.input.saveError,true);acknowledge();await tick();await tick();assert.equal(f.input.saveError,false);assert.equal(f.input.isSubmitted,true);
});
test('a delayed acknowledgement cannot claim a newer local edit was saved',async()=>{
 let acknowledge;const f=fixture({write:()=>new Promise(resolve=>acknowledge=resolve)});await f.submit();f.input.note='之後修改';acknowledge();await tick();await tick();assert.equal(f.input.note,'之後修改');assert.equal(f.input.saveError,true);assert.equal(f.input.isSubmitted,false);
});
test('a hung or synchronously rejected history log never blocks confirmed quantities',async()=>{
 for(const log of [()=>new Promise(()=>{}),()=>{throw new Error('log unavailable');}]){const f=fixture({log});await f.submit();assert.equal(f.input.isSubmitted,true);assert.equal(f.input.isSaving,false);assert.equal(f.input.saveError,false);}
});
test('a rejected inventory write preserves the local signature and the next retry succeeds',async()=>{
 let fail=true;const f=fixture({write:async()=>{if(fail)throw new Error('offline');}});await f.submit();assert.equal(f.input.saveError,true);assert.equal(f.c.cached.signature,f.input.signature);fail=false;await f.submit();assert.equal(f.input.isSubmitted,true);assert.equal(f.writes,2);
});
test('a hanging signature upload falls back to the original signature image and saves with the quantity',async()=>{
 const f=fixture();for(const id of ['signModal','signModalTitle','signCancelBtn','signConfirmBtn','signUploadStatus','calcModal','calcTitle','calcDisplay'])f.elements[id]={classList:{add(){},remove(){}},offsetWidth:300};
 const image='data:image/jpeg;base64,'+'b'.repeat(120);
 Object.assign(f.c,{canvas:{isLocked:false,width:300,height:220,toDataURL:()=>image},ctx:{getImageData:()=>({data:[0,0,0,255]})},activeCategory:f.hotel,activeItem:f.item,activeRole:'aunt',currentBaseHotel:f.hotel,closeSign(){}});
 const start=html.indexOf('        async function confirmSignature()'),end=html.indexOf('        function openCalc(',start);vm.runInContext(html.slice(start,end),f.c);f.c.openCalc=()=>{};f.c.window.uploadSignatureToStorage=()=>new Promise(()=>{});
 await f.c.confirmSignature();await f.submit();assert.equal(f.c.payload.signature,image);assert.equal(f.c.payload.count,'0');assert.equal(f.input.isSubmitted,true);assert.equal(f.input.saveError,false);
});
test('cached pending saves recover to retryable state and retain full signatures; only confirmed signatures become placeholders',()=>{
 const image='data:image/jpeg;base64,'+'c'.repeat(130),pending={count:'0',signature:image,isSaving:true,isSubmitted:true};
 const cached=save.cacheItem(pending);assert.equal(cached.isSaving,false);assert.equal(cached.saveError,true);assert.equal(cached.isSubmitted,false);assert.equal(cached.signature,image);assert.equal(pending.isSaving,true);
 const restored=save.recover({date:{hotel:{item:{...pending}}}}).date.hotel.item;assert.equal(restored.isSaving,false);assert.equal(restored.saveError,true);assert.equal(restored.count,'0');assert.equal(restored.signature,image);
 assert.equal(save.cacheItem({signature:image,isSubmitted:true}).signature,'CACHED');assert.equal(save.cacheItem({signature:image,isSubmitted:true,saveError:true}).signature,image);
});

test('an old cache that already lost an unsubmitted signature must re-sign, never silently save unsigned quantities',async()=>{
 const f=fixture();f.input.signature='CACHED';await f.submit();assert.equal(f.writes,0);assert.equal(f.input.saveError,true);assert.equal(f.input.count,'0');assert.match(f.c.message,/重新簽署/);
});
