const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js'),hotel='洲際';
async function fixture(seed,extraRows=[],deliverySchedules=[]){
 const elements=new Map();
 function element(tag='div'){
  const el={tagName:tag.toUpperCase(),value:'',disabled:false,children:[],append(child){this.children.push(child);if(child.id)elements.set(child.id,child);},replaceChildren(){for(const child of this.children){child.replaceChildren();if(child.id)elements.delete(child.id);}this.children=[];},setAttribute(key,value){this[key]=value;},required:false};
  let text='';Object.defineProperty(el,'textContent',{get:()=>text,set:value=>{text=value;el.replaceChildren();}});return el;
 }
 for(const id of ['title','back','department','sourceDate','target','items','message','submit','form','outletTabs'])elements.set(id,element());elements.get('department').value='餐廳';
 const settings=['大地','WARA','湛露'].flatMap(outlet=>['口布','小毛巾'].map(item=>({hotel,department:'餐廳',outlet,item,unit:'條',defaultQuantity:'',order:''}))).concat(extraRows);
 const template={items:settings.filter((r,i)=>settings.findIndex(x=>x.department===r.department&&x.item===r.item)===i).map(r=>({baseName:hotel,deptName:r.department,hotel:`${hotel} ${r.department}`,item:r.item})),sendwashSettings:settings,deliverySchedules};
 const tables={inventory_config:{master_template:template},sendwash_records:{},logistics_records:{}},transactions=[];let seeded=false;
 const snap=ref=>({exists:()=>!!tables[ref.name]?.[ref.id],data:()=>structuredClone(tables[ref.name]?.[ref.id])});
 const api={initializeApp:()=>({}),initializeFirestore:()=>({}),memoryLocalCache:()=>({}),doc:(_,name,id)=>({name,id}),getDocFromServer:async ref=>{if(!seeded){seeded=true;Object.assign(tables.sendwash_records,seed?.(elements.get('sourceDate').value)||{});}return snap(ref);},runTransaction:async(_,fn)=>{const pending=[],reads=[];await fn({get:async ref=>{assert.equal(pending.length,0,'all transaction reads precede writes');reads.push(ref);return snap(ref);},set:(ref,data)=>pending.push([ref,data])});transactions.push({reads,writes:pending});pending.forEach(([ref,data])=>{tables[ref.name][ref.id]=structuredClone(data);});}};
 const ctx=vm.createContext({...api,window:{SendwashCore:core},document:{getElementById:id=>elements.get(id),createElement:element},location:{search:'?hotel='+encodeURIComponent(hotel),href:'https://fixture.local/sendwash.html'},URL,URLSearchParams,Intl,console});
 const code=fs.readFileSync('sendwash.html','utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');await vm.runInContext('(async()=>{'+code+'})()',ctx);
 return{tables,elements,transactions,ctx,get date(){return elements.get('sourceDate').value;},fill(values){values.forEach((value,i)=>{const input=elements.get('qty'+i);input.value=value;input.oninput?.();});},async tab(index){await elements.get('outletTabs').children[index].onclick();},async submit(){await elements.get('form').onsubmit({preventDefault(){}});},id(outlet,dept='餐廳'){return core.submissionId(hotel,dept,this.date,outlet);}};
}
test('restaurant switching retains unsent drafts; a single submission atomically sends all outlets including explicit zero and blank',async()=>{
 const f=await fixture();assert.equal(f.elements.get('submit').textContent,'一次送出全部餐廳');
 f.fill(['18','0']);await f.tab(1);f.fill(['12','']);await f.tab(0);assert.equal(f.elements.get('qty0').value,'18');assert.equal(f.elements.get('qty1').value,'0');assert.equal(Object.keys(f.tables.sendwash_records).length,0);
 await f.submit();assert.equal(f.transactions.length,1);assert.equal(f.transactions[0].writes.length,3);assert.equal(f.tables.sendwash_records[f.id('大地')].items[0].quantity,'18');assert.equal(f.tables.sendwash_records[f.id('大地')].items[1].quantity,'0');assert.equal(f.tables.sendwash_records[f.id('WARA')].items[0].quantity,'12');assert.equal(f.tables.sendwash_records[f.id('湛露')].noSendwash,true);assert.match(f.elements.get('message').textContent,/已一次送出 3/);
});
test('second all-outlet submission updates the same sources and cleared quantities stay blank',async()=>{
 const f=await fixture();f.fill(['18','']);await f.submit();f.fill(['','']);await f.tab(1);f.fill(['10','']);await f.submit();assert.equal(Object.keys(f.tables.sendwash_records).length,3);assert.equal(f.tables.sendwash_records[f.id('大地')].noSendwash,true);assert.equal(f.tables.sendwash_records[f.id('WARA')].items[0].quantity,'10');assert(Object.values(f.tables.sendwash_records).every(record=>record.revision===2));
});
test('invalid numbers in an offscreen outlet reject the entire submission and preserve all drafts',async()=>{
 const f=await fixture();f.fill(['18','']);await f.tab(1);f.fill(['-1','']);await f.tab(2);f.fill(['7','']);await f.submit();assert.equal(Object.keys(f.tables.sendwash_records).length,0);assert.equal(f.transactions.length,0);await f.tab(0);assert.equal(f.elements.get('qty0').value,'18');await f.tab(1);assert.equal(f.elements.get('qty0').value,'-1');
});
test('concurrent editing or plant acceptance of one restaurant never partially sends the others',async()=>{
 for(const accepted of [false,true]){const f=await fixture();f.fill(['18','']);const old={hotel,department:'餐廳',outlet:'WARA',revision:accepted?0:1,items:[],...(accepted?{acceptedAt:'signed'}:{})};f.tables.sendwash_records[f.id('WARA')]=old;await f.submit();assert.equal(Object.keys(f.tables.sendwash_records).length,1);assert.deepEqual(f.tables.sendwash_records[f.id('WARA')],old);assert.equal(f.transactions.length,0);assert.match(f.elements.get('message').textContent,/本次全部尚未送出/);}
});
test('already received restaurants stay read-only and unchanged while remaining outlets can be sent once',async()=>{
 let original;const f=await fixture(date=>{original={hotel,department:'餐廳',outlet:'大地',revision:1,items:[{item:'口布',quantity:'8'}],acceptedAt:'already-accepted'};return{[core.submissionId(hotel,'餐廳',date,'大地')]:original};});assert.equal(f.elements.get('qty0').disabled,true);await f.tab(1);f.fill(['12','']);await f.submit();assert.deepEqual(f.tables.sendwash_records[f.id('大地')],original);assert.equal(f.transactions[0].writes.length,2);assert.equal(f.tables.sendwash_records[f.id('WARA')].items[0].quantity,'12');
});
test('signed receipt blocks the whole batch and source dates retain separate in-memory drafts',async()=>{
 const f=await fixture();f.fill(['18','']);const first=f.date;f.elements.get('sourceDate').value='2026-11-01';await f.elements.get('sourceDate').onchange();f.fill(['7','']);f.elements.get('sourceDate').value=first;await f.elements.get('sourceDate').onchange();assert.equal(f.elements.get('qty0').value,'18');
 const target=core.targetDate(hotel,'餐廳',first,[]);f.tables.logistics_records[`${target}_${hotel}_餐廳`]={clientSig:'signed'};await f.submit();assert.equal(Object.keys(f.tables.sendwash_records).length,0);assert.match(f.elements.get('message').textContent,/總單已簽收/);
});
test('one click includes configured restaurant departments but does not submit uniforms',async()=>{
 const f=await fixture(undefined,[{hotel,department:'宴會餐飲',outlet:'宴會廳',item:'口布',unit:'條',defaultQuantity:''},{hotel,department:'制服',item:'廚衣',unit:'件',defaultQuantity:''}]);assert.equal(f.elements.get('outletTabs').children.length,4);await f.tab(3);f.fill(['6']);await f.submit();assert.equal(Object.keys(f.tables.sendwash_records).length,4);assert.equal(f.tables.sendwash_records[f.id('宴會廳','宴會餐飲')].items[0].quantity,'6');assert(!Object.values(f.tables.sendwash_records).some(record=>record.department==='制服'));
});
test('stale settings reject the batch without losing drafts',async()=>{
 const f=await fixture();f.fill(['18','']);f.tables.inventory_config.master_template.sendwashSettings[0].unit='件';await f.submit();assert.equal(Object.keys(f.tables.sendwash_records).length,0);assert.equal(f.elements.get('qty0').value,'18');assert.match(f.elements.get('message').textContent,/設定已更新/);
});
test('batch preserves each restaurant department delivery schedule rather than using the visible tab date for all',async()=>{
 const schedules=[{hotel,department:'餐廳',rule:'收件後的下一個收送日',days:[1]},{hotel,department:'宴會餐飲',rule:'收件後的下一個收送日',days:[4]}];
 const f=await fixture(undefined,[{hotel,department:'宴會餐飲',outlet:'宴會廳',item:'口布',unit:'條',defaultQuantity:''}],schedules);f.fill(['18','']);await f.tab(3);f.fill(['6']);await f.submit();const a=f.tables.sendwash_records[f.id('大地')],b=f.tables.sendwash_records[f.id('宴會廳','宴會餐飲')];assert.equal(a.targetDate,core.targetDate(hotel,'餐廳',f.date,schedules));assert.equal(b.targetDate,core.targetDate(hotel,'宴會餐飲',f.date,schedules));assert.notEqual(a.targetDate,b.targetDate);
});

