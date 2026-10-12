const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const schedules=[{hotel:'驛館',department:'房務',days:[2,4,6,0],rule:'收件後的下一個收送日'}];
const template=[{baseName:'驛館',deptName:'房務',hotel:'驛館',item:'浴巾'},{baseName:'驛館',deptName:'房務',hotel:'驛館',item:'中毛'}];
test('next delivery day, never same day; month/year/leap-day rollover',()=>{
 assert.equal(core.targetDate('驛館','房務','2026-10-06',schedules),'2026-10-08');
 assert.equal(core.targetDate('驛館','房務','2026-09-30',schedules),'2026-10-01');
 assert.equal(core.targetDate('驛館','房務','2026-12-31',schedules),'2027-01-02');
 assert.equal(core.targetDate('普通飯店','房務','2028-02-28',[]),'2028-02-29');
 assert.throws(()=>core.targetDate('驛館','房務','2026-02-30',schedules));
});
test('same hotel departments resolve independently; normalization is existing behavior',()=>{
 const rules=[...schedules,{hotel:'驛館',department:'制服',days:[1],rule:'收件後的下一個收送日'}];
 assert.equal(core.targetDate(' 驛 館','房務部','2026-10-06',rules),'2026-10-08');
 assert.equal(core.targetDate('驛館','制服','2026-10-06',rules),'2026-10-12');
 assert.throws(()=>core.targetDate('驛館','房務','2026-10-06',[...schedules,...schedules]));
 assert.throws(()=>core.targetDate('驛館','房務','2026-10-06',[{...schedules[0],days:[]}]))
});
test('new date resolver agrees with current index resolver across every day for a year',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const functions=html.slice(html.indexOf('        function normalizeScheduleName'),html.indexOf('        function renderHome'));
 const ctx=vm.createContext({deliverySchedules:schedules,todayHotels:['歐遊','H2O','花季Ａ館','花季Ｃ館','花季','文七','好六','媚力泊'],yesterdayHotels:['捷中正'],getLocalDateString:d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().split('T')[0]});
 vm.runInContext(functions,ctx);
 for(let day=0;day<366;day++){const d=new Date(2026,0,1+day,12),value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;for(const hotel of ['驛館','H2O','花季Ａ館','捷中正','普通飯店'])assert.equal(core.targetDate(hotel,'房務',value,schedules),ctx.getTargetDateStr(hotel,value,'房務'));}
});
test('zero is a quantity; blank, negative, decimal, expression and unsafe numbers are rejected',()=>{
 assert.equal(core.quantity('0'),'0');assert.equal(core.quantity('00100'),'100');
 for(const v of ['',null,undefined,'-1','1.5','1+2','Infinity','9007199254740992'])assert.throws(()=>core.quantity(v));
});
test('settings match hotel AND department AND existing item, default blank stays blank',()=>{
 const rows=[{hotel:'驛館',department:'房務部',item:'浴巾',unit:'條',order:1,defaultQuantity:''}];
 assert.equal(core.settings(rows,template)[0].inventoryHotel,'驛館');assert.equal(core.settings(rows,template)[0].defaultQuantity,'');
 assert.throws(()=>core.settings([...rows,...rows],template));assert.throws(()=>core.settings([{...rows[0],department:'制服'}],template));assert.throws(()=>core.settings([{...rows[0],item:'不存在'}],template));
});
test('verification is idempotent, aggregates separate sources and keeps declared versus actual',()=>{
 const one=core.mergeVerification({},'source1','100','98');assert.equal(one.count,'100');assert.equal(one.doubleCount,'98');
 assert.deepEqual(core.mergeVerification(one,'source1','100','98'),one);
 const two=core.mergeVerification(one,'source2','20','0');assert.equal(two.count,'120');assert.equal(two.doubleCount,'98');assert.equal(Object.keys(two.sendwashSources).length,2);
});
test('refuse to overwrite manual counts or signatures including a manual zero',()=>{
 for(const old of [{count:'0'},{count:'10'},{doubleCount:'8'},{signature:'signed'},{doubleSignature:'signed'}])assert.throws(()=>core.mergeVerification(old,'source','100','98'));
 assert.equal(core.mergeVerification({count:'',doubleCount:''},'source','0','0').count,'0');
});
test('shared daily source identity deduplicates driver/hotel, safely handles slash',()=>{
 assert.equal(core.submissionId('A/B','房務','2026-10-01'),core.submissionId('A/B','房務','2026-10-01'));
 assert(!core.submissionId('A/B','房務','2026-10-01').includes('/'));
 assert.notEqual(core.submissionId('A','房務','2026-10-01'),core.submissionId('A','制服','2026-10-01'));
});
test('Apps Script reader uses named headers, ignores disabled rows and fails closed on invalid enable flag',()=>{
 const source=fs.readFileSync('docs/sendwash-settings.gs','utf8'),ctx=vm.createContext({});vm.runInContext(source,ctx);
 const header=['飯店','部門','品項','預設數量','單位','排列順序','是否啟用'];
 const spreadsheet=rows=>({getSheetByName:()=>({getLastRow:()=>rows.length,getDataRange:()=>({getDisplayValues:()=>rows})})});
 const rows=[header,['驛館','房務','浴巾','','條','1','是'],['驛館','房務','中毛','0','條','2','否']];
 assert.equal(ctx.readSendwashSettings(spreadsheet(rows)).length,1);
 assert.throws(()=>ctx.readSendwashSettings(spreadsheet([header,['驛館','房務','浴巾','','條','1','maybe']])));
 assert.deepEqual(Array.from(ctx.readSendwashSettings({getSheetByName:()=>null})),[]);
});

