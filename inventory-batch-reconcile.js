// Recompute the one-document hotel cursor only after a receipt signature was removed.
// The receipt and inventory reads are scoped to this hotel and the affected dates.
export async function reconcileRemovedSignature({db, api, hotel, date, templateRows, batchState, scopedReads}) {
    const physicalHotel = batchState.key(hotel);
    if (!physicalHotel || physicalHotel === '喜達絲') return { changed:false };
    const stateRef = api.doc(db, 'inventory_batch_states', physicalHotel);
    const initial = await api.getDocFromServer(stateRef);
    if (!initial.exists() || initial.data().latestSignedReceiptDate !== date) return { changed:false };

    const first = new Date(`${date}T00:00:00Z`);
    first.setUTCDate(first.getUTCDate() - 60);
    const since = first.toISOString().slice(0, 10);
    const reader = { collection:api.collection, query:api.query, where:api.where, getDocsFromServer:api.getDocsFromServer };
    const receiptSnaps = await scopedReads.read(reader, db, 'logistics_records', since, date,
        {field:'hotelKeyword', values:scopedReads.names(templateRows, physicalHotel, 'logistics')});
    const receipts = new Map();
    receiptSnaps.forEach(snap => snap.forEach(row => {
        const value = row.data();
        if (batchState.key(value.hotelKeyword) === physicalHotel) receipts.set(row.id, row);
    }));
    const active = [...receipts.values()].filter(row => {
        const value = row.data();
        return !value.manualDeletedReceipt && (value.driverSig || value.clientSig);
    });
    if (active.some(row => row.data().date === date)) return {changed:false, reason:'same-day-signature'};
    const previous = active.filter(row => row.data().date < date)
        .sort((a,b) => b.data().date.localeCompare(a.data().date))[0];
    if (!previous) throw new Error('找不到此飯店前一張有效簽收單，日期沒有自動退回');

    const inventorySnaps = await scopedReads.read(reader, db, 'inventory_records', date, date,
        {field:'hotel', values:scopedReads.names(templateRows, physicalHotel, 'inventory')});
    const hasInventory = inventorySnaps.some(snap => snap.docs.some(row => {
        const value = row.data();
        return (value.count !== undefined && value.count !== '') ||
            (value.doubleCount !== undefined && value.doubleCount !== '');
    }));

    return api.runTransaction(db, async tx => {
        const current = await tx.get(stateRef);
        if (!current.exists() || current.data().latestSignedReceiptDate !== date) return {changed:false};
        if (current.data().lockedDate && current.data().lockedDate > date)
            throw new Error('下一批已有盤點紀錄，日期沒有自動退回，請先由後台核對');
        const prevNow = await tx.get(previous.ref);
        if (!prevNow.exists() || prevNow.data().manualDeletedReceipt ||
            !(prevNow.data().clientSig || prevNow.data().driverSig))
            throw new Error('前一張簽收單已變更，請重新載入後核對');
        for (const receipt of receipts.values()) {
            if (receipt.data().date !== date) continue;
            const latest = await tx.get(receipt.ref);
            if (latest.exists() && !latest.data().manualDeletedReceipt &&
                (latest.data().clientSig || latest.data().driverSig))
                return {changed:false, reason:'same-day-signature'};
        }
        tx.set(stateRef, {
            latestSignedReceiptDate:previous.data().date,
            latestSignedReceiptId:previous.id,
            lockedDate:hasInventory ? date : '',
            updatedAt:Date.now()
        }, {merge:true});
        return {changed:true, lockedDate:hasInventory ? date : ''};
    });
}
