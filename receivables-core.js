import { payableAmount } from './statement-case.js';
const group25th = ["良一", "良西", "良站前", "英迪格", "富野", "富汽", "富野制服", "然一", "H2O", "花季", "天子閣", "驛館", "洲際", "承億", "萊特薇庭", "帕鉑", "候工所"];
const groupEndOfMonth = ["捷站前", "捷中正", "歐遊", "鈞怡", "宮賞", "家和", "秝二", "秝芯", "比歐", "駱駝", "喜達絲", "好六" , "媚力泊" , "巨蛋" , "老新" , "永心", "福客來", "林森", "福客來", "建工", "鴨點棧明誠", "高廬", "頭等艙", "河畔", "好地方", "文旅", "文七", "文一", "禾鮨", "禾寓", "日航", "鼎王", "鴨點棧華夏", "鉑麗"];
const settlementAliases = { '天幕': '天慕' };


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
function resolvedGroup(name,groups={}) {
 const canonical=settlementAliases[name]||name;
 let group='';
 if(Object.hasOwn(groups,name)) group=groups[name];
 else if(Object.hasOwn(groups,canonical)) group=groups[canonical];
 else {
  for (const [alias,target] of Object.entries(settlementAliases)) if(target===name && Object.hasOwn(groups,alias)) group=groups[alias];
  if(!group) group=group25th.some(x=>canonical.includes(x))?'25th':groupEndOfMonth.some(x=>canonical.includes(x))?'month':'';
 }
 return group;
}
export function periodFor(name,month,groups={}) {
 const group=resolvedGroup(name,groups);
 const [y,m]=month.split('-').map(Number);
 if(group==='25th')return {start:new Date(Date.UTC(y,m-2,26)).toISOString().slice(0,10),end:month+'-25'};
 if(group==='month'||group==='1st')return {start:month+'-01',end:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
 return null;
}
function billingDue(group,period) {
 if(group!=='1st')return period.end;
 const [y,m]=period.end.split('-').map(Number);
 return new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
}
export function auditRows(names,cases,month,groups,today) {
 const rows=[];
 for(const name of new Set(names)) {
  const group=resolvedGroup(name,groups);
  const period=periodFor(name,month,groups);
  if(!period){rows.push({name,status:'未設定結帳組別',invoice:'待確認'});continue;}
  const due=billingDue(group,period);
  const c=cases.find(c=>c.customerKey===name&&c.startDate===period.start&&c.endDate===period.end);
  const v=c?.versions?.find(v=>Number(v.version)===Number(c.latestVersion));
  rows.push({name,period,c,status:due>today?'未到結帳日':!c?'未產單':v?.sentAt?'已寄送':sentVersion(c)?'待重寄':'未寄送',invoice:due>today?'未到結帳日':invoiceState(c)});
 }
 return rows;
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
