// Display names may change in finance; the inventory source name stays stable.
export const normalizeItemName = name => String(name || '').replace(/[\s\u3000]+/g, '').trim();

// Keep outlet records separate in inventory but show one sum per item to the driver.
export function addInventoryQuantity(map, outletKeys, key, row, outlet = '') {
    if (map[key] && (outlet || outletKeys.has(key))) {
        const total = Number(map[key].originalQty) + Number(row.originalQty);
        if (!Number.isSafeInteger(total)) throw new Error('餐廳品項加總超過可用範圍');
        map[key].originalQty = String(total);
        if (row.auntNote) map[key].auntNote = [map[key].auntNote, row.auntNote].filter(Boolean).join('；');
    } else {
        map[key] = row;
    }
    if (outlet) outletKeys.add(key);
}

// Older outlet rows can lack metadata and keep the encoded name instead.
export function receiptInventoryIdentity(record, itemName, hotel) {
    const encoded = hotel === '洲際' && /^【([^】]+)】(.+)$/.exec(String(itemName).trim());
    const identity=record.outlet && record.sourceItem ? {itemName:String(record.sourceItem).trim(),outlet:record.outlet} : encoded ? {itemName:encoded[2].trim(),outlet:encoded[1]} : {itemName:String(itemName).trim(),outlet:record.outlet || ''};
    if(hotel==='洲際'&&identity.outlet&&!/制服/.test(record.department || record.hotel || '')){
        const item=normalizeItemName(identity.itemName),outlet=normalizeItemName(identity.outlet);
        const seeds=['大地','SEEDS(大地)'].includes(outlet.normalize('NFKC'));
        const total=outlet==='湛露'&&['黃口布','白口布'].includes(item)?'口布':seeds&&item==='餐墊'?'口布':item==='紅邊擦拭布'?'擦拭布':outlet==='CLUB'&&item==='雞尾酒巾'?'方巾':identity.itemName;
        if(total!==identity.itemName)return {...identity,itemName:total,detailItemName:identity.itemName};
    }
    return identity;
}

