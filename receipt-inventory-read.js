/* Receipt inventory needs quantities and notes, not the plant's signature images.
 * Keep the original date-wide read so legacy hotel field aliases are not lost.
 * This reads the same server data and never writes or supplies offline data. */
(function (root) {
    const fields = ['date', 'hotel', 'hotelKeyword', 'hotelName', 'item', 'itemName', 'name',
        'items', 'count', 'doubleCount', 'quantity', 'qty', 'amount', 'note', 'auntNote',
        'outlet', 'sourceItem', 'department', 'baseHotel'];
    function decode(value) {
        if ('nullValue' in value) return null;
        if ('integerValue' in value) return Number(value.integerValue);
        if ('doubleValue' in value) return Number(value.doubleValue);
        if ('booleanValue' in value) return value.booleanValue;
        if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
        if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
        if ('geoPointValue' in value) return value.geoPointValue;
        for (const type of ['stringValue', 'timestampValue', 'referenceValue', 'bytesValue']) {
            if (type in value) return value[type];
        }
        throw new Error('出貨資料格式無法辨識');
    }
    function decodeFields(values) {
        return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, decode(value)]));
    }
    async function read({ projectId, date, fallback, fetchImpl = root.fetch.bind(root), timeoutMs = 10000 }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`, {
                method: 'POST', cache: 'no-store', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ structuredQuery: {
                    from: [{ collectionId: 'inventory_records' }],
                    where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: date } } },
                    select: { fields: fields.map(fieldPath => ({ fieldPath })) }
                } })
            });
            if (!response.ok) throw new Error(`出貨資料讀取失敗 (${response.status})`);
            const result = await response.json();
            if (!Array.isArray(result) || result.some(row => row.error)) throw new Error('出貨資料回應不完整');
            const docs = result.filter(row => row.document).map(({ document }) => {
                const data = decodeFields(document.fields || {});
                return { id: document.name.split('/').pop(), data: () => data };
            });
            return { docs, size: docs.length, empty: !docs.length, forEach: callback => docs.forEach(callback) };
        } catch (error) {
            // Fall back to the standard server query; never treat a failed read as an empty receipt.
            if (fallback) return await fallback();
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
    const api = { read };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReceiptInventoryRead = api;
})(typeof window === 'object' ? window : globalThis);
