/* Flower Garden branch aliases share one receipt identity. */
(function(root) {
    const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
    function identity(hotel, dept) {
        const name = clean(hotel);
        if ((name === '富野' && /^汽旅房務(?:部)?$/.test(clean(dept))) ||
            (name === '富野汽旅' && /^(?:房務(?:部)?)?$/.test(clean(dept)))) {
            return {hotelKeyword: '富野', deptName: '汽旅 房務'};
        }
        if (!/^花季(?:[AC]館)?$/i.test(name)) return null;
        const full = name.slice(2) + clean(dept);
        const match = full.match(/^([AC])館(?:房務(?:部)?)?$/i);
        if (!match) return null;
        return {hotelKeyword: '花季', deptName: match[1].toUpperCase() + '館 房務'};
    }
    function inventoryHotel(hotel) {
        const name = clean(hotel);
        if (/^富野汽旅房務(?:部)?$/.test(name)) return '富野 汽旅 房務';
        const match = name.match(/^花季([AC])館(?:房務(?:部)?)?$/i);
        return match ? '花季' + match[1].toUpperCase() + '館 房務' : hotel;
    }
    function receiptTime(data) {
        const value = data.signedAt || data.updatedAt || data.timestamp || '';
        if (value && typeof value.toMillis === 'function') return value.toMillis();
        const raw = String(value).replace(/上午\s*/g, 'AM ').replace(/下午\s*/g, 'PM ');
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    function collapse(documents) {
        const result = new Map(), groups = new Map();
        documents.forEach(snapshot => {
            const data = snapshot.data(), branch = identity(data.hotelKeyword, data.deptName);
            if (!branch) {
                result.set(snapshot.id, snapshot);
                return;
            }
            const key = JSON.stringify([String(data.date), branch.hotelKeyword, branch.deptName]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({snapshot, data, branch});
        });
        for (const group of groups.values()) {
            // Older deletions could write an empty backup to one alias while a
            // second alias still carried the removed rows.
            const legacyWholeDelete = group.find(entry => entry.data.manualDeletedReceipt &&
                !entry.data.mergedInto && !(entry.data.deletedBackupItems || []).length);
            if (legacyWholeDelete) {
                result.set(legacyWholeDelete.snapshot.id, legacyWholeDelete.snapshot);
                continue;
            }
            const legacyEdited = group.filter(entry => entry.data.manualItemDeleted &&
                !(entry.data.deletedBackupItems || []).length);
            const legacyAllowed = legacyEdited.length
                ? new Set(legacyEdited.flatMap(entry => entry.data.items || [])
                    .map(item => clean(item.inventoryItemName || item.itemName)))
                : null;
            const active = group.filter(entry => !entry.data.manualDeletedReceipt);
            if (!active.length) {
                const deleted = group[0];
                result.set(deleted.snapshot.id, deleted.snapshot);
                continue;
            }
            const entries = active;
            const deletedItems = new Map();
            for (const entry of group) if (entry.data.manualItemDeleted ||
                (entry.data.manualDeletedReceipt && !entry.data.mergedInto)) {
                for (const item of entry.data.deletedBackupItems || []) {
                    const key = clean(item.inventoryItemName || item.itemName);
                    if (key) deletedItems.set(key, item);
                }
            }
            const items = new Map(), sources = new Map();
            // Prefer signed rows, then the most recently updated receipt.
            entries.sort((a,b) => Number(!!(b.data.clientSig || b.data.driverSig)) - Number(!!(a.data.clientSig || a.data.driverSig))
                || receiptTime(b.data) - receiptTime(a.data)
                || String(b.data.timestamp || '').localeCompare(String(a.data.timestamp || '')));
            for (const entry of entries) {
                for (const item of entry.data.items || []) {
                    const key = clean(item.inventoryItemName || item.itemName);
                    if (deletedItems.has(key) || (legacyAllowed && !legacyAllowed.has(key))) continue;
                    const existing = items.get(key);
                    if (existing && entries.length > 1 && entry.branch.hotelKeyword !== '花季' &&
                        !(entry.branch.hotelKeyword === '富野' && sources.get(key) &&
                            !(entry.data.clientSig || entry.data.driverSig)) &&
                        Number(existing.actualQty ?? existing.originalQty ?? 0) !== Number(item.actualQty ?? item.originalQty ?? 0)) {
                        throw new Error(entry.branch.hotelKeyword + ' ' + entry.data.date + ' ' + entry.branch.deptName + '「' + (item.itemName || '') + '」全形半形單據數量不同，請先核對後台原單。');
                    }
                    if (!existing) { items.set(key, item); sources.set(key, !!(entry.data.clientSig || entry.data.driverSig)); }
                }
            }
            const selected = entries[0];
            const data = {...selected.data, ...selected.branch, items: [...items.values()],
                manualItemDeleted: deletedItems.size > 0,
                deletedBackupItems: [...deletedItems.values()]};
            for (const field of ['clientSig','driverSig']) {
                data[field] = entries.find(entry => entry.data[field])?.data[field] || '';
            }
            const wrapper = {id: selected.snapshot.id, data: () => data};
            result.set(wrapper.id, wrapper);
        }
        return result;
    }
    root.FlowerReceipts = {identity, inventoryHotel, collapse};
})(typeof window === 'object' ? window : globalThis);
