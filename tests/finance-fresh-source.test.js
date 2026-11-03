import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { publishSnapshot, applySentRegistration, buildStatementTables, renderStatementHtml } from '../statement-case.js';
const html = fs.readFileSync(new URL('../finance.html', import.meta.url), 'utf8');
const fresh = html.slice(html.indexOf('async function generateFreshStatement()'), html.indexOf('function exportToExcel()'));
const querySource = html.slice(html.indexOf('async function getLogisticsDocsForPeriod('), html.indexOf('async function fetchInitialHotels()'));
function snapshot(item='舊名稱',qty=1) {
 const row={date:'2026-10-02', item,qty,price:10,amt:qty*10,docId:'source'};
 return {customerKey:'測試飯店',startDate:'2026-10-01',endDate:'2026-10-31',profile:{name:'測試抬頭'},departments:[{name:'房務',total:qty*10,summary:[row],records:[row]}],totals:{grandTotal:qty*10,rounded:qty*10,afterRebate:qty*10,tax:Math.round(qty*.5)}};
}
function setup(overrides={}) {
 const events=[], values={invoiceTargetCompany:'測試飯店',ciName:'測試抬頭',startDate:'2026-10-01',endDate:'2026-10-31'};
 const ctx={
  document:{getElementById:id=>({value:values[id]}),querySelectorAll:()=>[{value:'測試飯店 房務'}]},
  MERGE_ALL_KEY:'all',pendingUpdatesArray:[],financeSavePromise:null,
  rawLogisticsData:[{item:'舊名稱',qty:1}],currentStatementSnapshot:snapshot(),
  invalidateStatementSnapshot(){ctx.currentStatementSnapshot=null;},
  setDispatchStatus(){},alert:msg=>events.push(['alert',msg]),console,
  window:{closeInvoiceModal(){},async batchSavePrices(){events.push(['save']);return true;}},
  async fetchRecordsForSelectedHotels(options){assert.equal(options.requireServer,true);events.push(['fetch']);return [{item:'新名稱',qty:12}];},
  buildInvoiceReport(){events.push(['build',ctx.rawLogisticsData[0]]);return {comp:'測試飯店',depts:{房務:{}},hotelCount:1};},
  collectStatementSnapshot(){const r=ctx.rawLogisticsData[0];return snapshot(r.item,r.qty);},
  statementRepo:{async publish(s){events.push(['publish',s]);return {action:'updated'};}},
  notifyDispatchRefresh(){},...overrides
 };
 vm.createContext(ctx);vm.runInContext(fresh,ctx);
 return {ctx,events,values};
}
test('產單先儲存再抓最新名稱與數量，檔案取新版且保留原已寄出內容',async()=>{
 const {ctx,events}=setup({pendingUpdatesArray:[{}]});
 await ctx.generateFreshStatement();
 assert.deepEqual(events.filter(e=>['save','fetch','build','publish'].includes(e[0])).map(e=>e[0]),['save','fetch','build','publish']);
 const s=events.find(e=>e[0]==='publish')[1];
 assert.equal(s.departments[0].records[0].item,'新名稱');assert.equal(s.departments[0].records[0].qty,12);
 const v1=await publishSnapshot(null,snapshot());
 const sent=applySentRegistration(v1.doc,1,'xlsx','2026-11-01T00:00:00Z');
 const v2=await publishSnapshot(sent,s);
 assert.equal(v2.doc.latestVersion,2);assert.equal(v2.doc.state,'resend');
 assert.equal(v2.doc.versions[0].snapshot.departments[0].records[0].item,'舊名稱');
 const latest=v2.doc.versions[1].snapshot;
 assert.match(JSON.stringify(buildStatementTables(latest)),/新名稱/);
 assert.match(renderStatementHtml(latest),/新名稱/);
 assert.doesNotMatch(renderStatementHtml(latest),/舊名稱/);
 assert.equal(latest.departments[0].records[0].qty,12);
});
test('儲存失敗不讀取、不產單，舊匯出快照失效',async()=>{
 const {ctx,events}=setup({pendingUpdatesArray:[{}],window:{async batchSavePrices(){return false;}}});
 await ctx.generateFreshStatement();assert.equal(ctx.currentStatementSnapshot,null);
 assert.equal(events.some(e=>e[0]==='publish'||e[0]==='fetch'),false);
});
test('最新來源讀取失敗不發佈舊檔',async()=>{
 const {ctx,events}=setup({async fetchRecordsForSelectedHotels(){throw Error('offline');}});
 await ctx.generateFreshStatement();assert.equal(ctx.currentStatementSnapshot,null);
 assert.equal(events.some(e=>e[0]==='publish'),false);
});
test('讀取期間改變出帳區間，不能把舊資料寫成新區間',async()=>{
 const {ctx,events,values}=setup();
 ctx.fetchRecordsForSelectedHotels=async()=>{values.endDate='2026-11-30';return [{item:'新名稱',qty:12}];};
 await ctx.generateFreshStatement();assert.equal(events.some(e=>e[0]==='publish'),false);
});
test('產單專用讀取跳過進行中的舊查詢，斷線時禁止退回本機快取',async()=>{
 let server=0,cache=0;
 const ctx={Date,Map,db:{},LOGISTICS_CACHE_MS:600000,logisticsPeriodCache:new Map([['2026-10-01|2026-10-31',{promise:Promise.resolve('stale'),docs:'stale'}]]),
 legacyDatePrefixes:()=>['2026-10-'],query:()=>({}),collection:()=>({}),where:()=>({}),
 getDocsFromServer:async()=>{server++;throw Error('offline');},
 getDocsFromCache:async()=>{cache++;return {empty:false};},
 withTimeout:promise=>promise,showToast(){},console};
 vm.createContext(ctx);vm.runInContext(querySource,ctx);
 await assert.rejects(ctx.getLogisticsDocsForPeriod('2026-10-01','2026-10-31',true,true),/offline/);
 assert.equal(server,2);assert.equal(cache,0);
});
test('有修改或正在產單時不能匯出上一份快照',()=>{
 const source=html.slice(html.indexOf('function exportToExcel()'),html.indexOf('// ==========================================',html.indexOf('function exportToExcel()')));
 let writes=0,alerts=0;
 const ctx={currentStatementSnapshot:snapshot(),statementGenerationPending:false,pendingUpdatesArray:[{}],
 alert(){alerts++;},XLSX:{writeFile(){writes++;}},buildStatementWorkbook(){return {};},statementFileBase(){return 'test';},logisticsMasterItems:[]};
 vm.createContext(ctx);vm.runInContext(source,ctx);ctx.exportToExcel();
 assert.equal(writes,0);assert.equal(alerts,1);
});
