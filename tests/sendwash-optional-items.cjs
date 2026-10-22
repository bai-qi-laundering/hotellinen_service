const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const rows=[{item:'浴巾',unit:'條'},{item:'制服',unit:'件'}];
test('blank is omitted while explicit zero is preserved; filled items retain row order',()=>{
 assert.deepEqual(core.submissionItems(rows,['100','']),[{item:'浴巾',quantity:'100',unit:'條'}]);
 assert.deepEqual(core.submissionItems(rows,['','0']),[{item:'制服',quantity:'0',unit:'件'}]);
 assert.deepEqual(core.submissionItems(rows,[' ','']),[]);
 for(const value of ['-1','1.5','1+2'])assert.throws(()=>core.submissionItems(rows,['',value]));
});
async function fixture(seed={},configured,extraTemplate=[]){
 const elements=new Map();
 function element(tag='div'){return{tagName:tag.toUpperCase(),value:'',disabled:false,children:[],append(el){this.children.push(el);if(el.id)elements.set(el.id,el);},replaceChildren(){this.children=[];},setAttribute(key,value){this[key]=value;},scrollIntoView(){},textContent:'',required:false};}
 for(const id of ['title','back','department','sourceDate','target','items','message','submit','form','outletTabs','extraItemPanel','extraItemName','extraItemOptions','addExtraItem'])elements.set(id,element());
 elements.get('department').value='房務';
 const settings=configured || [{hotel:'飯店A',department:'房務',item:'浴巾',unit:'條',defaultQuantity:'20',order:''},{hotel:'飯店A',department:'房務',item:'制服',unit:'件',defaultQuantity:'',order:''}];
 const template={items:settings.filter((r,i)=>settings.findIndex(x=>x.hotel===r.hotel&&x.department===r.department&&x.item===r.item)===i).map(r=>({baseName:r.hotel,deptName:r.department,hotel:r.hotel,item:r.item})),sendwashSettings:settings,deliverySchedules:[]};
 template.items.push(...extraTemplate);
 const tables={inventory_config:{master_template:template},sendwash_records:structuredClone(seed)};
 const snap=ref=>({exists:()=>!!tables[ref.name]?.[ref.id],data:()=>structuredClone(tables[ref.name]?.[ref.id])});
 const api={initializeApp:()=>({}),initializeFirestore:()=>({}),memoryLocalCache:()=>({}),doc:(_,name,id)=>({name,id}),getDocFromServer:async r=>snap(r),runTransaction:async(_,fn)=>{const pending=[];await fn({get:async r=>snap(r),set:(r,d)=>pending.push([r,d])});pending.forEach(([r,d])=>{tables[r.name] ||= {};tables[r.name][r.id]=structuredClone(d);});}};
 const ctx=vm.createContext({...api,getFirestore:api.initializeFirestore,window:{SendwashCore:core},document:{getElementById:id=>elements.get(id),createElement:element},location:{search:'?hotel='+encodeURIComponent('飯店A'),href:'https://fixture.local/sendwash.html'},URL,URLSearchParams,Intl,console});
 const html=fs.readFileSync('sendwash.html','utf8');let script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
 await vm.runInContext('(async()=>{'+script+'})()',ctx);
 return{tables,elements,async submit(values){values.forEach((v,i)=>elements.get('qty'+i).value=v);await elements.get('form').onsubmit({preventDefault(){}});},async reload(){await elements.get('sourceDate').onchange();}};
}
test('outlet tabs scroll horizontally and save independent same-day receipts',async()=>{
 const base={hotel:'飯店A',department:'房務',item:'口布',unit:'條',defaultQuantity:'',order:''};
 const f=await fixture({},[{...base,outlet:'SEEDS'},{...base,outlet:'湛露'}]);
 assert.equal(f.elements.get('outletTabs').children.length,2);
 await f.submit(['18']);await f.elements.get('outletTabs').children[1].onclick();await new Promise(resolve=>setImmediate(resolve));
 await f.submit(['12']);const records=Object.values(f.tables.sendwash_records);assert.equal(records.length,2);assert.deepEqual(records.map(r=>r.outlet),['SEEDS','湛露']);assert.deepEqual(records.map(r=>r.items[0].quantity),['18','12']);
});
test('signed aggregate restaurant receipt blocks new outlet submissions',async()=>{
 const row={hotel:'飯店A',department:'房務',item:'口布',unit:'條',defaultQuantity:'',order:'',outlet:'SEEDS'};
 const f=await fixture({},[row]);f.tables.logistics_records={[`2026-10-13_飯店A_房務`]:{clientSig:'hotel-signature'}};
 // The target date follows the same existing next-delivery calculation.
 const date=f.elements.get('target').textContent.split('：')[1];f.tables.logistics_records={[`${date}_飯店A_房務`]:{clientSig:'hotel-signature'}};
 await f.submit(['18']);assert.equal(Object.keys(f.tables.sendwash_records).length,0);assert.match(f.elements.get('message').textContent,/已簽收/);
});
test('actual hotel form accepts partial submission without creating inventory data',async()=>{
 const f=await fixture();assert.equal(f.elements.get('qty0').required,false);await f.submit(['100','']);const record=Object.values(f.tables.sendwash_records)[0];assert.equal(record.items.length,1);assert.equal(record.items[0].item,'浴巾');assert.equal(record.noSendwash,false);assert(!f.tables.inventory_records);assert.equal(f.elements.get('qty1').value,'');
});
test('entire empty form records no shipment and leaves existing quantities untouched',async()=>{
 const f=await fixture();f.tables.inventory_records={existing:{count:'55',doubleCount:'54'}};await f.submit(['','']);const record=Object.values(f.tables.sendwash_records)[0];assert.deepEqual(record.items,[]);assert.equal(record.noSendwash,true);assert(!record.acceptedAt);assert.equal(f.tables.inventory_records.existing.count,'55');assert.equal(f.elements.get('qty0').value,'');assert(f.elements.get('message').textContent.includes('本次無送洗'));await f.reload();assert.equal(f.elements.get('qty0').value,'');
});
test('clear previously entered item removes it instead of reviving default or old quantity',async()=>{
 const f=await fixture();await f.submit(['100','5']);await f.submit(['','6']);const records=Object.values(f.tables.sendwash_records);assert.equal(records.length,1);assert.equal(records[0].revision,2);assert.deepEqual(records[0].items,[{item:'制服',quantity:'6',unit:'件'}]);assert.equal(f.elements.get('qty0').value,'');
});
test('no-shipment record can be updated later that day, and explicit zero remains a real item',async()=>{
 const f=await fixture();await f.submit(['','']);await f.submit(['','0']);const record=Object.values(f.tables.sendwash_records)[0];assert.equal(record.revision,2);assert.equal(record.noSendwash,false);assert.equal(record.items[0].quantity,'0');await f.reload();assert.equal(f.elements.get('qty1').value,'0');assert.equal(f.elements.get('qty0').value,'');
});

