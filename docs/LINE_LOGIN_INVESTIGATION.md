# LINE 登入失敗調查（更新：2026-09-07）

## 2026-09-07：Product 0.26 診斷版已部署

- 最終正式版為 `0.26`／commit `5d572a4`，Cloudflare version `70dcd5d9-f0fb-419a-91da-e3e3f456684b` 於台灣時間 17:44:59 切到 100%。使用既有 Wrangler OAuth 正式部署，migration 0016 已套用、無待執行 migration／缺少 binding，query-string redaction 已恢復並讀回確認。本機 release commits 尚未 push。
- 初版 `0.25` 上線後的整合檢查發現 Worker 入口原本未將 execution context 傳給 Hono，讓診斷走同步等待的安全 fallback。`0.26` 補上傳遞，並新增真實 built Worker 測試：診斷寫入刻意保持未完成，登入回應仍須先返回。這是診斷版整合修正，不是使用者 Android 登入問題的已證實根因。
- 17:45 的正式無憑證 smoke 已確認 callback 303、前端顯示編號、既有 `/me` 送同編號並回 401、D1 讀回兩筆對應事件；測試 trace 為 `2e69843f1d1d486ca7db61aed168352a`。該次刻意不提供 state，也沒有真實 LINE 帳號，因此 `missing_state → unauthenticated` 是預期測試結果，不得當成使用者故障原因。公開 health/readiness 200，正式 client bundle SHA-256 與本機受測檔案一致。

