# 結帳日早上自動產生對帳單

簽收頁不再產生對帳單。Cloud Scheduler 在每家飯店自己的結帳日 09:30（Asia/Taipei）產生，寫進 `statement_cases`，送件中心手動寄出，不會自動傳 LINE。

GitHub 提交本身不會部署這個排程。下面的部署做完、而且 `AUTO_STATEMENTS_ENABLED=true` 之前，正式環境不會跑。

## 結帳日存在哪裡

`inventory_config/finance_settlement_groups` 的 `groups`。值不是「幾號」，有三種：

- `25th`：每月 25 日，期間為上月 26 日～本月 25 日
- `month`：每月最後一天（2 月 28 或 29 日、4/6/9/11 月 30 日、其他月 31 日），期間為當月 1 日～最後一天
- `1st`：每月 1 日，期間為前一個曆月（上月 1 日～上月最後一天）。例如 11 月 1 日出 10 月 1 日～10 月 31 日。和月底組的曆月區間相同，只是出帳日晚一天。
- `''`：這筆名稱明確不自動結帳

名稱最好和物流範本 `master_template.items[].baseName`（也就是簽收單的 `hotelKeyword`）一致。設定寫了 25 日、月底或 1 日、但範本沒有這間名字時，仍會用那個名字查簽收單，並記一筆警告，避免有出貨卻被漏掉。查不到單的名稱這期只記 `skipped_empty`，不產生帳單。沒寫進設定的飯店，若範本裡有、而且符合財務頁原有關鍵字名單，仍會結。空白字串是明確不自動結帳。鼎王仍是一間飯店查一次，再依部門各出一張，和原本的客戶拆法相同；部門沿用母飯店這次的結帳區間。

cron 是 `30 9 1,25,28,29,30,31 * *`（台北，09:30）。1 日跑 1 號組。28～30 只為了短月份的最後一天；當天若不是 1 日、25 日，也不是該月最後一天，函式立刻結束，Firestore 讀取次數是 0。

這次把 1 號組加進程式之後，必須重新部署 `autoStatementOnBillingDay`，Cloud Scheduler 才會在每月 1 日啟動。只改網頁、不重新部署的話，畫面上可以指定 1 號，但 1 日早上不會自動出帳。

若以後要把某家改成 15 日或其他日子，必須改 `functions/lib/billing-schedule.js` 的 `KNOWN_BILLING_GROUPS`、`billingGroupForDate`，以及 `functions/index.js` 的 cron，再重新部署。否則下一個有跑的結帳日早上會記 `unknown_day` 警告，那一家不會出單。

把飯店加進既有的 25 日、月底或 1 號，不用再改程式：在財務頁儲存分組，並確認物流範本有這間飯店的 `baseName`。1 號組要等上面的函式重新部署之後，每月 1 日才會自動出帳。

名稱對應（不直接改資料庫）：設定裡的「天幕」一律當成「天慕」，結帳日固定 25 號。鉑麗固定月底。歐遊、捷中正固定 1 號（物流範本的 `baseName` 就是這兩個字；原先在月底名單，設定檔也存成 `month`）。H2O 固定 25 號。H2O 西餐是 H2O 的西餐部門（範本 `baseName` 是 H2O、`deptName` 是西餐），不是另一間客戶，出貨跟 H2O 同一張對帳單，結帳日也是 25 號，不會再出第二張。飯店結帳日管理仍單獨列「H2O 西餐」，下拉是 25 號。這些固定結帳日蓋過設定裡不一樣的值，避免同一家被分到兩組。系統裡的字是「鉑麗」，沒有「鉆麗」這間。

若要讓財務頁的結帳日清單跟這個對應一致：打開「結帳戰情系統」→「老闆業績戰情室」→「飯店結帳日管理」→「儲存全部設定」。這一步會把「天幕」的 25 日寫到「天慕」並拿掉舊名稱。沒按儲存，排程仍會照上面的對應出帳。

## 未簽名與晚簽名

09:30 不等人簽完。該期間的出貨明細（數量沿用財務規則）都算進帳單，包含還沒簽名的簽收單。回洗部門與品名含「回洗」的項目不算，四捨五入、管理費、客戶回饋與 5% 稅沿用原本計價。

送件中心若看到「產生時有 N 張簽收單還沒簽名」，代表金額已含那些出貨。之後補簽名不會改這張帳單，也不會再產生第二張。要更新，到結帳戰情系統手動產生新版本。

同一家、同一期間重跑或 Cloud Scheduler 重試，只會跳過，不會有兩張。

單價讀不到時不寫 0 元帳單，這一家記失敗並讓排程重試；重試不會重做已經成功的客戶。當天重試用盡後，這一家要手動產生。

