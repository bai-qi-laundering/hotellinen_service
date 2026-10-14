const SPREADSHEET_ID = '1AI3RjKdCf5jtLYn7jJf2bYo9e_yaDUdQk7nklzsooBk';
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function doOptions(e) {
  return createJsonResponse({ status: 'success' });
}
function formatDateString(d) {
  if (!d) return "";
  if (d instanceof Date) {
    let month = '' + (d.getMonth() + 1), day = '' + d.getDate(), year = d.getFullYear();
    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;
    return [year, month, day].join('-');
  }
  let dStr = String(d).split('T')[0].replace(/\//g, '-').trim();
  let parts = dStr.split('-');
  if (parts.length === 3) {
      let y = parts[0];
      let m = parts[1].length === 1 ? '0' + parts[1] : parts[1];
      let day = parts[2].length === 1 ? '0' + parts[2] : parts[2];
      return `${y}-${m}-${day}`;
  }
  return dStr;
}
function checkAndInitSheets(ss) {
  if (!ss.getSheetByName("基礎設定")) ss.insertSheet("基礎設定").appendRow(['飯店名稱', '部門分類', '品項名稱']);
  if (!ss.getSheetByName("價格總表")) ss.insertSheet("價格總表").appendRow(['飯店名稱', '部門分類', '品項名稱', '單價']);
  if (!ss.getSheetByName("盤點總表")) ss.insertSheet("盤點總表").appendRow(["選擇日期", "飯店部門", "品項", "現場數量", "備註", "現場簽名", "複點數量", "複點簽名", "複點時間", "請款數量(結帳用)"]);
  if (!ss.getSheetByName("歷史紀錄")) ss.insertSheet("歷史紀錄").appendRow(["盤點日期", "飯店部門", "品項", "現場數量", "備註", "現場簽名", "複點數量", "複點簽名", "操作時間"]);
  if (!ss.getSheetByName("客戶資料表")) ss.insertSheet("客戶資料表").appendRow(['飯店名稱', '請款抬頭名稱', '統一編號', '聯絡人', '聯絡電話', '電子信箱', '付款條件', '付款方式', '出貨地址', '備註']);
  if (!ss.getSheetByName("客戶簽單流水帳")) ss.insertSheet("客戶簽單流水帳").appendRow(['核對確認時間', '飯店名稱', '出貨部門', '原盤點日期', '核對明細數據', '客戶電子簽名', '百麒物流簽名']);
  if (!ss.getSheetByName("路線設定表")) ss.insertSheet("路線設定表").appendRow(['路線名稱', '包含飯店關鍵字(以逗號分隔，如: 花季,歐遊)']);
  if (!ss.getSheetByName("司機排班表")) ss.insertSheet("司機排班表").appendRow(['日期(YYYY-MM-DD)', '司機姓名', '負責路線']);
  baiqiInitDeliveryScheduleSheet(ss);
  baiqiInitSendwashSettingsSheet(ss);
  let summarySheet = ss.getSheetByName("盤點總表");
  if (summarySheet && summarySheet.getRange(1, 10).getValue() === "") {
      summarySheet.getRange(1, 10).setValue("請款數量(結帳用)");
  }
}
// 只在分頁不存在時建立，已有設定時不覆寫。
function baiqiInitDeliveryScheduleSheet(ss) {
  if (ss.getSheetByName('收送日設定')) return;
  const sheet = ss.insertSheet('收送日設定');
  sheet.getRange(1, 1, 2, 4).setValues([
    ['飯店', '部門', '固定收送日', '打單日期規則'],
    ['驛館', '餐飲部', '二、四、六、日', '收件後的下一個收送日']
  ]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#dbeafe');
  sheet.autoResizeColumns(1, 4);
}
// 可手動執行一次；網頁「更新設定」亦會自動建立分頁。
function baiqiSetupDeliveryScheduleSheet() {
  baiqiInitDeliveryScheduleSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
}
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
    if (values[3] !== '收件後的下一個收送日') throw new Error('收送日設定第 ' + (index + 2) + ' 列打單日期規則不支援。');
    result.push({hotel: values[0], department: values[1], days: values[2], rule: values[3]});
  });
  return result;
}
function doGet(e) {
  if (!e || !e.parameter) {
    return createJsonResponse({ success: false, error: "請透過網頁應用程式 URL 呼叫此 API，勿直接在編輯器內執行。" });
  }
  const action = e.parameter.action;
  let ss;
  try { ss = SpreadsheetApp.openById(SPREADSHEET_ID); }
  catch (err) { return createJsonResponse({ success: false, error: "找不到試算表，請確認 ID 與權限！" }); }
  try {
    checkAndInitSheets(ss);
    if (action === 'getInventoryData') {
      let template = [];
      let baseSheet = ss.getSheetByName('基礎設定');
      if (baseSheet) {
        let baseData = baseSheet.getDataRange().getDisplayValues();
        for(let i=1; i<baseData.length; i++) {
            if(baseData[i][0] && baseData[i][2]) {
                let baseName = String(baseData[i][0]).trim();
                let deptName = String(baseData[i][1]).trim();
                let combinedHotel = baseName + (deptName ? " " + deptName : "");
                template.push({ hotel: combinedHotel, baseName: baseName, deptName: deptName || "房務", item: String(baseData[i][2]).trim() });
            }
        }
      }
      return createJsonResponse({ success: true, template: template, deliverySchedules: baiqiReadDeliverySchedules(ss), sendwashSettings: readSendwashSettings(ss) });
    }
    // 保留前一版網頁相容入口。
    if (action === 'getDeliverySchedules') {
      return createJsonResponse({ success: true, deliverySchedules: baiqiReadDeliverySchedules(ss) });
    }
    if (action === 'getFinanceMasterData') {
      let priceSheet = ss.getSheetByName("價格總表");
      let priceData = priceSheet ? priceSheet.getDataRange().getValues() : [];
      let clientSheet = ss.getSheetByName("客戶資料表");
      let clientData = clientSheet ? clientSheet.getDataRange().getValues() : [];
      let routeSheet = ss.getSheetByName("路線設定表");
      let routeData = routeSheet ? routeSheet.getDataRange().getDisplayValues() : [];
      let scheduleSheet = ss.getSheetByName("司機排班表");
      let scheduleData = scheduleSheet ? scheduleSheet.getDataRange().getDisplayValues() : [];
      return createJsonResponse({ success: true, prices: priceData, clients: clientData, routes: routeData, schedules: scheduleData });
    }
    return createJsonResponse({ success: false, error: "未知的請求 Action" });
  } catch (err) {
    return createJsonResponse({ success: false, error: err.toString() });
  }
}
function doPost(e) {
  if (!e || !e.postData) return createJsonResponse({ status: "error", message: "請透過網頁應用程式傳送 POST 請求" });
  let lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (error) { return createJsonResponse({ status: "error", message: "伺服器忙碌中" }); }
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let params = JSON.parse(e.postData.contents);
    if (params.type === 'inventory') {
        ss.getSheetByName("歷史紀錄").appendRow([params.date, params.hotel, params.item, params.count, params.note, params.signature, params.doubleCount, params.doubleSignature, params.timestamp]);
        let summarySheet = ss.getSheetByName("盤點總表");
        let dataValues = summarySheet.getDataRange().getDisplayValues();
        let foundRow = -1;
        for (let i = dataValues.length - 1; i >= 1; i--) {
            if (formatDateString(dataValues[i][0]) === String(params.date).trim() && String(dataValues[i][1]).trim() === String(params.hotel).trim() && String(dataValues[i][2]).trim() === String(params.item).trim()) {
                foundRow = i + 1; break;
            }
        }
        if (foundRow > -1) {
            if (params.count !== undefined && params.count !== '') summarySheet.getRange(foundRow, 4).setValue(params.count);
            if (params.note !== undefined) summarySheet.getRange(foundRow, 5).setValue(params.note);
            if (params.signature) summarySheet.getRange(foundRow, 6).setValue(params.signature);
            if (params.doubleCount !== undefined && params.doubleCount !== '') summarySheet.getRange(foundRow, 7).setValue(params.doubleCount);
            if (params.doubleSignature) summarySheet.getRange(foundRow, 8).setValue(params.doubleSignature);
            if (params.doubleSignDate) summarySheet.getRange(foundRow, 9).setValue(params.doubleSignDate);
        } else {
            summarySheet.appendRow([params.date, params.hotel, params.item, params.count, params.note, params.signature || "", params.doubleCount || "", params.doubleSignature || "", params.doubleSignDate || "", ""]);
        }
        return createJsonResponse({ status: "success" });
    }
    if (params.type === 'logistics') {
        let clientSheet = ss.getSheetByName('客戶簽單流水帳');
        let timeStamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
        let dataValues = clientSheet.getDataRange().getDisplayValues();
        let foundRow = -1;
        for (let i = dataValues.length - 1; i >= 1; i--) {
            if (formatDateString(dataValues[i][3]) === String(params.date).trim() && String(dataValues[i][2]).trim() === String(params.deptName).trim()) {
                foundRow = i + 1; break;
            }
        }
        if (foundRow > -1) {
            clientSheet.getRange(foundRow, 1).setValue(timeStamp);
            clientSheet.getRange(foundRow, 5).setValue(params.verifyJson);
            if (params.clientSigBase64) clientSheet.getRange(foundRow, 6).setValue(params.clientSigBase64);
            if (params.driverSigBase64) clientSheet.getRange(foundRow, 7).setValue(params.driverSigBase64);
        } else {
            clientSheet.appendRow([timeStamp, String(params.hotelKeyword).trim(), String(params.deptName).trim(), String(params.date).trim(), params.verifyJson, params.clientSigBase64 || "", params.driverSigBase64 || ""]);
        }
        try {
            let summarySheet = ss.getSheetByName("盤點總表");
            let sumData = summarySheet.getDataRange().getDisplayValues();
            let parsedItems = JSON.parse(params.verifyJson);
            for (let k = 0; k < parsedItems.length; k++) {
                let pItem = parsedItems[k];
                for (let j = sumData.length - 1; j >= 1; j--) {
                    if (formatDateString(sumData[j][0]) === String(params.date).trim() && String(sumData[j][1]).trim() === String(params.deptName).trim() && String(sumData[j][2]).trim() === String(pItem.itemName).trim()) {
                        summarySheet.getRange(j + 1, 10).setValue(pItem.actualQty);
                        break;
                    }
                }
            }
        } catch (e) {}
        return createJsonResponse({ status: "success" });
    }
    return createJsonResponse({ status: "error", message: "未知的請求 Type" });
  } catch (error) { return createJsonResponse({ status: "error", message: error.toString() });
  } finally { lock.releaseLock(); }
}

// 僅在不存在時建立，不覆寫任何既有設定或盤點資料。
function baiqiInitSendwashSettingsSheet(ss) {
  if (ss.getSheetByName('送洗對點設定')) return;
  const sheet = ss.insertSheet('送洗對點設定');
  sheet.appendRow(['飯店', '部門', '品項', '預設數量', '單位', '排列順序', '是否啟用']);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#dbeafe');
  sheet.autoResizeColumns(1, 7);
}

// 可手動執行一次建立空白設定分頁。
function baiqiSetupSendwashSettingsSheet() {
  baiqiInitSendwashSettingsSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
}

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

