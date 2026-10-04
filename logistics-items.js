// Display names may change in finance; the inventory source name stays stable.
export const normalizeItemName = name => String(name || '').replace(/[\s\u3000]+/g, '').trim();

export function itemMatchesName(item, name) {
    const key = normalizeItemName(name);
    return !!key && [item.itemName, item.inventoryItemName, ...(item.itemNameAliases || [])]
        .some(value => normalizeItemName(value) === key);
}

export function renameItem(item, newName) {
    return {
        ...item,
        inventoryItemName: item.inventoryItemName || item.itemName,
        itemNameAliases: [...new Set([...(item.itemNameAliases || []), item.itemName].filter(Boolean))],
        itemName: newName
    };
}

export function applyFinanceItemNames(items, updates) {
    const next = items.map(item => ({...item}));
    for (const update of updates) {
        // Price-only changes must not undo a name changed by another user.
        if (update.newItemName === update.originalItemName) continue;
        const matches = next.filter(item => itemMatchesName(item, update.sourceItemName));
        if (matches.length !== 1) throw new Error('品項已變更或重複，請重新載入後再修改名稱。');
        const target = matches[0];
        if (target.itemName !== update.originalItemName && target.itemName !== update.newItemName) {
            throw new Error('其他使用者已修改此品項名稱，請重新載入後確認。');
        }
        if (next.some(item => item !== target && normalizeItemName(item.itemName) === normalizeItemName(update.newItemName))) {
            throw new Error('同一張單已有這個品項名稱，請使用不同名稱，避免重複計算。');
        }
        Object.assign(target, renameItem(target, update.newItemName));
    }
    return next;
}

export function mergeSignedItems(latestItems, submittedItems) {
    const next = latestItems.map(item => ({...item}));
    for (const submitted of submittedItems) {
        const sourceName = submitted.inventoryItemName || submitted.itemName;
        const matches = next.filter(item => itemMatchesName(item, sourceName));
        if (matches.length > 1) throw new Error('品項來源重複，請重新載入後確認。');
        if (!matches.length) {
            next.push({...submitted});
            continue;
        }
        const latest = matches[0];
        // A signing screen opened before an administrator's edit must not revert it.
        if (String(latest.actualQty ?? '') !== String(submitted.loadedActualQty ?? submitted.actualQty ?? '') &&
            String(latest.actualQty ?? '') !== String(submitted.actualQty ?? '')) {
            throw new Error('實收數量已由其他人更新，請重新載入後再簽名。');
        }
        latest.originalQty = submitted.originalQty;
        latest.actualQty = submitted.actualQty;
        latest.auntNote = submitted.auntNote || '';
        latest.driverNote = submitted.driverNote || latest.driverNote || '';
    }
    // This field only exists in the signing page's in-memory snapshot.
    next.forEach(item => {
        delete item.loadedActualQty;
        delete item.clientSig;
        delete item.driverSig;
        delete item.isSynced;
    });
    return next;
}

// Old unpadded dates are not chronologically ordered as strings (e.g. 9/30 → 10/1).
// Read each month's prefix and let callers filter normalized dates to the exact range.
export function legacyDatePrefixes(startDate, endDate) {
    const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
    const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
    if (!start || !end || startDate > endDate) throw new Error('請確認起訖日期。');
    if ([start, end].some(parts => Number(parts[2]) < 1 || Number(parts[2]) > 12 || Number(parts[3]) < 1 || Number(parts[3]) > 31)) {
        throw new Error('請確認起訖日期。');
    }
    const prefixes = new Set();
    let year = Number(start[1]), month = Number(start[2]);
    const lastMonth = Number(end[1]) * 12 + Number(end[2]);
    for (; year * 12 + month <= lastMonth; month++) {
        if (month > 12) { year++; month = 1; }
        prefixes.add(`${year}-${month}-`);
        prefixes.add(`${year}-${String(month).padStart(2, '0')}-`);
    }
    return [...prefixes];
}
