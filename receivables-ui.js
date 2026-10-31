import {legacyDatePrefixes} from './logistics-items.js';
import {manualReferenceHtml} from './manual-invoice-reference.js?v=20261031b';
import {ledger,applyLedger,auditRows,invoiceState,periodFor} from './receivables-core.js?v=20261031b';
import {formatCardAmount} from './statement-case.js';
import {createFirestoreRepository} from './statement-store.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import * as fs from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
const app=initializeApp({apiKey:'AIzaSyBEXcnXOKRags29CvhM6TKe3N-zty-ela4',authDomain:'hotel-inventory-3a1ad.firebaseapp.com',projectId:'hotel-inventory-3a1ad',appId:'1:363844184412:web:66cdd6425d53bde75f3999'},'receivables');
const db=fs.initializeFirestore(app,{localCache:fs.memoryLocalCache()});
const repo=createFirestoreRepository(db,fs,localStorage);
const root=document.getElementById('receivables'),mode=root.dataset.mode;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cases=[],names=[],groups={},activeNames=new Set(),loading=false,available=false,sequence=0;
root.innerHTML=`<h2>${mode==='audit'?'本月防漏偵測':'貨款登記'}</h2><p>寄送、飯店確認與開票分別記錄；金額直接沿用財務對帳單。</p><div class="ledger-tools"><label>月份 <input id="ledger-month" type="month" value="${today.slice(0,7)}"></label><input id="ledger-search" placeholder="搜尋飯店" aria-label="搜尋飯店"><select id="ledger-filter" aria-label="篩選"><option value="">全部</option><option>未產單</option><option>未寄送</option><option>待重寄</option><option>未開票</option><option>開票後有變</option><option>本期無物流紀錄，待確認</option></select><button id="ledger-refresh" type="button">重新整理</button></div><p id="ledger-message" role="status"></p><div id="ledger-list"></div><dialog id="ledger-dialog"><form id="ledger-form"><h2 id="ledger-title"></h2><div id="ledger-fields"></div><p id="ledger-error" role="alert"></p><footer><button type="button" id="ledger-cancel">返回</button><button id="ledger-save">儲存</button></footer></form></dialog>`;
const $=id=>document.getElementById('ledger-'+id);
async function timeout(p){let t;try{return await Promise.race([p,new Promise((_,r)=>t=setTimeout(()=>r(Error('雲端讀取逾時，請重試；尚不能判定是否漏寄。')),20000))]);}finally{clearTimeout(t);}}
function render(){
 if(!available)return;
 const month=$('month').value,q=$('search').value.trim().toLowerCase(),filter=$('filter').value;
 let rows=mode==='audit'?auditRows(names,cases,month,groups,today):cases.filter(c=>c.endDate?.startsWith(month)&&ledger(c)).map(c=>({name:c.customerName||c.customerKey,c,period:{start:c.startDate,end:c.endDate},status:ledger(c).pending?'待重寄':'已寄送',invoice:invoiceState(c)}));
 if(mode==='audit')rows=rows.map(r=>!activeNames.has(r.name)&&!r.c?{...r,status:'本期無物流紀錄，待確認',invoice:'待確認'}:r);
 rows=rows.filter(r=>[r.name,r.c?.customerKey,r.c?.customerName].some(n=>String(n||'').toLowerCase().includes(q))&&(!filter||r.status===filter||r.invoice===filter||(filter==='未寄送'&&['未產單','待重寄','未寄送'].includes(r.status))));
 $('list').innerHTML=rows.length?rows.map(r=>{const l=r.c&&ledger(r.c);return `<article class="ledger-row"><h3>${esc(r.name)}</h3>${r.c&&r.c.customerKey!==r.name?`<p>飯店：${esc(r.c.customerKey)}</p>`:''}<p>${esc(r.period?`${r.period.start} ～ ${r.period.end}`:'請至財務設定結帳組別')}</p><p><b>${esc(r.status)}</b> · ${esc(r.invoice)}</p>${l?`<strong>${formatCardAmount(l.amount)}</strong><p>已寄版本 V${l.version}${l.pending?' · 新版待重寄，金額將於登記重寄後更新':''}</p><p>${l.confirmed?'已收到飯店確認':'等待飯店確認通知'}</p>${l.invoice?`<p>發票 ${esc(l.invoice.number)} · ${formatCardAmount(l.invoice.amount)}</p>`:''}`:''}${mode==='payments'&&l?`<button data-confirm="${esc(r.c.id)}" ${l.pending||l.confirmed?'disabled':''}>已收到飯店確認通知</button> <button data-invoice="${esc(r.c.id)}" ${l.pending||!l.confirmed||r.invoice!=='未開票'?'disabled':''}>登記手開／電子發票</button>`:''}</article>`;}).join(''):'<p>此條件沒有紀錄。</p>';
 $('list').querySelectorAll('[data-confirm]').forEach(b=>b.onclick=()=>open(b.dataset.confirm,'confirm'));
 $('list').querySelectorAll('[data-invoice]').forEach(b=>b.onclick=()=>open(b.dataset.invoice,'invoice'));
}
async function config(key){const s=await fs.getDocFromServer(fs.doc(db,'inventory_config',key));return s.exists()?s.data():{};}
async function periodCustomers(month){
 const [y,m]=month.split('-').map(Number),start=new Date(Date.UTC(y,m-2,26)).toISOString().slice(0,10),end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
 const col=fs.collection(db,'logistics_records');
 const queries=legacyDatePrefixes(start,end).map(prefix=>fs.query(col,fs.where('date','>=',prefix),fs.where('date','<=',prefix+'\uf8ff')));
 queries.push(fs.query(col,fs.where('date','>=',new Date(start+'T00:00:00+08:00')),fs.where('date','<=',new Date(end+'T23:59:59.999+08:00'))));
 const names=new Set();
 for(const snap of await Promise.all(queries.map(q=>fs.getDocsFromServer(q))))for(const row of snap.docs){
 const d=row.data();if(d.manualDeletedReceipt)continue;
 const parent=String(d.hotelKeyword||'').trim(),dept=String(d.deptName||'').trim();
 if(!parent||parent.includes('回洗')||dept.includes('回洗'))continue;
 const raw=d.date?.toDate?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d.date.toDate()):String(d.date||'');
 const match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);if(!match)continue;
 const date=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
 const name=parent==='鼎王'&&dept&&dept!==parent?parent+' '+dept:parent;
 names.add(JSON.stringify({name,date}));
 }
 return [...names].map(x=>JSON.parse(x));
}
async function reload(){
 if(new URLSearchParams(location.search).get('store')==='local'){ $('message').textContent='本機檢查模式：不讀寫正式貨款與防漏資料。';return; }
 const token=++sequence;available=false;$('list').textContent='讀取中…';$('message').textContent='';
 try{
 const result=await timeout(repo.list());
 if(result.fromCache||result.cloudError||result.cases.some(c=>c.cloudPending))throw Error('雲端尚未完整同步，暫不判定防漏或開票，請重新整理。');
 let newNames=[],newGroups={},newActive=new Set();
 if(mode==='audit'){
 const [settings,activity]=await timeout(Promise.all([config('finance_settlement_groups'),periodCustomers($('month').value)]));
 newGroups=settings.groups||{};
 for(const r of activity){const period=periodFor(r.name,$('month').value,newGroups);if(!period||(r.date>=period.start&&r.date<=period.end))newActive.add(r.name);}
 newNames=[...newActive,...Object.keys(newGroups),...result.cases.filter(c=>c.endDate?.startsWith($('month').value)).map(c=>c.customerKey)];
 if(newNames.some(n=>n.startsWith('鼎王 ')))newNames=newNames.filter(n=>n!=='鼎王');
 if(!newNames.length)throw Error('飯店名單尚未讀取完成，不能判定本月沒有漏件。');
 }
 if(token!==sequence)return;cases=result.cases;names=newNames;groups=newGroups;activeNames=newActive;available=true;
 $('message').textContent=mode==='audit'?'依本期物流客戶及既有結帳組別核對；設定名單若無本期紀錄會標示待確認，不直接判定漏件。':'只列出已登記寄送的對帳單；重寄後沿用同一筆貨款更新金額。';render();
 }catch(e){if(token===sequence){$('message').textContent=e.message;$('list').textContent='讀取未完成，請重試。';}}
}
let selected=null,action='';
function open(id,type){selected=cases.find(c=>c.id===id);action=type;const l=ledger(selected);$('title').textContent=type==='confirm'?'確認收到飯店通知':'登記已開立的發票';$('error').textContent='';$('fields').innerHTML=type==='confirm'?`<p>${esc(selected.customerName||selected.customerKey)} · V${l.version} · ${formatCardAmount(l.amount)}</p><label><input type="checkbox" required> 我已收到飯店確認這一版對帳單的通知</label>`:`<p>汎宇 API 尚未串接；電子發票請先於平台開立，再登記號碼。</p><div id="ledger-reference"></div><label>類型<select name="method"><option value="manual">手開發票</option><option value="electronic">已在平台開立電子發票</option></select></label><label>發票日期<input name="date" type="date" required value="${today}"></label><label>發票號碼<input name="number" required pattern="[A-Za-z]{2}[0-9]{8}" maxlength="10" placeholder="AB12345678"></label><label><input type="checkbox" required> 已開立並核對發票金額</label>`;if(type==='invoice'){
 const form=$('form'),update=()=>{$('reference').innerHTML=manualReferenceHtml({buyer:l.snapshot.profile?.name,taxId:l.snapshot.profile?.taxId,date:form.elements.date.value||today,item:selected.endDate.slice(0,7)+' 洗滌費',net:l.snapshot.totals.afterRebate,tax:l.snapshot.totals.tax,total:l.amount,version:l.version},form.elements.number.value);};
 form.elements.date.onchange=update;form.elements.number.oninput=update;update();
 }$('dialog').showModal();}
$('cancel').onclick=()=>{if(!loading)$('dialog').close();};
$('form').onsubmit=async e=>{e.preventDefault();if(loading)return;loading=true;$('save').disabled=true;$('error').textContent='';const l=ledger(selected),payload=Object.fromEntries(new FormData(e.target));try{
 await fs.runTransaction(db,async tx=>{const ref=fs.doc(db,'statement_cases',selected.id),snap=await tx.get(ref);if(!snap.exists())throw Error('帳單不存在');const updated=applyLedger({id:selected.id,...snap.data()},l.version,action,payload,new Date().toISOString());tx.set(ref,updated);});
 $('dialog').close();window.parent.postMessage({type:'baiqi-ledger-updated'},location.origin);await reload();
 }catch(err){$('error').textContent=err.message;}finally{loading=false;$('save').disabled=false;}};
$('search').oninput=render;$('filter').onchange=render;$('month').onchange=reload;$('refresh').onclick=reload;
window.addEventListener('message',e=>{if(e.origin===location.origin&&['baiqi-refresh-statements','baiqi-ledger-updated'].includes(e.data?.type))reload();});
window.addEventListener('baiqi-sent-registered',reload);
reload();
