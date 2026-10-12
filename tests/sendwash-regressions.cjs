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

test('sendwash display follows sheet rows even when legacy numeric order conflicts',()=>{
 const rows=[{hotel:'驛館',department:'房務',item:'中毛',order:99},{hotel:'驛館',department:'房務',item:'浴巾',order:1}];
 const result=core.settings(rows,template);
 assert.deepEqual(result.map(row=>row.item),['中毛','浴巾']);
 assert.deepEqual(core.settings([...rows].reverse(),template).map(row=>row.item),['浴巾','中毛']);
});
test('sheet order is preserved within departments with blank numeric order and interleaved hotels',()=>{
 const other={baseName:'另家飯店',deptName:'制服',hotel:'另家飯店 制服',item:'制服'};
 const rows=[{hotel:'驛館',department:'房務',item:'中毛',order:''},{hotel:'另家飯店',department:'制服',item:'制服',order:''},{hotel:'驛館',department:'房務',item:'浴巾',order:''}];
 const result=core.settings(rows,[...template,other]);
 assert.deepEqual(result.filter(r=>r.hotel==='驛館').map(r=>r.item),['中毛','浴巾']);
});

