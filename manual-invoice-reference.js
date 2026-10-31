// 照抄用參考畫面，不開立發票、不傳送任何資料。
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
export function manualReferenceHtml(ref, number = '') {
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Number(n).toLocaleString('zh-TW');
  const [year, month, day] = ref.date.split('-').map(Number);
  return '<div class="copy-intro">以下藍色文字就是要照抄的內容。<strong>僅供填寫參考，不是有效發票。</strong><br>抬頭、統編與金額沿用已確認的對帳單。</div>' +
    '<div class="copy-scroll" tabindex="0" role="region" aria-label="三聯式發票照抄參考，可左右捲動"><div class="copy-invoice">' +
    '<div class="copy-heading"><span>手開填寫參考</span><h3>統 一 發 票（三聯式）</h3><span>對帳單 V' + escape(ref.version) + '</span></div>' +
    '<div class="copy-meta"><div>買受人：<b>' + escape(ref.buyer) + '</b></div><div>發票號碼：<b id="copyInvoiceNumber">' + escape(number || '請填寫上方號碼') + '</b></div></div>' +
    '<div class="copy-meta"><div>統一編號：<span class="copy-taxid">' + escape(ref.taxId).split('').map(c => '<b>' + c + '</b>').join('') + '</span></div><div>中華民國 <b>' + (year - 1911) + '</b> 年 <b>' + month + '</b> 月 <b>' + day + '</b> 日</div></div>' +
    '<div class="copy-table"><table><colgroup><col style="width:31%"><col style="width:9%"><col style="width:17%"><col style="width:20%"><col style="width:23%"></colgroup><thead><tr><th>品　名</th><th>數量</th><th>單　價</th><th>金　額</th><th>備　註</th></tr></thead><tbody><tr class="copy-item"><td><b>' + escape(ref.item) + '</b></td><td><b>1</b></td><td class="copy-amount"><b>' + fmt(ref.net) + '</b></td><td class="copy-amount"><b>' + fmt(ref.net) + '</b></td><td rowspan="3" class="copy-remark">金額依對帳單帶入<br>請核對後照抄</td></tr><tr class="copy-blank"><td></td><td></td><td></td><td rowspan="3" class="copy-diagonal"></td></tr><tr class="copy-blank"><td></td><td></td><td></td></tr><tr class="copy-blank"><td></td><td></td><td></td><td rowspan="5" class="copy-stamp"><div>營業人蓋用統一發票專用章</div><strong>記得蓋<br>發票章</strong></td></tr><tr><th colspan="3">銷 售 額 合 計</th><td class="copy-amount"><b>' + fmt(ref.net) + '</b></td></tr><tr><th colspan="2">營 業 稅</th><td class="copy-tax">應稅 <b>✓</b></td><td class="copy-amount"><b>' + fmt(ref.tax) + '</b></td></tr><tr><th colspan="3">總　　計</th><td class="copy-amount"><b>' + fmt(ref.total) + '</b></td></tr><tr><td colspan="4" class="copy-chinese"><span>總計新臺幣<br>（中文大寫）</span><b>' + (Number.isSafeInteger(ref.total)&&ref.total>=0?financeChinese(ref.total):'金額含小數或負值，請人工核對') + '</b></td></tr></tbody></table></div><div class="copy-footnote">品項以整期洗滌費彙總為一筆，數量 1；金額及稅額沿用本份對帳單。</div></div></div><div class="copy-mobile-hint">手機可在參考單內左右滑動，查看完整欄位。</div>';
}
