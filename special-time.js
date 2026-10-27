// Asia/Taipei clock helpers shared by the special-linen pages and tests.
// Inventory pages format the phone clock; these helpers pin the calendar to Taipei
// so a phone set to another zone still files the entry on the Taiwan date.

export function taipeiParts(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) throw new Error('時間不正確');
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const bag = {};
    for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
    let hour = bag.hour;
    if (hour === '24') hour = '00';
    const month = Number(bag.month);
    const day = Number(bag.day);
    return {
        date: `${bag.year}-${bag.month}-${bag.day}`,
        time: `${hour}:${bag.minute}:${bag.second}`,
        md: `${month}/${day}`,
        stamp: `${month}/${day} ${hour}:${bag.minute}`,
    };
}

export function taipeiToday(input = new Date()) {
    return taipeiParts(input).date;
}

export function formatMd(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
    if (!match) return String(isoDate || '');
    return `${Number(match[2])}/${Number(match[3])}`;
}

export function formatTaipeiStamp(input) {
    if (!input) return '';
    return taipeiParts(input).stamp;
}
