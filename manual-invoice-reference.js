// 照抄用的三聯式參考畫面。不開立發票、不向汎宇傳送任何資料。
const SPOKEN = '零一二三四五六七八九';
const MONTHS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

export function financeChinese(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount >= 1000000000000) throw new Error('金額超出照抄參考支援範圍。');
  if (amount === 0) return '零元整';
  const digits = '零壹貳參肆伍陸柒捌玖', units = ['', '拾', '佰', '仟'];
  function group(n) {
    let result = '', zero = false;
    for (let pos = 3; pos >= 0; pos--) {
      const digit = Math.floor(n / 10 ** pos) % 10;
      if (!digit) { if (result) zero = true; continue; }
      if (zero) result += '零';
      result += digits[digit] + units[pos]; zero = false;
    }
    return result;
  }
  const parts = [Math.floor(amount / 100000000), Math.floor(amount / 10000) % 10000, amount % 10000];
  const large = ['億', '萬', ''];
  let result = '', skipped = false;
  parts.forEach((part, i) => {
    if (!part) { if (result) skipped = true; return; }
    if (result && (skipped || part < 1000)) result += '零';
    result += group(part) + large[i]; skipped = false;
  });
  return result + '元整';
}

export function invoicePeriodLabel(date) {
  const [year, month] = String(date || '').split('-').map(Number);
  if (!year || month < 1 || month > 12) return '';
  const roc = year - 1911;
  const yearText = String(roc).split('').map(digit => SPOKEN[Number(digit)] || '').join('');
  const start = month % 2 === 0 ? month - 1 : month;
  return `${yearText}年 ${MONTHS[start]}、${MONTHS[start + 1]} 月份`;
}

export function manualReferenceHtml(ref, number = '') {
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString('zh-TW');
  const [year, month, day] = String(ref.date || '').split('-').map(Number);
  const rocYear = year ? year - 1911 : '';
  const digits = String(ref.taxId || '').replace(/\D/g, '').slice(0, 8);
  const boxes = Array.from({ length: 8 }, (_, index) => `<b>${escape(digits[index] || '')}</b>`).join('');
  const chinese = Number.isSafeInteger(ref.total) && ref.total >= 0 ? financeChinese(ref.total) : '金額含小數或負值，請人工核對';
  return '<div class="copy-intro">以下藍色文字就是要照抄到紙本的內容。<strong>僅供填寫參考，不是有效發票，也不會向汎宇開立。</strong><br>抬頭、統編、地址與金額沿用已確認的對帳單；品名用客戶資料表的發票品項。</div>' +
    '<div class="copy-scroll" tabindex="0" role="region" aria-label="三聯式統一發票照抄參考，可左右捲動"><div class="copy-invoice">' +
    '<div class="copy-heading"><span>' + escape(ref.issuer || '手開填寫參考') + '</span><h3>統一發票（三聯式）</h3><span>對帳單 V' + escape(ref.version) + '</span></div>' +
    '<p class="copy-period">' + escape(invoicePeriodLabel(ref.date)) + '</p>' +
    '<div class="copy-meta"><div>買受人（必填）：<b>' + escape(ref.buyer) + '</b></div><div>發票號碼：<b id="copyInvoiceNumber">' + escape(number || '請填寫下方號碼') + '</b></div></div>' +
    '<div class="copy-meta"><div>統一編號（必填）：<span class="copy-taxid">' + boxes + '</span></div><div>中華民國 <b>' + rocYear + '</b> 年 <b>' + (month || '') + '</b> 月 <b>' + (day || '') + '</b> 日</div></div>' +
    '<div class="copy-meta"><div>地址（可空白）：<b>' + escape(ref.address || '') + '</b></div></div>' +
    '<div class="copy-table"><table><colgroup><col style="width:31%"><col style="width:9%"><col style="width:17%"><col style="width:20%"><col style="width:23%"></colgroup><thead><tr><th>品　名</th><th>數量</th><th>單　價</th><th>金　額</th><th>備　註</th></tr></thead><tbody><tr class="copy-item"><td><b>' + escape(ref.item) + '</b></td><td><b>1</b></td><td class="copy-amount"><b>' + fmt(ref.net) + '</b></td><td class="copy-amount"><b>' + fmt(ref.net) + '</b></td><td rowspan="3" class="copy-remark">金額依對帳單帶入<br>請核對後照抄</td></tr><tr class="copy-blank"><td></td><td></td><td></td><td rowspan="3" class="copy-diagonal"></td></tr><tr class="copy-blank"><td></td><td></td><td></td></tr><tr class="copy-blank"><td></td><td></td><td></td><td rowspan="5" class="copy-stamp"><div>營業人蓋用統一發票專用章</div><strong>記得要蓋發票章唷</strong></td></tr><tr><th colspan="3">銷 售 額 合 計</th><td class="copy-amount"><b>' + fmt(ref.net) + '</b></td></tr><tr><th colspan="3" class="copy-tax">營 業 稅　應稅 <input type="checkbox" checked disabled><b>✓</b>　零稅率 <input type="checkbox" disabled>　免稅 <input type="checkbox" disabled></th><td class="copy-amount"><b>' + fmt(ref.tax) + '</b></td></tr><tr><th colspan="3">總　　計</th><td class="copy-amount"><b>' + fmt(ref.total) + '</b></td></tr><tr><td colspan="4" class="copy-chinese"><span>總計新臺幣<br>（中文大寫）</span><b>' + chinese + '</b><span class="copy-places">億仟佰拾萬仟佰拾元</span></td></tr></tbody></table></div><div class="copy-footnote">品名用客戶資料表的發票品項，數量 1；銷售額、營業稅與總計沿用這份對帳單，不另外重算。</div></div></div><div class="copy-mobile-hint">手機可在參考單內左右滑動，查看完整欄位。</div>';
}