// A saved total is authoritative; its old outlet breakdown must not be billed again.
export function receiptTotalItems(items, hotel) {
    if (hotel !== '洲際') return items;
    const groups = new Map();
    for (const item of items) {
        const source = String(/^【[^】]+】/.test(item.inventoryItemName || '')?item.inventoryItemName:/^【[^】]+】/.test(item.itemName || '')?item.itemName:item.inventoryItemName || item.itemName || '').trim();
        const identity = receiptInventoryIdentity(item,source,hotel),key=normalizeItemName(identity.itemName);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push({item,identity});
    }
    const normalized=[...groups.values()].flatMap(group=>{
        const totals=group.filter(row=>!row.identity.outlet);
        if (totals.length) return totals.map(row=>({...row.item}));
        const first=group[0],name=first.identity.itemName;
        const sum=field=>String(group.reduce((value,row)=>{
            const present=value=>value!==undefined&&value!==null&&value!=='';
            const qty=Number(present(row.item[field])?row.item[field]:present(row.item.originalQty)?row.item.originalQty:row.item.bqQty ?? 0);
            if(!Number.isSafeInteger(qty)||qty<0||!Number.isSafeInteger(value+qty))throw new Error('餐廳簽收數量格式錯誤，請確認原單');
            return value+qty;
        },0));
        const result={...first.item,itemName:/^【[^】]+】/.test(first.item.itemName)||first.identity.detailItemName?name:first.item.itemName,inventoryItemName:name,originalQty:sum('originalQty'),actualQty:sum('actualQty'),auntNote:group.map(row=>row.item.auntNote).filter(Boolean).join('；'),driverNote:group.map(row=>row.item.driverNote).filter(Boolean).join('；')};
        delete result.outlet;delete result.sourceItem;
        return result;
    });
    // Old signed receipts may contain BOTH a mat total and outlet details.
    // Reclassify only SEEDS' share of that authoritative total, never add it twice.
    const matGroup=groups.get(normalizeItemName('餐墊'));
    const oldMatTotals=matGroup?.filter(row=>!row.identity.outlet) || [];
    const seedsMats=(groups.get(normalizeItemName('口布')) || []).filter(row=>row.identity.detailItemName==='餐墊');
    if(!oldMatTotals.length || !seedsMats.length)return normalized;
    const napkin=normalized.find(item=>normalizeItemName(item.inventoryItemName || item.itemName)==='口布');
    const hasNapkinTotal=(groups.get(normalizeItemName('口布')) || []).some(row=>!row.identity.outlet);
    const qty=(item,field)=>{
        const value=Number(item[field]!==undefined&&item[field]!==null&&item[field]!==''?item[field]:field==='actualQty'?0:item.originalQty ?? item.bqQty ?? 0);
        if(!Number.isSafeInteger(value)||value<0)throw new Error('餐廳簽收數量格式錯誤，請確認原單');
        return value;
    };
    for(const item of normalized){const original=qty(item,'originalQty'),actual=qty(item,'actualQty');item.originalQty=String(original);item.actualQty=String(actual);}
    for(const field of ['originalQty','actualQty']){
        const declared=seedsMats.reduce((sum,row)=>sum+qty(row.item,field),0);
        let remaining=declared,moved=0;
        for(const old of oldMatTotals){
            const target=normalized.find(item=>item.itemName===old.item.itemName&&item.inventoryItemName===old.item.inventoryItemName);
            if(!target)continue;
            const before=qty(target,field),shift=Math.min(before,remaining);
            target[field]=String(before-shift);remaining-=shift;moved+=shift;
        }
        if(napkin){
            const total=qty(napkin,field)+moved-(hasNapkinTotal?0:declared);
            if(!Number.isSafeInteger(total)||total<0)throw new Error('餐廳品項加總超過可用範圍');
            napkin[field]=String(total);
        }
    }
    return normalized.filter(item=>normalizeItemName(item.inventoryItemName || item.itemName)!=='餐墊'||qty(item,'originalQty')!==0||qty(item,'actualQty')!==0);
}

// Display-only breakdown. These rows never enter signing or billing payloads.
export function outletReceiptDetails(inventoryRows, receipts, hotel, settings = []) {
    if (hotel !== '洲際') return [];
    const groups=new Map(),inventoryKeys=new Set();
    const keyFor=(dept,outlet,item)=>JSON.stringify([dept,outlet,normalizeItemName(item)]);
    function add(dept,outlet,item,quantity,note){
        if(!outlet)return;
        const qty=Number(quantity),groupKey=JSON.stringify([dept,outlet]);
        if(!Number.isSafeInteger(qty)||qty<0)throw new Error('餐廳明細數量格式錯誤');
        if(!groups.has(groupKey))groups.set(groupKey,{deptName:dept,outlet,items:new Map()});
        const group=groups.get(groupKey),itemKey=normalizeItemName(item),prior=group.items.get(itemKey);
        const total=Number(prior?.quantity || 0)+qty;
        if(!Number.isSafeInteger(total))throw new Error('餐廳明細加總超過可用範圍');
        group.items.set(itemKey,{itemName:prior?.itemName || item,quantity:String(total),note:[...new Set([prior?.note,note].filter(Boolean))].join('；')});
    }
    for(const {row,outlet,detailItemName} of inventoryRows){
        if(!outlet)continue;
        const name=detailItemName || row.itemName;
        inventoryKeys.add(keyFor(row.deptName,outlet,name));
        add(row.deptName,outlet,name,row.originalQty,row.auntNote);
    }
    // Old signed receipts may retain details even when the source inventory is absent.
    for(const receipt of receipts)for(const item of receipt.items || []){
        const source=/^【[^】]+】/.test(item.inventoryItemName || '')?item.inventoryItemName:/^【[^】]+】/.test(item.itemName || '')?item.itemName:item.inventoryItemName || item.itemName || '';
        const identity=receiptInventoryIdentity(item,source,hotel);
        const detailName=identity.detailItemName || identity.itemName;
        if(!identity.outlet||inventoryKeys.has(keyFor(receipt.deptName,identity.outlet,detailName)))continue;
        const actual=item.actualQty,quantity=actual!==undefined&&actual!==null&&actual!==''?actual:item.originalQty ?? 0;
        add(receipt.deptName,identity.outlet,detailName,quantity,item.auntNote);
    }
    const groupOrder=new Map(),itemOrders=new Map();
    settings.filter(row=>row.hotel===hotel&&row.outlet).forEach(row=>{
        const key=JSON.stringify([row.department,row.outlet]);
        if(!groupOrder.has(key))groupOrder.set(key,groupOrder.size);
        if(!itemOrders.has(key))itemOrders.set(key,new Map());
        const order=itemOrders.get(key),item=normalizeItemName(row.item);if(!order.has(item))order.set(item,order.size);
    });
    return [...groups.entries()].sort(([a],[b])=>(groupOrder.get(a) ?? 9999)-(groupOrder.get(b) ?? 9999)).map(([key,group])=>{
        const order=itemOrders.get(key) || new Map();
        return {...group,items:[...group.items.values()].sort((a,b)=>(order.get(normalizeItemName(a.itemName)) ?? 9999)-(order.get(normalizeItemName(b.itemName)) ?? 9999))};
    });
}

