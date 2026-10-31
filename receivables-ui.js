import {manualReferenceHtml} from './manual-invoice-reference.js?v=20261031c';
import {ledger,applyLedger,invoiceState} from './receivables-core.js?v=20261101-simple';
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
const PAYMENT_CONFIG=[{"name":"洲際","issuer":"百麒國際","method":"transfer","order":3,"taxId":"91097496","title":"遠洋投資(股)公司高雄分公司"},{"name":"然一","issuer":"百麒國際","method":"transfer","order":4,"taxId":"59269713","title":"御盟酒店(股)公司灣區分公司"},{"name":"然一-客衣","issuer":"百麒國際","method":"transfer","order":5,"taxId":"59269713","title":"御盟酒店(股)公司灣區分公司"},{"name":"驛館","issuer":"百麒國際","method":"transfer","order":6,"taxId":"92165561","title":"御盟國際驛館(股)公司高雄營業所"},{"name":"驛館-餐廳","issuer":"百麒國際","method":"transfer","order":7,"taxId":"92165561","title":"御盟國際驛館(股)公司高雄營業所"},{"name":"H2O","issuer":"百麒國際","method":"transfer","order":8,"taxId":"24978226","title":"水京棧國際酒店(股)公司"},{"name":"萊特薇庭","issuer":"百麒國際","method":"transfer","order":9,"taxId":"51519007","title":"新薇(股)公司"},{"name":"良站前","issuer":"百麒國際","method":"cheque","order":10,"taxId":"27696636","title":"長揚建設(股)公司"},{"name":"良西+良一","issuer":"百麒國際","method":"cheque","order":11,"taxId":"53589534","title":"碧港良居商旅(股)公司"},{"name":"英迪格","issuer":"百麒國際","method":"transfer","order":12,"taxId":"83603127","title":"頭等艙飯店有限公司英迪格分公司"},{"name":"富野","issuer":"百麒國際","method":"transfer","order":13,"taxId":"54534755","title":"富野大飯店(股)公司高雄分公司"},{"name":"帕鉑","issuer":"百麒國際","method":"transfer","order":14,"taxId":"59234476","title":"承崗開發(股)公司"},{"name":"候工所","issuer":"百麒國際","method":"transfer","order":15,"taxId":"94169640","title":"承崗開發(股)公司高雄港分公司"},{"name":"承億藝術","issuer":"百麒國際","method":"transfer","order":16,"taxId":"","title":""},{"name":"天子閤","issuer":"百麒國際","method":"cheque","order":17,"taxId":"54204229","title":"欣城資產開發(股)公司"},{"name":"塩旅","issuer":"百麒國際","method":"cheque","order":18,"taxId":"83154466","title":"泊思餐旅管理顧問有限公司"},{"name":"日航","issuer":"百麒國際","method":"transfer","order":19,"taxId":"94196668","title":"大和飯店管理顧問(股)公司"},{"name":"好地方","issuer":"百麒國際","method":"transfer","order":20,"taxId":"54214520","title":"好地方三多(股)公司"},{"name":"好地方六合館","issuer":"百麒國際","method":"transfer","order":21,"taxId":"89164743","title":"好地方六合(股)公司"},{"name":"文旅","issuer":"百麒國際","method":"transfer","order":22,"taxId":"54196261","title":"好地方飯店(股)公司"},{"name":"文旅七賢館","issuer":"百麒國際","method":"transfer","order":23,"taxId":"93781043","title":"高雄旅居文旅(股)公司七賢分公司"},{"name":"文旅一心館","issuer":"百麒國際","method":"transfer","order":24,"taxId":"90464037","title":"高雄旅居文旅(股)公司"},{"name":"捷中正","issuer":"百麒國際","method":"cheque","order":25,"taxId":"53678682","title":"悅寶企業(股)公司高雄中正分公司"},{"name":"捷站前","issuer":"百麒國際","method":"cheque","order":26,"taxId":"24796632","title":"悅寶企業(股)公司高雄站前分公司"},{"name":"鈞怡","issuer":"百麒國際","method":"cheque","order":27,"taxId":"59256463","title":"鈞晟(股)公司"},{"name":"宮賞","issuer":"百麒國際","method":"cheque","order":28,"taxId":"29025389","title":"宮賞國際(股)公司"},{"name":"家和","issuer":"百麒國際","method":"cheque","order":29,"taxId":"22061748","title":"鈞統興業有限公司"},{"name":"秝芯","issuer":"百麒國際","method":"cheque","order":30,"taxId":"79808746","title":"秝芯旅店"},{"name":"秝二","issuer":"百麒國際","method":"cheque","order":31,"taxId":"42803537","title":"秝芯旅店(股)公司"},{"name":"比歐","issuer":"百麒國際","method":"transfer","order":32,"taxId":"54638055","title":"比歐旅館事業有限公司"},{"name":"河畔","issuer":"百麒國際","method":"transfer","order":33,"taxId":"59701112","title":"河畔文旅(股)公司"},{"name":"駱駝","issuer":"百麒國際","method":"transfer","order":34,"taxId":"54192434","title":"駱駝旅棧(股)公司"},{"name":"媚力泊","issuer":"百麒國際","method":"cheque","order":35,"taxId":"24685592","title":"光力開發實業有限公司"},{"name":"頭等艙","issuer":"百麒國際","method":"transfer","order":36,"taxId":"42989392","title":"頭等艙飯店有限公司高雄站前分公司"},{"name":"喜達絲","issuer":"百麒國際","method":"transfer","order":37,"taxId":"53236645","title":"全球商旅有限公司"},{"name":"癮室","issuer":"百麒國際","method":"transfer","order":38,"taxId":"80664084","title":"癮室(股)公司"},{"name":"鴨點棧-華夏","issuer":"百麒國際","method":"transfer","order":39,"taxId":"62163056","title":"高禾鴨有限公司"},{"name":"鴨點棧-明誠","issuer":"百麒國際","method":"transfer","order":40,"taxId":"83788047","title":"鴨點棧有限公司"},{"name":"禾寓","issuer":"百麒國際","method":"transfer","order":41,"taxId":"60390153","title":"禾寓餐飲有限公司"},{"name":"高廬","issuer":"百麒國際","method":"transfer","order":42,"taxId":"82682741","title":"高廬餐飲小吃館"},{"name":"禾鮨","issuer":"百麒國際","method":"transfer","order":43,"taxId":"93512646","title":"禾餐飲有限公司"},{"name":"鼎王-七賢店","issuer":"百麒國際","method":"transfer","order":44,"taxId":"53550600","title":"鼎王國際餐飲股份有限公司高雄七賢分公司"},{"name":"鼎王-富國店","issuer":"百麒國際","method":"transfer","order":45,"taxId":"53738226","title":"鼎王國際餐飲股份有限公司高雄富國分公司"},{"name":"無老鍋","issuer":"百麒國際","method":"transfer","order":46,"taxId":"94221603","title":"鼎王國際餐飲股份有限公司無老鍋高雄苓雅分公司"},{"name":"歐遊","issuer":"百麒國際","method":"transfer","order":47,"taxId":"28903562","title":"歐遊國際(股)公司高雄分公司"},{"name":"承億","issuer":"百麒","method":"transfer","order":49,"taxId":"90373873","title":"承億酒店(股)公司"},{"name":"花季","issuer":"百麒","method":"cheque","order":50,"taxId":"28596678","title":"花季飯店事業(股)公司大崗山分公司"},{"name":"巨蛋","issuer":"百富","method":"cheque","order":52,"taxId":"53902289","title":"裕力開發有限公司"},{"name":"老新","issuer":"日聖","method":"cheque","order":54,"taxId":"24667567","title":"老新餐飲有限公司"},{"name":"永心","issuer":"日聖","method":"cheque","order":55,"taxId":"72185131","title":"永心鳳茶有限公司同盟營業所"},{"name":"福客來","issuer":"日聖","method":"transfer","order":56,"taxId":"28616647","title":"福客來中餐廳有限公司"},{"name":"林森","issuer":"日聖","method":"transfer","order":57,"taxId":"28306262","title":"南北樓餐飲事業有限公司"},{"name":"建工","issuer":"日聖","method":"transfer","order":58,"taxId":"53232649","title":"逢友園餐廳有限公司"},{"name":"雅樂十刻","issuer":"日聖","method":"transfer","order":59,"taxId":"60589437","title":"十刻好時光有限公司"},{"name":"雅樂廚苑","issuer":"日聖","method":"transfer","order":60,"taxId":"71456851","title":"怡廚商號"}];
const ISSUER_ORDER=['百麒國際','百麒','百富','日聖','未設定開票公司'];
const normalizeName=s=>String(s||'').normalize('NFKC').replace(/[\s\-－＋+／/()（）]/g,'').toLowerCase();
function customerConfig(c){
 const name=normalizeName(c.customerKey),l=ledger(c);
 const exact=PAYMENT_CONFIG.find(row=>normalizeName(row.name)===name);
 if(exact)return exact;
 const tax=String(l?.snapshot?.profile?.taxId||'').replace(/\D/g,'');
 const matches=tax?PAYMENT_CONFIG.filter(row=>row.taxId===tax):[];
 if(matches.length&&matches.every(row=>row.issuer===matches[0].issuer&&row.method===matches[0].method))return matches[0];
 return {issuer:c.collectionRecord?.issuer||'未設定開票公司',method:c.collectionRecord?.paymentMethod||'',order:9999,title:''};
}
let cases=[],loading=false,available=false,sequence=0;
function billingMonth(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const date=new Date(Date.UTC(parts.year,parts.month-1-(parts.day<=24?1:0),1));
 return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0');
}
root.innerHTML=`<h2>貨款登記</h2><p>金額沿用已寄送的對帳單。</p><div class="ledger-tools"><label>月份 <input id="ledger-month" type="month" value="${billingMonth()}"></label><input id="ledger-search" placeholder="搜尋飯店" aria-label="搜尋飯店"><select id="ledger-filter" aria-label="篩選"><option value="">全部</option><option>待重寄</option><option>未開票</option><option>開票後有變</option></select><button id="ledger-refresh" type="button">重新整理</button></div><p id="ledger-message" role="status"></p><div id="ledger-list"></div><dialog id="ledger-dialog"><form id="ledger-form"><h2 id="ledger-title"></h2><div id="ledger-fields"></div><p id="ledger-error" role="alert"></p><footer><button type="button" id="ledger-cancel">返回</button><button id="ledger-save">儲存</button></footer></form></dialog>`;
const $=id=>document.getElementById('ledger-'+id);
async function timeout(p){let t;try{return await Promise.race([p,new Promise((_,r)=>t=setTimeout(()=>r(Error('雲端讀取逾時，請重試。')),20000))]);}finally{clearTimeout(t);}}
function render(){
 if(!available)return;
 const month=$('month').value,q=$('search').value.trim().toLowerCase(),filter=$('filter').value;
 const rows=cases.filter(c=>c.endDate?.startsWith(month)&&ledger(c)).map(c=>({name:c.customerKey||c.customerName,c,period:{start:c.startDate,end:c.endDate},status:ledger(c).pending?'待重寄':'已寄送',invoice:invoiceState(c)})).filter(r=>[r.name,r.c?.customerKey,r.c?.customerName].some(n=>String(n||'').toLowerCase().includes(q))&&(!filter||r.status===filter||r.invoice===filter));
 rows.forEach(r=>{r.config=customerConfig(r.c);});
 rows.sort((a,b)=>{
  const companyRank=r=>{const index=ISSUER_ORDER.indexOf(r.config.issuer);return index<0?ISSUER_ORDER.length:index;};
  return companyRank(a)-companyRank(b)||a.config.issuer.localeCompare(b.config.issuer,'zh-TW')||Number(a.c.endDate.slice(-2))-Number(b.c.endDate.slice(-2))||a.config.order-b.config.order||a.name.localeCompare(b.name,'zh-TW')||a.c.id.localeCompare(b.c.id);
 });
 let previousIssuer='';
 $('list').innerHTML=rows.length?'<div class="ledger-table-scroll"><table class="ledger-table"><thead><tr>'+['客戶','開立發票','付款','未稅','稅金','含稅','入帳日','入帳金額','到期日','票號','銀行','分行'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>{
 const l=ledger(r.c),v=r.c.collectionRecord||{},disabled=l.pending?'disabled':'';
 const field=(key,type='text')=>'<input data-field="'+key+'" type="'+type+'" value="'+esc(v[key]??'')+'" aria-label="'+esc(r.name+' '+({receivedDate:'入帳日',receivedAmount:'入帳金額',dueDate:'支票到期日',chequeNumber:'支票號碼',bank:'銀行',branch:'分行'}[key]||key))+'" '+(type==='number'?'min="0" step="0.01" ':'')+disabled+'>';
 const invoice=l.invoice?.number||r.c.invoiceNumber||'';
 const title=l.snapshot.profile?.name||r.config.title||r.c.customerName||'';
 const heading=previousIssuer!==r.config.issuer?'<tr class="ledger-company"><th colspan="12">'+esc(r.config.issuer)+'</th></tr>':'';
 previousIssuer=r.config.issuer;
 const invoiceCell=invoice?'<span class="ledger-invoice-number" title="'+esc(r.invoice)+'">'+esc(invoice)+'</span>':'<button data-invoice="'+esc(r.c.id)+'" '+(l.pending||r.invoice!=='未開票'?'disabled':'')+' title="先在平台開票，再登記發票號碼">開立發票</button>';
 return heading+'<tr data-case="'+esc(r.c.id)+'" class="'+(l.pending?'ledger-pending':'')+'"><td class="ledger-customer"><strong>'+esc(r.name)+'</strong><small>'+esc(title)+'</small></td><td>'+invoiceCell+'</td><td class="ledger-payment">'+esc(r.config.method==='transfer'?'匯款':r.config.method==='cheque'?'支票':'未設定')+'</td><td class="ledger-money">'+formatCardAmount(l.snapshot.totals.afterRebate)+'</td><td class="ledger-money">'+formatCardAmount(l.snapshot.totals.tax)+'</td><td class="ledger-money"><strong>'+formatCardAmount(l.amount)+'</strong></td><td>'+field('receivedDate','date')+'</td><td>'+field('receivedAmount','number')+'</td><td>'+field('dueDate','date')+'</td><td>'+field('chequeNumber')+'</td><td>'+field('bank')+'</td><td>'+field('branch')+'<button data-collection="'+esc(r.c.id)+'" '+disabled+'>儲存</button><small class="ledger-row-status" role="status"></small></td></tr>';
 }).join('')+'</tbody></table></div>':'<p>此條件沒有紀錄。</p>';
 $('list').querySelectorAll('[data-invoice]').forEach(b=>b.onclick=()=>open(b.dataset.invoice,'invoice'));
 $('list').querySelectorAll('[data-collection]').forEach(b=>b.onclick=()=>saveCollection(b));
}
async function saveCollection(button){
 const row=button.closest('tr'),id=button.dataset.collection,c=cases.find(c=>c.id===id),l=ledger(c),status=row.querySelector('.ledger-row-status');
 const payload=Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]));
 const config=customerConfig(c);payload.issuer=config.issuer==='未設定開票公司'?'':config.issuer;payload.paymentMethod=config.method;
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