test('湛露 colors and outlet wiping cloth variants submit as independent quantities in one batch',async()=>{
 const extra=['大地','WARA','湛露'].map(outlet=>({hotel,department:'餐廳',outlet,item:'擦拭布',unit:'條',defaultQuantity:''}));
 const f=await fixture(undefined,extra);f.fill(['5','','2','3']);await f.tab(2);
 assert.equal(f.elements.get('items').children[0].textContent,'黃口布（條）');assert.equal(f.elements.get('items').children[1].textContent,'白口布（條）');
 f.fill(['10','0','','4','6']);await f.tab(0);assert.equal(f.elements.get('qty3').value,'3');await f.submit();assert.equal(f.transactions.length,1);
 assert.deepEqual(f.tables.sendwash_records[f.id('湛露')].items.map(i=>[i.item,i.quantity]),[['黃口布','10'],['白口布','0'],['擦拭布','4'],['紅邊擦拭布','6']]);
 assert.deepEqual(f.tables.sendwash_records[f.id('大地')].items.map(i=>[i.item,i.quantity]),[['口布','5'],['擦拭布','2'],['紅邊擦拭布','3']]);
});
test('legacy 湛露 unsplit quantity is retained without guessing a color or doubling it',async()=>{
 const f=await fixture(date=>({[core.submissionId(hotel,'餐廳',date,'湛露')]:{hotel,department:'餐廳',outlet:'湛露',revision:1,items:[{item:'口布',quantity:'19',unit:'條'}]}}));await f.tab(2);
 assert.equal(f.elements.get('items').children[0].textContent,'黃口布（條）');assert.equal(f.elements.get('qty0').value,'');assert.equal(f.elements.get('qty1').value,'');assert.equal(f.elements.get('qty2').value,'');await f.submit();assert.deepEqual(f.tables.sendwash_records[f.id('湛露')].items,[{item:'口布',quantity:'19',unit:'條'}]);
});
test('an existing red-edge cloth spreadsheet row also exposes both cloth subtypes without changing its default',()=>{
 const row={hotel:'洲際',department:'餐廳',outlet:'WARA',item:'紅邊擦拭布',defaultQuantity:'2',unit:'條'};
 assert.deepEqual(core.displayRows([row]).map(r=>[r.item,r.defaultQuantity]),[['擦拭布',''],['紅邊擦拭布','2']]);assert.deepEqual(core.displayRows([{...row,hotel:'H2O'}]),[{...row,hotel:'H2O'}]);
});

