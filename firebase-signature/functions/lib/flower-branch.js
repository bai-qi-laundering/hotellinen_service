/* 花季 A館／C館的唯一館別正規化。瀏覽器以 script 載入，Cloud Functions 以 side-effect import。
 * 不把 C館改成 B館。舊單不在這裡改寫，只在讀取與新寫入時折成同一名稱。 */
(function (root) {
    const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
    function suffixOf(rest) {
        if (rest === '' || rest === '房務' || rest === '房務部') return '房務';
        if (rest === '回洗' || rest === '回洗部') return '回洗';
        return rest;
    }
    function identity(hotel, dept) {
        const name = clean(hotel);
        const department = clean(dept);
        if ((name === '富野' && /^汽旅房務(?:部)?$/.test(department)) ||
            (name === '富野汽旅' && /^(?:房務(?:部)?)?$/.test(department))) {
            return { hotelKeyword: '富野', deptName: '汽旅 房務', building: '' };
        }
        let building = '';
        let rest = '';
        const hotelBuilding = name.match(/^花季([AC])館(.*)$/i);
        if (hotelBuilding) {
            building = hotelBuilding[1].toUpperCase();
            rest = hotelBuilding[2] + department;
        } else if (name === '花季') {
            const deptBuilding = department.match(/^([AC])館(.*)$/i);
            if (deptBuilding) {
                building = deptBuilding[1].toUpperCase();
                rest = deptBuilding[2];
            }
        }
        if (!building) return null;
        return { hotelKeyword: '花季', deptName: building + '館 ' + suffixOf(rest), building };
    }
    function inventoryHotel(hotel) {
        const name = clean(hotel);
        if (/^富野汽旅房務(?:部)?$/.test(name)) return '富野 汽旅 房務';
        const id = identity(name, '');
        if (id && id.building) return '花季' + id.building + '館 ' + id.deptName.replace(/^[AC]館\s*/, '');
        return hotel;
    }
    function batchKey(hotel, dept) {
        const id = identity(hotel, dept || '');
        return id && id.building ? '花季' + id.building + '館' : null;
    }
    function statementParent(hotel) {
        return /^花季[AC]館/i.test(clean(hotel)) ? '花季' : null;
    }
    function logisticsLookupKeywords(hotelKeyword) {
        const name = clean(hotelKeyword);
        if (name !== '花季' && !/^花季[AC]館/i.test(name)) return null;
        const out = new Set();
        for (const seed of ['花季', '花季A館', '花季C館', '花季 A館', '花季 C館']) {
            out.add(seed);
            const half = seed.normalize('NFKC');
            out.add(half);
            out.add(half.replace(/[A-Za-z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 0xFEE0)));
        }
        return [...out];
    }
    function canonicalWrite(hotel, dept) {
        const id = identity(hotel, dept);
        if (!id) return { hotelKeyword: String(hotel || '').trim(), deptName: String(dept || '').trim(), building: '' };
        return { hotelKeyword: id.hotelKeyword, deptName: id.deptName, building: id.building || '' };
    }
    function receiptTime(data) {
        const value = data.signedAt || data.updatedAt || data.timestamp || '';
        if (value && typeof value.toMillis === 'function') return value.toMillis();
        const raw = String(value).replace(/上午\s*/g, 'AM ').replace(/下午\s*/g, 'PM ');
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    function present(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }
    function billedQty(item) {
        const raw = present(item.actualQty) ? item.actualQty : present(item.originalQty) ? item.originalQty : (item.bqQty ?? 0);
        const qty = Number(raw);
        return Number.isFinite(qty) ? qty : NaN;
    }
    function collapse(documents) {
        const result = new Map(), groups = new Map();
        documents.forEach(snapshot => {
            const data = snapshot.data(), branch = identity(data.hotelKeyword, data.deptName);
            if (branch && data.manualDeletedReceipt) return;
            if (!branch) {
                result.set(snapshot.id, snapshot);
                return;
            }
            const key = JSON.stringify([String(data.date), branch.hotelKeyword, branch.deptName]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ snapshot, data, branch });
        });
        for (const entries of groups.values()) {
            const items = new Map(), sources = new Map();
            entries.sort((a, b) => Number(!!(b.data.clientSig || b.data.driverSig)) - Number(!!(a.data.clientSig || a.data.driverSig))
                || receiptTime(b.data) - receiptTime(a.data)
                || String(b.data.timestamp || '').localeCompare(String(a.data.timestamp || '')));
            for (const entry of entries) {
                for (const item of entry.data.items || []) {
                    if (item.deletedInLogistics) continue;
                    const key = clean(item.inventoryItemName || item.itemName);
                    const existing = items.get(key);
                    const unsignedFuyano = entry.branch.hotelKeyword === '富野' && sources.get(key) && !(entry.data.clientSig || entry.data.driverSig);
                    if (existing && entries.length > 1 && !unsignedFuyano && billedQty(existing) !== billedQty(item)) {
                        throw new Error(entry.branch.hotelKeyword + ' ' + entry.data.date + ' ' + entry.branch.deptName + '「' + (item.itemName || item.inventoryItemName || '') + '」有兩張單，數量 ' + billedQty(existing) + ' 與 ' + billedQty(item) + ' 不同，請先核對原單再出帳。系統不會自動取其中一張，也不會把數量相加。');
                    }
                    if (!existing) {
                        items.set(key, item);
                        sources.set(key, !!(entry.data.clientSig || entry.data.driverSig));
                    }
                }
            }
            const selected = entries[0];
            const data = {
                ...selected.data,
                hotelKeyword: selected.branch.hotelKeyword,
                deptName: selected.branch.deptName,
                items: [...items.values()],
            };
            for (const field of ['clientSig', 'driverSig']) {
                data[field] = entries.find(entry => entry.data[field])?.data[field] || '';
            }
            const wrapper = { id: selected.snapshot.id, data: () => data };
            result.set(wrapper.id, wrapper);
        }
        return result;
    }
    function foldForBilling(documents) {
        const map = new Map();
        for (const doc of documents || []) {
            const data = typeof doc.data === 'function' ? doc.data() : doc.data;
            map.set(doc.id, { id: doc.id, data: () => data });
        }
        return [...collapse(map).values()].map(snapshot => ({ id: snapshot.id, data: snapshot.data() }));
    }
    root.FlowerBranch = {
        identity, inventoryHotel, batchKey, statementParent, logisticsLookupKeywords,
        canonicalWrite, collapse, foldForBilling, billedQty,
    };
})(typeof globalThis === 'object' ? globalThis : this);
