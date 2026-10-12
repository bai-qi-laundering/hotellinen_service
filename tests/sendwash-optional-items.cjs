const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const rows=[{item:'浴巾',unit:'條'},{item:'制服',unit:'件'}];
test('blank is omitted while explicit zero is preserved; filled items retain row order',()=>{
 assert.deepEqual(core.submissionItems(rows,['100','']),[{item:'浴巾',quantity:'100',unit:'條'}]);
 assert.deepEqual(core.submissionItems(rows,['','0']),[{item:'制服',quantity:'0',unit:'件'}]);
 assert.deepEqual(core.submissionItems(rows,[' ','']),[]);
 for(const value of ['-1','1.5','1+2'])assert.throws(()=>core.submissionItems(rows,['',value]));
});
async function fixture(seed={}){
 const elements=new Map();
 function element(tag='div'){return{tagName:tag.toUpperCase(),value:'',disabled:false,children:[],append(el){this.children.push(el);if(el.id)elements.set(el.id,el);},replaceChildren(){this.children=[];},textContent:'',required:false};}
 for(const id of ['title','back','department','sourceDate','target','items','message','submit','form'])elements.set(id,element());
 elements.get('department').value='房務';
 const settings=[{hotel:'飯店A',department:'房務',item:'浴巾',unit:'條',defaultQuantity:'20',order:''},{hotel:'飯店A',department:'房務',item:'制服',unit:'件',defaultQuantity:'',order:''}];
 const template={items:settings.map(r=>({baseName:r.hotel,deptName:r.department,hotel:r.hotel,item:r.item})),sendwashSettings:settings,deliverySchedules:[]};
 const tables={inventory_config:{master_template:template},sendwash_records:structuredClone(seed)};
 const snap=ref=>({exists:()=>!!tables[ref.name]?.[ref.id],data:()=>structuredClone(tables[ref.name]?.[ref.id])});
 const api={initializeApp:()=>({}),initializeFirestore:()=>({}),memoryLocalCache:()=>({}),doc:(_,name,id)=>({name,id}),getDocFromServer:async r=>snap(r),runTransaction:async(_,fn)=>{const pending=[];await fn({get:async r=>snap(r),set:(r,d)=>pending.push([r,d])});pending.forEach(([r,d])=>{tables[r.name] ||= {};tables[r.name][r.id]=structuredClone(d);});}};
 const ctx=vm.createContext({...api,window:{SendwashCore:core},document:{getElementById:id=>elements.get(id),createElement:element},location:{search:'?hotel='+encodeURIComponent('飯店A'),href:'https://fixture.local/sendwash.html'},URL,URLSearchParams,Intl,console});
 const html=fs.readFileSync('sendwash.html','utf8');let script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
 await vm.runInContext('(async()=>{'+script+'})()',ctx);
 return{tables,elements,async submit(values){values.forEach((v,i)=>elements.get('qty'+i).value=v);await elements.get('form').onsubmit({preventDefault(){}});},async reload(){await elements.get('sourceDate').onchange();}};
}
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
