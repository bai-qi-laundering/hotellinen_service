# 簽收頁不再自動產生對帳單

先前簽收頁會在簽名後產生對帳單。這個做法已停用，`logistics.html` 不再載入 `signature-statement-client.js`。

現在改由 Firebase 排程，在每家飯店自己的結帳日 09:30（台北）產生，放進送件中心，由人員手動寄出。部署方式與結帳日規則見 [firebase-signature/README.md](../firebase-signature/README.md)。

`signature-statement-client.js` 只留下舊測試，簽收流程不會執行它。
