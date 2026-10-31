import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString, defineBoolean } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { signatureAdded, recordDate, taipeiDate, closingPeriod, customerOf, rowsForPeriod, commitOnce, createInvoiceEngine, caseDocumentId } from './lib/auto-close.js';
import { attemptWithBackoff, sheetPricesFromRows } from './lib/price-catalog.js';
import { legacyDatePrefixes } from './lib/logistics-items.js';
initializeApp();
const db=getFirestore();
const enabled=defineBoolean('AUTO_STATEMENTS_ENABLED',{default:false});
const masterUrl=defineString('FINANCE_MASTER_URL');
const region=defineString('FUNCTION_REGION',{default:'asia-east1'});
async function config(name) { const s=await db.collection('inventory_config').doc(name).get();return s.exists?s.data():{}; }
export const autoStatementOnSignature=onDocumentWritten({
 document:'logistics_records/{receiptId}',region,retry:true,timeoutSeconds:120,memory:'512MiB',maxInstances:3,
},async event=>{
 if(!enabled.value() || !event.data?.after.exists) return;
 const after=event.data.after.data(), before=event.data.before.exists?event.data.before.data():null;
 if(after.manualDeletedReceipt || !signatureAdded(before,after)) return;
 const day=taipeiDate(event.time);
 if(recordDate(after.date)!==day) return;
 const hotel=String(after.hotelKeyword||'').trim(), customer=customerOf(after);
 if(!hotel || !customer) return;
 const groups=(await config('finance_settlement_groups')).groups||{};
 const period=closingPeriod(Object.hasOwn(groups,customer)?customer:hotel,day,groups);
 if(!period) return;
 const id=await caseDocumentId(customer,period.startDate,period.endDate);
 if((await db.collection('statement_auto_runs').doc(id).get()).exists) return;
 try {
  const url=new URL(masterUrl.value());
  if(url.protocol!=='https:' || url.hostname!=='script.google.com') throw new Error('FINANCE_MASTER_URL 必須是既有 Apps Script HTTPS 網址');
  url.searchParams.set('action','getFinanceMasterData');
  const master=await attemptWithBackoff(async()=>{
   const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
   if(!response.ok) throw new Error('財務主資料 HTTP '+response.status);
   const body=await response.json();
   if(!body.success || !Array.isArray(body.prices) || !Array.isArray(body.clients)) throw new Error('財務主資料不完整');
   return body;
  },{attempts:3,delayMs:1000});
  const [pricing,effective,custom,template]=await Promise.all([
   config('finance_annual_pricing'),config('finance_effective_prices'),config('custom_prices'),config('master_template')
  ]);
  if(!template.items?.length) throw new Error('缺少品項排序 master_template');
  const queries=legacyDatePrefixes(period.startDate,period.endDate).map(prefix=>db.collection('logistics_records').where('date','>=',prefix).where('date','<=',prefix+'\uf8ff'));
  queries.push(db.collection('logistics_records').where('date','>=',new Date(period.startDate+'T00:00:00+08:00')).where('date','<=',new Date(period.endDate+'T23:59:59.999+08:00')));
  const docs=new Map();
  for(const snap of await Promise.all(queries.map(q=>q.get()))) snap.forEach(d=>docs.set(d.id,{id:d.id,data:d.data()}));
  const rawLogisticsData=rowsForPeriod([...docs.values()],customer,period.startDate,period.endDate);
  const sheetPrices=sheetPricesFromRows(master.prices);
  const options={rawLogisticsData,sheetPrices,customPrices:custom.prices||{},sheetClients:{},
   logisticsMasterItems:template.items,effectivePriceRules:effective.rules||[],
   pricingRules:{holidays:pricing.holidays||[],rebates:pricing.rebates||[],managementFees:pricing.managementFees||[]}};
  options.sheetClients=createInvoiceEngine(options).parseFinanceClientRows(master.clients);
  const snapshot=createInvoiceEngine(options).build(customer,period.startDate,period.endDate);
  const result=await commitOnce({db,id,snapshot,eventId:event.id,receiptId:event.params.receiptId,eventTime:event.time});
  logger.info('auto_statement_result',{result,caseId:id,customerKey:customer,...period});
 } catch(error) {
  logger.error('auto_statement_failed',{eventId:event.id,receiptId:event.params.receiptId,error:String(error)});
  throw error;
 }
});
