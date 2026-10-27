// 特處 LINE Messaging API webhook（Google Apps Script 網頁應用程式）。
// 跟 Parser.gs 放在同一個 Apps Script 專案。不使用試算表。
// 寫入 Firestore special_items，欄位和 special.html 臨時輸入相同，並多記 LINE 使用者。

var PROJECT_ID = 'hotel-inventory-3a1ad';
var DEFAULT_API_KEY = 'AIzaSyBEXcnXOKRags29CvhM6TKe3N-zty-ela4';
var FALLBACK_HOTELS = [
    'H2O', '候工所', '喜達絲', '天子閣', '天慕', '好六', '好地方', '媚力泊', '宮賞', '家和',
    '富野', '富野汽旅', '巨蛋', '巨蛋一般', '帕鉑', '建工', '承億', '承億休閒', '承億健身房',
    '捷中正', '捷站前', '文一', '文七', '文旅', '日航', '日航休閒中心', '林森', '歐遊', '比歐',
    '永心', '河畔', '泊思行旅', '洲際', '然一', '癮君子', '癮室', '福客來', '禾寓', '禾鮨',
    '秝二', '秝芯', '老新', '良一', '良站前', '良西', '花季', '花季Ａ館', '花季Ｃ館', '英迪格',
    '萊特薇庭', '金馬', '鈞怡', '鉑麗', '雅樂十刻', '雅樂廚苑', '頭等艙', '駱駝', '驛館', '高廬',
    '鴨點棧明誠', '鴨點棧華夏', '麥當勞', '鼎王',
];
var PARSE_HINT = '沒看懂。請先講飯店再講數量和品項，例如：好六一條床單一條被套三條足巾';
var LOCKED_TEXT = '這筆已經簽名或送出，不能從 LINE 刪除。請跟辦公室或老闆後台說。';

function doGet() {
    return ContentService.createTextOutput('特處 LINE webhook 已部署。LINE 要呼叫的網址必須帶 ?token=。');
}

function doPost(e) {
    if (!webhookAuthorized_(e)) throw new Error('webhook token 不對');
    var body = e && e.postData && e.postData.contents;
    if (!body) return textOut_('ok');
    var payload;
    try {
        payload = JSON.parse(body);
    } catch (err) {
        return textOut_('ok');
    }
    var events = payload.events || [];
    for (var i = 0; i < events.length; i++) {
        try {
            handleEvent_(events[i]);
        } catch (err) {
            console.error(err);
            replyText_(events[i] && events[i].replyToken, '沒有寫進特處，請稍後再試。');
        }
    }
    return textOut_('ok');
}

function webhookAuthorized_(e) {
    var expected = prop_('LINE_WEBHOOK_TOKEN');
    var given = e && e.parameter ? String(e.parameter.token || '') : '';
    if (!expected || given !== expected) return false;
    var signature = header_(e, 'x-line-signature');
    if (!signature) return true;
    return lineSignatureOk_(e.postData.contents || '', signature);
}

function header_(e, name) {
    var bags = [e && e.headers, e && e.requestHeaders];
    for (var i = 0; i < bags.length; i++) {
        var headers = bags[i];
        if (!headers) continue;
        var keys = Object.keys(headers);
        for (var j = 0; j < keys.length; j++) {
            if (String(keys[j]).toLowerCase() === name) return String(headers[keys[j]] || '');
        }
    }
    return '';
}

function lineSignatureOk_(body, signature) {
    var secret = prop_('LINE_CHANNEL_SECRET');
    if (!secret) return false;
    var digest = Utilities.base64Encode(Utilities.computeHmacSha256Signature(body, secret));
    return digest === signature;
}

function handleEvent_(event) {
    if (!event || seenEvent_(event.webhookEventId)) return;
    if (event.type === 'postback') {
        handlePostback_(event);
        markEvent_(event.webhookEventId);
        return;
    }
    if (event.type !== 'message' || !event.message || event.message.type !== 'text') return;
    handleText_(event);
    markEvent_(event.webhookEventId);
}

function handleText_(event) {
    var text = String(event.message.text || '');
    var userId = event.source && event.source.userId || '';
    var grouped = isGroup_(event);
    if (isCancelCommand(text)) {
        if (!userId) {
            replyText_(event.replyToken, '這則訊息沒有帶使用者，沒辦法取消上一筆。請先把官方帳號加為好友。');
            return;
        }
        cancelLatest_(event.replyToken, userId);
        return;
    }
    var catalog = loadCatalog_();
    var parsed = parseSpecialEntry(text, {
        hotels: catalog.hotels,
        items: catalog.items,
        receivedDate: taipeiToday(event.timestamp ? new Date(event.timestamp) : new Date()),
    });
    if (!parsed.ok) {
        if (grouped && !mentionsHotelOrItem(text, catalog)) return;
        replyText_(event.replyToken, PARSE_HINT);
        return;
    }
    var messageId = String(event.message.id || '');
    if (messageId && queryEquals_('lineMessageId', messageId).length) return;
    var time = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();
    var entryId = newId_('en');
    var docs = buildLineDocs(parsed, {
        time: time,
        entryId: entryId,
        userId: userId,
        displayName: displayName_(event.source),
        messageId: messageId,
    });
    for (var i = 0; i < docs.length; i++) {
        docs[i].id = newId_('sp');
        createDoc_(docs[i]);
    }
    var summary = lineSummary(parsed.hotel, parsed.lines);
    reply_(event.replyToken, [flexSaved_(summary, entryId)]);
}

