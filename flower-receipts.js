/* Browser entry for the shared 花季 branch normalizer. Load flower-branch.js first. */
(function (root) {
    const api = root.FlowerBranch;
    if (!api) throw new Error('花季館別正規化尚未載入');
    root.FlowerReceipts = {
        identity: (hotel, dept) => api.identity(hotel, dept),
        inventoryHotel: hotel => api.inventoryHotel(hotel),
        statementParent: hotel => api.statementParent(hotel),
        canonicalWrite: (hotel, dept) => api.canonicalWrite(hotel, dept),
        variantReceiptIds: (date, hotel, dept) => api.variantReceiptIds(date, hotel, dept),
        chooseReceiptId: (date, hotel, dept, existingIds) => api.chooseReceiptId(date, hotel, dept, existingIds),
        collapse: documents => api.collapse(documents),
    };
})(typeof globalThis === 'object' ? globalThis : this);
