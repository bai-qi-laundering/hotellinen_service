/* One receipt cursor and one inventory date per physical hotel. */
(function(root){
 const normalize=value=>String(value||'').normalize('NFKC').replace(/\s/g,'');
 const key=hotel=>{
  const name=normalize(hotel);
  if(/^花季[AC]館/.test(name))return '花季';
  // These departments have their own inventory names, but ride on the parent hotel's receipt.
  if(name==='承億休閒'||name==='承億健身房')return '承億';
  if(name==='日航休閒'||name==='日航休閒中心')return '日航';
  return name;
 };
 const day=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[0]:'';};
 const addDays=(value,amount)=>{const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);date.setDate(date.getDate()+amount);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
 function nextDate(receiptDate,targetForDay){
  const last=day(receiptDate);if(!last)throw Error('找不到已簽收單據日期');
  for(let offset=1;offset<=60;offset++){
   const next=day(targetForDay(addDays(last,offset)));
   if(next>last)return next;
  }
  throw Error('找不到下一批單據日期，請由後台檢查收送規則');
 }
 function signedPatch(state,receipt,now){
  const date=day(receipt.date),previous=day(state?.latestSignedReceiptDate);
  if(!date||!receipt.id)throw Error('簽收單據缺少日期或識別碼');
  if(previous>=date)return null; // The other party or department signing the same car must not unlock a batch.
  return {latestSignedReceiptDate:date,latestSignedReceiptId:receipt.id,lockedDate:'',updatedAt:now};
 }
 function validate(state,date,targetForDay){
  if(!state?.latestSignedReceiptDate)throw Error('此飯店尚未建立已簽收批次，請由後台核對，現場暫停新增數量');
  const expected=day(state.lockedDate)||nextDate(state.latestSignedReceiptDate,targetForDay);
  if(day(date)!==expected)throw Error(`此飯店目前只能寫入 ${expected} 的單據，請返回重新開啟飯店`);
  return state.lockedDate?null:{lockedDate:expected,lockedAt:Date.now()};
 }
 const api={key,day,nextDate,signedPatch,validate};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.InventoryBatchState=api;
})(typeof window==='object'?window:globalThis);