test('temporary items preserve existing quantities and survive submit plus fresh page load, including explicit zero',async()=>{
 const f=await fixture();f.elements.get('qty0').value='31';f.elements.get('extraItemName').value='臨時床罩';f.elements.get('addExtraItem').onclick();
 assert.equal(f.elements.get('qty0').value,'31');assert.equal(f.elements.get('items').children.length,3);assert.equal(f.elements.get('qty2').value,'');
 await f.submit(['31','','0']);const record=Object.values(f.tables.sendwash_records)[0];assert.deepEqual(record.items.map(i=>[i.item,i.quantity]),[['浴巾','31'],['臨時床罩','0']]);assert.equal(record.department,'房務');
 const g=await fixture(f.tables.sendwash_records);assert.equal(g.elements.get('qty2').value,'0');assert.match(g.elements.get('items').children[2].textContent,/臨時床罩/);await g.submit(['31','','4']);assert.equal(Object.values(g.tables.sendwash_records)[0].items[1].quantity,'4');
 assert.equal(f.tables.inventory_config.master_template.sendwashSettings.length,2);
});
test('temporary item validation rejects duplicates, reserved keys and markup without altering fields',async()=>{
 const f=await fixture();
 for(const name of ['浴 巾','<img>','bad\'name','A/B','A\\B','A&b','【其他部門】浴巾','_MANUAL_BORDER_','A\nB','']){f.elements.get('extraItemName').value=name;f.elements.get('addExtraItem').onclick();assert.equal(f.elements.get('items').children.length,2,name);assert(f.elements.get('message').textContent);}
 assert.equal(Object.keys(f.tables.sendwash_records).length,0);
});
test('temporary rows and values remain isolated by source date and locked source records cannot add items',async()=>{
 const f=await fixture(),date=f.elements.get('sourceDate').value;
 f.elements.get('extraItemName').value='臨時桌裙';f.elements.get('addExtraItem').onclick();f.elements.get('qty2').value='3';
 f.elements.get('sourceDate').value='2026-11-02';await f.reload();assert.equal(f.elements.get('items').children.length,2);
 f.elements.get('sourceDate').value=date;await f.reload();assert.equal(f.elements.get('qty2').value,'3');
 await f.submit(['','','3']);const record=Object.values(f.tables.sendwash_records)[0];record.receivedItems={'臨時桌裙':{signature:'received'}};await f.reload();assert.equal(f.elements.get('addExtraItem').disabled,true);
 f.elements.get('extraItemName').value='不得新增';f.elements.get('addExtraItem').onclick();assert.equal(f.elements.get('items').children.length,3);assert.equal(f.elements.get('submit').disabled,true);
});
test('add-item selection offers other template items in the same department',async()=>{
 const f=await fixture({},undefined,[{baseName:'飯店A',deptName:'房務',hotel:'飯店A',item:'床單'},{baseName:'其他飯店',deptName:'房務',hotel:'其他飯店',item:'不可選'}]);
 assert.deepEqual(f.elements.get('extraItemOptions').children.map(option=>option.value),['床單']);
 f.elements.get('extraItemName').value='床單';f.elements.get('addExtraItem').onclick();await f.submit(['','','6']);assert.equal(Object.values(f.tables.sendwash_records)[0].items[0].item,'床單');
});
