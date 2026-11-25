// 一起出帳的客戶。試算表仍是一列一家；這裡只列「一份對帳單、一個貨款戶」的組合。
// 良西、良一在客戶清單是兩列，但付款帳戶與貨款頁用的名稱是「良西+良一」。
// 然一／客衣、驛館／餐廳即使統編相同也不在這份名單，維持各自一張。

export const COMBINED_ACCOUNTS = Object.freeze([
    Object.freeze({ key: '良西+良一', members: Object.freeze(['良西', '良一']) }),
]);

export function normalizeAccountText(value) {
    return String(value ?? '').normalize('NFKC').replace(/[\s.．]/g, '').replace(/[－–—]/g, '-').trim().toLowerCase();
}

export function clientProfileIdentity(profile) {
    if (!profile) return '';
    const tax = normalizeAccountText(profile.taxId).replace(/\.0$/, '');
    const title = normalizeAccountText(profile.name);
    if (!tax || !title) return '';
    return `${tax}\n${title}`;
}

export function membersOfStatementTarget(target) {
    const text = String(target ?? '').trim();
    if (!text) return [];
    return text.split(/\s*[+＋]\s*/).map(part => part.trim()).filter(Boolean);
}

function memberSet(value) {
    return new Set(membersOfStatementTarget(String(value ?? '').normalize('NFKC').replace(/\s/g, '')));
}

export function matchingCombinedAccount(members) {
    const set = new Set((members || []).map(name => String(name || '').trim()).filter(Boolean));
    if (set.size < 2) return null;
    return COMBINED_ACCOUNTS.find(account => account.members.length === set.size && account.members.every(name => set.has(name))) || null;
}

export function isCombinedAccountKey(value) {
    return !!matchingCombinedAccount([...memberSet(value)]);
}

export function accountKeyForCustomer(name) {
    const key = String(name ?? '').trim();
    if (!key) return '';
    if (isCombinedAccountKey(key)) {
        return matchingCombinedAccount([...memberSet(key)])?.key || '';
    }
    return COMBINED_ACCOUNTS.find(account => account.members.includes(key))?.key || '';
}

// 勾選或待產清單裡，已知組合的每一家都在，而且試算表抬頭與統編一致（或兩邊都還沒讀到），才合成一份。
// 抬頭或統編互相矛盾時不合併，避免把兩家不同公司併進同一張。
export function statementSelectionGroups(names, profiles) {
    const list = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))];
    const profileFor = typeof profiles === 'function'
        ? profiles
        : name => profiles?.[name];
    const groups = [];
    for (const account of COMBINED_ACCOUNTS) {
        if (!account.members.every(member => list.includes(member))) continue;
        const identities = account.members.map(member => clientProfileIdentity(profileFor(member)));
        const known = identities.filter(Boolean);
        if (known.length && (known.length !== identities.length || new Set(known).size !== 1)) continue;
        groups.push({ key: account.key, members: [...account.members] });
    }
    return groups;
}

export function regroupBillingJobs(jobs, profiles) {
    const groups = statementSelectionGroups((jobs || []).map(job => job.customer), profiles);
    const consumed = new Set();
    const next = [];
    for (const group of groups) {
        const members = group.members.map(name => (jobs || []).find(job => job.customer === name)).filter(Boolean);
        if (members.length !== group.members.length) continue;
        const period = members[0].period;
        if (!period || members.some(job => job.period?.startDate !== period.startDate || job.period?.endDate !== period.endDate)) continue;
        members.forEach(job => consumed.add(job.customer));
        next.push({ customer: group.key, members: [...group.members], jobs: members, period });
    }
    for (const job of jobs || []) {
        if (!consumed.has(job.customer)) next.push({ customer: job.customer, members: [job.customer], jobs: [job], period: job.period });
    }
    return next;
}
