/* Shared by hotel submission, plant verification and regression tests. */
(function(root) {
    'use strict';
    const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').trim();
    const department = value => { const d = normalize(value); return ['房務部', '餐飲部'].includes(d) ? d.slice(0, -1) : d; };
    const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    function date(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式錯誤');
        const [y,m,d] = value.split('-').map(Number); const result = new Date(y,m-1,d,12);
        if (localDate(result) !== value) throw new Error('日期不存在');
        return result;
    }
    function quantity(value) {
        if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('請填入完整的非負整數；沒有送洗請填 0');
        return String(Number(value));
    }
    function submissionItems(rows, values) {
        if (!Array.isArray(rows) || !Array.isArray(values) || rows.length !== values.length) throw new Error('品項數量欄位不一致，請重新載入');
        return rows.flatMap((row, index) => {
            const value = String(values[index] ?? '').trim();
            return value === '' ? [] : [{item:row.item, quantity:quantity(value), unit:row.unit}];
        });
    }
    function targetDate(hotel, dept, sourceDate, schedules) {
        const d = date(sourceDate);
        if (!Array.isArray(schedules)) throw new Error('收送日設定尚未載入');
        const matches = schedules.filter(r => normalize(r.hotel) === normalize(hotel) && department(r.department) === department(dept));
        if (matches.length > 1) throw new Error('收送日設定重複，請先確認試算表');
        const rule = matches[0];
        if (rule) {
            if (rule.rule !== '收件後的下一個收送日' || !Array.isArray(rule.days) || !rule.days.length || rule.days.some(n => !Number.isInteger(n) || n < 0 || n > 6)) throw new Error('固定收送日設定不完整，請先更新設定');
            for (let i=0;i<7;i++) { d.setDate(d.getDate()+1); if(rule.days.includes(d.getDay())) return localDate(d); }
        }
        // Exactly the existing index.html fallback, including its legacy exceptions.
        if (['歐遊','H2O','花季Ａ館','花季Ｃ館','花季','文七','好六','媚力泊'].some(k=>hotel.includes(k))) return localDate(d);
        d.setDate(d.getDate() + (['捷中正'].some(k=>hotel.includes(k)) ? -1 : 1));
        return localDate(d);
    }
    function settings(rows, template) {
        if (!Array.isArray(rows) || !Array.isArray(template)) throw new Error('對點設定格式錯誤');
        const seen = new Set();
        const result=rows.map(r => {
            if (!r.hotel || !r.department || !r.item) throw new Error('對點設定需有飯店、部門及品項');
            const matches = template.filter(t => normalize(t.baseName) === normalize(r.hotel) && department(t.deptName || '房務') === department(r.department) && normalize(t.item) === normalize(r.item));
            if (matches.length !== 1) throw new Error(`對點品項無法唯一對應登記清單：${r.hotel}／${r.department}／${r.item}`);
            const outlet=String(r.outlet || '').trim();
            if (outlet && !outlet.replace(/\s/g,'')) throw new Error('餐廳名稱不可空白');
            const key = JSON.stringify([normalize(r.hotel),department(r.department),normalize(outlet),normalize(r.item)]);
            if (seen.has(key)) throw new Error('對點設定有重複品項'); seen.add(key);
            const t = matches[0];
            return {hotel:t.baseName, department:t.deptName || '房務', inventoryHotel:t.hotel, item:t.item, ...(outlet?{outlet}:{}), unit:String(r.unit || '件'), order:Number(r.order || 0), defaultQuantity:r.defaultQuantity === '' || r.defaultQuantity == null ? '' : quantity(r.defaultQuantity)};
        }); // Preserve spreadsheet row order; legacy numeric order is ignored.
        for (const row of result) {
            if (row.outlet && result.some(other=>!other.outlet&&normalize(other.hotel)===normalize(row.hotel)&&department(other.department)===department(row.department))) {
                throw new Error(`${row.hotel}／${row.department} 不能同時啟用「餐廳」空白與分餐廳品項；請先停用原本的彙總列`);
            }
        }
        return result;
    }
    const submissionId = (hotel,dept,sourceDate,outlet='') => encodeURIComponent(JSON.stringify(outlet?[hotel,dept,sourceDate,outlet]:[hotel,dept,sourceDate]));
    const outletItem = (outlet,item) => outlet ? `【${outlet}】${item}` : item;
    const inventoryId = (target,hotel,item) => `${target}_${hotel}_${item.replace(/\//g,'-')}`;
    function mergeVerification(existing, sourceId, declared, actual) {
        if (!existing.sendwashSources && [existing.count,existing.doubleCount,existing.signature,existing.doubleSignature].some(v=>v !== undefined && v !== null && v !== '')) throw new Error('登記單已有現場資料，請由管理員核對，系統不會覆蓋');
        const sources = {...(existing.sendwashSources || {}),[sourceId]:{declared:quantity(declared),actual:quantity(actual)}};
        const values = Object.values(sources);
        return {sendwashSources:sources,count:quantity(values.reduce((s,r)=>s+Number(r.declared),0)),doubleCount:quantity(values.reduce((s,r)=>s+Number(r.actual),0))};
    }
    // Only InterContinental's restaurant outlets skip the dirty-linen signature.
    const recheckOnly = record => normalize(record.baseHotel || String(record.hotel || '').split(/\s+/)[0]) === '洲際' && !!record.outlet && department(record.department || '') !== '制服';
    function sendwashInventoryPatch(latest, payload, expectedCount, expectedDoubleCount) {
        if (latest.countSource !== 'sendwash') throw new Error('來源單已變更，請重新載入');
        if (String(latest.count ?? '') !== String(expectedCount ?? '') || String(latest.doubleCount ?? '') !== String(expectedDoubleCount ?? '')) throw new Error('數量已由其他人更新，請重新載入後確認');
        const single = recheckOnly(latest);
        const count = single && latest.sendwashSupplemental && payload.count === '' ? '' : quantity(payload.count);
        const doubleCount = payload.doubleCount === '' ? '' : quantity(payload.doubleCount);
        if (latest.doubleSignature && (count !== String(latest.count) || (payload.signature && payload.signature !== latest.signature))) throw new Error('已完成出貨複點，現場數量與簽名已鎖定');
        const firstSignature = payload.signature || latest.signature;
        const secondSignature = payload.doubleSignature || latest.doubleSignature;
        if (!single && !firstSignature) throw new Error('請先完成回廠現場簽名');
        if (single && !secondSignature) throw new Error('請完成複點簽名');
        if (single && count !== String(latest.count ?? '')) throw new Error('飯店送洗數量不可在複點時修改，請修改右側複點數量');
        if (secondSignature && doubleCount === '') throw new Error('請填入出貨複點數量');
        if (doubleCount !== '' && !secondSignature) throw new Error('請完成出貨複點簽名');
        return {...payload, count, doubleCount, countSource:'sendwash', sendwashStage:secondSignature && doubleCount !== '' ? 'ready' : 'received'};
    }
    // UI names remain independent inventory keys; receipts map them back to billing names.
    const retiredOutletItem = row => recheckOnly(row) && normalize(row.outlet)==='湛露' && normalize(row.item)==='口布';
    function displayRows(rows) {
        const expanded=rows.flatMap(row=>{
            if(!recheckOnly(row))return [row];
            const names=normalize(row.item)==='口布'&&normalize(row.outlet)==='湛露' ? ['黃口布','白口布'] : ['擦拭布','紅邊擦拭布'].includes(normalize(row.item)) ? ['擦拭布','紅邊擦拭布'] : [row.item];
            if(names.length===1)return [row];
            return names.map(item=>({...row,item,defaultQuantity:item===row.item?row.defaultQuantity:''}));
        });
        // Keep CLUB's separate cocktail count immediately below its square towels.
        const clubGroups=new Set();
        for(const row of rows){
            if(!recheckOnly(row)||normalize(row.outlet)!=='CLUB')continue;
            const key=JSON.stringify([row.hotel,row.department,row.outlet]);
            if(clubGroups.has(key))continue;clubGroups.add(key);
            const same=other=>other.hotel===row.hotel&&other.department===row.department&&other.outlet===row.outlet;
            const prior=expanded.findIndex(other=>same(other)&&normalize(other.item)==='雞尾酒巾');
            const cocktail=prior<0?{...row,item:'雞尾酒巾',unit:'條',defaultQuantity:''}:expanded.splice(prior,1)[0];
            let anchor=expanded.findIndex(other=>same(other)&&normalize(other.item)==='方巾');
            if(anchor<0){expanded.push({...row,item:'方巾',unit:'條',defaultQuantity:''});anchor=expanded.length-1;}
            expanded.splice(anchor+1,0,cocktail);
        }
        const seen=new Set();return expanded.filter(row=>{const key=JSON.stringify([row.hotel,row.department,row.outlet,row.item]);if(seen.has(key))return false;seen.add(key);return true;});
    }
    const api = {normalize,department,quantity,submissionItems,sendwashInventoryPatch,recheckOnly,displayRows,retiredOutletItem,targetDate,settings,submissionId,outletItem,inventoryId,mergeVerification};
    root.SendwashCore=api;
    if (typeof module !== 'undefined') module.exports=api;
})(typeof window !== 'undefined' ? window : globalThis);