// Finance uses the same receipt totals as the audit desk, scoped to restaurant linen.
export function billingReceiptItems(receipt) {
    const restaurant=String(receipt.hotelKeyword || '').replace(/\s/g,'')==='洲際' && ['餐廳','餐飲','餐飲部'].includes(String(receipt.deptName || '').trim());
    return restaurant ? receiptTotalItems(receipt.items || [],'洲際') : receipt.items || [];
}

export function unreceivedOutletItems(records, date, hotel, department) {
    return records.filter(r=>r.targetDate===date && r.hotel===hotel && r.department===department && r.outlet)
        .flatMap(r=>(r.items || []).filter(i=>!r.receivedItems?.[i.item]).map(i=>`${r.outlet}／${i.item}`));
}

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

export function financeItemSnapshot(item) {
    return JSON.stringify([item.inventoryItemName || item.itemName, String(item.originalQty ?? ''), String(item.actualQty ?? ''), item.price ?? null]);
}

export function applyFinanceItemNames(items, updates) {
    const next = items.map(item => ({...item}));
    for (const update of updates) {
        // Price-only changes must not undo a name changed by another user.
        if (update.newItemName === update.originalItemName) continue;
        let matches = update.financeItemId ? next.filter(item => item.financeItemId === update.financeItemId) : [];
        if(!matches.length && update.sourceRowSnapshot){
            matches=next.filter(item=>financeItemSnapshot(item)===update.sourceRowSnapshot);
            if(matches.length>1){const indexed=next[update.receiptOrder];matches=indexed&&matches.includes(indexed)?[indexed]:[];}
            if(matches.some(item=>item.financeItemId&&item.financeItemId!==update.financeItemId))throw new Error('明細列已由其他人更新，請重新載入後確認。');
        } else if(!matches.length) {
            matches=next.filter(item=>normalizeItemName(item.inventoryItemName || item.itemName)===normalizeItemName(update.sourceItemName));
            if(!matches.length)matches=next.filter(item => itemMatchesName(item, update.sourceItemName));
        }
        if (matches.length !== 1) throw new Error('品項已變更或重複，請重新載入後再修改名稱。');
        const target = matches[0];
        if (target.itemName !== update.originalItemName && target.itemName !== update.newItemName) {
            throw new Error('其他使用者已修改此品項名稱，請重新載入後確認。');
        }
        if(target.itemName!==update.newItemName)Object.assign(target, renameItem(target, update.newItemName));
        if(update.financeItemId)target.financeItemId=update.financeItemId;
    }
    return next;
}

