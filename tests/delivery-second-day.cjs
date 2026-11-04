const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../sendwash-core.js');
const html=fs.readFileSync('index.html','utf8'),script=fs.readFileSync('docs/hotellinen-apps-script.gs','utf8');
const reader=script.slice(script.indexOf('function baiqiReadDeliverySchedules'),script.indexOf('function doGet'));
function setup(rule='收件後第2個收送日',days='一、二、三、四、五、六、日'){
 const rows=[['飯店','部門','固定收送日','打單日期規則'],['花季','制服',days,rule],['花季','房務','一、二、三、四、五、六、日','收件後的下一個收送日']];
 const gas=vm.createContext({});vm.runInContext(reader,gas);
 const raw=gas.baiqiReadDeliverySchedules({getSheetByName:()=>({getDataRange:()=>({getDisplayValues:()=>rows})})});
 const context=vm.createContext({window:{SendwashCore:core},todayHotels:['花季'],yesterdayHotels:[],getLocalDateString:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`});
 vm.runInContext(html.slice(html.indexOf('        function normalizeScheduleName'),html.indexOf('        function renderHome')),context);
 context.deliverySchedules=context.validateDeliverySchedules(raw);
 return {context,resolve:(date,dept='制服')=>{
  const hotelDate=core.targetDate('花季',dept,date,context.deliverySchedules),plantDate=context.getTargetDateStr('花季',date,dept);
  assert.equal(hotelDate,plantDate,'飯店送洗與廠內登記日期必須一致');return hotelDate;
 }};
}
test('second delivery includes both weekend days and handles month, year and leap-day boundaries',()=>{
 const f=setup();for(const [source,target] of [['2026-11-04','2026-11-06'],['2026-11-06','2026-11-08'],['2026-11-08','2026-11-10'],['2026-11-30','2026-12-02'],['2026-12-31','2027-01-02'],['2028-02-28','2028-03-01']])assert.equal(f.resolve(source),target);
 assert.equal(f.resolve('2026-11-04','房務'),'2026-11-05','其他部門保留原收送規則');
});
test('second scheduled day counts configured delivery days, including weekly schedules needing fourteen calendar days',()=>{
 assert.equal(setup('收件後第2個收送日','二、四、六、日').resolve('2026-11-03'),'2026-11-07');
 assert.equal(setup('收件後第2個收送日','一').resolve('2026-11-02'),'2026-11-16');
});
test('spreadsheet, validation and both pages accept the supported full-width and Chinese second-day spellings',()=>{
 for(const rule of ['收件後第2個收送日','收件後下2個工作日','收件後第２個收送日','收件後的第二個收送日',' 收件後 第 2 個 收送日 '])assert.equal(setup(rule).resolve('2026-11-04'),'2026-11-06');
 assert.throws(()=>setup('收件後第3個收送日'),/不支援/);
 assert.equal(setup('收件後的下一個收送日').resolve('2026-11-04'),'2026-11-05');
});
