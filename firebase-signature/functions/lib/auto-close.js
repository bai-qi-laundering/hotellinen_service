import { billingReceiptItems } from './logistics-items.js';
import { createInvoiceEngine } from './invoice-engine.js';
import { caseDocumentId, publishSnapshot } from './statement-case.js';
const group25th = ["良一", "良西", "良站前", "英迪格", "富野", "富汽", "富野制服", "然一", "H2O", "花季", "天子閣", "驛館", "洲際", "承億", "萊特薇庭", "帕鉑", "候工所"];
const group1st = ["歐遊", "捷中正"];
const groupEndOfMonth = ["捷站前", "鈞怡", "宮賞", "家和", "秝二", "秝芯", "比歐", "駱駝", "喜達絲", "好六" , "媚力泊" , "巨蛋" , "老新" , "永心" , "福客來", "林森", "福客來", "建工", "鴨點棧明誠", "高廬", "頭等艙", "河畔", "好地方", "文旅", "文七", "文一", "禾鮨", "禾寓", "日航", "鼎王", "鴨點棧華夏", "鉑麗"];
// 結帳設定裡的舊名稱。查單與分組用物流範本的名稱，不改 Firestore。
export const settlementNameAliases = { '天幕': '天慕' };
export function canonicalHotelKeyword(name) {
 const text = String(name || '').trim();
 return settlementNameAliases[text] || text;
}
export function aliasSourceKeywords(canonical) {
 const names = new Set([canonical]);
 for (const [alias, target] of Object.entries(settlementNameAliases)) if (target === canonical) names.add(alias);
 return [...names];
}
export function taipeiDate(value) {
 const d = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
 if (!Number.isFinite(d.getTime())) throw new Error('無效事件時間');
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
export function recordDate(value) {
 if(value?.toDate || value instanceof Date) return taipeiDate(value);
 const s=String(value||'').trim();
 if (/T.*(?:Z|[+-]\\d{2}:?\\d{2})$/.test(s)) return taipeiDate(s);
 const m=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/.exec(s);
 return m ? [m[1],m[2].padStart(2,'0'),m[3].padStart(2,'0')].join('-') : '';
}
export function signatureAdded(before, after) {
 return ['clientSig','driverSig'].some(key => !String(before?.[key]||'').trim() && !!String(after?.[key]||'').trim());
}
function assignedGroup(name, groups) {
 if(Object.hasOwn(groups,name)) return {set:true, value:groups[name]};
 const canonical=canonicalHotelKeyword(name);
 if(canonical!==name && Object.hasOwn(groups,canonical)) return {set:true, value:groups[canonical]};
 for (const [alias, target] of Object.entries(settlementNameAliases)) {
  if (target===name && Object.hasOwn(groups, alias)) return {set:true, value:groups[alias]};
 }
 return {set:false, value:''};
}
// 較長的名稱放前面。H2O 西餐是 H2O 的西餐部門，不是另一間飯店。
const pinnedBillingGroups = [
 ['H2O 西餐', '25th'],
 ['捷中正', '1st'],
 ['歐遊', '1st'],
 ['天慕', '25th'],
 ['鉑麗', 'month'],
 ['H2O', '25th'],
];
export function pinnedBillingGroup(key) {
 const name=String(key||'').trim();
 if (name.includes('H2O') && name.includes('西餐')) return '25th';
 for (const [label, group] of pinnedBillingGroups) {
  if (label === 'H2O') {
   if (name === 'H2O' || name.startsWith('H2O ') || name.startsWith('H2O　')) return group;
   continue;
  }
  if (name.includes(label)) return group;
 }
 return '';
}
// H2O 西餐的出貨在 H2O 這張對帳單上，不另出一張。
export function statementHotelKey(hotel) {
 const key=canonicalHotelKeyword(hotel);
 if (key.includes('H2O') && key.includes('西餐')) return 'H2O';
 return key;
}
export function settlementGroup(hotel, groups={}) {
 const name=String(hotel||'').trim();
 if(!name) return '';
 const key=canonicalHotelKeyword(name);
 const pinned=pinnedBillingGroup(key);
 if (pinned) return pinned;
 const saved=assignedGroup(name, groups);
 if(saved.set) return saved.value;
 if(group25th.some(x=>key.includes(x))) return '25th';
 if(groupEndOfMonth.some(x=>key.includes(x))) return 'month';
 if(group1st.some(x=>key.includes(x))) return '1st';
 return '';
}
export function closingPeriod(hotel, date, groups={}) {
 const [y,m,d]=date.split('-').map(Number);
 const group=settlementGroup(hotel, groups);
 const last=new Date(Date.UTC(y,m,0)).getUTCDate();
 if(group==='25th' && d===25) {
  const prev=new Date(Date.UTC(y,m-2,26));
  return {startDate:prev.toISOString().slice(0,10),endDate:date};
 }
 if(group==='month' && d===last) return {startDate:date.slice(0,7)+'-01',endDate:date};
 // 1 號組：每月 1 日出前一個曆月（上月 1 日～上月最後一天）。
 if(group==='1st' && d===1) {
  return {startDate:new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,10),endDate:new Date(Date.UTC(y,m-1,0)).toISOString().slice(0,10)};
 }
 return null;
}
export function customerOf(receipt) {
 const hotel=String(receipt.hotelKeyword||'').trim(), dept=String(receipt.deptName||'').trim();
 return hotel==='鼎王' && dept && dept!==hotel ? hotel+' '+dept : hotel;
}
export function rowsForPeriod(documents,customer,start,end) {
 const rows=[];
 for(const {id,data:d} of documents) {
  const date=recordDate(d.date);
  if(d.manualDeletedReceipt || customerOf(d)!==customer || date<start || date>end) continue;
  const parent=String(d.hotelKeyword||'').trim();
  const dept=String(d.deptName||'').trim();
  const hotel=dept && dept!==parent ? parent+' '+dept : parent;
  // Same department exclusion as finance's 產生對帳單 hotel list.
  if(hotel.includes('回洗') || dept.includes('回洗')) continue;
  billingReceiptItems(d).forEach((item,idx)=>{
   if(item.deletedInLogistics) return;
   const raw=item.actualQty!==undefined && item.actualQty!==null && String(item.actualQty).trim()!=='' ? item.actualQty : item.originalQty ?? item.bqQty ?? 0;
   const qty=Number(raw)||0;
   if(qty<=0 || String(item.itemName||'').includes('回洗')) return;
   rows.push({docId:id,receiptOrder:idx,rowId:JSON.stringify([id,idx]),parentCompany:parent,hotel,date,item:item.itemName,qty,savedPrice:item.price,manualPriceOverride:!!item.manualFinancePrice});
  });
 }
 return rows;
}
export async function commitOnce({db,id,snapshot,eventId,receiptId,eventTime,meta}) {
 const marker=db.collection('statement_auto_runs').doc(id);
 const ref=db.collection('statement_cases').doc(id);
 const completedAt=new Date().toISOString();
 return db.runTransaction(async tx=>{
  const [done,existing]=await Promise.all([tx.get(marker),tx.get(ref)]);
  if(done.exists) return 'already_completed';
  if(existing.exists) {
   tx.create(marker,{status:'skipped_existing',eventId,receiptId,eventTime,completedAt,caseId:id});
   return 'skipped_existing';
  }
  if(!snapshot) throw new Error('缺少對帳單內容');
  const result=await publishSnapshot(null,snapshot,completedAt);
  const caseDoc={...result.doc,id,autoGenerated:true,sourceEventId:eventId};
  if(meta) caseDoc.autoGeneration={source:'billing-day',completedAt,billingGroup:meta.billingGroup||'',unsignedReceiptCount:meta.unsignedReceiptCount||0,signedReceiptCount:meta.signedReceiptCount||0};
  tx.create(ref,caseDoc);
  tx.create(marker,{status:'completed',eventId,receiptId,eventTime,completedAt,caseId:id,customerKey:snapshot.customerKey,startDate:snapshot.startDate,endDate:snapshot.endDate,...(meta?{billingGroup:meta.billingGroup||'',unsignedReceiptCount:meta.unsignedReceiptCount||0,signedReceiptCount:meta.signedReceiptCount||0}:{})});
  return 'created';
 });
}
export {createInvoiceEngine, caseDocumentId};