## 讀取量

非結帳日：0 次 Firestore 讀取。簽收頁也不再為了產單讀整期資料。

結帳日：先讀結帳分組與物流範本（2 份）。只處理今天該結的飯店。每一家先看這期帳單在不在（最多 2 次讀取）；已有就不再讀簽收單，也不抓價格。還沒有的，才抓一次財務主資料，並只查這家 `hotelKeyword` 加上這段日期的簽收單。鼎王是其中一間，不是全資料庫掃描。

空查詢 Firestore 仍算 1 次讀取。零填充日期用一條區間；只有舊的不補零日期（例如 `2026-9-26`）才多一條月份前綴。另外一條時間戳記查詢用來接住舊資料，沒有這種資料時是 1 次讀取。

以 2026-10 的飯店數粗估：25 日組大約二十多家真實飯店、月底組大約四十家。每家一個月的簽收單通常是幾十到一兩百筆（一部門一天一筆）。結帳日早上大約是數千次文件讀取，外加那 5 份設定；不是每天，也不是簽收當下。

需要複合索引 `logistics_records` 的 `hotelKeyword` + `date`。索引沒建好時，結帳日查詢會失敗、不會產出帳單。

## 部署

專案是 `hotel-inventory-3a1ad`。Cloud Functions 與 Cloud Scheduler 需要 Blaze 方案。這不代表固定月費是零。

在可以管理這個專案的電腦上：

```bash
git clone https://github.com/bai-qi-laundering/hotellinen_service.git baiqi-signature-deploy
cd baiqi-signature-deploy/firebase-signature
npm --prefix functions install
npm --prefix functions test
```

部署前，`functions/.env.hotel-inventory-3a1ad` 要有下面三行。這個檔已在 repo，沒有帳號或密碼。`FINANCE_MASTER_URL` 與 `finance.html` 的 `GAS_API_URL` 相同。其他 `functions/.env*` 仍不提交。

```
AUTO_STATEMENTS_ENABLED=false
FINANCE_MASTER_URL=https://script.google.com/macros/s/AKfycbxkUiqCGa85QiI8P91p4DEnd6exOuQ4VnBt4r-hrrQHImE-3Bg0KO3yVR3_EbG5yHovtA/exec
SIGNATURE_FUNCTION_REGION=asia-east1
```

地區參數的名稱是 `SIGNATURE_FUNCTION_REGION`，預設 `asia-east1`。`FUNCTION_REGION` 是 Firebase 保留的環境變數名，不能寫進 `.env`，非互動部署會失敗。

`hotel-inventory-3a1ad` 的 `asia-east1` 已設定 artifacts cleanup policy。之後部署函式不會再停下來問容器映像要留幾天，也不必再執行 `firebase functions:artifacts:setpolicy`。

先部署索引（不會改 Firestore 規則）：

```bash
npx --yes firebase-tools@latest deploy --only firestore:indexes --project hotel-inventory-3a1ad
```

等到 Firebase 主控台顯示該索引已啟用。

`.env.hotel-inventory-3a1ad` 先保持 `AUTO_STATEMENTS_ENABLED=false`，確認函式部署成功。這一步排程已掛上，但每次啟動都不讀資料、不產單：

```bash
npx --yes firebase-tools@latest deploy --only functions:signature-statements:autoStatementOnBillingDay --project hotel-inventory-3a1ad
```

確認成功後，把 `AUTO_STATEMENTS_ENABLED=false` 改成 `true`，核對 `FINANCE_MASTER_URL` 仍是現有財務 Apps Script 網址，再部署同一次：

```bash
npx --yes firebase-tools@latest deploy --only functions:signature-statements:autoStatementOnBillingDay --project hotel-inventory-3a1ad
```

不要執行沒有限定目標的 `firebase deploy`，也不要 `firebase init`。這份設定沒有帶上 Firestore 規則檔。

函式位置預設 `asia-east1`。若資料庫不在這個位置，先改 `SIGNATURE_FUNCTION_REGION`，不要為了部署去搬現有資料庫。

查看記錄：

```bash
npx --yes firebase-tools@latest functions:log --only autoStatementOnBillingDay --project hotel-inventory-3a1ad
```

`auto_statement_schedule_noop` 是非結帳日或尚未啟用。`billing_day_warning` 是結帳日不在常數裡，或設定名稱對不到物流飯店。`billing_day_done` 是這天跑完。

暫停：把 `AUTO_STATEMENTS_ENABLED` 改回 `false` 再部署同一個函式。已產生的帳單保留。

