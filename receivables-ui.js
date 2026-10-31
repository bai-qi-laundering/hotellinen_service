import {manualReferenceHtml} from './manual-invoice-reference.js?v=20261031c';
import {ledger,applyLedger,invoiceState} from './receivables-core.js?v=20261101-table';
import {formatCardAmount} from './statement-case.js';
import {createFirestoreRepository} from './statement-store.js?v=20261101-month-query';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import * as fs from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
const app=initializeApp({apiKey:'AIzaSyBEXcnXOKRags29CvhM6TKe3N-zty-ela4',authDomain:'hotel-inventory-3a1ad.firebaseapp.com',projectId:'hotel-inventory-3a1ad',appId:'1:363844184412:web:66cdd6425d53bde75f3999'},'receivables');
const db=fs.initializeFirestore(app,{localCache:fs.memoryLocalCache(),experimentalForceLongPolling:true,useFetchStreams:false});
const repo=createFirestoreRepository(db,fs,localStorage);
const root=document.getElementById('receivables');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cases=[],loading=false,available=false,sequence=0;
function billingMonth(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const date=new Date(Date.UTC(parts.year,parts.month-1-(parts.day<=24?1:0),1));
 return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0');
}
root.innerHTML=`<h2>貨款登記</h2><p>寄送、飯店確認與開票分別記錄；金額直接沿用財務對帳單。</p><div class="ledger-tools"><label>月份 <input id="ledger-month" type="month" value="${billingMonth()}"></label><input id="ledger-search" placeholder="搜尋飯店" aria-label="搜尋飯店"><select id="ledger-filter" aria-label="篩選"><option value="">全部</option><option>待重寄</option><option>未開票</option><option>開票後有變</option></select><button id="ledger-refresh" type="button">重新整理</button></div><p id="ledger-message" role="status"></p><div id="ledger-list"></div><dialog id="ledger-dialog"><form id="ledger-form"><h2 id="ledger-title"></h2><div id="ledger-fields"></div><p id="ledger-error" role="alert"></p><footer><button type="button" id="ledger-cancel">返回</button><button id="ledger-save">儲存</button></footer></form></dialog>`;
const $=id=>document.getElementById('ledger-'+id);
async function timeout(p){let t;try{return await Promise.race([p,new Promise((_,r)=>t=setTimeout(()=>r(Error('雲端讀取逾時，請重試。')),20000))]);}finally{clearTimeout(t);}}
function render(){
 if(!available)return;
 const month=$('month').value,q=$('search').value.trim().toLowerCase(),filter=$('filter').value;
 const rows=cases.filter(c=>c.endDate?.startsWith(month)&&ledger(c)).map(c=>({name:c.customerKey||c.customerName,c,period:{start:c.startDate,end:c.endDate},status:ledger(c).pending?'待重寄':'已寄送',invoice:invoiceState(c)})).filter(r=>[r.name,r.c?.customerKey,r.c?.customerName].some(n=>String(n||'').toLowerCase().includes(q))&&(!filter||r.status===filter||r.invoice===filter));
 $('list').innerHTML=rows.length?'<div class="ledger-table-scroll"><table class="ledger-table"><thead><tr>'+['對／結帳','客戶','發票登記／號碼','發票','付款','未稅','稅金','含稅','入帳日','入帳金額','到期日','票號','銀行','分行'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>{
 const l=ledger(r.c),v=r.c.collectionRecord||{},disabled=l.pending?'disabled':'';
 const field=(key,type='text')=>'<input data-field="'+key+'" type="'+type+'" value="'+esc(v[key]??'')+'" aria-label="'+esc(r.name+' '+({issuer:'開票公司',receivedDate:'入帳日',receivedAmount:'入帳金額',dueDate:'支票到期日',chequeNumber:'支票號碼',bank:'銀行',branch:'分行'}[key]||key))+'" '+(type==='number'?'min="0" step="0.01" ':'')+disabled+'>';
 const select=(key,choices)=>'<select data-field="'+key+'" aria-label="'+esc(r.name+' '+(key==='paymentMethod'?'付款方式':'需否對帳'))+'" '+disabled+'>'+choices.map(([value,label])=>'<option value="'+value+'" '+(String(v[key]??'')===value?'selected':'')+'>'+label+'</option>').join('')+'</select>';
 const end=r.c.endDate||'',day=Number(end.slice(-2)),last=new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7)),0)).getUTCDate(),period=day===last?'月底結':day+'日結';
 const invoice=l.invoice?.number||r.c.invoiceNumber||'';
 return '<tr data-case="'+esc(r.c.id)+'" class="'+(l.pending?'ledger-pending':'')+'"><td>'+select('reconciliationRequired',[['','對帳未設定'],['yes','需對帳'],['no','不需對帳']])+'<div>'+esc(period)+'</div></td><td class="ledger-customer"><strong>'+esc(r.name)+'</strong><small>'+esc(r.c.startDate+' ～ '+r.c.endDate)+'</small><small>'+esc(r.status)+' · 已寄 V'+l.version+'</small>'+(l.confirmed?'<small>已收到飯店確認</small>':'<button data-confirm="'+esc(r.c.id)+'" '+disabled+'>收到飯店確認</button>')+'</td><td><span class="ledger-invoice-number">'+esc(invoice||'尚未登記')+'</span><small>'+esc(r.invoice)+'</small><button data-invoice="'+esc(r.c.id)+'" '+(l.pending||!l.confirmed||r.invoice!=='未開票'?'disabled':'')+'>登記手開／電子發票</button></td><td>'+field('issuer')+'</td><td>'+select('paymentMethod',[['','請選擇'],['transfer','匯款'],['cheque','支票']])+'</td><td class="ledger-money">'+formatCardAmount(l.snapshot.totals.afterRebate)+'</td><td class="ledger-money">'+formatCardAmount(l.snapshot.totals.tax)+'</td><td class="ledger-money"><strong>'+formatCardAmount(l.amount)+'</strong></td><td>'+field('receivedDate','date')+'</td><td>'+field('receivedAmount','number')+'</td><td>'+field('dueDate','date')+'</td><td>'+field('chequeNumber')+'</td><td>'+field('bank')+'</td><td>'+field('branch')+'<button data-collection="'+esc(r.c.id)+'" '+disabled+'>儲存本列</button><small class="ledger-row-status" role="status"></small></td></tr>';
 }).join('')+'</tbody></table></div>':'<p>此條件沒有紀錄。</p>';
 $('list').querySelectorAll('[data-confirm]').forEach(b=>b.onclick=()=>open(b.dataset.confirm,'confirm'));
 $('list').querySelectorAll('[data-invoice]').forEach(b=>b.onclick=()=>open(b.dataset.invoice,'invoice'));
 $('list').querySelectorAll('[data-collection]').forEach(b=>b.onclick=()=>saveCollection(b));
}
async function saveCollection(button){
 const row=button.closest('tr'),id=button.dataset.collection,c=cases.find(c=>c.id===id),l=ledger(c),status=row.querySelector('.ledger-row-status');
 const payload=Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]));
 button.disabled=true;status.textContent='儲存中…';
 try{
  let saved;
  await fs.runTransaction(db,async tx=>{
   const ref=fs.doc(db,'statement_cases',id),snap=await tx.get(ref);
   if(!snap.exists())throw Error('帳單不存在');
   saved=applyLedger({id,...snap.data()},l.version,'collection',payload,new Date().toISOString());
   tx.set(ref,saved);
  });
  cases=cases.map(item=>item.id===id?saved:item);status.textContent='已儲存';
 }catch(error){status.textContent=error.message||'儲存失敗，請重試';}
 finally{button.disabled=false;}
}
async function reload(){
 if(new URLSearchParams(location.search).get('store')==='local'){ $('message').textContent='本機檢查模式：不讀寫正式貨款資料。';return; }
 const token=++sequence;available=false;$('list').textContent='讀取中…';$('message').textContent='';
 try{
 const result=await timeout(repo.list({skipFlush:true,month:$('month').value}));
 if(token!==sequence)return;
 if(result.fromCache||result.cloudError)throw Error('雲端讀取未完成，暫不判定開票，請重新整理。');cases=result.cases.filter(c=>!c.cloudPending);available=true;
 $('message').textContent='只列出已登記寄送的對帳單；重寄後沿用同一筆貨款更新金額。'+(result.cases.some(c=>c.cloudPending)?' 部分資料尚未同步，暫不提供這些帳單的貨款操作。':'');render();
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
