// 開票公司沿用貨款登記的對照表。客戶資料表目前沒有「開票公司」欄；
// 以後若加了這一欄，只有對照表裡沒有的客戶才讀它，空白仍是百麒國際電子發票。
import './flower-branch.js';

const ISSUERS = [
    { name: '洲際', issuer: '百麒國際', taxId: '91097496' },
    { name: '然一', issuer: '百麒國際', taxId: '59269713' },
    { name: '然一-客衣', issuer: '百麒國際', taxId: '59269713' },
    { name: '驛館', issuer: '百麒國際', taxId: '92165561' },
    { name: '驛館-餐廳', issuer: '百麒國際', taxId: '92165561' },
    { name: 'H2O', issuer: '百麒國際', taxId: '24978226' },
    { name: '萊特薇庭', issuer: '百麒國際', taxId: '51519007' },
    { name: '良站前', issuer: '百麒國際', taxId: '27696636' },
    { name: '良西+良一', issuer: '百麒國際', taxId: '53589534' },
    { name: '英迪格', issuer: '百麒國際', taxId: '83603127' },
    { name: '富野', issuer: '百麒國際', taxId: '54534755' },
    { name: '帕鉑', issuer: '百麒國際', taxId: '59234476' },
    { name: '候工所', issuer: '百麒國際', taxId: '94169640' },
    { name: '承億藝術', issuer: '百麒國際', taxId: '' },
    { name: '天子閤', issuer: '百麒國際', taxId: '54204229' },
    { name: '塩旅', issuer: '百麒國際', taxId: '83154466' },
    { name: '日航', issuer: '百麒國際', taxId: '94196668' },
    { name: '好地方', issuer: '百麒國際', taxId: '54214520' },
    { name: '好地方六合館', issuer: '百麒國際', taxId: '89164743' },
    { name: '文旅', issuer: '百麒國際', taxId: '54196261' },
    { name: '文旅七賢館', issuer: '百麒國際', taxId: '93781043' },
    { name: '文旅一心館', issuer: '百麒國際', taxId: '90464037' },
    { name: '捷中正', issuer: '百麒國際', taxId: '53678682' },
    { name: '捷站前', issuer: '百麒國際', taxId: '24796632' },
    { name: '鈞怡', issuer: '百麒國際', taxId: '59256463' },
    { name: '宮賞', issuer: '百麒國際', taxId: '29025389' },
    { name: '家和', issuer: '百麒國際', taxId: '22061748' },
    { name: '秝芯', issuer: '百麒國際', taxId: '79808746' },
    { name: '秝二', issuer: '百麒國際', taxId: '42803537' },
    { name: '比歐', issuer: '百麒國際', taxId: '54638055' },
    { name: '河畔', issuer: '百麒國際', taxId: '59701112' },
    { name: '駱駝', issuer: '百麒國際', taxId: '54192434' },
    { name: '媚力泊', issuer: '百麒國際', taxId: '24685592' },
    { name: '頭等艙', issuer: '百麒國際', taxId: '42989392' },
    { name: '喜達絲', issuer: '百麒國際', taxId: '53236645' },
    { name: '癮室', issuer: '百麒國際', taxId: '80664084' },
    { name: '鴨點棧-華夏', issuer: '百麒國際', taxId: '62163056' },
    { name: '鴨點棧-明誠', issuer: '百麒國際', taxId: '83788047' },
    { name: '禾寓', issuer: '百麒國際', taxId: '60390153' },
    { name: '高廬', issuer: '百麒國際', taxId: '82682741' },
    { name: '禾鮨', issuer: '百麒國際', taxId: '93512646' },
    { name: '鼎王-七賢店', issuer: '百麒國際', taxId: '53550600' },
    { name: '鼎王-富國店', issuer: '百麒國際', taxId: '53738226' },
    { name: '無老鍋', issuer: '百麒國際', taxId: '94221603' },
    { name: '歐遊', issuer: '百麒國際', taxId: '28903562' },
    { name: '鉑麗', issuer: '百麒國際', taxId: '' },
    { name: '承億', issuer: '百麒', taxId: '90373873' },
    { name: '花季', issuer: '百麒', taxId: '28596678' },
    { name: '巨蛋', issuer: '百富', taxId: '53902289' },
    { name: '老新', issuer: '日聖', taxId: '24667567' },
    { name: '永心', issuer: '日聖', taxId: '72185131' },
    { name: '福客來', issuer: '日聖', taxId: '28616647' },
    { name: '林森', issuer: '日聖', taxId: '28306262' },
    { name: '建工', issuer: '日聖', taxId: '53232649' },
    { name: '雅樂十刻', issuer: '日聖', taxId: '60589437' },
    { name: '雅樂廚苑', issuer: '日聖', taxId: '71456851' },
];

