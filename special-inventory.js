// Turn one signed 特處 sheet into inventory_records rows.
// index.html stores each line at inventory_records/{date}_{hotel}_{item}
// where hotel is master_template.hotel (「驛館 特處」), not the short base name.

export const INVENTORY_NOTE = '特處匯入';

function deptRank(dept) {
    if (dept === '特處') return 0;
    if (dept === '房務') return 1;
    return 2;
}

export function inventoryCatalog(templateRows) {
    const byBase = new Map();
    for (const row of templateRows || []) {
        const base = String(row?.baseName || '').trim();
        const item = String(row?.item || '').trim();
        const hotel = String(row?.hotel || '').trim();
        const deptName = String(row?.deptName || '').trim();
        if (!base || !item || !hotel) continue;
        if (!byBase.has(base)) byBase.set(base, { names: [], placements: [] });
        byBase.get(base).placements.push({ item, hotel, deptName });
    }
    for (const entry of byBase.values()) {
        const ranked = entry.placements
            .map((row, index) => ({ ...row, index }))
            .sort((a, b) => deptRank(a.deptName) - deptRank(b.deptName) || a.index - b.index);
        const seen = new Set();
        entry.names = [];
        for (const row of ranked) {
            if (seen.has(row.item)) continue;
            seen.add(row.item);
            entry.names.push(row.item);
        }
    }
    return byBase;
}

export function inventoryDocId(date, hotel, item) {
    return `${date}_${hotel}_${String(item).replace(/\//g, '-')}`;
}

function inventoryHotel(entry, item) {
    const matches = (entry?.placements || []).filter(row => row.item === item);
    const special = matches.find(row => row.deptName === '特處');
    if (special) return special.hotel;
    const housekeeping = matches.find(row => row.deptName === '房務');
    if (housekeeping) return housekeeping.hotel;
    return matches[0]?.hotel || '';
}

export function buildInventoryWrites(lines, catalogEntry, { signature, timestamp, note = INVENTORY_NOTE } = {}) {
    if (!signature) throw new Error('請先簽名');
    if (!timestamp) throw new Error('缺少送出時間');
    const valid = new Set(catalogEntry?.names || []);
    const bad = (lines || []).filter(line => !valid.has(String(line?.officeName || '').trim()));
    if (bad.length) {
        const error = new Error('品名和盤點不一致');
        error.ids = bad.map(line => line.id);
        throw error;
    }
    const groups = new Map();
    for (const line of lines) {
        const item = String(line.officeName).trim();
        const hotel = inventoryHotel(catalogEntry, item);
        const date = String(line.shipDate || '');
        if (!date || !hotel) throw new Error('出貨單日期還沒算出來');
        const key = `${date}\0${hotel}\0${item}`;
        const group = groups.get(key) || { date, hotel, item, qty: 0 };
        const qty = Number(line.qty);
        if (!Number.isFinite(qty)) throw new Error('數量不正確');
        group.qty += qty;
        groups.set(key, group);
    }
    return [...groups.values()].map(group => ({
        id: inventoryDocId(group.date, group.hotel, group.item),
        date: group.date,
        hotel: group.hotel,
        item: group.item,
        count: String(group.qty),
        signature,
        note,
        timestamp,
    }));
}
