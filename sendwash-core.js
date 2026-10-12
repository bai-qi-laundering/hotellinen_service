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
        return rows.map(r => {
            if (!r.hotel || !r.department || !r.item) throw new Error('對點設定需有飯店、部門及品項');
            const matches = template.filter(t => normalize(t.baseName) === normalize(r.hotel) && department(t.deptName || '房務') === department(r.department) && normalize(t.item) === normalize(r.item));
            if (matches.length !== 1) throw new Error(`對點品項無法唯一對應登記清單：${r.hotel}／${r.department}／${r.item}`);
            const key = JSON.stringify([normalize(r.hotel),department(r.department),normalize(r.item)]);
            if (seen.has(key)) throw new Error('對點設定有重複品項'); seen.add(key);
            const t = matches[0];
            return {hotel:t.baseName, department:t.deptName || '房務', inventoryHotel:t.hotel, item:t.item, unit:String(r.unit || '件'), order:Number(r.order || 0), defaultQuantity:r.defaultQuantity === '' || r.defaultQuantity == null ? '' : quantity(r.defaultQuantity)};
        }); // Preserve spreadsheet row order; legacy numeric order is ignored.
    }
    const submissionId = (hotel,dept,sourceDate) => encodeURIComponent(JSON.stringify([hotel,dept,sourceDate]));
    const inventoryId = (target,hotel,item) => `${target}_${hotel}_${item.replace(/\//g,'-')}`;
    function mergeVerification(existing, sourceId, declared, actual) {
        if (!existing.sendwashSources && [existing.count,existing.doubleCount,existing.signature,existing.doubleSignature].some(v=>v !== undefined && v !== null && v !== '')) throw new Error('登記單已有現場資料，請由管理員核對，系統不會覆蓋');
        const sources = {...(existing.sendwashSources || {}),[sourceId]:{declared:quantity(declared),actual:quantity(actual)}};
        const values = Object.values(sources);
        return {sendwashSources:sources,count:quantity(values.reduce((s,r)=>s+Number(r.declared),0)),doubleCount:quantity(values.reduce((s,r)=>s+Number(r.actual),0))};
    }
    const api = {normalize,department,quantity,targetDate,settings,submissionId,inventoryId,mergeVerification};
    root.SendwashCore=api;
    if (typeof module !== 'undefined') module.exports=api;
})(typeof window !== 'undefined' ? window : globalThis);