function handlePostback_(event) {
    var data = event.postback && event.postback.data || '';
    var match = /^delete:(en_[0-9a-z]+_[0-9a-z]+)$/.exec(data);
    if (!match) return;
    deleteEntry_(event.replyToken, match[1], event.timestamp);
}

function cancelLatest_(replyToken, userId) {
    var docs = queryEquals_('lineUserId', userId);
    var entryId = latestEntryId(docs, userId);
    if (!entryId) {
        replyText_(replyToken, '沒有可以取消的上一筆。');
        return;
    }
    deleteEntry_(replyToken, entryId);
}

function deleteEntry_(replyToken, entryId, timestamp) {
    var all = queryEquals_('entryId', entryId);
    var docs = all.filter(function (doc) { return !doc.deleted; });
    if (!all.length) {
        replyText_(replyToken, '找不到這筆。');
        return;
    }
    if (!docs.length) {
        replyText_(replyToken, '這筆已經刪除了。');
        return;
    }
    var decision = entryDeleteDecision(docs);
    if (!decision.ok) {
        replyText_(replyToken, LOCKED_TEXT);
        return;
    }
    var time = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
    var next = softDeleteDocs(docs, time);
    for (var i = 0; i < next.length; i++) {
        if (!next[i] || !next[i].deleted) continue;
        patchDoc_(next[i].id, {
            deleted: true,
            deletedAt: next[i].deletedAt,
            history: next[i].history,
            edits: next[i].edits,
        });
    }
    replyText_(replyToken, '已刪除 ' + lineSummary(docs[0].hotel, docs));
}

function flexSaved_(summary, entryId) {
    var shown = summary.length > 280 ? summary.slice(0, 280) + '…' : summary;
    return {
        type: 'flex',
        altText: shown,
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    { type: 'text', text: '已寫入特處', weight: 'bold', size: 'md', color: '#134e4a' },
                    { type: 'text', text: shown, wrap: true, weight: 'bold', size: 'xl', margin: 'md' },
                    { type: 'text', text: '打錯可以按刪除。已經簽名或送出的，要請辦公室或老闆後台處理。', wrap: true, size: 'sm', color: '#78716c', margin: 'md' },
                ],
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        color: '#b91c1c',
                        height: 'sm',
                        action: { type: 'postback', label: '刪除這筆', data: 'delete:' + entryId, displayText: '刪除這筆' },
                    },
                ],
            },
        },
    };
}

function isGroup_(event) {
    var type = event.source && event.source.type;
    return type === 'group' || type === 'room';
}

function displayName_(source) {
    if (!source || !source.userId) return '';
    var token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) return '';
    var url = 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(source.userId);
    if (source.type === 'group' && source.groupId) {
        url = 'https://api.line.me/v2/bot/group/' + encodeURIComponent(source.groupId) + '/member/' + encodeURIComponent(source.userId);
    } else if (source.type === 'room' && source.roomId) {
        url = 'https://api.line.me/v2/bot/room/' + encodeURIComponent(source.roomId) + '/member/' + encodeURIComponent(source.userId);
    }
    var res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return '';
    try {
        return String(JSON.parse(res.getContentText()).displayName || '');
    } catch (err) {
        return '';
    }
}

function loadCatalog_() {
    var cache = CacheService.getScriptCache();
    var hit = cache.get('special-catalog-v1');
    if (hit) {
        try { return JSON.parse(hit); } catch (err) { /* 快取壞了就重讀 */ }
    }
    var data = getDoc_('inventory_config/master_template');
    var catalog = data ? catalogFromTemplate_(data) : { hotels: FALLBACK_HOTELS.slice(), items: [] };
    if (!catalog.hotels.length) catalog.hotels = FALLBACK_HOTELS.slice();
    try { cache.put('special-catalog-v1', JSON.stringify(catalog), 600); } catch (err) { /* 清單太大就不要快取 */ }
    return catalog;
}

