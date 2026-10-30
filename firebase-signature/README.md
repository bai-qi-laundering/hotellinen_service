# 簽名後自動產生對帳單：Firebase 部署

> 現在另有已接入簽單網頁的方案，不需部署本後端。使用簽單網頁方案請看 [操作說明](../docs/signature-statement-client.md)。以下是日後需要關閉網頁仍繼續運作時的後端選項。

目前：程式碼已備妥，尚未部署到你的 Firebase。只部署此資料夾的新函式，不改既有網站和 Firebase 其他函式。

## 實際規則

- 監聽 logistics_records 新增或修改。clientSig 或 driverSig 從空白變成有內容，才進入判斷；換簽名圖片、改數量、改單價不觸發。
- 使用事件發生時間的台灣日期，必須同時是單據日期、店家結帳日。不是排程、不等兩天。
- 25 號組：上月 26 日～本月 25 日；月底組：本月 1 日～實際最後一天。
- 優先用 inventory_config/finance_settlement_groups 的儲存設定，否則沿用 finance.html 的兩組名單。鼎王依部門分帳，和目前財務頁一致。
- 第一個符合條件的簽名會建立該客戶整期「當時已有」的財務資料快照。這不是判斷全期完成的訊號；其後才寫入的單據不會自動補進帳單。這是本版「簽名當下產生一次」的行為。
- 寫入 statement_cases，沿用送件中心現有 HTML / Excel 快照格式；這是放進送件中心，不會傳 LINE。
- statement_auto_runs 的 ID 和 statement_cases 相同，以飯店＋帳期雜湊產生。完成紀錄與帳單在同一個 Firestore transaction 建立。
- 多裝置同時簽名、同一事件重送，只會有一份自動帳單。
- 已有手動產生帳單時，自動流程會標示 skipped_existing，不覆蓋它。
- 完成後，後續再簽名、修改數量或價格都不會自動建立新版。手動「產生客戶對帳單」仍可建立新版。
- 主資料讀取失敗或缺少客戶抬頭時會失敗並重試，不會先寫成功紀錄。
- 部署前的舊簽名不會自動補跑；不提供大量歷史補帳，以免意外產單。

## 1. Firebase 確認

開啟 https://console.firebase.google.com/project/hotel-inventory-3a1ad/overview

確認選到 hotel-inventory-3a1ad。Cloud Functions 正式部署需要 Blaze 計費方案，若目前是 Spark，請在 Firebase 控制台自行評估並升級。這不代表固定收費為零。

在 Firestore Database 的資料庫資訊查看位置。函式位置預設 asia-east1；若資料庫在別的位置，部署前把設定的 FUNCTION_REGION 改成適合且支援 Firestore 事件的位置。不要因為部署而更換現有資料庫。

## 2. 開啟 Google Cloud Shell

開啟 https://console.cloud.google.com/?project=hotel-inventory-3a1ad ，點右上方終端機圖示。手機可用瀏覽器的桌面網站模式。

在終端機依序貼入（第一次建立一個新工作目錄）：

```bash
git clone https://github.com/bai-qi-laundering/hotellinen_service.git baiqi-signature-deploy
cd baiqi-signature-deploy/firebase-signature
node --version
npm --prefix functions install
npm --prefix functions test
cp functions/.env.example functions/.env.hotel-inventory-3a1ad
npx --yes firebase-tools@latest login --no-localhost
```

Node 應使用 22（本地檢查也可用 24，正式 runtime 已指定 22）。登入時使用能管理這個 Firebase 專案的公司 Google 帳號。依 CLI 顯示的網址完成登入，不需下載或交付服務帳戶 JSON 金鑰。

## 3. 先部署停用狀態

.env.example 的 AUTO_STATEMENTS_ENABLED 預設 false。先保留 false，確認函式可以部署成功：

```bash
npx --yes firebase-tools@latest deploy --only functions:signature-statements:autoStatementOnSignature --project hotel-inventory-3a1ad
```

依工具提示啟用所需 Google Cloud API；若提示權限不足，需由專案管理員完成該項設定。第一次部署後台 API 可能需要數分鐘生效。

目前只設定函式，不會修改 Hosting、Firestore rules 或其他 codebase。不要執行 firebase init，也不要用未限定目標的 firebase deploy。

## 4. 啟用簽名觸發

確認上述部署成功後，開啟設定：

```bash
nano functions/.env.hotel-inventory-3a1ad
```

把 AUTO_STATEMENTS_ENABLED=false 改成 true，核對 FINANCE_MASTER_URL 是現有財務 Apps Script 網址。Ctrl+O、Enter 儲存，再 Ctrl+X 離開。重新部署同一個函式：

```bash
npx --yes firebase-tools@latest deploy --only functions:signature-statements:autoStatementOnSignature --project hotel-inventory-3a1ad
```

只有看到部署成功，才算後端已啟用。GitHub 提交本身不會部署 Firebase Functions。

## 5. 驗收與紀錄

在實際結帳日正常完成一方簽名後，打開送件中心按重新整理，查看該店正確帳期。不要為了測試而更改正式單據日期或刪掉簽名。

Firestore 會有 statement_auto_runs/{case_id}：

- completed：本期自動帳單已建立。
- skipped_existing：本期已有人工作出的帳單，保留原帳單。

可查看函式記錄：

```bash
npx --yes firebase-tools@latest functions:log --only autoStatementOnSignature --project hotel-inventory-3a1ad
```

成功記錄 auto_statement_result；失敗記錄 auto_statement_failed。失敗沒有寫入完成紀錄，事件會依 Firebase 重試政策再試；永久錯誤需修正主資料或部署設定。不要刪除 statement_auto_runs 完成紀錄，否則會失去一次性保護。

statement_auto_runs 是後端專用紀錄，前端不需讀寫它。若現有 Firestore rules 含「全部集合都可寫」的規則，需另行收緊，讓用戶端無法刪改此紀錄；單加一條 allow false 無法抵銷其他 allow true。這份部署不會自行覆蓋你現有的規則。

## 暫停

把 AUTO_STATEMENTS_ENABLED 改回 false，再部署同一函式即可停用，不刪除既有帳單或完成紀錄。

## 計價程式來源與維護

functions/lib/invoice-engine.js 的計價函式取自 finance.html（blob 37c5ab8d570c43ed9f8d68930d2e4051e575ec57）。包含生效日單價、春節加價、飯店回饋、洗滌管理費、四捨五入與 5% 稅。statement-case.js 和 logistics-items.js 是本次檢查過的同版快照。

前端日後修改計價公式、品項處理或快照格式時，需要同步更新這份後端並重新部署，避免兩邊公式分歧。未改動前端現有產單流程。

## 驗證範圍

本地測試覆蓋：任一方首次簽名、換簽與資料修改不觸發、跨年25號區間、月份長度／閏年、台灣日期、數量與回洗排除、價格規則、併發重複事件防重、手動帳單優先與失敗不留完成紀錄。未連線操作正式 Firebase，也未部署。

官方文件：
- https://firebase.google.com/docs/functions/firestore-events
- https://firebase.google.com/docs/functions/get-started
- https://firebase.google.com/docs/functions/config-env
