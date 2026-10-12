/* Opt-in plant verification. Does not alter normal inventory cards or outbound records. */
(function(){
 const core=window.SendwashCore,records=new Map();let db,api,unsubscribe,ready=false,active=null,saving=false,sequence=0;
 const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.startSendwashVerification=async database=>{db=database;api=await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');ready=true;};
 window.attachSendwashListener=async dates=>{
 const request=++sequence;
 if(!ready){await window.sendwashVerificationReady;if(!ready)return;}
 if(request!==sequence)return;
 if(unsubscribe)unsubscribe();records.clear();
 unsubscribe=api.onSnapshot(api.query(api.collection(db,'sendwash_records'),api.where('targetDate','in',dates)),snap=>{
  records.clear();snap.forEach(d=>records.set(d.id,{id:d.id,...d.data()}));renderItems(true);
 },error=>{console.warn('送洗對點單讀取失敗',error);showMessage('送洗對點单無法載入，請檢查網路及 Firebase 權限。原有登記功能仍可使用。');});
 };
 window.sendwashPendingItems=(date,hotel)=>[...new Set([...records.values()].filter(r=>r.targetDate===date&&r.inventoryHotel===hotel&&!r.acceptedAt).flatMap(r=>r.items.map(i=>i.item)))];
 window.sendwashCard=(item,date,hotel,u)=>{
 const pending=[...records.values()].filter(r=>r.targetDate===date&&r.inventoryHotel===hotel&&!r.acceptedAt&&r.items.some(x=>x.item===item));
 if(!pending.length)return null; // Received items use the original two-signature inventory card.
 const id=window.getSafeId(item),total=Number(u.count || 0)+pending.reduce((s,r)=>s+Number(r.items.find(x=>x.item===item).quantity),0);
 const card=document.createElement('div');card.id=`card_${id}`;card.className='bg-white border-2 border-blue-200 rounded-2xl p-4';
 const first=pending[0],sourceId=escape(first.id),note=first.notes?.[item] ?? u.note ?? '';
 card.innerHTML=`<div class="font-black text-2xl text-gray-800 mb-3">${escape(item)}</div>
 <div class="flex gap-2 mb-4">
  <div class="flex-1 bg-gray-50 rounded-xl p-3 border border-gray-200 flex flex-col justify-between min-w-0">
   <div class="text-sm font-bold text-gray-500 mb-2 text-center">廠內實點</div>
   <button type="button" data-sendwash-id="${sourceId}" class="w-full px-1 py-3 text-center font-black text-3xl border-b-4 rounded-t-lg mb-3 bg-white text-gray-800 border-blue-300 shadow-inner">${escape(total)}</button>
   <div class="item-action" data-sendwash-first-actions></div>
  </div>
  <div class="flex-1 bg-blue-50 rounded-xl p-3 border border-blue-200 flex flex-col justify-between min-w-0">
   <div class="text-sm font-bold text-blue-700 mb-2 text-center">複點確認</div>
   <button type="button" data-sendwash-outbound class="w-full px-1 py-3 text-center font-black text-3xl border-b-4 rounded-t-lg mb-3 bg-white text-blue-400 border-blue-200">等待輸入</button>
   <div class="item-action"><button type="button" data-sendwash-outbound class="w-full py-2 bg-green-600 text-white rounded-lg font-bold shadow-md text-sm active:bg-green-700">第二步-複點簽名</button></div>
  </div>
 </div>
 <input type="text" id="note_${id}" data-sendwash-note="${sourceId}" data-sendwash-item="${escape(item)}" value="${escape(note)}" class="w-full p-3 border border-gray-200 rounded-xl text-base outline-none bg-gray-50 focus:border-blue-500" placeholder="📝 點此可寫備註(寫完自動存)">`;
 const actions=card.querySelector('[data-sendwash-first-actions]');
 pending.forEach(r=>{const button=document.createElement('button');button.type='button';button.className='w-full py-2 bg-blue-600 text-white rounded-lg font-bold shadow-md text-sm active:bg-blue-700';button.textContent=pending.length>1 ? `第一步-簽名（${r.sourceDate}）` : '第一步-簽名';button.dataset.sendwashId=r.id;actions.append(button);});
 return card.outerHTML;
 };
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-sendwash-outbound]')) { showMessage('請先完成左側廠內實點數量及簽名，再進行右側複點確認'); return; }
  const button=e.target.closest('[data-sendwash-id]');if(button)open(button.dataset.sendwashId);
 });
 document.addEventListener('change',async e=>{
  const input=e.target.closest('[data-sendwash-note]');if(!input)return;
  const value=input.value,item=input.dataset.sendwashItem,sourceId=input.dataset.sendwashNote;
  try {
   await api.runTransaction(db,async tx=>{
    const recordRef=api.doc(db,'sendwash_records',sourceId),snap=await tx.get(recordRef);
    if(!snap.exists())throw new Error('來源單已不存在，請重新載入');
    const latest=snap.data();
    if(latest.acceptedAt)throw new Error('來源單已完成點收，請在更新後的卡片填寫備註');
    if(!latest.items.some(row=>row.item===item))throw new Error('此品項已從送洗單移除，請重新載入');
    tx.update(recordRef,{notes:{...(latest.notes || {}),[item]:value}});
   });
   showToast('✅ 備註已儲存');
  } catch(error) { showMessage(error.message); }
 });
 async function open(id){
 if(saving)return;
 try{
 const snap=await api.getDocFromServer(api.doc(db,'sendwash_records',id));if(!snap.exists())throw new Error('送洗單已不存在');const r={id,...snap.data()};if(r.acceptedAt)throw new Error('此單已完成驗收');
 if(r.targetDate!==document.getElementById('datePicker').value||r.inventoryHotel!==currentHotelName)throw new Error('畫面日期或飯店已切換，請重新開啟送洗單');
 active=r;
 let modal=document.getElementById('sendwashVerify');if(!modal){modal=document.createElement('div');modal.id='sendwashVerify';modal.className='fixed inset-0 bg-black/60 z-[40000] overflow-y-auto p-4';document.body.append(modal);}
 modal.innerHTML=`<div class="bg-white rounded-2xl p-5 max-w-lg mx-auto"><h2 class="text-xl font-black">髒布品回廠－現場點收</h2><p class="my-3">${escape(r.hotel)}／${escape(r.department)}<br>飯店送洗：${escape(r.sourceDate)}<br>寫入登記單：${escape(r.targetDate)}</p><p class="text-sm text-gray-500">核對收回的髒布品數量，可修改並簽名。洗完後還要另外複點及簽名。</p><form id="sendwashVerifyForm"><div id="sendwashVerifyRows"></div><canvas id="sendwashSign" width="400" height="200" style="width:100%;height:200px;touch-action:none" class="border-2 border-dashed rounded-xl mt-4"></canvas><button type="button" id="sendwashClear" class="p-3 text-blue-700">清除簽名</button><p id="sendwashVerifyError" class="text-red-600 whitespace-pre-wrap"></p><button id="sendwashAccept" class="w-full bg-blue-600 text-white p-4 rounded-xl font-bold">儲存現場數量及簽名</button><button type="button" id="sendwashCancel" class="w-full p-4">取消</button></form></div>`;
 const container=document.getElementById('sendwashVerifyRows');r.items.forEach((item,i)=>{const label=document.createElement('label');label.className='block mt-4 font-bold';label.textContent=`${item.item}｜飯店送洗 ${item.quantity} ${item.unit} → 場內實點`;const input=document.createElement('input');input.id=`sendwashActual${i}`;input.type='number';input.inputMode='numeric';input.required=true;input.min='0';input.step='1';input.value=item.quantity;input.className='w-full border rounded-xl p-3 mt-2';label.append(input);container.append(label);});
 const canvas=document.getElementById('sendwashSign'),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,200);ctx.strokeStyle='#111';ctx.lineWidth=3;ctx.lineCap='round';let drawing=false,signed=false;
 const point=e=>{const rect=canvas.getBoundingClientRect();return[(e.clientX-rect.left)*canvas.width/rect.width,(e.clientY-rect.top)*canvas.height/rect.height];};
 canvas.onpointerdown=e=>{if(saving)return;e.preventDefault();drawing=true;canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...point(e));};canvas.onpointermove=e=>{if(!drawing||saving)return;e.preventDefault();ctx.lineTo(...point(e));ctx.stroke();signed=true;};canvas.onpointerup=canvas.onpointercancel=()=>drawing=false;
 document.getElementById('sendwashClear').onclick=()=>{if(!saving){ctx.fillRect(0,0,400,200);signed=false;}};
 document.getElementById('sendwashCancel').onclick=()=>{if(!saving){modal.remove();active=null;}};
 document.getElementById('sendwashVerifyForm').onsubmit=async e=>{e.preventDefault();if(saving)return;const error=document.getElementById('sendwashVerifyError');try{if(!signed)throw new Error('請先簽名');const actual=r.items.map((_,i)=>core.quantity(document.getElementById(`sendwashActual${i}`).value));saving=true;modal.querySelectorAll('input,button').forEach(el=>el.disabled=true);await accept(r,actual,canvas.toDataURL('image/jpeg',.4));modal.remove();active=null;showToast('✅ 現場點收已儲存；洗完後請完成右側複點數量及簽名');}catch(err){error.textContent=err.message;}finally{saving=false;if(modal.isConnected)modal.querySelectorAll('input,button').forEach(el=>el.disabled=false);}};
 }catch(e){showMessage(e.message);}
 }
 async function accept(r,actual,signature){
 const recordRef=api.doc(db,'sendwash_records',r.id);
 const refs=r.items.map(item=>api.doc(db,'inventory_records',core.inventoryId(r.targetDate,r.inventoryHotel,item.item)));
 if(new Set(refs.map(ref=>ref.id)).size!==refs.length)throw new Error('品項識別碼衝突，請由管理員確認');
 await api.runTransaction(db,async tx=>{
  const source=await tx.get(recordRef);if(!source.exists())throw new Error('對點單已不存在');const current=source.data();if(current.acceptedAt)throw new Error('此單已由其他人驗收，請重新載入');if(current.revision!==r.revision||current.targetDate!==r.targetDate||JSON.stringify(current.items)!==JSON.stringify(r.items))throw new Error('飯店已修改對點單，請重新開啟確認');
  const existing=[];for(const ref of refs)existing.push(await tx.get(ref));
  const acceptedAt=new Date().toISOString();
  refs.forEach((ref,i)=>{const old=existing[i].exists()?existing[i].data():{};
   if(existing[i].exists()&&(old.date!==r.targetDate||old.hotel!==r.inventoryHotel||old.item!==r.items[i].item))throw new Error('登記單識別碼衝突，不會覆蓋其他品項');
   if(old.doubleSignature) throw new Error('此品項已完成出貨複點，不能再加入收回數量，請由管理員核對');
   if(old.sendwashSources && String(old.count) !== String(Object.values(old.sendwashSources).reduce((sum,x)=>sum+Number(x.actual),0))) throw new Error('現場數量已有人工調整，請由管理員核對後合併');
   const merged=core.mergeVerification(old,r.id,r.items[i].quantity,actual[i]);
   tx.set(ref,{date:r.targetDate,hotel:r.inventoryHotel,item:r.items[i].item,sendwashSources:merged.sendwashSources,count:merged.doubleCount,doubleCount:'',countSource:'sendwash',sendwashStage:'received',...(current.notes && Object.prototype.hasOwnProperty.call(current.notes,r.items[i].item) ? {note:current.notes[r.items[i].item]} : {}),signature,doubleSignature:'',doubleSignDate:'',timestamp:acceptedAt},{merge:true});
  });
  tx.update(recordRef,{acceptedAt,receivedAt:acceptedAt,signature,actualQuantities:actual});
 });
 }
})();


