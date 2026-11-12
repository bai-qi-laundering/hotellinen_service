import { normalizeItemName, receiptInventoryIdentity } from './logistics-items.js?v=20261019-same-names';

export const isRestaurant = (hotel, dept) => normalizeItemName(hotel) === '洲際' && ['餐廳','餐飲','餐飲部'].includes(normalizeItemName(dept));
export const outletKey = name => {
    const key = normalizeItemName(name).normalize('NFKC').toUpperCase();
    return key === '俱樂部' || key === '俱乐部' ? 'CLUB' : key;
};

export function moveOutletQuantity(groups, move) {
    const {item, from, to, quantity, department} = move;
    const key = normalizeItemName(item), fromKey = outletKey(from), toKey = outletKey(to);
    if (!key || !fromKey || !toKey || fromKey === toKey || !isRestaurant('洲際', department))
        throw new Error('請選擇品項及兩個不同的餐廳部門。');
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('請輸入大於 0 的整數件數。');

    // Some outlet items roll up differently. A transfer must stay within the same receipt item.
    const totalName = outlet => normalizeItemName(receiptInventoryIdentity({outlet, sourceItem:item, department},item,'洲際').itemName);
    if (totalName(fromKey) !== totalName(toKey)) throw new Error('兩部門的品項歸類不同，無法在保持簽收總數的情況下移轉。');

    const result = groups.map(group => ({...group,items:group.items.map(row=>({...row}))}));
    const sameOutlet = (group, outlet) => isRestaurant('洲際',group.deptName) && outletKey(group.outlet) === outlet;
    const sources = result.filter(group=>sameOutlet(group,fromKey)).flatMap(group=>group.items.filter(row=>normalizeItemName(row.itemName)===key));
    const available = sources.reduce((sum,row)=>sum+Number(row.quantity),0);
    if (!Number.isSafeInteger(available) || available < quantity)
        throw new Error(`來源部門只有 ${available} 件，無法移轉 ${quantity} 件。`);
    let destination = result.find(group=>sameOutlet(group,toKey));
    if (!destination) {
        destination={deptName:department,outlet:to,items:[]};
        result.push(destination);
    }
    let target = destination.items.find(row=>normalizeItemName(row.itemName)===key);
    if (!target) {
        target={itemName:item,quantity:'0',note:''};
        destination.items.push(target);
    }
    const destinationQty = Number(target.quantity)+quantity;
    if (!Number.isSafeInteger(destinationQty)) throw new Error('目的部門數量超過可用範圍。');
    let remaining = quantity;
    for (const source of sources) {
        const used=Math.min(Number(source.quantity),remaining);
        source.quantity=String(Number(source.quantity)-used);
        remaining-=used;
    }
    target.quantity=String(destinationQty);
    return result;
}

const receiptDay = value => String(value || '').trim().split(/[-/]/).map((part,i)=>i ? part.padStart(2,'0') : part).join('-');

export function correctedOutletGroups(groups, receipts) {
    let result = groups;
    for (const receipt of receipts) {
        if (!isRestaurant(receipt.hotelKeyword,receipt.deptName) || !receipt.clientSig || !receipt.driverSig || receipt.manualDeletedReceipt) continue;
        for (const move of receipt.outletCorrections || []) {
            if (move.date === receiptDay(receipt.date)) result = moveOutletQuantity(result,{...move,department:receipt.deptName});
        }
    }
    return result;
}

// A correction patch changes only the ledger, never items, signature fields or billing.
export function outletCorrectionPatch(receipt, date, groups, move) {
    if (!isRestaurant(receipt.hotelKeyword,receipt.deptName) || !receipt.clientSig || !receipt.driverSig || receipt.manualDeletedReceipt || date !== move.date || receiptDay(receipt.date) !== date)
        throw new Error('單據已變更，請重新載入雙方已簽收的洲際餐廳單。');
    const previous=receipt.outletCorrections || [];
    if (previous.some(entry=>entry.id===move.id)) return null;
    moveOutletQuantity(correctedOutletGroups(groups,[receipt]),{...move,department:receipt.deptName});
    return {outletCorrections:[...previous,move]};
}

export function restaurantInventoryRows(records) {
    return records.flatMap(record=>{
        const hotel=String(record.hotel || record.hotelKeyword || record.hotelName || '').trim();
        const dept=hotel.startsWith('洲際') ? hotel.slice(2).trim() || record.department : '';
        if (!isRestaurant('洲際',dept)) return [];
        return (Array.isArray(record.items)?record.items:[record]).flatMap(row=>{
            const item=String(row.itemName || row.item || row.name || '').trim();
            if (!item) return [];
            const identity=receiptInventoryIdentity(record,item,'洲際');
            if (!identity.outlet) return [];
            const originalQty=[row.doubleCount,row.count,row.quantity,row.qty,row.amount].find(v=>v!==undefined&&v!==null&&v!=='') ?? '0';
            return [{row:{deptName:dept,itemName:identity.itemName,originalQty,auntNote:row.note || row.auntNote || record.note || ''},outlet:identity.outlet,detailItemName:identity.detailItemName}];
        });
    });
}
