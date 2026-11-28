/* Browser entry for the shared 花季 branch normalizer. Load flower-branch.js first. */
(function (root) {
    const api = root.FlowerBranch;
    if (!api) throw new Error('花季館別正規化尚未載入');
    root.FlowerReceipts = {
        identity: (hotel, dept) => api.identity(hotel, dept),
        inventoryHotel: hotel => api.inventoryHotel(hotel),
        statementParent: hotel => api.statementParent(hotel),
        collapse: documents => api.collapse(documents),
    };
})(typeof globalThis === 'object' ? globalThis : this);