// Exercise the actual verification module with an isolated DOM and atomic DB fixture.
// No live Firebase requests, signatures or hotel records are involved.
function verificationFixture(source, inventory={}) {
 const elements=new Map(),events={};
 const element=(tag='div')=>({tagName:tag.toUpperCase(),dataset:{},className:'',value:'',isConnected:true,children:[],append(child){this.children.push(child);if(child.id)elements.set(child.id,child);},querySelectorAll(){return [...elements.values()].filter(el=>['INPUT','BUTTON'].includes(el.tagName));},remove(){this.isConnected=false;elements.delete(this.id);},getBoundingClientRect(){return{left:0,top:0,width:400,height:200}},setPointerCapture(){},getContext(){return{fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}},toDataURL(){return 'data:image/jpeg;base64,offline-fixture';},set innerHTML(value){this.html=value;for(const match of value.matchAll(/<(\w+)\b[^>]*id="([^"]+)"[^>]*>/g)){const el=element(match[1]);el.id=match[2];elements.set(el.id,el);}},get innerHTML(){return this.html || '';}});
 const body=element();
 const document={createElement:element,body,getElementById:id=>elements.get(id),addEventListener:(name,fn)=>events[name]=fn};
 const picker=element('input');picker.id='datePicker';picker.value=source.targetDate;elements.set(picker.id,picker);
 const tables={sendwash_records:{[source.id]:structuredClone(source)},inventory_records:structuredClone(inventory)};
 const snapshot=ref=>({exists:()=>!!tables[ref.name]?.[ref.id],data:()=>structuredClone(tables[ref.name]?.[ref.id])});
 let wrote=0;
 const api={doc:(_,name,id)=>({name,id}),collection:(_,name)=>({name}),where:(...args)=>args,query:col=>col,getDocFromServer:async ref=>snapshot(ref),onSnapshot:(q,fn)=>{fn({forEach:visit=>Object.entries(tables[q.name]||{}).forEach(([id,data])=>visit({id,data:()=>structuredClone(data)}))});return()=>{};},runTransaction:async(_,fn)=>{const updates=[];await fn({get:async ref=>snapshot(ref),set:(ref,value)=>updates.push([ref,value]),update:(ref,value)=>updates.push([ref,value])});for(const [ref,value]of updates){tables[ref.name] ||= {};tables[ref.name][ref.id]={...tables[ref.name][ref.id],...value};wrote++;}}};
 const ctx=vm.createContext({window:{SendwashCore:core,getSafeId:s=>s},document,currentHotelName:source.inventoryHotel,renderItems(){},getLocalTimeString:()=> '2026-10-01 08:00:00',showMessage:msg=>ctx.message=msg,showToast:msg=>ctx.toast=msg,apiFixture:api,console});
 const script=fs.readFileSync('sendwash-verification.js','utf8').replace("await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')",'apiFixture');
 vm.runInContext(script,ctx);
 return {ctx,tables,elements,events,get wrote(){return wrote},async open(){await ctx.window.startSendwashVerification({});await ctx.window.attachSendwashListener([source.targetDate]);events.click({target:{closest:()=>({dataset:{sendwashId:source.id}})}});for(let i=0;i<10&&!elements.has('sendwashVerifyForm');i++)await new Promise(resolve=>setImmediate(resolve));assert(elements.has('sendwashVerifyForm'),ctx.message);const canvas=elements.get('sendwashSign');canvas.onpointerdown({preventDefault(){},pointerId:1,clientX:10,clientY:10});canvas.onpointermove({preventDefault(){},clientX:30,clientY:30});canvas.onpointerup();},async submit(){await elements.get('sendwashVerifyForm').onsubmit({preventDefault(){}});}};
}
const incoming=()=>({id:'source',hotel:'驛館',department:'房務',inventoryHotel:'驛館',sourceDate:'2026-09-30',targetDate:'2026-10-01',revision:1,items:[{item:'浴巾',quantity:'100',unit:'條'},{item:'中毛',quantity:'0',unit:'條'}]});
test('real plant flow atomically writes declared/actual/signature into existing fields and accepts source',async()=>{
 const f=verificationFixture(incoming());await f.open();f.elements.get('sendwashActual0').value='98';await f.submit();
 const bath=f.tables.inventory_records['2026-10-01_驛館_浴巾'];assert.equal(bath.count,'100');assert.equal(bath.doubleCount,'98');assert.equal(bath.countSource,'sendwash');assert(bath.doubleSignature);assert(f.tables.sendwash_records.source.acceptedAt);assert.equal(f.wrote,3);
});
test('actual transaction refuses concurrent hotel edit or acceptance with no partial inventory writes',async()=>{
 for(const change of [{revision:2},{acceptedAt:'other staff signed'}]){const f=verificationFixture(incoming());await f.open();Object.assign(f.tables.sendwash_records.source,change);await f.submit();assert.equal(f.wrote,0);assert.equal(Object.keys(f.tables.inventory_records).length,0);assert(f.elements.get('sendwashVerifyError').textContent);}
});
test('actual transaction refuses manual inventory collision atomically across all items',async()=>{
 const id='2026-10-01_驛館_中毛',f=verificationFixture(incoming(),{[id]:{date:'2026-10-01',hotel:'驛館',item:'中毛',count:'0',signature:'existing'}});await f.open();await f.submit();assert.equal(f.wrote,0);assert.equal(f.tables.inventory_records[id].signature,'existing');assert(!f.tables.sendwash_records.source.acceptedAt);
});
test('actual transaction merges previous sendwash contributions while preserving notes',async()=>{
 const id='2026-10-01_驛館_浴巾',f=verificationFixture(incoming(),{[id]:{date:'2026-10-01',hotel:'驛館',item:'浴巾',count:'20',doubleCount:'19',note:'保留備註',sendwashSources:{earlier:{declared:'20',actual:'19'}}}});await f.open();f.elements.get('sendwashActual0').value='98';await f.submit();assert.equal(f.tables.inventory_records[id].count,'120');assert.equal(f.tables.inventory_records[id].doubleCount,'117');assert.equal(f.tables.inventory_records[id].note,'保留備註');
});