test('CLUB cocktail towels are available without a new spreadsheet row and submit with the outlet batch',async()=>{
 const f=await fixture(undefined,[{hotel,department:'餐廳',outlet:'CLUB',item:'口布',unit:'條',defaultQuantity:''}]);await f.tab(3);
 assert.equal(f.elements.get('items').children[2].textContent,'雞尾酒巾（條）');f.fill(['2','3','0']);await f.submit();
 assert.equal(f.transactions.length,1);assert.deepEqual(f.tables.sendwash_records[f.id('CLUB')].items,[{item:'口布',quantity:'2',unit:'條'},{item:'方巾',quantity:'3',unit:'條'},{item:'雞尾酒巾',quantity:'0',unit:'條'}]);
 assert(!f.tables.sendwash_records[f.id('大地')].items.some(i=>i.item==='雞尾酒巾'));
 const row={hotel,department:'餐廳',outlet:'CLUB',item:'雞尾酒巾',unit:'條',defaultQuantity:''};assert.deepEqual(core.displayRows([row]).map(r=>r.item),['方巾','雞尾酒巾']);assert(!core.displayRows([{...row,hotel:'H2O',item:'口布'}]).some(i=>i.item==='雞尾酒巾'));assert(!core.displayRows([{...row,department:'制服',item:'口布'}]).some(i=>i.item==='雞尾酒巾'));
});
test('CLUB cocktail towels move directly below existing square towels without duplicate fields or losing defaults',()=>{
 const base={hotel,department:'餐廳',outlet:'CLUB',unit:'條',defaultQuantity:''};const rows=core.displayRows([{...base,item:'雞尾酒巾',defaultQuantity:'4'},{...base,item:'口布'},{...base,item:'方巾'},{...base,item:'服務巾'}]);
 assert.deepEqual(rows.map(r=>r.item),['口布','方巾','雞尾酒巾','服務巾']);assert.equal(rows[2].defaultQuantity,'4');
});