export function mergeSignedItems(latestItems, submittedItems) {
    const next = latestItems.map(item => ({...item}));
    for (const submitted of submittedItems) {
        const sourceName = submitted.inventoryItemName || submitted.itemName;
        let matches = next.filter(item=>normalizeItemName(item.inventoryItemName || item.itemName)===normalizeItemName(sourceName));
        if(!matches.length)matches=next.filter(item => itemMatchesName(item, sourceName));
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

function templateRows(template) {
    return Array.isArray(template) ? template : (template?.items || []);
}

// 與簽收頁相同：先對這家飯店、這個部門的範本，對不到再用這家飯店的品項。
// 不把「日航」算進「日航休閒中心」，除非簽收頁那條包含條件也會算到。
export function receiptTemplateRows(template, hotelKeyword, deptName) {
    const items = templateRows(template);
    const hotel = String(hotelKeyword || '').trim();
    const dept = String(deptName ?? '').trim();
    const matchesHotel = row => row?.baseName === hotel || (row?.hotel && String(row.hotel).includes(hotel));
    const matchesDept = row => {
        const templateDept = row?.deptName || '房務';
        return templateDept === dept || (row?.deptName === '' && dept === '房務') || (row?.hotel && dept && String(row.hotel).includes(dept));
    };
    const matched = dept ? items.filter(row => matchesHotel(row) && matchesDept(row)) : items.filter(matchesHotel);
    return matched.length ? matched : items.filter(matchesHotel);
}

export function receiptItemRanks(template, hotelKeyword, deptName) {
    const ranks = new Map();
    receiptTemplateRows(template, hotelKeyword, deptName).forEach((row, index) => {
        const name = String(row?.item || '').trim();
        if (name && !ranks.has(name)) ranks.set(name, index);
    });
    return ranks;
}

export function splitDepartmentLabel(template, label) {
    const items = templateRows(template);
    const name = String(label || '').trim();
    const bases = [...new Set(items.map(row => String(row?.baseName || '').trim()).filter(Boolean))]
        .sort((a, b) => b.length - a.length);
    const hotelKeyword = bases.find(base => name === base || name.startsWith(`${base} `)) || name;
    const deptName = name.startsWith(`${hotelKeyword} `) ? name.slice(hotelKeyword.length + 1) : '房務';
    return { hotelKeyword, deptName };
}

function compareByReceiptRank(ranks, a, b) {
    const left = ranks.has(a.item) ? ranks.get(a.item) : null;
    const right = ranks.has(b.item) ? ranks.get(b.item) : null;
    if (left != null && right != null && left !== right) return left - right;
    if (left != null && right == null) return -1;
    if (left == null && right != null) return 1;
    return (a._order ?? 0) - (b._order ?? 0);
}

// 範本裡的品項照簽收單順序；範本沒有的放最後，並維持原本出現的先後。
export function orderStatementSnapshot(snapshot, template) {
    const items = templateRows(template);
    if (!snapshot || !items.length) return snapshot;
    const departments = (snapshot.departments || []).map((dept, index) => {
        const { hotelKeyword, deptName } = splitDepartmentLabel(items, dept.name);
        const ranks = receiptItemRanks(items, hotelKeyword, deptName);
        const summary = (dept.summary || []).map((row, order) => ({ ...row, _order: order }));
        summary.sort((a, b) => compareByReceiptRank(ranks, a, b));
        const records = (dept.records || []).map((row, order) => ({ ...row, _order: order }));
        records.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || compareByReceiptRank(ranks, a, b));
        const rank = items.findIndex(row => {
            const hotel = String(row?.baseName || '').trim();
            const department = String(row?.deptName || '房務').trim();
            return hotel === hotelKeyword && department === deptName;
        });
        return {
            ...dept,
            _rank: rank === -1 ? Number.MAX_SAFE_INTEGER : rank,
            _order: index,
            summary: summary.map(({ _order, ...row }) => row),
            records: records.map(({ _order, ...row }) => row),
        };
    });
    departments.sort((a, b) => a._rank - b._rank || a._order - b._order);
    return {
        ...snapshot,
        departments: departments.map(({ _rank, _order, ...dept }) => dept),
    };
}

