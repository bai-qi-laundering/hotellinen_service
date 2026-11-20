/* 喜達絲：first entered quantity keeps the receipt date until either logistics signature. */
(function(root){
  const norm=value=>String(value ?? '').normalize('NFKC').replace(/\s/g,'');
  const day=value=>{const m=String(value || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';};
  const hotel=value=>norm(value)==='喜達絲'||(String(value || '').trim().startsWith('喜達絲 ')&&!/特處|回洗|客衣/.test(value));
  const quantity=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
  function date(inventory,receipts){
    const signed=new Set((receipts || []).filter(r=>norm(r.hotelKeyword)==='喜達絲'&&!r.manualDeletedReceipt&&(r.clientSig||r.driverSig)).map(r=>day(r.date))); 
    return [...new Set((inventory || []).filter(r=>hotel(r.hotel)&&!r.manualDeletedReceipt&&r.item!=='_MANUAL_BORDER_'&&r.inventoryDateLockEnteredAt&&(quantity(r.count)||quantity(r.doubleCount))&&!signed.has(day(r.date))).map(r=>day(r.date)).filter(Boolean))].sort()[0] || '';
  }
  const api={hotel,date,day,quantity};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.InventoryDateLock=api;
})(typeof window==='object'?window:globalThis);
