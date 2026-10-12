const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync('docs/hotellinen-apps-script.gs','utf8');
function fixture() {
 const sheets=new Map();
 const sheet=(name,rows)=>({rows:structuredClone(rows),appendRow(values){this.rows.push(values);return this;},getLastRow(){return this.rows.length;},getDataRange(){const self=this;return{getValues:()=>structuredClone(self.rows),getDisplayValues:()=>self.rows.map(r=>r.map(v=>String(v??'')))};},getRange(row,col){const self=this;const range={getValue:()=>self.rows[row-1]?.[col-1]??'',setValue(value){self.rows[row-1] ||= [];self.rows[row-1][col-1]=value;return range;},setValues(values){values.forEach((r,i)=>r.forEach((v,j)=>{self.rows[row-1+i] ||= [];self.rows[row-1+i][col-1+j]=v;}));return range;},setFontWeight(){return range;},setBackground(){return range;}};return range;},setFrozenRows(){},autoResizeColumns(){}});
 const workbook={getSheetByName:name=>sheets.get(name),insertSheet:name=>{const value=sheet(name,[]);sheets.set(name,value);return value;},getSpreadsheetTimeZone:()=> 'Asia/Taipei'};
 const add=(name,rows)=>sheets.set(name,sheet(name,rows));
 add('基礎設定',[['飯店名称','部門分類','品項名稱'],['驛館','餐飲部','浴巾']]);
 add('價格總表',[['飯店','部門','品項','單價'],['驛館','餐飲部','浴巾',18]]);
 add('客戶資料表',[['飯店名稱'],['驛館']]);
 add('路線設定表',[['路線','包含飯店'],['A','驛館']]);add('司機排班表',[['日期','司機','路線'],['2026-10-01','司機A','A']]);
 add('收送日設定',[['飯店','部門','固定收送日','打單日期規則'],['驛館','餐飲部','二、四、六、日','收件後的下一個收送日']]);
 add('盤點總表',[['選擇日期','飯店部門','品項','現場數量','備註','現場簽名','複點數量','複點簽名','複點時間','請款數量(結帳用)']]);add('歷史紀錄',[['header']]);add('客戶簽單流水帳',[['header']]);
 const ctx=vm.createContext({SpreadsheetApp:{openById:()=>workbook},ContentService:{MimeType:{JSON:'json'},createTextOutput:raw=>({setMimeType:()=>JSON.parse(raw)})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Utilities:{formatDate:()=> '2026-10-01 12:00:00'}});vm.runInContext(source,ctx);return{ctx,sheets,add,workbook};
}
test('full script preserves original doPost and schedule reader exactly after Markdown unescaping',()=>{
 const digest=s=>crypto.createHash('sha256').update(s.trim()).digest('hex');
 const post=source.slice(source.indexOf('function doPost'),source.indexOf('// 僅在不存在時建立'));
 const schedules=source.slice(source.indexOf('function baiqiReadDeliverySchedules'),source.indexOf('function doGet'));
 assert.equal(digest(post),'616725c3a8baae274855a87e625a0a8cd82f264fd20e9b9d81516b46795b931d');
 assert.equal(digest(schedules),'04a8326d750927feecb9ef39cf333a08f389f26046052de7068afbcb95cbeca9');
});
test('getInventoryData creates only an empty sendwash setting and retains existing template and schedules',()=>{
 const f=fixture(),before=JSON.stringify(f.sheets.get('收送日設定').rows);const response=f.ctx.doGet({parameter:{action:'getInventoryData'}});
 assert.equal(response.success,true);assert.deepEqual(response.template,[{hotel:'驛館 餐飲部',baseName:'驛館',deptName:'餐飲部',item:'浴巾'}]);assert.equal(response.deliverySchedules[0].days,'二、四、六、日');assert.deepEqual(response.sendwashSettings,[]);
 assert.equal(f.sheets.get('送洗對點設定').rows.length,1);assert.equal(JSON.stringify(f.sheets.get('收送日設定').rows),before);
});
test('setting initialization is idempotent; enabled hotel/dept/items and default zero survive API response',()=>{
 const f=fixture();f.ctx.baiqiSetupSendwashSettingsSheet();f.sheets.get('送洗對點設定').appendRow(['驛館','餐飲部','浴巾','0','條','1','是']);const before=JSON.stringify(f.sheets.get('送洗對點設定').rows);
 f.ctx.baiqiSetupSendwashSettingsSheet();const response=f.ctx.doGet({parameter:{action:'getInventoryData'}});assert.equal(response.sendwashSettings[0].defaultQuantity,'0');assert.equal(response.sendwashSettings[0].department,'餐飲部');assert.equal(JSON.stringify(f.sheets.get('送洗對點設定').rows),before);
});
test('finance data and compatibility schedule actions keep their original response shape',()=>{
 const f=fixture();const response=f.ctx.doGet({parameter:{action:'getFinanceMasterData'}});assert.deepEqual(Object.keys(response),['success','prices','clients','routes','schedules']);assert.equal(response.prices[1][3],18);assert.equal(response.routes[1][1],'驛館');
 const dates=f.ctx.doGet({parameter:{action:'getDeliverySchedules'}});assert.deepEqual(Object.keys(dates),['success','deliverySchedules']);
});
test('existing inventory POST still writes original ten-column row without extra quantity columns',()=>{
 const f=fixture();const params={type:'inventory',date:'2026-10-01',hotel:'驛館 餐飲部',item:'浴巾',count:'100',doubleCount:'98',signature:'staff',doubleSignature:'verify',doubleSignDate:'2026-10-01 12:00:00',timestamp:'now',note:'測試'};
 const response=f.ctx.doPost({postData:{contents:JSON.stringify(params)}});assert.equal(response.status,'success');assert.equal(f.sheets.get('盤點總表').rows[1].length,10);assert.equal(f.sheets.get('盤點總表').rows[1][3],'100');assert.equal(f.sheets.get('盤點總表').rows[1][6],'98');assert.equal(f.sheets.get('歷史紀錄').rows.length,2);
});
test('existing logistics POST still writes signatures, verifyJson and billing quantity',()=>{
 const f=fixture();f.sheets.get('盤點總表').appendRow(['2026-10-01','驛館 餐飲部','浴巾','100','','','','','','']);
 const response=f.ctx.doPost({postData:{contents:JSON.stringify({type:'logistics',date:'2026-10-01',hotelKeyword:'驛館',deptName:'驛館 餐飲部',verifyJson:JSON.stringify([{itemName:'浴巾',actualQty:'98'}]),clientSigBase64:'client',driverSigBase64:'driver'})}});
 assert.equal(response.status,'success');assert.equal(f.sheets.get('盤點總表').rows[1][9],'98');assert.equal(f.sheets.get('客戶簽單流水帳').rows[1][5],'client');assert.equal(f.sheets.get('客戶簽單流水帳').rows[1][6],'driver');
});