舊的 `autoStatementOnSignature`（簽名當下觸發）若主控台裡看得到，請刪除，避免和這個排程各跑一次。這次檢查時 `statement_auto_runs` 是空的，那個函式先前應未在正式環境跑過；主控台本身無法從這裡直接確認。

## 電子發票（汎宇電子發票 API）

送件中心不開立發票。開立在旁邊的「貨款登記」：已寄出的帳單按「開立發票」。百麒國際是電子發票，員工先看抬頭、統編、未稅、稅金、含稅和品項說明，按「確認開立」才會送到汎宇。只開立 B2B：`process_type` 為 B，買方代號是對帳單上的 8 碼統編。沒有 8 碼統編時對話框顯示不能開立，「確認開立」停用，不會送出。百麒、百富、日聖仍是手開，照舊填號碼登記，不打汎宇。結帳日排程和「我已寄出」都不會開立。作廢仍是貨款登記的「登記已作廢」，只登記結果，不向汎宇送出作廢。貨款登記的「測試電子發票連線」只打 `/queryInvoice`（訂單號 `connection-check`，`process_type` B），不開票。

帳號不放在網頁，也不要寫進 git。函式是 `issueStatementInvoice`、`voidStatementInvoice`、`testEInvoiceConnection`，都在 codebase `signature-statements`，地區沿用 `SIGNATURE_FUNCTION_REGION`（預設 `asia-east1`）。呼叫的人必須先用 Google 登入，而且信箱在 `EINVOICE_STAFF_EMAILS` 裡。舊的 `EINVOICE_SELLER_ID`、`EINVOICE_POS_ID`、`EINVOICE_POS_SN` 和 `EINVOICE_BASE_URL` 不再讀取。部署這三個函式之前，上面的 `.env.hotel-inventory-3a1ad` 三行要在，`asia-east1` 的 artifacts cleanup policy 也已經設好。

在可以管理 `hotel-inventory-3a1ad` 的電腦上，於 `firebase-signature` 目錄。每一行都會問一次要存的值，貼上之後按 Enter：

```bash
npx --yes firebase-tools@latest functions:secrets:set UEC_USER_ID --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_AUTH --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_API_KEY --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_COMPANY_ID --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_ENV --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set EINVOICE_STAFF_EMAILS --project hotel-inventory-3a1ad
```

各欄位怎麼填：

- `UEC_USER_ID`：汎宇給的系統帳號。
- `UEC_AUTH`：汎宇給的密碼明碼。不要自己做 base64，程式送出前才編碼。
- `UEC_API_KEY`：用來簽 `createDateTime` 的 APIKey。不是 AESKEY。
- `UEC_COMPANY_ID`：賣方統編。百麒填 `96842769`。空白時程式也用這個統編。
- `UEC_ENV`：先填 `test`。只有完整小寫或大寫的 `prod` 會改打正式機，`test`、空白或其他字都打測試機 `https://webtest.einvoice.com.tw/einv`。
- `EINVOICE_STAFF_EMAILS`：可以開票的 Google 信箱，多個用逗號隔開。

Firebase 主控台要啟用 Google 登入，並把網站網域加進授權網域。

部署這三個函式（不要空跑 `firebase deploy`）：

```bash
npx --yes firebase-tools@latest deploy --only functions:signature-statements:issueStatementInvoice,functions:signature-statements:voidStatementInvoice,functions:signature-statements:testEInvoiceConnection --project hotel-inventory-3a1ad
```

改正式機時，把 `UEC_ENV` 改成 `prod`，再部署上面同一行。正式機網址是 `https://web.einvoice.com.tw/einv`。測試機開過的發票不會自動帶到正式機。

```bash
npx --yes firebase-tools@latest functions:secrets:set UEC_ENV --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest deploy --only functions:signature-statements:issueStatementInvoice,functions:signature-statements:voidStatementInvoice,functions:signature-statements:testEInvoiceConnection --project hotel-inventory-3a1ad
```

`functions:secrets:set UEC_ENV` 那一行出現提示時，輸入 `prod` 再按 Enter。

網頁上的送件中心假設函式在 `asia-east1`。若 `SIGNATURE_FUNCTION_REGION` 改了，送件中心裡的 `asia-east1` 也要一起改。

簽章是標準 Base64 的 HMAC-SHA256：金鑰為 UTF-8 的 `UEC_API_KEY`（APIKey，不是 AESKEY），訊息為同一段送出的 `createDateTime`。時間是台北時區 14 碼的 `YYYYMMDDHHMMSS`，例如 `20260701172208`，月日時分秒都補 0、24 小時制，不含斜線、空格或冒號。給老闆照做的設定步驟在 `docs/uec-einvoice-deploy.md`。
