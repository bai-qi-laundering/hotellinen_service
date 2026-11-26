// Keep the receipt used by logistics and finance in step with saved inventory.
export const itemKey = value => String(value || '').normalize('NFKC').replace(/[\s\u3000]+/g, '');

export function mergeReceiptQuantity(items, name, quantity, options = {}) {
    const qty = String(quantity ?? '0');
    const next = (items || []).map(row => ({...row}));
    const index = next.findIndex(row => itemKey(row.inventoryItemName || row.itemName) === itemKey(name));
    if (index < 0) {
        if (Number(qty) > 0) next.push({itemName:name, originalQty:qty, actualQty:qty, auntNote:'', driverNote:''});
        return next;
    }
    const row = next[index];
    const old = String(row.originalQty ?? row.bqQty ?? '0');
    if (old === qty) return next;
    // A deliberately corrected actual quantity stays authoritative until changed in the back office.
    if (row.actualQty === undefined || row.actualQty === null || String(row.actualQty) === old)
        row.actualQty = qty;
    row.originalQty = qty;
    return next;
}

export function receiptPatch(record, name, quantity) {
    if (record?.manualDeletedReceipt || record?.manualItemDeleted) return null;
    const items = mergeReceiptQuantity(record?.items, name, quantity);
    return JSON.stringify(items) === JSON.stringify(record?.items || []) ? null : {items};
}