- 使用者補充確認 17:09 是手機操作，電腦 QR 登入在其後；因此 17:09:11 建立 session 的時間與失敗手機操作吻合，但仍沒有該次回呼明細。17:18 照片回到一般登入提示。使用者不知道 LINE 帳號密碼；手動按鈕打開帳密畫面，不能當成已解決的替代方案。
- 使用者授權「實作並部署這個診斷版」。本版只增加 begin／callback／既有初始 `/me` 的安全事件，記下 attempt、token、verify、user、session 階段與 cookie 存在／設定布林值。不同請求的 request ID 不同；同一次 state 用獨立 HMAC 診斷命名空間產生同一 trace，不保存原 state 或認證 lookup hash。
- 32 位小寫 hex `auth_trace` 只附加在本站原有回呼導向，不放進 LINE 授權網址，也不是登入憑證。前端驗證後在既有 `/me` 請求附上編號與 `browser/standalone/unknown`，未登入／錯誤畫面可顯示編號。不增加登入請求、不改頁面恢復行為、不清 cookie/session、不改 SameSite、不降低一次性 state／nonce／PKCE 檢查。
- 新事件以固定白名單輸出 console，並限量 best-effort 保存獨立 D1 表，避免只依賴目前無法取得的 telemetry 權限。D1 儲存失敗不阻擋登入；事件不進 AI 或 LINE 告警。收集到 9/14 08:00 台灣時間為止；七天保留目標由既有每小時最多 500 筆清理執行，可能因故障或積壓延後。詳見 [Operations](OPERATIONS.md#temporary-line-login-diagnostics-product-025)。
- 最終 `0.26` 完整 `pnpm verify` 通過：lint、typecheck、38 檔／248 測試、migration drift、build、3 項 built-Worker／rendered-site 及 13 項 Chromium／無障礙測試。含真實 migrated SQLite session 建立、cookie 有／無／偽造的 `/me` 結果、重複回呼同 trace 且不二次交換 token、過期／nonce／audience 拒絕、診斷關閉／寫入失敗仍保留認證行為及敏感欄位不外洩；手機尺寸診斷編號畫面亦已檢視。這不是 Android 或 iPhone 實機 LINE 驗收。

下一步是請使用者從原 Android 入口重新載入後重試一次，提供畫面診斷編號及台灣時間。只有取得實際事件後才決定修法，並分別驗收實機 Android Chrome／桌面捷徑與 iPhone Safari／主畫面入口。以下 17:09 初查與 9/5 內容為較早快照。

## 2026-09-07：Android 照片與電腦掃碼對照

- 使用者提供三張 17:09 的手機照片：上傳分頁「這裡需要登入」→ LINE 成功 toast 與本站載入畫面 → 我的分頁「LINE 登入未完成」。使用者確認 Android／Chrome 不能登入，但電腦 Chrome 顯示 QR code、由手機掃描後可以登入。照片沒有網址列，不能僅憑畫面認定實際瀏覽器容器；是否仍由桌面捷徑開啟、失敗網址僅 `login` 的值，以及手動重試結果待回覆。
- 正式 D1 唯讀查詢發現管理員 session 分別於台北時間 **17:09:11.450、17:10:22.126、17:10:58.847** 建立，皆於 9/14 同時刻到期。這些時間落在此次操作附近，但資料表沒有裝置／登入模式／callback request ID，不能把任一筆擅自歸因手機或電腦。已請使用者確認手機及電腦操作時間。
- 17:12 的健康與 readiness 檢查皆 HTTP 200／`ok: true`。`ops_events` 在 16:55–17:15 範圍沒有事件；當下查詢沒有找到過期時間介於 17:05–17:30 的剩餘 OAuth attempt。這不代表沒有回呼失敗：attempt 在驗證上游前即被一次性消耗，而 `failed`／`expired` 分支沒有記錄原因。
- 照片三對應程式的 `login=failed` 或 `login=expired` 分支，並且前端未持有已登入使用者。單純 session cookie 沒帶回、網址未帶錯誤參數時，顯示的是照片一的標題；因此「cookie 被 Android 擋掉」不足以單獨解釋整個序列。由上傳轉到我的與載入畫面，符合帶錯誤參數重新進頁的路徑，但照片仍不能排除恢復舊頁。
- 以現有建置產物進行純本機診斷，LINE 與 D1 全部以記憶體替身代替：首次成功 callback 回傳 303 `/` 並設 session cookie；帶 cookie 的 `/me` 回傳 200、不帶則 401；同一 callback 再送一次回傳 303 `/?login=expired`，不再交換 token。此實驗證明「成功後的 callback 重放」也可產生 expired，不證明這支手機確實重放；一次性防重放檢查不能移除。
- 既有登入測試再次通過：2 個檔案／16 個測試。最新 auth 檔案變更仍是 8/30；Product 0.24 沒有改 auth。電腦 QR 成功與新 session 降低共用 channel／secret／D1 全面故障的可能性，但不能排除手機單次 code／state／nonce 問題。
- Cloudflare telemetry keys 的唯讀查詢仍 HTTP 403（10000）；管理頁亦停在登入畫面。沒有擴權或變更日誌設定，沒有取得這次 callback 的實際分階段日誌。

**目前優先診斷：** 先對上 17:09 session 是否來自手機，並取得 `login` 值與「改用 LINE 登入畫面」的結果。若手機那次已建立 session，優先查 callback 重複送達、回跳至不同容器，以及原頁面 `/me` 的結果；若沒有，先查 attempt／token／verify。LINE 官方仍建議自動登入失敗後以 `disable_auto_login=true` 重試，Android 與 iPhone 均適用；現有按鈕已實作，但提示只寫 iPhone 不夠清楚。[LINE 官方處理方式](https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/)

本輪只讀取必要的時間與狀態欄位、執行本機診斷並更新文件；沒有修改／部署 auth、清 cookie、清 session 或讀取／輸出真實 code、state、token、cookie、LINE subject。以下保留 9/5 原始調查，時間與正式版本敘述均為當時快照。

## 結論

**已證實今天晚上的資料庫額度故障會阻斷登入；尚未證實它與 Android 桌面捷徑回跳失敗、先前 iPhone 失敗是同一個根因。** LINE 頁面顯示成功，只代表 LINE 端流程走到某一步，不等於本站已完成授權碼交換、身分驗證、建立 session，並由原本的瀏覽器帶回 cookie。

本次是診斷與方案研究，沒有修改登入程式、輪替密鑰、變更方案或部署。先前本機 matching 變更保留，尚未上線。深度研究採用正式資料庫的最小唯讀查詢、Git 與程式碼，以及官方文件交叉核對，不以手機常見問題取代事件證據。

## 1. 已確認的事件與限制

以下時間均為 2026-09-05、Asia/Taipei：

| 時間 | 觀察 | 能證明／不能證明 |
| --- | --- | --- |
| 14:01–14:31 | 管理員帳號建立五筆 session，期限皆到 9/12 同時刻 | LINE token 驗證與本站 session 寫入曾成功；不能證明來自這支手機或 cookie 已被接受 |
| 21:05 起 | 已查到的 scheduled 事件出現 D1 每日讀取額度錯誤 | 額度故障存在；不是精確的額度耗盡起點 |
| 21:09:42 | `/api/v1/auth/line` 同樣報 D1 額度錯誤 | 登入「起始端點」被阻斷，不是已證實 callback 出錯 |
| 21:09:54 | `/api/v1/matches` 報同樣錯誤 | 對應使用者提供的錯誤編號 `100f5c56-a91c-4e22-b75b-557c6b711c63`；它不是 LINE 回呼錯誤編號 |

證據來源：正式 D1 的 `ops_events` 與管理員 `auth_sessions` 時間欄位唯讀查詢。未讀取或輸出 LINE subject、session token、session hash、授權碼或 state。後續部分診斷查詢成功，不能據此宣告整體服務恢復。

Cloudflare 在 9/1 公告免費方案每日讀寫超額後會拒絕查詢，UTC 午夜重置，即台灣時間次日 08:00；資料不因此被刪除。這是近期環境變動，但尚無完整日用量證據可以斷言「本網站正是從 9/1 才受影響」。[Cloudflare：D1 每日額度 enforcement，2026-09-01](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)

## 2. 「LINE 登入未完成」實際代表什麼

[前端 LoginRequired](../app/surf-app.tsx) 只有在網址帶 `login=failed` 或 `login=expired`、且前端沒有已登入使用者時，顯示這段標題：

- `failed`：交換 token 失敗、驗證 ID token 失敗，或回應／audience／nonce／期限檢查不通過。
- `expired`：一次性登入嘗試不存在或超過 10 分鐘。包含已使用過、重複開啟的 callback，不能一律解讀為「LINE 帳號登入過期」。
- 缺 cookie、無有效本站 session、且網址沒有上述參數時，正常標題是「這裡需要登入」。
- D1 例外由 API 錯誤處理回傳泛用 500 與錯誤編號；不是這些 `failed/expired` 分支。

因此，若使用者記得的正是「LINE 登入未完成」，應先分辨「這次 callback 真的失敗」與「捷徑／原頁面保留先前失敗狀態」，不能直接歸咎 cookie。

[後端 auth.ts](../src/worker/auth.ts) 將 state、nonce、PKCE verifier 存在伺服器 D1，**不依賴起始瀏覽器 cookie 或 localStorage 驗證 state**。所以「換瀏覽器導致起始 cookie 消失，因而 state 失敗」並不符合這份程式。跨瀏覽器仍可能影響最後的本站 session。

## 3. 是否可能原本就有問題，直到今天登入過期才發現？

**可能，但未證實。** 本站 session 固定 7 天，不會因使用網站自動展延；這與 LINE 自己的登入狀態是兩件事。到期後才再次經過手機 LINE 跳轉，就可能首次碰到既有相容性問題。

反證與界線：今天下午已建立五筆新的 7 天 session，所以不能說後端登入始終壞著，也不能說這五筆下午新 session 到晚上便自然到期。資料庫不記錄它們屬於哪個瀏覽器；舊的過期資料會清理，無法重建原手機 session 的完整生命週期。[程式依據](../src/worker/auth.ts)

最近登入後端變更：

- 8/30 `847be38`：增加 `disable_auto_login` 選項，提供手動登入重試；沒有修改 callback 的 token 交換或 cookie 屬性。
- 8/29 `d863bda`：增加私人顯示名稱與註冊人數上限處理。既有使用者不受新註冊額度限制。
- 目前正式 Product 0.23；沒有證據把 9/5 手機滑動修正或尚未部署的 matching SQL 變更判定為這次 auth 回歸原因。

## 4. Android 桌面捷徑與 iPhone：有哪些可信候選原因？

### A. LINE 自動登入回傳無效授權結果（有官方依據，個案未證實）

LINE 官方明確說明，私密瀏覽或 OS 行為可能讓自動登入失敗；callback 即使有 code/state，code 也可能無效，state 也可能不符。官方建議以 `disable_auto_login=true` 重新開始。此機制不是 iPhone 專用，也不能因此跳過 state 驗證。[LINE：How to handle auto login failure](https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/)

現有「改用 LINE 登入畫面」按鈕已使用 `/api/v1/auth/line?manual=1`，會建立全新嘗試；但提示文字只提 iPhone，容易讓 Android 使用者以為與自己無關。尚無這次 LINE token／verify 回應可確認是否命中。

### B. 回到舊頁面，前端沒有重新確認登入（程式缺口已確認，手機觸發未證實）

前端只在元件初次載入時呼叫 `/me`，沒有在 `pageshow`／重新可見時更新。若另一頁完成登入，原頁只是恢復而沒有重新載入，畫面可能繼續使用舊的「未登入」狀態。網址上的舊錯誤也沒有主動清除。[程式依據](../app/surf-app.tsx)

### C. 捷徑與回跳使用不同瀏覽器／儲存空間（待驗證）

「Android 加到桌面」不能直接等同獨立 PWA；程式未提供 manifest、service worker 或 standalone 設定。Android 實際可能是捷徑、WebAPK 或其他形式，取決於瀏覽器與裝置。同一瀏覽器的捷徑也可能共用儲存，不能一概認定 cookie 隔離。[Google web.dev：Installation，2024-09-20](https://web.dev/learn/pwa/installation)

要確認建立捷徑的瀏覽器、LINE 返回哪個視窗，以及原捷徑重新整理後的結果。iPhone 也需分開測 Safari 與主畫面入口，不能以桌面 Chromium 的手機尺寸模擬代替。

### D. 本站資料載入失敗掩蓋已登入狀態（程式缺口已確認）

初始化順序是 `/spots → /me → /videos`。spots 失敗會阻止 /me；即使 /me 成功，videos 失敗也會進全頁錯誤。這可解釋「登入後仍出現系統錯誤」，但不直接等於 `login=failed`。[程式依據](../app/surf-app.tsx)

## 5. 建議的共同解法與優先序

1. **先確保資料庫可用，並完成讀取量優化與實測。** 額度超限時，改手機登入參數不能讓 D1 正常建立／讀取 session。重置不是永久解法；未量測前不宣告 SQL 調整已足夠，也不擅自升級付費方案。
2. **登入增加安全的分階段診斷。** 區分 attempt 不存在／過期、LINE token 交換、ID token 驗證、session 建立、回到本站後 /me 結果；只記階段、HTTP status、本站 request ID 與 LINE request ID 等允許欄位。不記 code/state/token/cookie、原始 LINE subject 或完整網址，也不只依賴可能已故障的 D1 保存錯誤。現有被消耗的 attempt 若沒有額外受控紀錄，不能精確區分「不存在」與「已使用」。
3. **Android 與 iPhone 都提供明確的瀏覽器登入模式。** 建議先把「改用 LINE 登入畫面」設為兩平台皆可見的穩定入口；每次重試產生新 state/nonce/PKCE，不重用失敗 callback、不無限重導。若實機證明自動跳 App 不穩定，再決定是否把手動模式設為預設。
4. **補齊返回網頁後的 session 確認。** 初次載入、從 LINE 返回／頁面恢復可見時，以去重、防競態方式重新確認 /me。成功時清除舊錯誤狀態；401 才視為未登入，500/503 顯示服務暫不可用並允許重試。影片清單失敗不得掩蓋已確認的登入。
5. **維持同一正式 origin；跨儲存空間不可假裝能共享 cookie。** 若實機證實回到另一容器，就引導在原入口完成登入，或另行評估綁定原瀏覽器、短效單次且防重放的安全交接設計。不要把 session token 放入網址，不放寬 state/nonce/PKCE，也不要為此任意改成 SameSite=None。
6. **實機驗收後才能宣告兩系統修好。** Android Chrome 一般頁與現有桌面捷徑、iPhone Safari 一般頁與主畫面入口，逐一測首次登入、7 天失效後重登、手動模式、切回原頁、重複 callback、D1 不可用與恢復。成功標準是「原入口 /me 成功且可進我的影片」，不只是 LINE 顯示成功。

上述修正需另行實作與完整 `pnpm verify`；目前尚未實作或部署。

## 6. 目前可做的排查與剩餘證據

資料庫恢復可用後，在 Android **原本建立捷徑的瀏覽器一般模式**打開正式首頁，使用現有「改用 LINE 登入畫面」重新登入；若瀏覽器成功但桌面捷徑仍失敗，回原捷徑重新整理一次。這是區分回跳／舊畫面的診斷，不是保證解法。不要先清除所有網站資料，避免破壞仍可用的登入及比較線索。

下一筆最有價值的資訊：瀏覽器名稱、失敗的台灣時間、網址僅 `login` 參數值（failed／expired／沒有），以及刷新原捷徑是否恢復；不要提供含 code/state/token 的完整網址。

已完成：

- 程式與最近 auth Git 差異檢視、正式資料庫最小唯讀查詢、官方 LINE／Cloudflare／安裝行為文件核對。
- 登入相關既有自動測試：2 個檔案、16 個測試通過。這些使用 mock，不能代表實機 LINE 登入已通過。
- 正式 Workers 已啟用日誌與 query-string redaction；本次唯讀臨時 telemetry 查詢返回 403，現有憑證沒有足夠存取權。未擴權、未變更設定。
- `failed/expired` 回呼分支目前不留下細分類事件，因此既有 D1 事件不足以還原單次手機失敗。進一步泛查文件不會補出這份事件證據；到此停止推測，保留上述驗證項目。
