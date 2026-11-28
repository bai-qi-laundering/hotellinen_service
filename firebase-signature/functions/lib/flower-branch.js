/* 同一客戶同一部門的名稱正規化。瀏覽器以 script 載入，Cloud Functions 以 side-effect import。
 * 花季不把 C館改成 B館。承億健身房／休閒、日航休閒中心折回母飯店，不另立客戶。
 * 舊單不在這裡改寫，只在讀取與新寫入時折成同一名稱。 */
(function (root) {
    const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
    // display 是出帳與新寫入用的部門。bases 是範本把部門黏在飯店名上的寫法。
    // parentDept 只在「母飯店 + 這個部門」本身就是這張單時才對上；日航特處是另一個部門，不能靠這個併進來。
    const departmentAliases = [
        { parent: '承億', bases: ['承億健身房'], dept: '健身房', display: '健身房', parentDept: true },
        { parent: '承億', bases: ['承億休閒'], dept: '休閒', display: '休閒', parentDept: true },
        { parent: '日航', bases: ['日航休閒中心', '日航休閒'], dept: '休閒中心', display: '休閒中心', parentDept: true },
        { parent: '日航', bases: ['日航休閒中心', '日航休閒'], dept: '特處', display: '休閒中心 特處', parentDept: false },
    ];
    function suffixOf(rest) {
        if (rest === '' || rest === '房務' || rest === '房務部') return '房務';
        if (rest === '回洗' || rest === '回洗部') return '回洗';
        return rest;
    }
    function canonicalDepartment(row) {
        return { hotelKeyword: row.parent, deptName: row.display, building: '' };
    }
    function departmentIdentity(hotel, dept) {
        const name = clean(hotel);
        const department = clean(dept);
        for (const row of departmentAliases) {
            const parent = clean(row.parent);
            const deptName = clean(row.dept);
            const display = clean(row.display);
            const doubled = deptName + deptName;
            const baseRest = clean(row.bases[0]).slice(parent.length);
            const signDept = (row.parentDept ? deptName : baseRest) + deptName;
            const hotelIsBase = row.bases.some(base => clean(base) === name);
            if (hotelIsBase && (department === deptName || department === display || department === doubled)) return canonicalDepartment(row);
            if (name === parent && row.parentDept && (department === deptName || department === doubled || department === display)) return canonicalDepartment(row);
            if (name === parent && !row.parentDept && (department === display || department === signDept)) return canonicalDepartment(row);
            if (!department && (name === parent + signDept || name === parent + doubled || row.bases.some(base => name === clean(base) + deptName))) {
                return canonicalDepartment(row);
            }
        }
        return null;
    }
    function bareParent(hotel) {
        const name = clean(hotel);
        if (name === '承億健身房' || name === '承億休閒') return '承億';
        if (name === '日航休閒中心' || name === '日航休閒') return '日航';
        return null;
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
        if (building) return { hotelKeyword: '花季', deptName: building + '館 ' + suffixOf(rest), building };
        return departmentIdentity(hotel, dept);
    }
    function inventoryHotel(hotel) {
        const name = clean(hotel);
        if (/^富野汽旅房務(?:部)?$/.test(name)) return '富野 汽旅 房務';
        const id = identity(name, '');
        if (id && id.building) return '花季' + id.building + '館 ' + id.deptName.replace(/^[AC]館\s*/, '');
        if (id) return id.hotelKeyword + ' ' + id.deptName;
        return hotel;
    }
    function batchKey(hotel, dept) {
        const id = identity(hotel, dept || '');
        if (id && id.building) return '花季' + id.building + '館';
        if (id && (id.hotelKeyword === '承億' || id.hotelKeyword === '日航')) return id.hotelKeyword;
        return bareParent(hotel);
    }
    function statementParent(hotel) {
        if (/^花季[AC]館/i.test(clean(hotel))) return '花季';
        const id = identity(hotel, '');
        if (id && (id.hotelKeyword === '承億' || id.hotelKeyword === '日航')) return id.hotelKeyword;
        return bareParent(hotel);
    }
    function logisticsLookupKeywords(hotelKeyword) {
        const name = clean(hotelKeyword);
        if (name === '花季' || /^花季[AC]館/i.test(name)) {
            const out = new Set();
            for (const seed of ['花季', '花季A館', '花季C館', '花季 A館', '花季 C館']) {
                out.add(seed);
                const half = seed.normalize('NFKC');
                out.add(half);
                out.add(half.replace(/[A-Za-z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 0xFEE0)));
            }
            return [...out];
        }
        if (name === '承億' || name === '承億健身房' || name === '承億休閒') {
            return ['承億', '承億健身房', '承億休閒', '承億 健身房', '承億 休閒'];
        }
        if (name === '日航' || name === '日航休閒中心' || name === '日航休閒') {
            return ['日航', '日航休閒中心', '日航休閒', '日航 休閒中心'];
        }
        return null;
    }
    function priceLookupLabels(hotel) {
        const name = String(hotel || '').trim();
        if (name === '承億 健身房') return ['承億 健身房 健身房', '承億健身房 健身房'];
        if (name === '承億 休閒') return ['承億 休閒 休閒', '承億休閒 休閒'];
        if (name === '日航 休閒中心') return ['日航 休閒中心 休閒中心', '日航休閒中心 休閒中心'];
        if (name === '日航 休閒中心 特處') return ['日航休閒中心 特處'];
        return [];
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
    let quantityWarnings = [];
    function hasSignature(data) {
        return !!(String(data.clientSig || '').trim() || String(data.driverSig || '').trim());
    }
    // 已簽的正規主單優先（花季半形「A館 房務」、承億「健身房」、日航「休閒中心」）。未簽影子單不能蓋過已簽單。
    function canonicalRank(entry) {
        const hotel = String(entry.data.hotelKeyword || '');
        const dept = String(entry.data.deptName || '');
        const halfwidthMain = hotel.normalize('NFKC') === hotel && dept.normalize('NFKC') === dept
            && clean(hotel) === entry.branch.hotelKeyword && dept === entry.branch.deptName;
        return (hasSignature(entry.data) ? 4 : 0) + (halfwidthMain ? 2 : 0) + (clean(hotel) === entry.branch.hotelKeyword ? 1 : 0);
    }
    function collapse(documents) {
        quantityWarnings = [];
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
            entries.sort((a, b) => {
                const hotel = a.branch.hotelKeyword;
                if (hotel === '花季' || hotel === '承億' || hotel === '日航') {
                    const rank = canonicalRank(b) - canonicalRank(a);
                    if (rank) return rank;
                } else {
                    const signedFirst = Number(hasSignature(b.data)) - Number(hasSignature(a.data));
                    if (signedFirst) return signedFirst;
                }
                return receiptTime(b.data) - receiptTime(a.data)
                    || String(b.data.timestamp || '').localeCompare(String(a.data.timestamp || ''));
            });
            for (const entry of entries) {
                for (const item of entry.data.items || []) {
                    if (item.deletedInLogistics) continue;
                    const key = clean(item.inventoryItemName || item.itemName);
                    const existing = items.get(key);
                    const unsignedFuyano = entry.branch.hotelKeyword === '富野' && sources.get(key) && !(entry.data.clientSig || entry.data.driverSig);
                    if (existing && entries.length > 1 && !unsignedFuyano && billedQty(existing) !== billedQty(item)) {
                        const hotel = entry.branch.hotelKeyword;
                        if (hotel === '花季' || hotel === '承億' || hotel === '日航') {
                            quantityWarnings.push({
                                date: String(entry.data.date || ''),
                                building: entry.branch.building || '',
                                deptName: entry.branch.deptName,
                                item: item.itemName || item.inventoryItemName || '',
                                keptQty: billedQty(existing),
                                otherQty: billedQty(item),
                            });
                        } else {
                            throw new Error(hotel + ' ' + entry.data.date + ' ' + entry.branch.deptName + '「' + (item.itemName || item.inventoryItemName || '') + '」有兩張單，數量 ' + billedQty(existing) + ' 與 ' + billedQty(item) + ' 不同，請先核對原單再出帳。系統不會自動取其中一張，也不會把數量相加。');
                        }
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
        priceLookupLabels, canonicalWrite, collapse, foldForBilling, billedQty,
        get quantityWarnings() { return quantityWarnings; },
    };
})(typeof globalThis === 'object' ? globalThis : this);
