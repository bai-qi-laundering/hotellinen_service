/**
 * Add this file to the EXISTING Apps Script project; do not replace doGet.
 * In its existing getInventoryData response object add:
 *   sendwashSettings: readSendwashSettings(existingSpreadsheet)
 * Use the same Spreadsheet object already used for the template and schedules.
 */
function readSendwashSettings(ss) {
  var sheet = ss.getSheetByName('送洗對點設定');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getDisplayValues();
  var header = values.shift().map(function(value) { return String(value).trim(); });
  var required = ['飯店', '部門', '品項', '預設數量', '單位', '排列順序', '是否啟用'];
  var columns = {};
  required.forEach(function(name) {
    var index = header.indexOf(name);
    if (index < 0) throw new Error('送洗對點設定缺少欄位：' + name);
    columns[name] = index;
  });
  var outletColumn = header.indexOf('餐廳');
  return values.filter(function(row) { return row.some(function(cell) { return cell !== ''; }); }).filter(function(row) {
    var enabled = String(row[columns['是否啟用']]).trim().toLowerCase();
    if (['是', 'true', '1', '啟用'].indexOf(enabled) >= 0) return true;
    if (['', '否', 'false', '0', '停用'].indexOf(enabled) >= 0) return false;
    throw new Error('是否啟用請填「是」或「否」');
  }).map(function(row) {
    return {
      hotel: row[columns['飯店']].trim(), department: row[columns['部門']].trim(),
      item: row[columns['品項']].trim(), outlet: outletColumn >= 0 ? String(row[outletColumn] || '').trim() : '', defaultQuantity: row[columns['預設數量']].trim(),
      unit: row[columns['單位']].trim(), order: row[columns['排列順序']].trim()
    };
  });
}

