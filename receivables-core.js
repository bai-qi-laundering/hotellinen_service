import { payableAmount } from './statement-case.js';
import { settlementGroup } from './firebase-signature/functions/lib/auto-close.js';


export function sentVersion(c) { return [...(c.versions||[])].filter(v=>v.sentAt).sort((a,b)=>b.version-a.version)[0]||null; }
export function isFixedHotelCase(c) {
 const name=String(c?.customerKey||'').normalize('NFKC').replace(/\s/g,'');
 return !name.includes('+') || name==='良西+良一';
}
export function ledger(c) {
 if(!isFixedHotelCase(c))return null;
 const v=sentVersion(c); if(!v)return null;
 return {version:v.version,amount:payableAmount(v.snapshot),snapshot:v.snapshot,pending:Number(c.latestVersion)!==Number(v.version),confirmed:c.paymentConfirmation?.version===v.version,invoice:c.invoiceRecord||null};
}
export function invoiceState(c) {
 if(!c)return '未開票';
 if(c.invoiceRecord||c.invoiceStatus==='invoiced')return Number(c.invoicedVersion)===Number(c.latestVersion)?'已開票':'開票後有變';
 return '未開票';
}
function resolvedGroup(name, groups={}) {
 return settlementGroup(name, groups);
}
export function periodFor(name,month,groups={}) {
 const group=resolvedGroup(name,groups);
 const [y,m]=month.split('-').map(Number);
 if(group==='25th')return {start:new Date(Date.UTC(y,m-2,26)).toISOString().slice(0,10),end:month+'-25'};
 if(group==='month'||group==='1st')return {start:month+'-01',end:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
 return null;
}
export function applyLedger(c,expected,action,payload,now) {
 const out=JSON.parse(JSON.stringify(c)),l=ledger(out);
 if(action==='voidInvoice'){
  if(!l||l.version!==Number(expected)||Number(payload.latestVersion)!==Number(out.latestVersion))
   throw Error('帳單已更新，請重新整理後再登記作廢。');
  const number=String(out.invoiceRecord?.number||out.invoiceNumber||'').trim().toUpperCase();
  if(!number||(!out.invoiceRecord&&out.invoiceStatus!=='invoiced'))throw Error('沒有可登記作廢的發票。');
  if(String(payload.number||'').trim().toUpperCase()!==number)throw Error('請輸入與原紀錄相同的發票號碼。');
  if(payload.confirmed!=='yes')throw Error('請先完成實際發票作廢，再勾選確認。');
  const reason=String(payload.reason||'').trim();
  if(!reason)throw Error('請填寫作廢原因。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.date||''))throw Error('請填寫作廢日期。');
  const old=out.invoiceRecord||{};
  out.invoiceHistory=[...(out.invoiceHistory||[]),{...old,number,date:old.date||out.invoiceDate||'',version:old.version||out.invoicedVersion||l.version,amount:old.amount??l.amount,reason,voidDate:payload.date,at:now,source:'external-void-confirmed'}];
  for(const key of ['invoiceRecord','invoiceNumber','invoiceDate','invoicedVersion','provider','invoiceKind','invoiceBuyerId','invoiceBuyerName','invoiceRaw','invoiceDraft','invoiceLock'])out[key]=null;
  for(const version of out.versions||[]){
   if(version.review==='invoiced_diff'&&Number(version.version)===Number(out.latestVersion))version.review=null;
   if(version.invoiceNumber===number){version.invoiceNumber=null;version.invoiceDate=null;version.voidedAt=now;}
  }
  const latest=(out.versions||[]).find(v=>Number(v.version)===Number(out.latestVersion));
  out.state=latest?.sentAt?'sent':(out.versions||[]).some(v=>v.sentAt)?'resend':'pending';
  out.invoiceStatus=out.state==='sent'?'ready':'none';
  out.updatedAt=now;
  return out;
 }
 if(!l||l.pending||l.version!==Number(expected))throw Error('帳單已更新或尚未寄出，請先寄送最新版本並重新整理。');
 if(action==='collection'){
  const allowed=['issuer','paymentMethod','receivedDate','receivedAmount','dueDate','chequeNumber','bank','branch','reconciliationRequired'];
  const details={...(out.collectionRecord||{})};
  for(const key of allowed) if(Object.prototype.hasOwnProperty.call(payload,key)) details[key]=String(payload[key]??'').trim();
  if(!['','transfer','cheque'].includes(details.paymentMethod||''))throw Error('請選擇匯款或支票。');
  if(!['','yes','no'].includes(details.reconciliationRequired||''))throw Error('對帳設定不正確。');
  for(const key of ['receivedDate','dueDate']) if(details[key]&&!/^\d{4}-\d{2}-\d{2}$/.test(details[key]))throw Error('日期格式不正確。');
  if(details.receivedAmount==null)details.receivedAmount='';
  if(details.receivedAmount!==''){
   const amount=Number(details.receivedAmount);
   if(!Number.isFinite(amount)||amount<0)throw Error('入帳金額需為零或正數。');
   details.receivedAmount=amount;
  }
  details.updatedAt=now;out.collectionRecord=details;
 }
 else if(action==='confirm')out.paymentConfirmation={version:l.version,at:now};
 else if(action==='invoice') {
  const number=String(payload.number||'').trim().toUpperCase();
  if(!/^[A-Z]{2}[0-9]{8}$/.test(number))throw Error('發票號碼需為 2 碼英文及 8 碼數字。');
  if((out.invoiceHistory||[]).some(h=>String(h.number||'').toUpperCase()===number))throw Error('此發票號碼已有作廢紀錄，請使用重新開立的號碼。');
  if(out.invoiceRecord||out.invoiceStatus==='invoiced')throw Error('已有發票紀錄，請先核對原發票，不能重複登記或覆蓋。');
  if(!['manual','electronic'].includes(payload.method)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.date))throw Error('請填寫發票類型與日期。');
  out.invoiceRecord={number,method:payload.method,date:payload.date,amount:l.amount,version:l.version,at:now};out.invoiceStatus='invoiced';out.invoicedVersion=l.version;
 } else throw Error('不支援的操作');
 out.updatedAt=now;return out;
}