const ALIASES = [
    { name: '承億酒店', canonical: '承億' },
    { name: '承億酒店(股)公司', canonical: '承億' },
    { name: '承億酒店股份有限公司', canonical: '承億' },
    { name: '承億健身房', canonical: '承億' },
    { name: '承億休閒', canonical: '承億' },
    { name: '花季飯店', canonical: '花季' },
    { name: '花季飯店事業(股)公司大崗山分公司', canonical: '花季' },
    { name: '裕力開發', canonical: '巨蛋' },
    { name: '裕力開發有限公司', canonical: '巨蛋' },
    { name: '老新餐飲', canonical: '老新' },
    { name: '老新餐飲有限公司', canonical: '老新' },
    { name: '永心鳳茶', canonical: '永心' },
    { name: '永心鳳茶有限公司同盟營業所', canonical: '永心' },
    { name: '福客來中餐廳', canonical: '福客來' },
    { name: '福客來中餐廳有限公司', canonical: '福客來' },
    { name: '南北樓', canonical: '林森' },
    { name: '南北樓餐飲', canonical: '林森' },
    { name: '南北樓餐飲事業有限公司', canonical: '林森' },
    { name: '逢友園', canonical: '建工' },
    { name: '逢友園餐廳', canonical: '建工' },
    { name: '逢友園餐廳有限公司', canonical: '建工' },
    { name: '十刻好時光', canonical: '雅樂十刻' },
    { name: '十刻好時光有限公司', canonical: '雅樂十刻' },
    { name: '萬樂國際餐飲', canonical: '雅樂廚苑' },
    { name: '萬樂國際', canonical: '雅樂廚苑' },
    { name: '怡廚商號', canonical: '雅樂廚苑' },
];

function compact(value) {
    return String(value ?? '').normalize('NFKC').replace(/[\s\u3000\-－–—_＋+／/()（）]/g, '').replace(/ㄧ/g, '一').toLowerCase();
}

function lookupConfig(name) {
    const key = compact(name);
    if (!key) return null;
    return ISSUERS.find(row => compact(row.name) === key) || null;
}

function lookupAlias(name) {
    const key = compact(name);
    if (!key) return null;
    const alias = ALIASES.find(row => compact(row.name) === key);
    return alias ? lookupConfig(alias.canonical) : null;
}

function foldedNames(name) {
    const text = String(name || '').trim();
    if (!text) return [];
    const names = [text];
    const parent = globalThis.FlowerBranch?.statementParent?.(text);
    if (parent && compact(parent) !== compact(text)) names.push(parent);
    return names;
}

function matchNames(names) {
    for (const name of names) {
        const row = lookupConfig(name);
        if (row) return { row, source: 'config' };
    }
    for (const name of names) {
        const row = lookupAlias(name);
        if (row) return { row, source: 'alias' };
    }
    return null;
}

export function parseIssuerLabel(value) {
    const text = compact(value);
    if (!text) return '';
    if (['百麒國際', '百麒國際電子', '電子發票', '電子'].includes(text)) return '百麒國際';
    if (['百麒', '百麒手開'].includes(text)) return '百麒';
    if (['百富', '百富手開'].includes(text)) return '百富';
    if (['日聖', '日聖手開'].includes(text)) return '日聖';
    return '';
}

function sheetIssuer(rows, names) {
    if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) return '';
    const titles = rows[0].map(cell => compact(cell));
    const issuerIdx = titles.findIndex(title => title === '開票公司' || title === '發票公司');
    if (issuerIdx < 0) return '';
    const nameIdx = titles.findIndex(title => title === '飯店名稱');
    const nameCol = nameIdx >= 0 ? nameIdx : 0;
    const wanted = new Set(names.map(compact).filter(Boolean));
    for (let index = 1; index < rows.length; index++) {
        const row = rows[index];
        if (!Array.isArray(row) || !wanted.has(compact(row[nameCol]))) continue;
        const issuer = parseIssuerLabel(row[issuerIdx]);
        if (issuer) return issuer;
    }
    return '';
}

function taxIssuer(taxId) {
    const tax = String(taxId || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(tax)) return null;
    const matches = ISSUERS.filter(row => row.taxId === tax);
    if (!matches.length || !matches.every(row => row.issuer === matches[0].issuer)) return null;
    return matches[0];
}

function describe(issuer, canonicalName, source) {
    const manual = issuer === '百麒' || issuer === '百富' || issuer === '日聖';
    return {
        issuer: manual ? issuer : '百麒國際',
        method: manual ? 'manual' : 'electronic',
        label: manual ? '手開發票' : '電子發票',
        companyLabel: manual ? `${issuer}（手開）` : '百麒國際（電子發票）',
        canonicalName: canonicalName || '',
        source,
    };
}

export function resolveInvoiceIssuer(customerKey, { taxId = '', title = '', rows = null } = {}) {
    const primary = matchNames(foldedNames(customerKey));
    if (primary) return describe(primary.row.issuer, primary.row.name, primary.source);
    const fromTitle = matchNames(foldedNames(title));
    if (fromTitle) return describe(fromTitle.row.issuer, fromTitle.row.name, fromTitle.source);
    const names = [...foldedNames(customerKey), ...foldedNames(title)];
    const fromSheet = sheetIssuer(rows, names);
    if (fromSheet) return describe(fromSheet, '', 'sheet');
    const fromTax = taxIssuer(taxId);
    if (fromTax) return describe(fromTax.issuer, fromTax.name, 'tax');
    return describe('百麒國際', '', 'default');
}

export function manualInvoiceRefusal(customerKey, options) {
    const issuer = resolveInvoiceIssuer(customerKey, options);
    if (issuer.method !== 'manual') return '';
    return `這家由${issuer.companyLabel}開立，不能向汎宇開立。請在貨款登記照三聯式填寫紙本，再登記手寫的發票號碼。`;
}
