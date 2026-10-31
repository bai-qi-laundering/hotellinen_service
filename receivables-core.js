import { payableAmount } from './statement-case.js';
import { settlementGroup } from './firebase-signature/functions/lib/auto-close.js';


export function sentVersion(c) { return [...(c.versions||[])].filter(v=>v.sentAt).sort((a,b)=>b.version-a.version)[0]||null; }
export function ledger(c) {
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
 if(!l||l.pending||l.version!==Number(expected))throw Error('帳單已更新或尚未寄出，請先寄送最新版本並重新整理。');
 if(action==='confirm')out.paymentConfirmation={version:l.version,at:now};
 else if(action==='invoice') {
  if(!l.confirmed)throw Error('請先確認已收到飯店確認通知。');
  const number=String(payload.number||'').trim().toUpperCase();
  if(!/^[A-Z]{2}[0-9]{8}$/.test(number))throw Error('發票號碼需為 2 碼英文及 8 碼數字。');
  if(out.invoiceRecord||out.invoiceStatus==='invoiced')throw Error('已有發票紀錄，請先核對原發票，不能重複登記或覆蓋。');
  if(!['manual','electronic'].includes(payload.method)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.date))throw Error('請填寫發票類型與日期。');
  out.invoiceRecord={number,method:payload.method,date:payload.date,amount:l.amount,version:l.version,at:now};out.invoiceStatus='invoiced';out.invoicedVersion=l.version;
 } else throw Error('不支援的操作');
 out.updatedAt=now;return out;
}
