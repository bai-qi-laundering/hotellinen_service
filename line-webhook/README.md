# 特處 LINE webhook

新的 LINE 官方帳號收到「好六一條床單一條被套」這種訊息後，寫進和特處頁同一份 Firestore `special_items`。摺疊、辦公室、老闆後台不用改。這個資料夾不會自己部署，請照下面貼到 Google Apps Script。

用到兩個檔案：

- `Code.gs`：收 LINE、寫 Firestore、回覆。
- `Parser.gs`：和 `special.html` 相同的解析規則。

## 1. 開一個新的 LINE 官方帳號

1. 到 [LINE Official Account Manager](https://manager.line.biz/) 建立**新的**官方帳號（不要拿現在已在用的帳號來試）。
2. 到 [LINE Developers](https://developers.line.biz/console/) 同一個帳號，建立或打開 Messaging API channel。
3. 在 channel 的 **Messaging API** 頁面記下：
   - **Channel secret**
   - **Channel access token**（long-lived；沒有就按 Issue）
4. 同一頁把 **Allow bot to join group chats**（允許加入群組）打開。
5. 先不要開 Use webhook，等第 4 步拿到網址再貼。

## 2. 建立 Apps Script

1. 打開 [script.google.com](https://script.google.com/)，用會長期管理這個帳號的 Google 帳號。
2. **新專案**。專案名稱例如 `特處 LINE`。
3. 左邊預設的 `Code.gs`：全選刪掉，貼上這個資料夾的 `Code.gs`。
4. 檔案旁的 **＋** → **指令碼**，名稱打 `Parser`（Apps Script 會存成 `Parser.gs`）。把 `Parser.gs` 全部貼上。
5. 確認執行階段是 **V8**（新專案預設就是。專案設定 → 顯示「appsscript.json」→ `"runtimeVersion": "V8"`）。

## 3. 設定 Script properties

專案設定（齒輪）→ **指令碼內容** → 新增指令碼內容。名稱要完全一樣：

| 內容 | 值 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | 第 1 步的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 第 1 步的 Channel access token |
| `LINE_WEBHOOK_TOKEN` | 自己產生一串夠長的亂碼，至少 24 字。這是網址上的密碼，不要用 `1234` 或這份說明裡的例子。 |
| `FIREBASE_API_KEY` | 可省略。省略時使用和特處頁相同的公開 Firebase 網頁金鑰。若之後換了金鑰再填這裡。 |

Firestore 專案固定是 `hotel-inventory-3a1ad`，集合是 `special_items`。規則必須允許這個網頁金鑰讀寫 `special_items`，並讀取 `inventory_config/master_template`（和特處頁一樣）。沒有試算表。

## 4. 部署成網頁應用程式

1. 右上 **部署** → **新增部署作業**。
2. 類型選 **網頁應用程式**。
3. 說明可寫 `特處 LINE`。
4. **執行身分：我**。
5. **具有存取權的使用者：任何人**（Anyone）。LINE 的伺服器沒有 Google 登入。
6. 部署。第一次會要求授權：允許連到外部網址（LINE 與 Firestore）。
7. 複製 **網頁應用程式網址**。長相是 `https://script.google.com/macros/s/……/exec`。
8. 在網址後面加上權杖：`https://script.google.com/macros/s/……/exec?token=你的LINE_WEBHOOK_TOKEN`。
9. 用瀏覽器打開這個帶 token 的網址，應看到「特處 LINE webhook 已部署」。

之後若改了程式，必須再部署一次才會生效：**部署** → **管理部署作業** → 鉛筆 → **版本** 選 **新版本** → 部署。網址不用換。

## 5. 接到 LINE

1. 回到 LINE Developers 的 Messaging API 設定。
2. **Webhook URL** 貼上帶 `?token=` 的那條網址。
3. 按 **Verify**。應顯示成功。
4. 打開 **Use webhook**。
5. 到 [LINE Official Account Manager](https://manager.line.biz/) → 設定 → 回應設定：
   - **關閉**自動回應訊息
   - **關閉**歡迎訊息
   - 聊天先維持能收訊息即可。Webhook 開著時，自動回應會和機器人搶著回，所以一定要關。
6. 用手機把這個官方帳號加為好友。群組裡若沒加好友，LINE 不會給 userId，「取消上一筆」就對不到人。
7. 把官方帳號拉進要收特處的群組，傳：`好六一條床單一條被套三條足巾`。

成功時會回一張卡片，例如「好六 特處床單*1 特處被套*1 特處足巾*3」，下面有 **刪除這筆**。摺疊頁當天的卡片會出現同樣的品項。

## 機器人怎麼回應

- 寫入時間用 LINE 訊息的時間，並換成台北日期。單據會記下 LINE userId 和顯示名稱。
- **刪除這筆**，或傳「取消上一筆」（也認「取消剛剛那筆」「刪除上一筆」）：還沒摺疊簽名、也還沒送出，才會軟刪除（`deleted: true`、時間、寫進 `edits`）。已經簽名或已送出，會回「請跟辦公室或老闆後台說」，不會改盤點。
- 看不懂但像在報飯店或品項，回一句範例。群組裡的閒聊、貼圖、圖片不回。
- 同一則 LINE 訊息重送不會寫第二次。

## 簽章

LINE 會在 `X-Line-Signature` 用 Channel secret 對本文做 HMAC-SHA256。Google Apps Script 的網頁應用程式**讀不到 HTTP 標頭**，所以沒辦法在每次請求都核對這個簽章。程式裡若執行環境真的帶了這個標頭，會用 `LINE_CHANNEL_SECRET` 核對；目前實際擋外部呼叫的是網址上的 `token`。請把權杖當密碼，不要貼到群組或截圖。
