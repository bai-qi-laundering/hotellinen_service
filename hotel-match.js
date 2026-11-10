// 簽收單上的飯店名稱有長有短：花季、花季Ａ館、日航、日航休閒中心。
// 舊寫法用「名稱有沒有包含」會把較長的飯店算進較短的那一張單。

export function inventoryBases(currentHotel, templateItems) {
    const bases = new Set();
    const add = value => {
        const text = String(value || '').trim();
        if (text) bases.add(text);
    };
    add(currentHotel);
    for (const row of templateItems || []) add(row?.baseName);
    return [...bases].sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh-Hant'));
}

// 回傳這筆出貨屬於哪一家、哪個部門。對不上回 null，呼叫端不要把它畫進別家的單。
export function assignInventoryHotel(hotelStr, bases, { allowGlued = true } = {}) {
    const name = String(hotelStr || '').trim();
    if (!name || !bases?.length) return null;
    for (const base of bases) {
        if (name === base) return { base, dept: '房務' };
        if (name.startsWith(`${base} `)) {
            const dept = name.slice(base.length).trim();
            return { base, dept: dept || '房務' };
        }
    }
    if (!allowGlued) return null;
    for (const base of bases) {
        if (!name.startsWith(base) || name.length === base.length) continue;
        const rest = name.slice(base.length).trim();
        if (!rest) continue;
        const coveredByLonger = bases.some(other => other.length > base.length && (name === other || name.startsWith(other)));
        if (coveredByLonger) continue;
        return { base, dept: rest };
    }
    return null;
}

export function sameDepartment(left, right) {
    const norm = value => String(value || '').trim().replace(/部$/, '');
    const a = norm(left);
    const b = norm(right);
    return Boolean(a) && a === b;
}
