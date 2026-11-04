// 在原 Apps Script 中，只替換同名的 baiqiReadDeliverySchedules 函式。
// 保留其他程式，儲存後將既有網頁應用程式部署更新至新版本。
function baiqiReadDeliverySchedules(ss) {
  const sheet = ss.getSheetByName('收送日設定');
  if (!sheet) throw new Error('找不到收送日設定分頁。');
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0].map(function(v) { return String(v).trim(); });
  const columns = ['飯店', '部門', '固定收送日', '打單日期規則'].map(function(name) {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error('收送日設定缺少欄位：' + name);
    return index;
  });
  const result = [];
  rows.slice(1).forEach(function(row, index) {
    const values = columns.map(function(col) { return String(row[col] || '').trim(); });
    if (values.every(function(v) { return !v; })) return;
    if (values.some(function(v) { return !v; })) throw new Error('收送日設定第 ' + (index + 2) + ' 列未填完整。');
    const rule = values[3].normalize('NFKC').replace(/\s+/g, '');
    if (rule !== '收件後的下一個收送日' && !/^收件後(?:的)?(?:第|下)(?:2|二|兩)個(?:收送日|工作日)$/.test(rule)) throw new Error('收送日設定第 ' + (index + 2) + ' 列打單日期規則不支援。');
    result.push({hotel: values[0], department: values[1], days: values[2], rule: values[3]});
  });
  return result;
}
