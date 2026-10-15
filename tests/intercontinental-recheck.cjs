const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const date='2026-10-16',hotel='洲際 餐廳';
const settings=['大地','WARA'].map(outlet=>({hotel:'洲際',department:'餐廳',inventoryHotel:hotel,outlet,item:'口布',unit:'條'}));
function fixture(){
 const sources={};for(const [outlet,quantity] of [['大地','18'],['WARA','12']])sources[outlet]={hotel:'洲際',department:'餐廳',inventoryHotel:hotel,outlet,targetDate:date,items:[{item:'口布',quantity,unit:'條'}]};
 const tables={sendwash_records:sources,inventory_records:{},logistics_records:{}},inputs={};let writes=0;
 const api={doc:(_,name,id)=>({name,id}),collection:(_,name)=>({name}),where(){},query:c=>c,onSnapshot:(q,fn)=>{fn({forEach:visit=>Object.entries(tables[q.name]).forEach(([id,data])=>visit({id,data:()=>structuredClone(data)}))});return()=>{};},runTransaction:async(_,fn)=>{const pending=[];let wrote=false;const result=await fn({get:async r=>{assert.equal(wrote,false,'Firestore reads must precede writes');return{exists:()=>!!tables[r.name]?.[r.id],data:()=>structuredClone(tables[r.name]?.[r.id])};},set:(r,d)=>{wrote=true;pending.push([r,d]);},update:(r,d)=>{wrote=true;pending.push([r,d]);}});pending.forEach(([r,d])=>{tables[r.name][r.id]={...tables[r.name][r.id],...d};writes++;});return result;}};
 const elements=new Map();function element(){return{value:'',children:[],dataset:{},classList:{hidden:true,toggle(){},remove(){this.hidden=false;},add(){this.hidden=true;}},replaceChildren(){this.children=[];},append(e){this.children.push(e);},setAttribute(){}};}
 for(const id of ['outletTabs','newItemInput','datePicker','signModal','signModalTitle','signCancelBtn','signConfirmBtn','signUploadStatus','calcModal','calcTitle','calcDisplay'])elements.set(id,element());elements.get('datePicker').value=date;
 const context=vm.createContext({window:{SendwashCore:core},userInputs:inputs,apiFixture:api,renderItems(){},showMessage:message=>context.error=message,showToast(){},document:{getElementById:id=>elements.get(id),createElement:element}});
 vm.runInContext(fs.readFileSync('sendwash-verification.js','utf8').replace("await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')",'apiFixture'),context);
 context.window.setSendwashSettings(settings);
 const setupUI=()=>{
  Object.assign(context,{canvas:{offsetWidth:300,width:300,height:220,toDataURL:()=> 'data:image/jpeg;base64,test'},ctx:{fillRect(){},clearRect(){},getImageData:()=>({data:[0,0,0,255]})},activeCategory:'',activeItem:'',activeRole:'',currentBaseHotel:'洲際',currentHotelName:hotel,masterData:[{hotel,item:'口布'}],isFirebaseLoaded:true,db:{},requestAnimationFrame:fn=>fn(),getLocalTimeString:()=> '2026-10-16 10:00:00',getLocalDateString:()=>date,handleInput:(d,h,item,k,v)=>{inputs[d] ||= {};inputs[d][h] ||= {};inputs[d][h][item] ||= {count:'',doubleCount:''};inputs[d][h][item][k]=v;},saveToLocal(){},doc:api.doc,runTransaction:api.runTransaction,addDoc:async()=>{},collection(){},SendwashCore:core,calcExpr:'',closeSign(){}});
  context.window.uploadSignatureToStorage=async()=> 'uploaded-supervisor';
  const code=fs.readFileSync('index.html','utf8');
  vm.runInContext(code.slice(code.indexOf('        function openSign('),code.indexOf('        function toggleDropdown(')),context);
  vm.runInContext(code.slice(code.indexOf('                window.firebaseSubmit = async function('),code.indexOf('                window.syncSettingsFromSheet =')),context);
 };
 return{tables,inputs,context,elements,api,setupUI,get writes(){return writes;},async start(){await context.window.startSendwashVerification({});await context.window.attachSendwashListener([date]);context.window.prepareSendwashInputs(date,hotel);context.window.filterSendwashOutlets(date,hotel,context.window.sendwashPendingItems(date,hotel));},save(outlet='大地',quantity='17',extra={}){const item=core.outletItem(outlet,'口布'),u=inputs[date][hotel][item];return context.window.persistPendingSendwash(date,hotel,item,{date,hotel,item,count:u.count,doubleCount:quantity,doubleSignature:'supervisor-'+outlet,note:'',...extra},u.sendwashPending,u.sendwashLoadedCount,u.sendwashLoadedDoubleCount);}};
}
test('only InterContinental linen outlets skip first signature; uniforms and other hotels retain it',()=>{
 assert(core.recheckOnly({hotel:'洲際',outlet:'大地',department:'餐廳'}));
 for(const record of [{hotel:'其他飯店',outlet:'大地'},{hotel:'洲際',outlet:''},{hotel:'洲際',outlet:'廚房',department:'制服'}])assert.equal(core.recheckOnly(record),false);
});
test('single recheck saves actual quantity, signature and source acceptance without a fabricated first signature',async()=>{
 const f=fixture();await f.start();const saved=await f.save();
 assert.equal(saved.count,'18');assert.equal(saved.doubleCount,'17');assert.equal(saved.signature,'');assert.equal(saved.doubleSignature,'supervisor-大地');assert.equal(saved.sendwashStage,'ready');
 const source=f.tables.sendwash_records.大地;assert(source.acceptedAt);assert.equal(source.receivedItems.口布.signature,undefined);assert.equal(source.receivedItems.口布.doubleSignature,'supervisor-大地');assert.equal(source.receivedItems.口布.aggregateActual,'17');assert(!f.tables.sendwash_records.WARA.acceptedAt);
 const writes=f.writes;await f.save();assert.equal(f.writes,writes,'retry must be idempotent');
});
test('zero recheck is preserved; missing signatures, blank counts and changed source quantities cause no writes',async()=>{
 for(const extra of [{doubleSignature:''},{doubleSignature:'CACHED'},{doubleCount:''},{count:'99'}]){const f=fixture();await f.start();await assert.rejects(f.save('大地','17',extra));assert.equal(f.writes,0);}
 const f=fixture();await f.start();f.tables.sendwash_records.大地.items[0].quantity='19';await assert.rejects(f.save(),/修改此品項數量/);assert.equal(f.writes,0);
 const g=fixture();await g.start();assert.equal((await g.save('大地','0')).doubleCount,'0');
});
test('saved single recheck can update notes or re-sign without requiring first signature; original declared count stays locked',async()=>{
 const f=fixture();await f.start();const saved=await f.save();
 const patch=core.sendwashInventoryPatch(saved,{count:'18',doubleCount:'16',doubleSignature:'new-supervisor',note:'破損1條'},'18','17');assert.equal(patch.doubleCount,'16');assert.equal(patch.sendwashStage,'ready');
 assert.throws(()=>core.sendwashInventoryPatch(saved,{count:'19',doubleCount:'17'},'18','17'),/鎖定/);
});
test('actual original signature and calculator flow saves directly from supervisor side',async()=>{
 const f=fixture();await f.start();f.setupUI();const item='【大地】口布',c=f.context;
 c.openSign(hotel,item,'sup');assert.equal(c.error,undefined);assert.equal(f.elements.get('signModalTitle').innerText,'複點人員簽名');
 await c.confirmSignature();assert.equal(f.elements.get('calcDisplay').innerText,'18');vm.runInContext("calcExpr='17'",c);c.calcConfirm();
 for(let i=0;i<30&&!f.tables.inventory_records[core.inventoryId(date,hotel,item)];i++)await new Promise(resolve=>setImmediate(resolve));
 const saved=f.tables.inventory_records[core.inventoryId(date,hotel,item)];assert(saved,c.error);assert.equal(saved.doubleSignature,'uploaded-supervisor');assert.equal(saved.signature,'');assert.equal(saved.doubleCount,'17');assert.equal(f.inputs[date][hotel][item].saveError,false);
});
test('actual card renderer shows hotel count and only the supervisor signature action for InterContinental',async()=>{
 const f=fixture();await f.start();f.setupUI();
 f.elements.set('itemsList',{children:[],dataset:{},innerHTML:''});f.elements.set('supplementOutletHint',{classList:{toggle(){}},textContent:''});f.context.window.getSafeId=name=>name;
 const code=fs.readFileSync('index.html','utf8');vm.runInContext(code.slice(code.indexOf('        function renderItems('),code.indexOf('        function handleInput(')),f.context);f.context.renderItems(true);
 const html=f.elements.get('itemsList').innerHTML;assert(html.includes('飯店送洗'));assert(html.includes('複點簽名'));assert(!html.includes('第一步-簽名'));assert(!html.includes('第二步-'));assert(html.includes('>18</div>'));assert(f.elements.get('supplementOutletHint').textContent.includes('大地'));
});
test('bottom add button supplements a missing template item inside current outlet and rejects same-outlet duplicates',async()=>{
 const f=fixture();await f.start();f.setupUI();const c=f.context;
 f.elements.get('newItemInput').value='口布';c.addNewItem();assert.match(c.error,/已在列表/);
 f.elements.get('newItemInput').value='桌裙';c.addNewItem();const u=f.inputs[date][hotel]['【大地】桌裙'];assert(u);assert.equal(u.outlet,'大地');assert.equal(u.sourceItem,'桌裙');assert.equal(u.count,'');assert.equal(u.sendwashSupplemental,true);
 f.elements.get('outletTabs').children[1].onclick();c.window.filterSendwashOutlets(date,hotel,Object.keys(f.inputs[date][hotel]));f.elements.get('newItemInput').value='桌裙';c.addNewItem();assert(f.inputs[date][hotel]['【WARA】桌裙']);assert(!f.inputs[date][hotel].桌裙);
 // A template item absent from this driver's submission can also be supplemented.
 c.masterData.push({hotel,item:'檯布'});f.elements.get('newItemInput').value='檯布';c.addNewItem();assert(f.inputs[date][hotel]['【WARA】檯布']);
});
test('supplement saves with only recheck signature, survives transaction retry, and aggregates under original item name',async()=>{
 const f=fixture();await f.start();f.setupUI();f.elements.get('newItemInput').value='桌裙';f.context.addNewItem();
 const item='【大地】桌裙',u=f.inputs[date][hotel][item];Object.assign(u,{doubleCount:'3',doubleSignature:'supplement-signature'});
 await f.context.window.firebaseSubmit(hotel,item);const saved=f.tables.inventory_records[core.inventoryId(date,hotel,item)];assert(saved,f.context.error);assert.equal(saved.count,'');assert.equal(saved.doubleCount,'3');assert.equal(saved.sourceItem,'桌裙');assert.equal(saved.outlet,'大地');assert.equal(saved.sendwashStage,'ready');assert(!saved.signature);
 const sources=JSON.stringify(f.tables.sendwash_records);await f.context.window.firebaseSubmit(hotel,item);assert.equal(JSON.stringify(f.tables.sendwash_records),sources);assert.equal(Object.keys(f.tables.inventory_records).length,1);
 const {addInventoryQuantity}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('logistics-items.js','utf8')));const totals={},keys=new Set();addInventoryQuantity(totals,keys,'餐廳_桌裙',{originalQty:saved.doubleCount},saved.outlet);addInventoryQuantity(totals,keys,'餐廳_桌裙',{originalQty:'2'},'WARA');assert.equal(totals['餐廳_桌裙'].originalQty,'5');
});
test('signed driver receipt, duplicate inventory sources and stale values protect supplemental writes atomically',async()=>{
 for(const scenario of ['signed','source','stale']){
  const f=fixture();await f.start();f.setupUI();f.elements.get('newItemInput').value='桌裙';f.context.addNewItem();const item='【大地】桌裙';
  if(scenario==='signed')f.tables.logistics_records[`${date}_洲際_餐廳`]={clientSig:'signed'};
  else f.tables.inventory_records[core.inventoryId(date,hotel,item)]={date,hotel,item,countSource:'sendwash',baseHotel:'洲際',outlet:'大地',sendwashSupplemental:scenario==='stale',count:'',doubleCount:'4',doubleSignature:'someone-else'};
  await assert.rejects(f.context.window.persistSupplementalSendwash(date,hotel,item,{date,hotel,item,count:'',doubleCount:'3',doubleSignature:'sup'},'',''));assert.equal(f.writes,0);
 }
});