function catalogFromTemplate_(data) {
    var hotels = [];
    var items = [];
    function add(list, value) {
        var name = String(value || '').replace(/^\s+|\s+$/g, '');
        if (name && list.indexOf(name) === -1) list.push(name);
    }
    var rows = data.items || [];
    for (var i = 0; i < rows.length; i++) {
        add(hotels, rows[i].baseName);
        add(items, rows[i].item);
    }
    var schedules = data.deliverySchedules || [];
    for (var j = 0; j < schedules.length; j++) add(hotels, schedules[j].hotel);
    return { hotels: hotels, items: items };
}

function replyText_(replyToken, text) {
    if (!text) return;
    reply_(replyToken, [{ type: 'text', text: text }]);
}

function reply_(replyToken, messages) {
    var token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token || !replyToken || !messages || !messages.length) return;
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
        muteHttpExceptions: true,
    });
}

function seenEvent_(id) {
    if (!id) return false;
    return CacheService.getScriptCache().get('evt:' + id) === '1';
}

function markEvent_(id) {
    if (!id) return;
    try { CacheService.getScriptCache().put('evt:' + id, '1', 600); } catch (err) { /* 略過 */ }
}

function prop_(name) {
    return String(PropertiesService.getScriptProperties().getProperty(name) || '').replace(/^\s+|\s+$/g, '');
}

function textOut_(body) {
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.TEXT);
}

function newId_(prefix) {
    var rand = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toLowerCase();
    return prefix + '_' + new Date().getTime().toString(36) + '_' + rand;
}

function apiKey_() {
    return prop_('FIREBASE_API_KEY') || DEFAULT_API_KEY;
}

function firestoreRoot_() {
    return 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
}

function createDoc_(doc) {
    var fields = {};
    var keys = Object.keys(doc);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i] !== 'id') fields[keys[i]] = doc[keys[i]];
    }
    var url = firestoreRoot_() + '/special_items?documentId=' + encodeURIComponent(doc.id) + '&key=' + encodeURIComponent(apiKey_());
    var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ fields: fsFields_(fields) }),
        muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
        throw new Error('Firestore 寫入失敗 ' + res.getResponseCode());
    }
}

function patchDoc_(id, fields) {
    var mask = Object.keys(fields).map(function (key) {
        return 'updateMask.fieldPaths=' + encodeURIComponent(key);
    }).join('&');
    var url = firestoreRoot_() + '/special_items/' + encodeURIComponent(id) + '?' + mask + '&key=' + encodeURIComponent(apiKey_());
    var res = UrlFetchApp.fetch(url, {
        method: 'patch',
        contentType: 'application/json',
        payload: JSON.stringify({ fields: fsFields_(fields) }),
        muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
        throw new Error('Firestore 更新失敗 ' + res.getResponseCode());
    }
}

function getDoc_(path) {
    var url = firestoreRoot_() + '/' + path + '?key=' + encodeURIComponent(apiKey_());
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var body = JSON.parse(res.getContentText());
    return fsUnwrap_({ mapValue: { fields: body.fields || {} } });
}

function queryEquals_(field, value) {
    var url = firestoreRoot_() + ':runQuery?key=' + encodeURIComponent(apiKey_());
    var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: 'special_items' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: field },
                        op: 'EQUAL',
                        value: { stringValue: value },
                    },
                },
            },
        }),
        muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error('Firestore 查詢失敗 ' + res.getResponseCode());
    return docsFromQuery_(JSON.parse(res.getContentText()));
}

function docsFromQuery_(rows) {
    var docs = [];
    for (var i = 0; i < (rows || []).length; i++) {
        if (!rows[i].document) continue;
        var name = rows[i].document.name || '';
        var data = fsUnwrap_({ mapValue: { fields: rows[i].document.fields || {} } }) || {};
        data.id = name.split('/').pop();
        docs.push(data);
    }
    return docs;
}

function fsFields_(obj) {
    var fields = {};
    var keys = Object.keys(obj || {});
    for (var i = 0; i < keys.length; i++) fields[keys[i]] = fsWrap_(obj[keys[i]]);
    return fields;
}

function fsWrap_(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (Math.floor(value) === value && Math.abs(value) <= 9007199254740991) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    if (typeof value === 'string') return { stringValue: value };
    if (Object.prototype.toString.call(value) === '[object Array]') {
        return { arrayValue: { values: value.map(fsWrap_) } };
    }
    var fields = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) fields[keys[i]] = fsWrap_(value[keys[i]]);
    return { mapValue: { fields: fields } };
}

function fsUnwrap_(value) {
    if (!value || typeof value !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return value.doubleValue;
    if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
    if (value.arrayValue) return (value.arrayValue.values || []).map(fsUnwrap_);
    if (value.mapValue) {
        var out = {};
        var fields = value.mapValue.fields || {};
        var keys = Object.keys(fields);
        for (var i = 0; i < keys.length; i++) out[keys[i]] = fsUnwrap_(fields[keys[i]]);
        return out;
    }
    return null;
}
