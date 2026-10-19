const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('logistics.html','utf8');
const rows=['制服','藝術','餐廳(全日餐廳)','BARPOOL','BARKAO','仕女樓','賀鴨郎(B1中餐廳)','福疊來','主管制服'].flatMap(department=>['品項一','品項二'].map(item=>({hotel:'承億',department,item}))).concat([{hotel:'承億休閒',department:'休閒',item:'浴巾(泳池)'},{hotel:'承億健身房',department:'健身房',item:'浴巾'}]);
function fixture(hotel='承億'){
 const deferred=[],timers=new Map();let nextTimer=0,renders=0;
 const element=tag=>({tag,children:[],textContent:'',append(child){this.children.push(child);},replaceChildren(){this.children=[];}}),container=element('div');
 const context=vm.createContext({currentHotel:hotel,location:{href:'https://fixture.local/logistics.html?hotel='+encodeURIComponent(hotel)},URL,document:{getElementById:id=>id==='sendwashLinks'?container:null,createElement:element,querySelectorAll:()=>[{dataset:{sendwashDept:'BARKAO'}}]},console:{warn(){}},db:{},doc:(_,collection,id)=>({collection,id}),getDocFromServer:ref=>{assert.equal(ref.id,'master_template');return new Promise((resolve,reject)=>deferred.push({resolve,reject}));},setTimeout:(callback,ms)=>{assert.equal(ms,8000);timers.set(++nextTimer,callback);return nextTimer;},clearTimeout:id=>timers.delete(id),renderDepartments:()=>renders++,dataReady:false,groupedData:{},masterTemplate:[],globalItemOrder:{},sendwashSettings:[],sendwashSettingsLoaded:false,sendwashSettingsError:'',templateLoadSequence:0});
 vm.runInContext(source.slice(source.indexOf('        function withReadTimeout('),source.indexOf('        function escapeHtml('))+source.slice(source.indexOf('        function loadReceiptTemplate('),source.indexOf('        async function init('))+source.slice(source.indexOf('        function renderSendwashLinks('),source.indexOf('        function extractQty(')),context);
 const all=()=>{const visit=node=>[node,...node.children.flatMap(visit)];return visit(container);};
 return{context,container,deferred,timers,all,links:()=>all().filter(node=>node.tag==='a'),get renders(){return renders;},resolve(index,settings=rows){deferred[index].resolve({exists:()=>true,data:()=>({items:settings.map(row=>({hotel:row.hotel+' '+row.department,item:row.item})),sendwashSettings:settings})});}};
}
test('Cheng Yi has an immediate entry before slow settings load, then all configured departments stay visible at the top',async()=>{
 const f=fixture(),wait=f.context.loadReceiptTemplate();assert(f.links().some(link=>link.textContent==='開啟承億送洗對點單'));
 f.resolve(0);await wait;const links=f.links();assert.equal(links.length,11);assert(links.some(link=>link.textContent==='BARKAO'),'entry remains visible even when a receipt card already has the same department');
 const pool=links.find(link=>link.textContent==='休閒'),gym=links.find(link=>link.textContent==='健身房');assert.equal(new URL(pool.href).searchParams.get('hotel'),'承億休閒');assert.equal(new URL(gym.href).searchParams.get('hotel'),'承億健身房');assert.equal(new URL(links.find(link=>link.textContent==='賀鴨郎(B1中餐廳)').href).searchParams.get('department'),'賀鴨郎(B1中餐廳)');
 f.context.renderSendwashLinks();assert.equal(f.links().length,11,'date/receipt rerender does not hide entries');
});
test('settings arriving after the eight-second UI timeout still restore entry buttons without reloading',async()=>{
 const f=fixture(),wait=f.context.loadReceiptTemplate();[...f.timers.values()][0]();await wait;assert(f.all().some(node=>node.textContent==='重新載入對點設定'));assert(f.links().some(link=>link.textContent==='開啟承億送洗對點單'));
 f.resolve(0);await new Promise(setImmediate);assert.equal(f.links().length,11);assert.equal(f.context.sendwashSettingsError,'');assert(!f.all().some(node=>node.textContent==='重新載入對點設定'));
});
test('a retry recovers failed reads and an older slow request cannot replace newer settings',async()=>{
 const f=fixture(),old=f.context.loadReceiptTemplate();[...f.timers.values()][0]();await old;
 const retry=f.all().find(node=>node.tag==='button'),latest=retry.onclick();f.resolve(1,[{hotel:'承億',department:'BARKAO',item:'轉盤套'}]);await latest;f.resolve(0);await new Promise(setImmediate);assert.equal(f.links().length,1);assert.equal(f.links()[0].textContent,'BARKAO');
 const g=fixture(),failed=g.context.loadReceiptTemplate();g.deferred[0].reject(new Error('offline'));await failed;assert(g.all().some(node=>node.textContent==='重新載入對點設定'));assert(g.links().some(link=>link.textContent==='開啟承億送洗對點單'));
});
test('late settings also rebuild loaded receipt cards; other hotels retain their prior per-card entry behavior',async()=>{
 const f=fixture();f.context.dataReady=true;f.context.groupedData={BARKAO:{items:[]}};const wait=f.context.loadReceiptTemplate();f.resolve(0);await wait;assert.equal(f.renders,1);
 const other=fixture('其他飯店');other.context.sendwashSettings=[{hotel:'其他飯店',department:'BARKAO'},{hotel:'其他飯店',department:'制服'}];other.context.renderSendwashLinks();assert.equal(other.links().length,1);assert.equal(other.links()[0].textContent,'填寫送洗對點單｜制服');
});
test('an empty date clears old groups so a late template cannot restore the prior date receipt cards',async()=>{
 const f=fixture();f.context.dataReady=true;f.context.groupedData={BARKAO:{items:[{itemName:'過漿口布'}]}};const get=f.context.document.getElementById,departments={innerHTML:''};f.context.document.getElementById=id=>id==='departmentsContainer'?departments:get(id);
 vm.runInContext(source.slice(source.indexOf('        function processAndRenderData('),source.indexOf('        function handleQtyChange(')),f.context);f.context.processAndRenderData([]);assert.equal(Object.keys(f.context.groupedData).length,0);
 const wait=f.context.loadReceiptTemplate();f.resolve(0);await wait;assert.equal(f.renders,0);assert.equal(f.links().length,11);
});
