# 汎宇電子發票：把帳號放上雲端

這份給老闆照做。做完只會把汎宇給的帳號存進 Firebase，並更新雲端程式。

**不會自動開立發票，也不會連到汎宇。** 發票仍要員工在「貨款登記」看完抬頭、統編、金額後，自己按「確認開立」才會送出。結帳、寄出帳單都不會開票。

帳號、密碼、API Key 只在終端機提示時貼上。不要寫進檔案、不要貼到群組、不要存進 git。

## 網址

程式依 `UEC_ENV` 自己選，不用手打網址。

| 環境 | `UEC_ENV` 怎麼填 | 網址 |
| --- | --- | --- |
| 測試 | `test` | `https://webtest.einvoice.com.tw/einv` |
| 正式 | `prod` | `https://web.einvoice.com.tw/einv` |

先用測試。只有整段是 `prod`（大小寫都可以）才會打正式機。填 `test`、空白或其他字，都打測試機。不要填 `production`。

測試機開過的發票不會自動出現在正式機。

## 要設定的秘密

在 Firebase 專案 `hotel-inventory-3a1ad` 設定這些名稱。每一項都是秘密，值由汎宇或公司自己提供。

| 名稱 | 貼上什麼 |
| --- | --- |
| `UEC_USER_ID` | 汎宇給的系統帳號 |
| `UEC_AUTH` | 汎宇給的密碼明碼。不要自己做 base64 |
| `UEC_API_KEY` | 汎宇給的 API Key。簽名用這一把，不是 AES Key |
| `UEC_COMPANY_ID` | 賣方統編。百麒填 `96842769` |
| `UEC_ENV` | 先填 `test`。改正式機才填 `prod` |
| `EINVOICE_STAFF_EMAILS` | 可以按「確認開立」的 Google 信箱，多個用逗號隔開 |

少了員工信箱，沒有人能按開立。

## 步驟

請會開終端機、也能管理這個 Firebase 專案的人一起做。先進入專案裡的 `firebase-signature` 資料夾，再一行一行貼。每一行都會停下來等你貼值，貼完按 Enter。畫面不顯示你貼的字是正常的。

```bash
npx --yes firebase-tools@latest functions:secrets:set UEC_USER_ID --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_AUTH --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_API_KEY --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_COMPANY_ID --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set UEC_ENV --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest functions:secrets:set EINVOICE_STAFF_EMAILS --project hotel-inventory-3a1ad
```

六個都存好之後，先確認 `firebase-signature/functions/.env.hotel-inventory-3a1ad` 有下面三行，再部署這三個函式。這個檔已在 repo，沒有帳號、密碼或 API Key。`FINANCE_MASTER_URL` 與 `finance.html` 的 `GAS_API_URL` 相同。

```
AUTO_STATEMENTS_ENABLED=false
FINANCE_MASTER_URL=https://script.google.com/macros/s/AKfycbxkUiqCGa85QiI8P91p4DEnd6exOuQ4VnBt4r-hrrQHImE-3Bg0KO3yVR3_EbG5yHovtA/exec
SIGNATURE_FUNCTION_REGION=asia-east1
```

地區參數的名稱是 `SIGNATURE_FUNCTION_REGION`。`FUNCTION_REGION` 是 Firebase 保留的環境變數名，不能寫進 `.env`，非互動部署會失敗。

`hotel-inventory-3a1ad` 的 `asia-east1` 已設定 artifacts cleanup policy。部署時不會再停下來問容器映像要留幾天，也不必再執行 `firebase functions:artifacts:setpolicy`。

不要執行沒有 `--only` 的 `firebase deploy`，以免動到其他功能。

```bash
npx --yes firebase-tools@latest deploy --only functions:signature-statements:issueStatementInvoice,functions:signature-statements:voidStatementInvoice,functions:signature-statements:testEInvoiceConnection --project hotel-inventory-3a1ad
```

這一行只更新程式。它不會開立發票，也不會呼叫汎宇。

## 改成正式機

確認測試沒問題後，再做下面兩行。第一行出現提示時輸入 `prod`，然後按 Enter。

```bash
npx --yes firebase-tools@latest functions:secrets:set UEC_ENV --project hotel-inventory-3a1ad
npx --yes firebase-tools@latest deploy --only functions:signature-statements:issueStatementInvoice,functions:signature-statements:voidStatementInvoice,functions:signature-statements:testEInvoiceConnection --project hotel-inventory-3a1ad
```

## 簽名長什麼樣

老闆不用自己算。程式用 API Key 對「送出當下的台灣時間」簽名，再放進同一份請求。

時間例子：`2026/07/01 17:22:08`。格式是 `yyyy/MM/dd HH:mm:ss`，台灣時間，24 小時制，月、日、時、分、秒不足兩位會補 0。拿去簽名的那一串，和請求裡的 `createDateTime` 是同一串。
