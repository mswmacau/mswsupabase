# MSW 街健館 — 端到端功能驗證報告

- **驗證日期**：2026-09-23
- **驗證環境**：http://localhost:3000（Next.js 16 dev server + 真實 Supabase）
- **驗證方式**：Playwright（headless Chromium `/usr/bin/chromium`）實際操作網站，全程截圖存證
- **截圖目錄**：`/workspace/msw-street-workout/screenshots/`（共 27 張，依步驟編號）
- **測試帳號**：管理員 mswmacau2026@gmail.com、會員 A runner1@msw.test（阿健）、會員 B runner2@msw.test（小玲）

---

## 一、逐步驗證結果

| # | 步驟 | 結果 | 截圖 | 說明 |
|---|------|------|------|------|
| 1 | 首頁 `/` 渲染 | **PASS** | `01-home.png`、`02-home-top.png` | Hero、累積數據（0 km / 4 人 / 9 場 / 300 km）、兩大活動卡、6 格訓練項目、9 月排行榜、CTA、頁尾全部渲染。`body` 背景實測 `rgb(15,15,15)`＝`#0F0F0F`，有活力紅按鈕與鈷藍點綴 |
| 2 | `/events`、`/training` | **PASS** | `03-events.png`、`04-training.png` | 活動總覽含參加流程 4 步驟；訓練頁列出 8 個未來週一場次（9/28～11/16，第 9 場 9/21 已過期被過濾，後台總數 9 場一致） |
| 3 | 會員 A 登入 | **PASS** | `05-login.png`、`06-login-dashboard.png` | 登入成功導向 `/dashboard`，顯示「你好，阿健」，積分 0、里程 0 |
| 4 | 上傳跑步紀錄 `/run` | **PASS** | `07-run-page.png`、`08-run-form-filled.png`、`09-run-submitted.png` | 以 PIL 產生假 Strava 截圖（`/root/.codebuddy/artifact/fake-run.png`），提交 12.5 km／2026-09。出現成功訊息「已提交 12.5 公里，等待後台確認」，進度卡即時顯示「待確認 12.5 km」，提交紀錄出現一筆「待確認」 |
| 5 | 訓練報名 `/training` | **PASS** | `10-training-registered.png` | 點「報名這一場」（11/16 場次）後按鈕變為「已報名 · 待確認」，「我的訓練紀錄」出現該筆 |
| 6 | 登出 → 管理員登入 | **PASS** | `11-admin-login-redirect.png` | `POST /auth/signout`（303 轉址）正常；管理員登入後 dashboard 顯示「管理員 · 進入後台」 |
| 7 | 後台總覽 `/admin` | **PASS** | `12-admin-overview.png` | 六張統計卡與左側選單（總覽/跑步審核/簽到確認/月度名單/優惠券/訓練場次）齊全；「待審核 1、待確認簽到 1」計數正確（見 P0-1 的矛盾現象） |
| 8 | 跑步審核 `/admin/runs` | **FAIL（P0-1）** | `13-admin-runs-before.png`、`14-admin-runs-after.png`、`15-admin-runs-approved-tab.png`、`23-admin-runs-approved-after-rpc.png` | 待確認／已確認分頁**全部顯示「沒有待確認的提交」**，管理員在 UI 上完全看不到會員剛提交的 12.5 km 紀錄，也無法點「通過」，截圖（signed URL）因此無從顯示。改以管理員身分呼叫與 UI 相同的 RPC `review_run_submission` 代為通過；另以 API 層驗證 signed URL：HTTP 200、`image/png`、33,039 bytes，**私有 bucket 與 signed URL 機制本身正常**，問題僅在 UI 查詢（見 P0-1） |
| 9 | 簽到確認 `/admin/checkins` | **FAIL（P0-1）** | `16-admin-checkins-before.png`、`17-admin-checkins-after.png` | 同樣顯示「目前沒有待確認的簽到」，UI 無法確認。改以 RPC `review_checkin` 代為確認 |
| 10 | 驗證入帳（會員 A） | **PASS**（經 RPC 審核後） | `18-memberA-dashboard-after.png` | `/dashboard` 顯示：積分 **23**（12.5 km → +13 分四捨五入、簽到 +10 分）、本月里程 **12.5 km**、狀態「已確認」、積分明細兩筆入帳正確 |
| 11 | 優惠券發放與 QR | **部分 FAIL → QR 渲染 PASS** | `24-admin-monthly.png`、`19-memberA-coupon-qr.png`、`25-admin-coupons.png` | `/admin/monthly` 的發券名單僅含「≥300 km 已達標」會員，會員 A（12.5 km）**不在名單上，UI 無任何補發入口**（`/admin/coupons` 只有核銷表單）→ 測試計畫預設的手動發券路徑走不通（見 P2-2）。改以 RPC `issue_coupons` 發放後：會員 A `/dashboard/coupons` 顯示券卡，**QR Code 為伺服端 dataURL（naturalWidth=300）真實渲染**，券碼 MSW-202609-6572D6、有效期限 2026/12/22 |
| 12 | 排行榜 `/leaderboard` | **PASS** | `20-leaderboard.png` | 阿健以 12.5 km、23 積分登上月度榜與總榜第 1 名 |
| 13 | 手機版 375×812 | **PASS** | `21-mobile-home.png`、`21b-mobile-home-full.png`、`22-mobile-run.png`、`22b-mobile-run-full.png` | 漢堡選單正常、無水平溢出（`scrollWidth == clientWidth == 375`）、進度卡與表單排版正常 |

**主控台錯誤**：全程（桌面＋手機）**零 console error、零 pageerror、零 request failed**。

---

## 二、發現的問題清單

### P0-1（阻斷）後台審核清單永遠空白，管理員無法審核任何提交與簽到

- **發生位置**：`/admin/runs`（待確認／已確認／已駁回三個分頁全部）、`/admin/checkins`
- **重現步驟**：
  1. 會員上傳跑步紀錄（或報名訓練）成功，狀態「待確認」。
  2. 管理員登入 → `/admin` 總覽正確顯示「待審核跑步提交 1、待確認簽到 1」。
  3. 點進 `/admin/runs` → 顯示「沒有待確認的提交」；`/admin/checkins` → 「目前沒有待確認的簽到」。
- **根本原因**（以管理員身分重現查詢確認）：`src/lib/queries.ts` 的 `getSubmissionsByStatus()`（約 258 行）與 `getPendingCheckins()`（約 275 行）使用 `profile:profiles(...)` 關聯查詢，但 `run_submissions` 與 `training_checkins` 對 `profiles` 各有**兩條外鍵**（`user_id` 與 `reviewed_by`／`confirmed_by`），Supabase（PostgREST）回傳 **PGRST201: "Could not embed because more than one relationship was found"**；程式碼以 `const { data } = ...` 取值後用 `?? []` **靜默吞掉錯誤**，導致清單永遠為空。總覽的計數查詢不含 embed，所以數字正確，形成「總覽說有 1 筆、點進去是空的」的矛盾。
- **影響**：管理員無法透過 UI 核准任何跑步里程或簽到 → 會員里程與積分永遠無法入帳、月度 300 km 達標與自動發券永不觸發 → **網站核心業務流程完全阻斷**。
- **建議修法**（未修改，僅供開發者參考）：embed 改為明確外鍵，例如 `profile:profiles!run_submissions_user_id_fkey(id, display_name, avatar_url)`、`profile:profiles!training_checkins_user_id_fkey(id, display_name)`；並養成檢查 `error` 的習慣，不要靜默回空陣列。
- **證據截圖**：`12-admin-overview.png`（計數＝1）vs `13-admin-runs-before.png`／`16-admin-checkins-before.png`（清單空）；`23-admin-runs-approved-after-rpc.png` 證明連「已確認」分頁也看不到 DB 中確實存在的已核准紀錄。

### P2-2（嚴重→功能缺口）後台無法對未達標會員手動補發優惠券

- **發生位置**：`/admin/monthly`、`/admin/coupons`
- **重現步驟**：管理員進入 `/admin/monthly` → 發券表單只列出當月「≥300 km 已達標」會員（RPC `monthly_qualified_list`）；未達標會員不在名單，`/admin/coupons` 僅提供核銷（redeem）表單，全站無「指定會員補發一張券」的 UI 入口。
- **影響**：本次驗證計畫「手動發一張券給會員 A」無法透過 UI 完成；實務上若遇發券失敗、客訴補償等情境，管理員沒有任何操作途徑。
- **備註**：若「僅對達標者發券」是有意設計，建議至少在後台提供管理員指定會員補發的高階功能，或將此項降級為 P3。

### P3-1（建議）首頁部分 emoji 圖示顯示為豆腐方塊（□）

- **發生位置**：首頁「WHY MSW」三卡與「各類訓練項目」六格的 emoji 圖示（見 `01-home.png`）
- **說明**：驗證環境為無 emoji 字型的 headless Linux Chromium，真實手機／桌面瀏覽器多半正常；但首頁關鍵區塊以 emoji 當主圖示，建議改用 SVG icon（如專案內已用的 lucide-react）以確保跨環境一致。

### P3-2（建議）提交紀錄成功訊息未自動捲動、表單重置後預覽消失屬正常，但成功後畫面停在表單區

- **說明**：提交成功後成功訊息出現在「上傳表單」上方，但頁面不會捲動到該訊息或「我的提交紀錄」，使用者可能沒注意到已提交成功（見 `09-run-submitted.png`）。建議提交成功後捲動至成功訊息或提交紀錄。

---

## 三、驗證過程中的必要揭露（非網站問題）

由於 P0-1 導致審核與發券的 **UI** 無法操作，為了不讓後續步驟（入帳、QR、排行榜）全部停擺，驗證官以**管理員本人的登入身分、呼叫與 UI 按鈕完全相同的 Supabase RPC**（`review_run_submission`、`review_checkin`、`issue_coupons`）代為執行第 8、9、11 步的動作。此舉：

- 未修改任何網站程式碼、未修改任何資料庫結構或 RLS；
- 走的是與 UI 相同的權限路徑（管理員 session）與相同的商業邏輯（RPC 內含加分、累加里程、狀態更新）；
- 僅為了驗證「審核之後」的下游流程是否正確（結果：正確）。

**換言之：下游邏輯全部正常，網站離「可用」只差 P0-1 這一個查詢 bug。**

另：第 11 步的優惠券是發給會員 A 的測試券（標題含「驗證測試」字樣），第 8、9 步的審核備註均註明「驗證官代為執行」，可在後台追溯。

---

## 四、總結

**這個網站尚不能稱為「可正常使用的完整網站」。** 會員端體驗（首頁、活動、訓練報名、跑步上傳、入帳顯示、優惠券 QR、排行榜、手機版排版）全部正常且完成度高；但後台審核頁因 P0-1（PostgREST embed 歧義 + 錯誤被靜默吞掉）導致管理員**完全看不到也無法核准任何提交與簽到**，等同把「上傳 → 審核 → 入帳 → 發券」這條核心商業流程攔腰斬斷。修復 P0-1（預計是兩行 query 的修改）並重跑第 8、9、11 步驗證後，即可達到可上線標準。

---

# 複驗結果（2026-09-23 第二輪）

開發者已修復 P0-1（embed 改為顯式外鍵 `profiles!run_submissions_user_id_fkey` / `profiles!training_checkins_user_id_fkey`，並新增 `logQueryError()`）與 P2-2（`/admin/coupons` 新增「手動發放優惠券」區塊）。本輪全程以 **UI 實際點擊**操作（未再代呼叫 RPC），截圖 23 張（`fix-01` ～ `fix-23` 前綴），全程**零 console error、零 request failed**，`/tmp/msw-dev.log` 無任何查詢錯誤輸出。

| # | 複驗步驟 | 結果 | 截圖 | 說明 |
|---|---------|------|------|------|
| 1 | `/admin/runs` 三分頁 | **PASS** | `fix-01`～`fix-04` | 「已確認」分頁正確列出阿健 12.5 km（提交時間、會員備註、管理員備註齊全），**截圖縮圖真實顯示**（signed URL，naturalWidth 640×900，非「圖片無法載入」）；待確認／已駁回分頁此時確實無資料，顯示合理空狀態 |
| 2 | `/admin/checkins` | **PASS** | `fix-05` | 空狀態合理（上一輪的簽到已被核准；本輪另驗證：非管理員開 `/admin/*` 會被正確擋下顯示「權限不足」，見 `12` 誤登狀態的截圖，屬正面發現） |
| 3 | 完整真實審核流程（UI） | **PASS** | `fix-06`～`fix-11` | ① 會員 A 於 `/run` 上傳 8.3 km → 成功訊息＋「待確認 8.3 km」；② 管理員於 `/admin/runs`（待確認分頁）看到該筆（含縮圖 640×900），點「通過」→ 清單即時清空，「已確認」分頁同時出現 8.3 與 12.5 兩筆；③ 會員 A `/dashboard`：積分 23→**31**（+8）、里程 12.5→**20.8 km**、狀態「已確認」 |
| 4 | `/admin/coupons` 手動發券 | **PASS** | `fix-12`～`fix-15` | 「手動發放優惠券」區塊存在，可勾選任意會員（不限達標者）；勾選阿健送出 → 成功訊息「已發放 1 張優惠券」；會員 A `/dashboard/coupons` 「可使用（2）」，新券 MSW-202609-97D5A1 **QR Code 正常渲染**（naturalWidth 300，兩張券皆正常） |
| 5 | 月度達標自動發券 | **PASS** | `fix-16`～`fix-23` | 會員 B（小玲）分兩筆上傳 160＋145 km（單筆未超 200 上限）→ 管理員 UI 逐筆點「通過」→ `/admin/monthly` 達標名單出現小玲 305.0 km（優惠券狀態「已發放」，全體累積表同時顯示小玲 305/阿健 20.8）→ 小玲 `/dashboard`：積分 **505**（305＋月度達標 +200）、里程 305 km、優惠券 1 張 → `/dashboard/coupons` 自動產生「月度 300km 達成優惠券」MSW-202609-2A0230，**QR Code 正常渲染** → `/leaderboard` 小玲以 305 km 登上月度榜第 1 |

### 複驗觀察（非阻斷，不計新 bug）

- 自動發券的到期日採「達標月份＋3 個月」（本例 2026/12/01），手動發券採「發放日＋有效天數」（本例 2026/12/22）——兩者算法不同，經核對 `supabase/schema.sql` 為刻意設計，僅提醒營運時注意兩種券效期語意不同。
- 非管理員帳號直接造訪 `/admin/coupons` 會被正確阻擋（顯示「權限不足。此帳號不是管理員」），權限防護有效（`fix-12` 首次誤拍即為此狀態）。

### 複驗結論

**P0-1 與 P2-2 均確認修復，核心商業流程（上傳 → UI 審核 → 入帳 → 手動發券 → 月度達標自動發券）全鏈路以純 UI 操作走通。** 本輪未發現新的 P0/P1 問題；原先 P3 項目（emoji 圖示依賴環境字型、提交成功後未自動捲動）維持原樣。**網站現已達到「可正常使用的完整網站」標準。**

---

# 線上環境驗證（2026-09-23 第三輪）

- **目標網址**：https://a1c3aee7df1da69a8.app.workbuddy.host（Next.js production build + 邊緣 CDN/WAF，同一 Supabase 專案）
- **截圖**：13 張（`live-01` ～ `live-13` 前綴），WAF 攔截頁 HTML 存於 `/root/.codebuddy/artifact/waf-block-page.html`
- **方法**：Playwright（headless Chromium，全新 cookie profile）實際操作線上站

## 逐步結果

| # | 步驟 | 結果 | 截圖 | 說明 |
|---|------|------|------|------|
| 1 | 線上首頁 | **PASS** | `live-01`、`live-02` | CSS 正確載入（1 個 stylesheet）：`body` 背景 `rgb(15,15,15)`＝`#0F0F0F`、活力紅 `rgb(227,0,27)`、鈷藍 `rgb(0,71,171)`、H1 67.2px、容器 1200px，全站渲染與本機一致；累積里程 325.8 km（資料同步） |
| 2 | 手機版 375×812 | **PASS** | `live-03`、`live-04` | 無水平溢出（scrollWidth == clientWidth == 375）、漢堡選單正常 |
| 3 | 註冊新會員 | **FAIL（P0-LIVE-1）** | `live-05`～`live-07` | 填寫完成送出後，Server Action POST 被 **403** 攔截，頁面拋出「An unexpected response was received from the server」，**帳號未建立** |
| 4 | 會員 A 登入並上傳 6.6 km | **FAIL（P0-LIVE-1）** | `live-09`、`live-13` | 登入送出同樣 403，Next.js 顯示「This page couldn't load / Reload to try again」錯誤頁，**無法登入**，後續上傳無從執行 |
| 5 | 管理員審核 | **FAIL（被 P0-LIVE-1 阻斷）** | — | 無法登入，無法進後台 |
| 6 | Dashboard 積分／優惠券 QR | **FAIL（被 P0-LIVE-1 阻斷）** | — | 無法登入；QR 為伺服端產生，本機已驗證可運作，線上因登入受阻無法取得證據 |
| 7 | `/leaderboard` | **PASS（附 P2-LIVE-2）** | `live-10`、`live-11` | 月度榜有資料（305 km / 20.8 km），月份切換（?m=2026-08）正常；**但匿名訪客看到的會員全部顯示「匿名會員」、積分 0，總榜整個「尚無資料」** |
| 8 | `/training` | **PASS（列表）／FAIL（報名，被 P0 阻斷）** | `live-12` | 8 個未來場次正常列出；報名需登入 → 被 P0 阻斷 |
| 9 | Console 檢查 | **FAIL（P0-LIVE-1 證據）** | — | 每次提交表單必現：console error「Failed to load resource: 403」＋ pageerror「An unexpected response was received from the server」；其餘僅 `_rsc` prefetch 的 ERR_ABORTED（Next.js 預取取消，無害）。未見 Supabase CORS 錯誤 |

## P0-LIVE-1（阻斷）線上所有表單操作（Server Action）被邊緣 WAF 攔截，全站無法登入／註冊／提交

- **發生位置**：所有使用 Next.js Server Action 的 POST（`/signup`、`/login`、`/run` 上傳、`/admin/runs` 審核、`/training` 報名、`/admin/*` 發券等）。純 GET 頁面與 `/auth/signout`（route handler）不受影響。
- **重現步驟**：開啟 https://a1c3aee7df1da69a8.app.workbuddy.host/login → 輸入帳密 → 點「登入」→ 請求 `POST /login`（帶 `next-action` 標頭、multipart body）→ 回 **403**，內容為 CDN WAF 攔截頁（標題「WAF拦截页面」，`server: stgw`，騰訊雲 EdgeOne）。
- **根因定位**（以 curl 重放二分法確認）：
  - 同一 POST **不帶 `next-action` 標頭** → 200（正常進入應用）；
  - 帶 `next-action` 標頭 + 含 `$ACTION_` 欄位的 multipart body → **一律 403 WAF 拦截**（與帳密內容無關，空參數也擋）；
  - 判定為邊緣 WAF 的規則命中 Next.js Server Action 特徵（`next-action` / `$ACTION_`，常見於 RSC 相關攻擊特徵庫），把合法的 Server Action 請求當成攻擊攔下。
- **影響**：線上環境**任何寫入操作全部失效**——不能註冊、不能登入、不能上傳、不能審核、不能報名。全站只剩瀏覽功能，等同核心功能 100% 阻斷。
- **建議修法**（僅記錄）：在 EdgeOne WAF 對本網域新增白名單規則，放行帶 `next-action` 標頭（或 `$ACTION_` 欄位）且 `referer` 為本網域的 POST；或調整觸發該特徵的規則編號。

## P2-LIVE-2（一般）公開排行榜對未登入訪客完全匿名化，總榜直接空白

- **發生位置**：`/leaderboard`（未登入狀態）
- **重現步驟**：未登入開啟 `/leaderboard` → 月度榜顯示「匿名會員 305 km / 匿名會員 20.8 km」且積分 0；「累積總榜」顯示「尚無資料」。
- **根因**：`getMonthlyLeaderboard()`／`getAllTimeLeaderboard()`（`src/lib/queries.ts` 69、105 行）需讀 `profiles` 取名稱與積分，但 profiles 的 RLS（`auth.uid() = id or is_admin()`）不允許匿名讀取 → 名稱回退「匿名會員」、總榜查詢整個為空。此行為由程式與 RLS 決定，**本機同樣存在**（非線上獨有），但線上「訪客看到排行榜」是主要曝光場景，影響更大。
- **建議**：為 `profiles` 增加公開欄位檢視（僅 display_name / points / total_km 的安全 view 或改用 security definer RPC），讓訪客能看到榜單名稱。

## 線上環境結論

**線上環境目前不可用：所有需要帳號的操作（註冊、登入、上傳、審核、報名、發券）全部被邊緣 WAF 的 403 攔截，僅靜態瀏覽（首頁、活動、訓練列表、排行榜、RWD）正常。** 這是部署層（CDN WAF 規則）與應用程式碼無關的問題，調整 WAF 白名單後，依本輪第 3～6、8 步重驗即可。本輪未發現登入 session 維持、cookie domain、圖片 403 等其他線上獨有問題（皆因無法登入而暫無法驗證）。

---

# 線上環境驗證（2026-09-23 第四輪）

- **目標網址**：https://a1c3aee7df1da69a8.app.workbuddy.host（重新 build + 重新發布後）
- **本輪待驗修復**：① P0-LIVE-1 → 所有 Server Action 改寫為 API Route（`/api/auth/*`、`/api/runs`、`/api/training/checkins`、`/api/admin/*`），前端表單改為 fetch；② P2-LIVE-2 → 新增 `public_leaderboard` 檢視表（`security_invoker = false`，僅暴露 id/display_name/avatar_url/points/total_km，grant select 給 anon），排行榜查詢改讀該 view。
- **方法**：Playwright（headless Chromium `/usr/bin/chromium`）真實瀏覽器操作，每個角色使用**全新 cookie profile**（`/root/.codebuddy/artifact/browser-profile-live4*`，匿名狀態起步）；全程攔截記錄 console error / pageerror / HTTP ≥ 400 / request failed。
- **截圖**：45 張（`live4-01` ～ `live4-45` 前綴，位於 `screenshots/`）。
- **基線數據**（測前）：阿健 31 積分／20.8 km／2 張券；小玲 505 積分／305 km／1 張券；首頁全站累積 325.8 km；後台優惠券共 3 張。

## 逐步結果（對應任務 14 項必測）

| # | 步驟 | 結果 | 截圖 | 說明 |
|---|------|------|------|------|
| 1 | 註冊新會員（上輪 P0 項目） | **PASS** | `live4-08`～`live4-11` | `/signup` 填寫 `pretest_live4@msw.test`／「QA驗4」送出 → `POST /api/auth/signup` 回 **200** `{"ok":true,"next":"/dashboard","needConfirm":false}`，**直接建立 session 並導向 `/dashboard`**；再以全新 profile 登入該帳號成功，Dashboard 顯示「QA驗4 · 積分 0」，Nav 出現會員選單 → 帳號確實建立 |
| 2 | 會員 A 登入 | **PASS** | `live4-12` | `POST /api/auth/login` 200 → 導向 `/dashboard`，Nav 顯示「阿健 31 pt」會員選單；Dashboard 基線 31 積分／20.8 km／2 張券 |
| 3 | 上傳跑步紀錄 6.6 km | **PASS** | `live4-13`～`live4-15`、`live4-21` | `/run` 上傳 `fake-run.png`＋6.6 km → 成功訊息「已提交 6.6 公里，等待後台確認…」；進度卡出現「待確認 6.6 km」，Dashboard 顯示「還差 272.6 公里達標。另有 6.6 km 待後台確認」（**未入帳**，狀態正確） |
| 4 | 管理員登入 | **PASS** | `live4-23` | 導向 `/admin`，總覽顯示「待審核跑步提交 1、待確認簽到 1」，計數與實際一致 |
| 5 | `/admin/runs` 審核 | **PASS** | `live4-24`～`live4-26`、`live4-36` | 待確認分頁列出阿健 6.6 km，**截圖縮圖真實載入**（signed URL，naturalWidth 640×900）；點「通過」→ 清單即時清空、「已確認」分頁出現該筆（含 live4 備註）；會員 Dashboard 複核：**31 → 48 分（+7 跑步 ＋10 簽到）、20.8 → 27.4 km**，積分明細出現「跑步里程 6.60 km +7」（`round(6.6 × 1) = 7`，每公里 +1 分、四捨五入到整數） |
| 6 | `/admin/checkins` 簽到確認 | **PASS** | `live4-27`、`live4-28` | 待確認清單出現阿健 2026-11-02 場次 → 點「確認」→ 清單清空，會員 +10 分（積分明細「定期訓練簽到 +10」） |
| 7 | `/training` 報名／取消 | **PASS** | `live4-16`～`live4-19` | 點「報名這一場」→ 狀態變「已報名 · 待確認」且「取消報名」可用；對另一場報名後點「取消報名」→ 恢復「報名這一場」（可再報名），狀態流轉正確 |
| 8 | 會員 Dashboard／優惠券 QR | **PASS** | `live4-36`、`live4-37` | 審核後積分 48、里程 27.4 km、可用優惠券 2（與商業邏輯完全吻合）；`/dashboard/coupons` 兩張券 QR Code 均真實渲染（data:image/png，**naturalWidth = 300**） |
| 9 | `/admin/monthly` 達標名單＋發券 | **PASS**（附 P3-3） | `live4-29`、`live4-30`、`live4-40` | 達標名單正確：僅小玲 305.0 km（標示「已發放」）、全體累積表同時列出阿健 27.4 km；勾選小玲按「發放優惠券」→ 成功訊息「已發放 1 張優惠券。」；**會員端（小玲）確實收到新券** MSW-202609-8638F3（pretest_live4 月度補發測試券），QR naturalWidth 300，積分維持 505（補發不加 200 分，正確） |
| 10 | `/admin/coupons` 手動發券＋核銷 | **PASS** | `live4-31`～`live4-33`、`live4-42` | 勾選新會員「QA驗4」發券 → 成功訊息「已發放 1 張優惠券。」，清單出現 MSW-202609-F2EA65（可使用）；核銷表單輸入券碼 → 成功訊息「優惠券 MSW-202609-F2EA65 已核銷。」，清單狀態變「已使用」，**會員端同步顯示「已使用」** |
| 11 | `/admin/sessions` 建立場次 | **PASS** | `live4-34`、`live4-35` | 建立 2026-12-28「pretest_live4 測試場次」→ 清單即時出現，「開放報名」場次 9 → 10 |
| 12 | 匿名排行榜修復（上輪 P2 項目） | **PASS** | `live4-03`、`live4-04`、`live4-39` | **未登入**開 `/leaderboard`：月度榜「小玲 2 次提交 · 505 積分 / 305 km」「阿健 2 次提交 · 31 積分 / 20.8 km」；累積總榜列出全部會員（含 0 km 的阿明／管理員）——**不再有「匿名會員／0 分」，總榜不再空白** |
| 13 | Console 檢查 | **PASS** | — | 所有真實使用者流程（匿名瀏覽、註冊、三個角色登入、上傳、審核、報名、發券、核銷、建場次）**零 console error、零 pageerror、零 request failed**；全程未出現 403、未出現「An unexpected response was received from the server」。唯一 HTTP ≥ 400 來自驗證官**故意**的邊界／越權探測（見下），屬預期錯誤回應 |
| 14 | 手機版 375×812 | **PASS** | `live4-06`、`live4-07` | `scrollWidth == clientWidth == 375`，無水平溢出 |

### 邊界測試（API 直測，8 例全 PASS）

| 案例 | 實際回應 | 判定 |
|------|---------|------|
| 匿名 `POST /api/runs` | `401 {"ok":false,"error":"請先登入。"}` | 正確 |
| 匿名 `POST /api/training/checkins` | `401 請先登入。` | 正確 |
| 匿名 `POST /api/admin/coupons` | `401 請先登入。` | 正確 |
| 會員 A 呼叫管理員審核 `POST /api/admin/review-run` | `403 {"ok":false,"error":"權限不足。"}` | 正確 |
| km = -5 | `400 請填寫有效的公里數。` | 正確 |
| km = 999999 | `400 單次提交上限為 200 公里。` | 正確 |
| period_month = "2026-13-99" | `400 月份格式錯誤。` | 正確 |
| 註冊密碼 3 位／重複 email／空 body 登入／錯誤密碼 | `400 密碼至少需要 6 個字元。`／`400 此電郵已註冊，請直接登入。`／`400 請填寫電郵與密碼。`／`401 電郵或密碼錯誤。` | 正確，皆為中文可讀訊息 |

另：會員 A 開 `/admin` 頁面 → HTTP 200 但內容為「權限不足。此帳號不是管理員」（`live4-38`），頁面層防護有效。WAF 殘留探測：帶 `next-action` 標頭的 POST 現在可正常到達應用（回 401 業務錯誤而非 403 攔截頁；邊緣 `server` 已由 `stgw` 變為 `CloudStudio Gateway`），且全站已無 Server Action 呼叫，P0-LIVE-1 的觸發條件已雙重消除。

## 本輪缺陷清單（無 P0／P1／P2）

### P3-1 `DELETE /api/runs` 對不存在或非本人的提交回 `200 {"ok":true}`（靜默無操作）

- **重現**：以會員 A 身分 `DELETE /api/runs` 帶任意不存在 uuid → `200 {"ok":true}`。
- **影響**：無資料外洩（實際刪除 0 列，RLS `runs_delete_own_pending` 有兜底），但 API 對「刪不到」回成功，前端無從得知失敗；程式碼 `src/app/api/runs/route.ts` 的 DELETE 未過濾 `user_id`、未檢查刪除列數，正確性完全依賴 RLS。
- **建議**：delete 前先 `select ... eq('id', id).eq('user_id', user.id)` 確認擁有權；影響列數為 0 時回 `404`。

### P3-2 除錯端點 `/api/test` 殘留在 production build

- **重現**：`GET /api/test` → `200 {"ok":true,"mode":"get"}`；`POST /api/test`（multipart）→ 200 並回顯表單欄位。（有趣的是同請求帶 JSON body 反而 403，被邊緣規則擋下——更說明它沒有存在必要。）
- **影響**：無資料外洩，但攻擊面多一個 echo 端點，且交付不應含除錯碼。
- **建議**：刪除 `src/app/api/test/route.ts` 後重新發布。

### P3-3 月度發券表單可對「已發放」會員重複發券，無防呆

- **重現**：`/admin/monthly` 對小玲（優惠券狀態「已發放」）再次勾選發放 → 直接成功，產生同月第二張券。
- **影響**：管理員手滑即造成重複發券（本輪測試即因此多出一張，已清理）；核銷端無法分辨重複。
- **建議**：`MonthlyIssueForm` 預設取消勾選已發放者（現況已如此）之外，對 `has_coupon = true` 的列禁用 checkbox 或送出前二次確認。

### P3-4（規則備註，非 bug）積分四捨五入語意

- 6.6 km → +7 分（`round(km × points_per_km)`）；即 0.5 km 以下（< 0.5）提交會得 0 分。與「每公里 +1 分」的直觀理解略有出入，建議在規則頁註明「不足 0.5 km 捨去、滿 0.5 進位」。

## 測試資料清理說明

本輪產生的測試資料已**全數清理並驗證還原**（清理透過驗證環境自第一輪即持有的 Supabase Management API 通道執行 SQL，僅刪除/還原本輪 `pretest_` 資料與本輪計數，未動任何 schema／RLS／他人資料）：

| 測試資料 | 處理 |
|---|---|
| 帳號 `pretest_live4@msw.test`（QA驗4）、`pretest_live4c@msw.test`（邊界測試時建立，顯示名 fallback 為 email 前綴） | 刪除 `auth.users`（FK cascade 連帶 profile／券） |
| 阿健 6.6 km 跑步提交＋其 Storage 截圖物件 | 刪除 `run_submissions` 列；截圖以擁有者（會員 A）token 呼叫 Storage API 刪除成功 |
| 阿健 2026-11-02 簽到（已確認） | 刪除 `training_checkins` 列 |
| 本輪積分異動（跑步 +7、簽到 +10） | 刪除對應 `point_transactions` 兩列；`profiles` 還原為 31 分／20.8 km |
| 小玲第二張月度券 MSW-202609-8638F3 | 刪除 `coupons` 列 |
| 場次 2026-12-28「pretest_live4 測試場次」 | 刪除 `training_sessions` 列 |

清理後還原驗證（SQL + 線上 UI 雙重核對，截圖 `live4-43`～`live4-45`）：profiles 阿健 31／20.8、小玲 505／305；優惠券 3 張（與測前一致）；point_transactions 剩基線 6 筆；首頁全站累積回到 **325.8 km**；會員 A Dashboard 31 分／20.8 km／2 張券、無 6.6 km 紀錄；訓練紀錄僅剩 2026-11-16 一筆已確認；匿名排行榜無任何 pretest 帳號；`/admin/sessions` 無 2026-12-28。**上輪殘留資料未動**（阿健 8.3/12.5 km、小玲 160/145 km 及其 3 張券為前兩輪既有測試資料，非本輪產生）。

## 第四輪結論

**這個線上網址現在已經是「可正常完整使用的網站」。** P0-LIVE-1 確認修復：全站寫入改走 API Route 後，註冊、登入、上傳、審核、簽到確認、報名／取消、手動與月度發券、核銷、建場次在真實瀏覽器全鏈路可用，全程零 console error、零 403；P2-LIVE-2 確認修復：匿名訪客可看到月度榜與總榜的暱稱與真實積分。商業邏輯數字（每公里 +1 分四捨五入、簽到 +10、里程累加、月度券僅首次 +200 分）全部核對無誤。剩餘 4 項均為 P3（殘留除錯端點、DELETE 靜默成功、重複發券防呆、積分捨入語意），不影響交付，建議列入後續小改版。

---

# 終端交付總體檢（2026-09-23）

- **目標網址**：https://a1c3aee7df1da69a8.app.workbuddy.host
- **測試帳號**：（憑證已自版本庫移除，僅存於 Supabase Auth，勿寫入任何版本庫檔案）
  - 管理員：`<管理員 email>` / `******`
  - 會員 A（阿健）：`runner1@msw.test` / `******`
  - 會員 B（小玲）：`runner2@msw.test` / `******`
- **方法**：Playwright（headless Chromium `/usr/bin/chromium`），每個角色使用全新 cookie profile（`/root/.codebuddy/artifact/browser-profile-final*`），全程攔截 console error / pageerror / HTTP ≥ 400 / requestfailed
- **截圖目錄**：`/workspace/msw-street-workout/screenshots/`（共 67 張，`final-01` ～ `final-60` 及子編號）
- **資料庫清理**：透過 Supabase Management API SQL + Storage API（會員 A token）全數清理本輪測試資料
- **測前基線**：阿健 31 分／20.8 km／2 張券；小玲 505 分／305 km／1 張券；首頁累積里程 325.8 km；後台優惠券 3 張

---

## 一、逐頁／逐項結果表

| 項目 | 結果 | 截圖 | 說明 |
|------|------|------|------|
| **A. 匿名訪客** | | | |
| 首頁 `/` | PASS | `final-01-home.png`、`final-01b-home-full.png` | 背景 `#0F0F0F`、累積里程 325.8 km、會員 5 人、已開場次 9 場、Hero CTA 為「立即加入會員／查看活動」、底部 CTA 為「免費註冊會員／我已有帳號」；無 console error、無水平溢出 |
| `/training` | PASS | `final-02-training.png`、`final-02b-training-full.png` | 8 個未來週一場次列出，按鈕「登入後報名」；無 overflow |
| `/run` | PASS | `final-03-run.png`、`final-03b-run-full.png` | 匿名顯示「請先登入會員」區塊；進度卡 0 km；無 overflow |
| `/events` | PASS（附 P2-2） | `final-04-events.png`、`final-04b-events-full.png` | 活動總覽、參加流程 4 步驟渲染；底部 CTA 為「免費註冊／看看排行榜」，與首頁規格不完全同步 |
| `/leaderboard` | PASS | `final-05-leaderboard.png`、`final-05b-leaderboard-full.png` | 月度榜／總榜顯示真實暱稱與積分（小玲 505／305、阿健 31／20.8）；無 overflow |
| `/login` | PASS | `final-06-login.png`、`final-06b-login-full.png` | 表單正常，錯誤密碼會顯示「電郵或密碼錯誤」 |
| `/signup` | PASS | `final-07-signup.png`、`final-07b-signup-full.png` | 註冊表單正常；無 overflow |
| 匿名點頁尾「管理員入口」→ 登入頁帶提示 | PASS | `final-08-anon-admin-entry.png` | 導向 `/login?next=%2Fadmin`，頁面顯示「管理員入口：請用管理員帳號登入，成功後會直接進入後台管理」 |
| 匿名點頁尾「我的帳戶」→ 登入頁 | PASS（頁面層） | `final-09-anon-footer-dashboard.png` | 導向 `/login?next=%2Fdashboard`，但頁尾仍對匿名顯示該連結（見 P2-1） |
| 匿名直接開 `/dashboard`、`/dashboard/coupons` | PASS | `final-10-anon-direct-dashboard.png`、`final-11-anon-direct-coupons.png` | 兩者皆導向 `/login?next=...` |
| **B. 會員 A（阿健）** | | | |
| 登入 → `/dashboard` | PASS | `final-12-memberA-login-dashboard.png` | 登入後導向 `/dashboard`，顯示「你好，阿健」、31 pt、20.8 km、可用優惠券 2 |
| `/` 會員版 CTA | PASS | `final-13-memberA-home.png`、`final-13b-memberA-home-full.png` | Hero 已切換為「我的帳戶／上傳跑步紀錄」；底部 CTA 為「繼續把汗水換成積分」+「上傳跑步紀錄／報名訓練場次」；頁尾無「註冊會員／會員登入」 |
| `/dashboard/coupons` QR | PASS | `final-15-memberA-coupons.png` | 兩張券 QR Code 均為 `data:image/png;base64…`，`naturalWidth=300`、`naturalHeight=300` |
| `/training` 報名／取消 | PASS | `final-16-memberA-training-before.png` ～ `final-18-memberA-training-cancelled.png` | 可報名場次、狀態變「已報名 · 待確認」；對另一場點「取消報名」後恢復「報名這一場」 |
| `/run` 上傳 8.4 km | PASS | `final-19-memberA-run-before.png`、`final-20-memberA-run-submitted.png` | 提交 `fake-run.png` + 8.4 km，成功訊息「已提交 8.4 公里…」、進度卡「待確認 8.4 km」 |
| 桌面版 Nav 頭像下拉 → 登出 | PASS | `final-21-memberA-dropdown.png`、`final-22-memberA-logout-desktop.png` | 點頭像後出現「登出」，點擊後導向首頁，Nav 恢復「會員登入／立即加入」 |
| 手機版 375×812 漢堡選單 → 登出 | PASS | `final-23-memberA-mobile-dashboard.png` ～ `final-25-memberA-mobile-logout.png` | 漢堡選單內有「登出」，點擊後導向首頁，Nav 恢復匿名狀態 |
| 管理員審核後複核 | PASS | `final-41-memberA-dashboard-after-admin.png`、`final-42-memberA-coupons-after-admin.png` | 審核 8.4 km 後積分 31→39、里程 20.8→29.2 km；手動發券後可用券 4 張、核銷 MSW-202609-97D5A1 後出現「已使用」區塊 |
| **C. 管理員** | | | |
| 匿名點頁尾「管理員入口」→ 登入 → 直接進 `/admin` | PASS | `final-26-admin-login-prompt.png`、`final-27-admin-after-login.png` | 登入後直接進入 `/admin` 總覽 |
| `/admin` 總覽 | PASS | `final-28-admin-overview.png` | 六張統計卡、左側選單齊全；待審核跑步提交、待確認簽到計數正確 |
| `/admin/runs` 審核 8.4 km | PASS | `final-29-admin-runs-pending.png`、`final-30-admin-runs-after-approve.png` | 待確認分頁列出阿健 8.4 km（含截圖縮圖），點「通過」後即時移入「已確認」；全站累積里程由 325.8→334.2 km |
| `/admin/checkins` | PASS（頁面層） | `final-31-admin-checkins.png` | 本輪會員 A 已取消報名，因此無待確認簽到，頁面顯示「目前沒有待確認的簽到」 |
| `/admin/monthly` | PASS | `final-33-admin-monthly.png` | 達標名單僅小玲 305.0 km（已發放）；全體累積表正確；月份切換正常 |
| `/admin/coupons` 手動發券 + 核銷 | PASS | `final-34-admin-coupons-before.png` ～ `final-36-admin-coupons-redeemed.png` | 勾選阿健發券成功；輸入 MSW-202609-97D5A1 核銷成功，列表狀態變「已使用」 |
| `/admin/sessions` 建立場次 | PASS | `final-37-admin-sessions.png`、`final-38-admin-sessions-created.png` | 建立 2026-12-28「pretest_final 測試場次」，已排定場次 9→10 |
| 管理員登出 | PASS | `final-39-admin-dropdown.png`、`final-40-admin-logout.png` | 點頭像下拉「登出」，導向首頁 |
| **D. 跨裝置** | | | |
| 桌面 1440×900：`/`、`/run`、`/dashboard`、`/admin/runs` | PASS | `final-43-cross-d-home.png` ～ `final-46-cross-d-admin-runs.png` | 四頁 `scrollWidth == clientWidth == 1440`，無水平溢出 |
| 手機 375×812：`/`、`/run`、`/dashboard` | PASS | `final-47-cross-m-home.png` ～ `final-49-cross-m-dashboard.png` | 三頁 `scrollWidth == clientWidth == 375` |
| 手機 375×812：`/admin/runs` | **FAIL（P1-1）** | `final-50-cross-m-admin-runs.png` | `scrollWidth=524 > clientWidth=375`，水平溢出 |
| **E. 錯誤與邊界** | | | |
| 錯誤密碼 | PASS | `final-51-error-wrong-password.png` | 登入頁顯示「電郵或密碼錯誤」；POST `/api/auth/login` 回 401，屬預期錯誤 |
| 未登入直接開 `/dashboard` | PASS | `final-52-error-unauth-dashboard.png` | 導向 `/login?next=%2Fdashboard` |
| 未登入直接開 `/admin` | PASS | `final-53-error-unauth-admin.png` | 導向 `/login?next=%2Fadmin`，附管理員提示 |
| 會員 A 開 `/admin` | PASS | `final-54-error-member-admin.png` | 顯示「權限不足…此帳號不是管理員」，並附「登出」按鈕 |
| `/run` 提交空值 | PASS（HTML5 攔截） | `final-55-error-run-empty.png` | 空 km 未送出，頁面無異常 |
| `/run` 提交 999999 km | PASS | `final-56-error-run-huge.png` | 表單顯示錯誤「單次提交上限為 200 公里」 |
| API：負數 km、超大 km、錯誤月份、會員越權 | PASS | 直測記錄見下 | `POST /api/runs`（-5、999999、2026-13-99）回 400 中文錯誤；會員呼叫管理員 API 回 403；匿名呼叫受保護 API 回 401 |
| **F. Console / 網路** | | | |
| 全站無 console error / pageerror / request failed | PASS | 各輪 watch 彙整 | 僅有「錯誤密碼」產生的 401 為預期錯誤，其餘零 console error、零 pageerror、零非預期 403；無 localhost 導向、無 WAF 攔截 |
| Dashboard 預載簽名圖片 warning | PASS（P3-1） | `final-59-verify-dashboard.png` | Chromium 回報 signed URL preload 後未使用，屬效能 warning，不影響功能 |

**補充：API 邊界探測實測回應**

| 案例 | 身分 | 回應 |
|------|------|------|
| `POST /api/runs` km=-5 | 會員 A | `400 請填寫有效的公里數。` |
| `POST /api/runs` km=999999 | 會員 A | `400 單次提交上限為 200 公里。` |
| `POST /api/runs` period_month=2026-13-99 | 會員 A | `400 月份格式錯誤。` |
| `POST /api/admin/review-run` | 會員 A | `403 權限不足。` |
| `POST /api/admin/coupons` | 會員 A | `403 權限不足。` |
| `POST /api/runs` | 匿名 | `401 請先登入。` |
| `POST /api/training/checkins` | 匿名 | `401 請先登入。` |
| `POST /api/admin/coupons` | 匿名 | `401 請先登入。` |

---

## 二、缺陷清單

### P1-1 後台頁面手機版（375×812）全面水平溢出，無法正常使用

- **描述**：在 375×812 手機 viewport 下，所有後台頁面 `scrollWidth=524 > clientWidth=375`，出現水平捲動；`/admin/runs`、`/admin/checkins`、`/admin/monthly`、`/admin/coupons`、`/admin/sessions` 與 `/admin` 總覽全部失守。
- **重現步驟**：
  1. 以管理員登入。
  2. 切換 viewport 至 375×812。
  3. 依序開啟 `/admin`、`/admin/runs`、`/admin/checkins`、`/admin/monthly`、`/admin/coupons`、`/admin/sessions`。
  4. 測量 `document.documentElement.scrollWidth` 與 `clientWidth`。
- **實際結果**：`scrollWidth=524`、`clientWidth=375`，所有後台頁面皆可水平捲動。
- **預期結果**：`scrollWidth == clientWidth`，無水平溢出，按鈕與表格不超出螢幕。
- **影響範圍**：管理員無法在手機上審核跑步、確認簽到、發券、建立場次；驗收標準 D 明確要求 `/admin/runs` 手機版不可溢出。
- **證據**：截圖 `final-50-cross-m-admin-runs.png`；數據：`/admin` 524×375、`/admin/runs` 524×375、`/admin/checkins` 524×375、`/admin/monthly` 524×375、`/admin/coupons` 524×375、`/admin/sessions` 524×375。
- **定位**：`src/app/admin/layout.tsx` 與各後台 `page.tsx` 的 grid / sidebar / table 寬度未對 375 px 做響應式處理。
- **建議修法**：
  - 後台 layout 在手機版改為單欄，側邊選單改為上方水平滾動或可收合抽屜；
  - 主內容容器使用 `min-w-0` / `overflow-x-auto` 於個別表格卡片；
  - 審核卡片內的「備註輸入框 + 通過 + 駁回」按鈕列改為垂直堆疊或 `flex-wrap`。

---

### P2-1 匿名訪客頁尾仍顯示「我的帳戶」「我的優惠券」連結

- **描述**：未登入時，頁尾「會員」欄位仍列出「我的帳戶」與「我的優惠券」。
- **重現步驟**：
  1. 開啟 https://a1c3aee7df1da69a8.app.workbuddy.host/，不登入。
  2. 捲動至頁尾「會員」區。
- **實際結果**：出現「我的帳戶」「我的優惠券」連結（點擊後會導向 `/login`，但連結本身對訪客不該出現）。
- **預期結果**：依驗收標準 A「無殘留『我的帳戶』類會員入口」，匿名時頁尾「會員」欄僅顯示「註冊會員／會員登入」。
- **影響範圍**：所有匿名訪客都會看到會員專區連結，讓客戶覺得「網站連結混亂」。
- **證據**：截圖 `final-01-home.png`、`final-04-events.png` 等所有匿名頁面頁尾；`final-09-anon-footer-dashboard.png` 顯示點擊後導向登入。
- **定位**：`src/components/Footer.tsx`，會員欄的「我的帳戶」「我的優惠券」連結未包在 `{isLoggedIn && …}` 條件內。
- **建議修法**：將「我的帳戶」「我的優惠券」移至 `{isLoggedIn && (…)}` 區塊；已登入時才顯示。

---

### P2-2 `/events` 底部 CTA 未與首頁同步

- **描述**：首頁已依登入狀態切換 CTA，但 `/events` 底部 CTA 文案與按鈕組合和首頁不一致。
- **重現步驟**：
  1. 未登入開 `/events` → 底部 CTA 為「免費註冊／看看排行榜」。
  2. 登入後開 `/events` → 底部 CTA 為「我的帳戶／看看排行榜」。
- **實際結果**：
  - 匿名：`免費註冊` + `看看排行榜`（缺少「我已有帳號」）。
  - 登入：`我的帳戶` + `看看排行榜`（缺少「上傳跑步紀錄／報名訓練場次」）。
- **預期結果**：依本輪修復說明「`/events` 底部 CTA 也同步改」，應與首頁一致：
  - 匿名：`免費註冊會員` + `我已有帳號`。
  - 登入：`上傳跑步紀錄` + `報名訓練場次`。
- **影響範圍**：`/events` 是主要轉換頁，CTA 不一致會導致訪客與會員行動路徑混亂。
- **證據**：截圖 `final-04-events.png`；原始碼 `src/app/events/page.tsx:121-134`。
- **建議修法**：在 `src/app/events/page.tsx` 底部 CTA 區塊，複用與 `src/app/page.tsx:375-400` 一致的條件與按鈕組合。

---

### P2-3 生產資料庫殘留測試帳號「nokia」，出現在公開排行榜與後台

- **描述**：資料庫存在 `nokiatest@gmail.com` / 顯示名 `nokia` 的會員，並帶有 2 筆 pending 跑步提交（101 km、200 km）與 storage 截圖（漁船照片）。該帳號出現在公開排行榜、後台審核清單、手動發券會員列表。
- **重現步驟**：
  1. 未登入開 `/leaderboard` → 總榜第 5 名為 `nokia 0 積分 0 km`。
  2. 管理員登入 `/admin/runs` → 待確認清單出現 `nokia 101 km`、`nokia 200 km`。
  3. `/admin/coupons` 手動發券會員列表出現 `nokia`。
- **實際結果**：公開榜單與後台管理介面均出現非真實會員的測試帳號。
- **預期結果**：正式交付資料僅應包含真實會員與真實數據。
- **影響範圍**：客戶會認為「網站資料是亂的／還有測試資料」，直接損害信任。
- **證據**：截圖 `final-05-leaderboard.png`、`final-29-admin-runs-pending.png`、`final-34-admin-coupons-before.png`；DB 查詢 `profiles` 顯示 `nokia`。
- **定位**：非程式碼 bug，屬資料清理疏漏。
- **建議修法**：
  - 刪除 `auth.users` / `profiles` 中 email 為 `nokiatest@gmail.com` 的帳號；
  - 連帶刪除其 2 筆 `run_submissions`、`training_checkins`、`coupons` 與 storage 物件；
  - 未來交付前再跑一次 `select * from profiles where email like '%test%'` 確認無殘留。

---

### P3-1 Dashboard / 排行榜出現 signed URL preload warning

- **描述**：Chromium 回報「The resource … was preloaded using link preload but not used within a few seconds from the window's load event」。
- **重現步驟**：登入後開 `/dashboard` 或 `/leaderboard`，開啟 devtools console。
- **實際結果**：出現 2 則 warning。
- **預期結果**：無 warning。
- **影響範圍**：效能提示，不影響功能，但會讓客戶覺得「網站有警告」。
- **證據**：`final-59-verify-dashboard.png` 對應 watch 記錄。
- **定位**：可能為 `<link rel="preload">` 標記了跑步截圖 signed URL，但圖片進入 viewport 時間晚於 load event。
- **建議修法**：改為 `<link rel="prefetch">` 或移除 preload；或將 `<img>` 加上 `fetchpriority="low"` / `loading="lazy"` 並移除對應 preload。

---

## 三、本輪修復複驗

| 修復項目 | 結果 | 說明 |
|----------|------|------|
| ① 首頁 CTA 依登入狀態切換 | **PASS** | 匿名顯示「立即加入會員／查看活動」與底部「免費註冊會員／我已有帳號」；登入顯示「我的帳戶／上傳跑步紀錄」與「繼續把汗水換成積分」+「上傳跑步紀錄／報名訓練場次」 |
| ② 登出功能（桌面 Nav 頭像下拉、手機漢堡選單） | **PASS** | 桌面與手機皆能正常登出，登出後導回首頁、Nav 回復匿名狀態；未再出現 localhost 導向 |
| ③ 後台入口與權限提示 | **PASS** | 匿名點「管理員入口」→ `/login?next=%2Fadmin` 並帶管理員提示；管理員登入後直接進 `/admin`；非管理員進 `/admin` 顯示「權限不足」+「登出」按鈕 |

---

## 四、測試資料清理說明

本輪產生的測試資料已全數清理並驗證還原（透過 Supabase Management API SQL 與會員 A Storage API token）：

| 測試資料 | 處理 |
|----------|------|
| 阿健 8.4 km 跑步提交 | 刪除 `run_submissions` 對應列 |
| 對應積分異動 `跑步里程 8.40 km +8` | 刪除 `point_transactions` |
| 阿健 profile 數字 | `update profiles set points=31, total_km=20.8` |
| 手動發放與殘留測試優惠券 `A3FBE9`、`4B3E28`、`B7DC32` | 刪除 |
| 被核銷的優惠券 `MSW-202609-97D5A1` | `update coupons set status='active'` |
| 2026-12-28「pretest_final 測試場次」 | 刪除 `training_sessions` |
| 8.4 km 截圖 storage 物件 | 透過 Storage API 刪除 |

**清理後基線驗證（DB + UI 雙重核對）**：

- 阿健：31 分／20.8 km／2 張可用券 ✓
- 小玲：505 分／305 km／1 張券 ✓
- 首頁累積里程：325.8 km ✓
- 後台優惠券：3 張 ✓
- `run-screenshots` bucket：6 個物件（4 筆基線 + 2 筆非本輪 nokia 測試圖）✓

截圖：`final-58-verify-home.png`、`final-59-verify-dashboard.png`、`final-60-verify-leaderboard.png`。

---

## 五、測試結論

**本網站目前「不可交付」給終端客戶驗收。**

- **無 P0**：核心商業流程（註冊、登入、上傳、後台審核、發券、核銷、建立場次、排行榜、QR Code）皆可運作；未發現越權、WAF 攔截、localhost 導向或嚴重資料錯誤。
- **存在 P1-1**：後台全部頁面在手機版（375×812）出現水平溢出，管理員無法在行動裝置上使用，違反驗收標準 D 的明確要求。
- **存在 P2**：匿名頁尾殘留會員入口、`/events` CTA 未同步、生產資料夾雜測試帳號，均屬客戶會直接看見的瑕疵，與「唔可以有任何錯失」的要求不符。
- **存在 P3**：Dashboard preload warning 等輕微問題。

**交付條件**：修復 P1-1 並經回歸驗證（特別是 375×812 下 `/admin/runs`、`/admin/checkins`、`/admin/monthly`、`/admin/coupons`、`/admin/sessions` 全部 `scrollWidth == clientWidth`），同時處理 P2-1、P2-2、P2-3 後，方可進入終端驗收。

---

# 線上環境驗證（2026-09-23 第五輪 · P3 修複複驗）

- **目標網址**：https://a1c3aee7df1da69a8.app.workbuddy.host
- **本輪任務**：複驗工程師已修復的 3 項 P3；同時做一回歸煙霧，確認修 P3 沒有打斷主流程。
- **方法**：Playwright（`/usr/bin/chromium`，全新 cookie profile `/root/.codebuddy/artifact/browser-profile-live5*`），部分 API 直測（cookie 與瀏覽器 profile 共享）；Supabase Management API 執行 SQL 清理與基線驗證；Storage API 清理測試截圖。
- **截圖**：`live5-01` ～ `live5-24` 前綴，位於 `screenshots/`。
- **基線數據**（測前，與第四輪一致）：阿健 31 積分／20.8 km／2 張券；小玲 505 積分／305 km／1 張券；首頁全站累積 325.8 km；後台優惠券共 3 張；`run_submissions` 4 筆均為 approved；Storage 4 個物件。

## 逐步結果

| # | 步驟 | 結果 | 截圖 | 說明 |
|---|------|------|------|------|
| 1 | P3-2 `/api/test` 已移除 | **PASS** | `live5-01` | 線上 `GET /api/test`、`POST /api/test`（含 JSON body）、`/api/test/`、`/api/test/x` 皆回 **404** Next.js 404 頁（非 WAF 攔截頁）。漫遊首頁、`/run`、`/training`、`/leaderboard`、`/login`、`/dashboard` 全無對 `/api/test` 的請求。原始碼 `src/app/api/test` 已不存在 |
| 2 | P3-1 匿名 `DELETE /api/runs` | **PASS** | — | 全新匿名 profile 呼叫 `DELETE /api/runs` → **401** `{"ok":false,"error":"請先登入。"}` |
| 3 | P3-1 會員 A 刪除不存在 uuid | **PASS** | — | `DELETE /api/runs` 帶 `00000000-0000-4000-8000-000000000000` → **404** `{"ok":false,"error":"找不到這筆提交，或它不屬於你。"}` |
| 4 | P3-1 會員 A 刪除他人提交（小玲 160 km） | **PASS** | — | `DELETE /api/runs` 帶小玲 run id `51dbbaef-4954-459b-9aa1-3947f3fb43b0` → **404** 同上；事後 DB 查詢該筆仍在，確認未誤刪 |
| 5 | P3-1 會員 A 刪除已審核本人提交（8.3 km） | **PASS** | — | `DELETE` 帶阿健 approved run id `8a2caf72-1106-42d9-9f0b-2568444ba2b9` → **409** `{"ok":false,"error":"已審核的提交無法刪除。"}` |
| 6 | P3-1 會員 A 刪除本人待審核提交（3.3 km） | **PASS** | `live5-06` | `DELETE` 帶阿健 pending run id `d76136f3-f7f6-4322-9059-7a19e093a760` → **200** `{"ok":true,"message":"已刪除該筆提交。"}`；重新載入 `/run` 後 3.3 km 消失，5.5 km 仍保留 |
| 7 | P3-1 其他邊界（缺 id、畸形 uuid） | **PASS** | — | `{}` → **400** `缺少 id。`；`{"id":"not-a-uuid"}` → **404**（優雅回退，無 500） |
| 8 | 回歸：會員 A 登入 Dashboard 基線 | **PASS** | `live5-03` | 登入後 `/dashboard` 顯示積分 **31**、總里程 **20.8 km**、可用優惠券 **2**，與基線一致 |
| 9 | 回歸：`/run` 上傳 5.5 km | **PASS** | `live5-04`、`live5-05` | `fake-run.png`＋5.5 km 成功提交；頁面顯示「已提交 5.5 公里，等待後台確認」，進度卡「待確認 5.5 km」 |
| 10 | 回歸：管理員審核 5.5 km | **PASS** | `live5-14`、`live5-19` 過程截圖 `live5-07`、`live5-08` | 管理員登入 `/admin/runs` 看到阿健 5.5 km 待確認 → 點「通過」→ 待確認清單清空；會員端複核：積分 **31 → 37**、里程 **20.8 → 26.3 km**（`round(5.5) = 6` 分） |
| 11 | P3-3 重複發券二次確認 | **PASS** | `live5-09`（勾選 小玲）、`live5-17b`（dialog 真實截圖）、`live5-16`（準備發放）、`live5-18`（確定後成功）、`live5-19`（後台優惠券 4 張） | ① 取消：勾選已發放的小玲 → 點發放 → `window.confirm` 彈出「以下會員本月已發放過優惠券：**小玲**。\n確定要再發一張嗎？」，點取消後 **無 `POST /api/admin/coupons`**、優惠券仍為 3 張；② 確定：同樣操作點確定 → `POST /api/admin/coupons` 成功，頁面顯示「已發放 1 張優惠券。」，後台優惠券變 4 張，新增券碼 **MSW-202609-99933F** |
| 12 | 回歸：匿名 `/leaderboard` | **PASS** | `live5-02`、`live5-23` | 未登入開 `/leaderboard`：月度榜「小玲 505 積分／305 km」「阿健 31 積分／20.8 km」；總榜列出全部會員含管理員，無匿名會員、無空白 |
| 13 | Console 檢查 | **PASS** | — | 本輪所有真實流程（匿名瀏覽、會員 A 登入／上傳、管理員審核／發券、會員 A 複核）與故意邊界探測，**零 console error、零 pageerror、零 request failed**；全程未出現非預期 403 |
| 14 | 清理後基線還原 | **PASS** | `live5-22`（首頁）、`live5-23`（排行榜）、`live5-24`（會員 A Dashboard） | 刪除測試券 MSW-202609-99933F、刪除 5.5 km 跑步提交、刪除對應 point_transaction、更新阿健 profile 回 31／20.8、以 Storage API 刪除測試截圖；驗證首頁回到 **325.8 km**、排行榜與 Dashboard 數字回到基線 |

### 補充：P3-3 彈窗截圖說明

原生 `window.confirm` 在 headless Chromium 不會被渲染成可見視覺元素，因此 Playwright 內的 `page.screenshot` 無法拍到對話框本身。為取得真實視覺證據，本輪以 **headed Chromium 在 Xvfb 虛擬顯示下執行**，並在 dialog handler 中以 `import -window root` 擷取整個 X display，得到 `live5-17b.png`。該圖清晰顯示瀏覽器原生 confirm 對話框：

> a1c3aee7df1da69a8.app.workbuddy.host says  
> 以下會員本月已發放過優惠券：小玲。  
> 確定要再發一張嗎？  
> Cancel / OK

這證明二次確認彈窗確實出現，且訊息包含會員暱稱「小玲」。

## 測試資料清理說明

本輪產生的測試資料已**全數清理並驗證還原**（透過 Supabase Management API SQL 與擁有者 Storage API）：

| 測試資料 | 處理 |
|---|---|
| 小玲重複測試券 MSW-202609-99933F | `delete from public.coupons where code='MSW-202609-99933F';` |
| 阿健 5.5 km 跑步提交 | `delete from public.run_submissions where id='b834af6e-5851-4a8c-bf25-870b59f81a9f';` |
| 對應積分異動 | `delete from public.point_transactions where ... reason like '跑步里程 5.50 km%';` |
| 阿健 profile 數字 | `update public.profiles set points=31, total_km=20.8 where id='fb8dae8a-b31d-4b3c-a711-99803e677cf7';` |
| 阿健 3.3 km 測試提交（DELETE 成功路徑） | 已由 `DELETE /api/runs` 連同 Storage 物件一併刪除 |
| 5.5 km 截圖物件 | 透過會員 A session token 呼叫 Storage API 刪除 `fb8dae8a-b31d-4b3c-a711-99803e677cf7/1790144569565-m7358k.png` |

清理後雙重核對（SQL ＋ 線上 UI）：`profiles` 阿健 31／20.8、小玲 505／305；`coupons` 3 張；`run_submissions` 4 筆（無測試紀錄）；`point_transactions` 無 5.5 km 紀錄；Storage 4 個物件；首頁 325.8 km；排行榜與 Dashboard 均回到基線。

## 本輪缺陷清單

**無 P0／P1／P2／P3 新缺陷。**

## 修復確認

- **P3-1 修復確認**：`src/app/api/runs/route.ts` 的 `DELETE` 已改為先 `select` 驗證登入／所有權／`status='pending'`；不存在或不屬於本人 → 404；已審核 → 409；本人待審核 → 200。三種強制情境（匿名 401、不存在 404、他人提交 404）全部通過。
- **P3-2 修復確認**：`src/app/api/test` 目錄已刪除；線上所有 method 皆 404；全站頁面無 `/api/test` 請求。
- **P3-3 修復確認**：`src/app/admin/monthly/MonthlyIssueForm.tsx` 在送出前檢查勾選名單中 `has_coupon=true` 的會員，以 `window.confirm` 彈窗（含會員暱稱）進行二次確認；取消時不發送 `POST /api/admin/coupons`、不產生新券；確定時正常發放。

## 第五輪結論

**網站處於可交付狀態。** 本輪聚焦回歸，確認三項 P3 均已修復且未引入任何新問題：主流程（會員上傳 → 管理員審核 → 積分里程入帳）運作正常，匿名排行榜顯示真實暱稱與積分，Console 全程乾淨，測試資料已清理並驗證基線還原。

---

# 缺陷修複複驗（2026-09-23）

- **目標網址**：https://a1c3aee7df1da69a8.app.workbuddy.host（工程師修復後重新 build + 重新發布之版本）
- **本輪任務**：對上一輪「終端交付總體檢」判定之 P1-1、P2-1、P2-2、P2-3、P3-1 逐項複驗，並做全站回歸。
- **測試帳號**：管理員 mswmacau2026@gmail.com、會員 A（阿健）runner1@msw.test、會員 B（小玲）runner2@msw.test（本輪僅用 B 的 token 核對 Storage 基線，未操作會員 B 流程）
- **方法**：Playwright + `/usr/bin/chromium`（headless），每角色／每 viewport 使用全新 cookie profile（`/root/.codebuddy/artifact/browser-profile-fix-*`），全程攔截 console error／console warning／pageerror／HTTP ≥ 400／request failed；DB 與 Storage 經 Supabase Management API SQL 通道核對與清理。
- **截圖**：`/workspace/msw-street-workout/screenshots/`，前綴 `fix-fx01` ～ `fix-fx10`（共 54 張；同目錄另有前輪 `fix-01`～`fix-23` 舊檔，非本輪產出）。
- **測前基線（DB 實測）**：會員 4 人（MSW 管理員／阿健 31 分 20.8 km／小玲 505 分 305 km／阿明）；`nokia` 帳號已不存在；`run_submissions` 4 筆皆 approved；優惠券 3 張 active；訓練場次 9 場。

---

## 一、逐項複驗結果表

| # | 項目 | 結果 | 實測數據 | 截圖 |
|---|------|------|----------|------|
| 1 | **P1-1** 後台手機版水平溢出（375×812） | **PASS** | 6 頁全部 `scrollWidth == clientWidth == 375`：`/admin` 375×375、`/admin/runs` 375×375、`/admin/checkins` 375×375、`/admin/monthly` 375×375、`/admin/coupons` 375×375、`/admin/sessions` 375×375；`document.body.scrollWidth` 亦皆為 375。`<aside>` 實測 `min-width: 0px`、寬 335px、右緣 355px（未超出）；側欄 `<nav class="flex gap-2 overflow-x-auto …">` 實測 `scrollWidth=728 / clientWidth=309 / overflow-x=auto`，即 AdminNav 在手機版改為卡片內橫向捲動，且為唯一横向可捲動元素——溢出被收斂在側欄內部，不再撐開整頁。逐頁 viewport 截圖目測：主內容、統計卡、表格、按鈕均未超出螢幕 | `fix-fx03-admin-vp.png`、`fix-fx03-admin-runs-vp.png`、`fix-fx03-admin-checkins-vp.png`、`fix-fx03-admin-monthly-vp.png`、`fix-fx03-admin-coupons-vp.png`、`fix-fx03-admin-sessions-vp.png`（另有整頁版 `fix-fx03-*.png`） |
| 1b | 手機版公開頁面未被改壞（375×812） | **PASS** | `/` 375×375、`/run` 375×375、`/dashboard`（會員）375×375、`/training` 375×375、`/leaderboard` 375×375、`/events` 375×375；匿名訪問 `/dashboard` 正常導向 `/login`。`/training` 的表格使用 `min-w-[520px]` + 外層橫向捲動容器，屬卡片內捲動，頁面本身無溢出 | `fix-fx02-home.png`、`fix-fx02-run.png`、`fix-fx02-dashboard.png`、`fix-fx02-training.png`、`fix-fx02-leaderboard.png`、`fix-fx02-events.png`；會員版 `fix-fx06-*.png` |
| 2 | **P2-1** 匿名頁尾「我的帳戶／我的優惠券」 | **PASS** | 匿名頁尾「會員」欄實測僅剩「註冊會員／會員登入」（桌面與手機各驗一次）；會員（阿健）登入後頁尾顯示「我的帳戶／我的優惠券」；管理員登入後再加顯示「後台管理」 | `fix-fx01-footer.png`、`fix-fx02-footer.png`、`fix-fx04-02-home-footer.png`（會員頁尾可見於 `fix-fx04-03-events-cta-member.png` 底部） |
| 3 | **P2-2** `/events` 底部 CTA | **PASS** | 匿名：CTA 區塊為「現在就開始累積」＋「免費註冊會員」「我已有帳號」；已登入（阿健）：同區塊為「上傳跑步紀錄」「報名訓練場次」，與首頁完全同步 | `fix-fx01-events-cta.png`、`fix-fx02-events-cta.png`（匿名）；`fix-fx04-03-events-cta-member.png`（會員） |
| 4 | **P2-3** 殘留測試帳號 nokia | **PASS** | DB `profiles` 僅 4 筆：MSW 管理員、阿健、小玲、阿明（無 `nokia`）；匿名 `/leaderboard` 總榜僅列出小玲 505／305、阿健 31／20.8、阿明 0／0、MSW 管理員 0／0，頁面全文不含 "nokia"；管理員 `/admin/runs` 與 `/admin/coupons` 會員清單（MSW 管理員／阿健／小玲／阿明）皆無 nokia；`run_submissions` 僅剩 4 筆基線 approved，nokia 的 2 筆 pending 已不存在 | `fix-fx01-leaderboard.png`、`fix-fx02-leaderboard.png`、`fix-fx07-02-runs-pending.png`、`fix-fx03-admin-coupons-vp.png` |
| 5 | **P3-1** signed URL preload warning | **PASS** | 本輪 10 個瀏覽 session（匿名桌面／匿名手機／會員桌面×3／會員手機／管理員桌面×2／管理員手機／基線覆核）全程 **console warning = 0**。特別針對原重現路徑：會員登入後 `/dashboard` 停留 8 秒、`/leaderboard` 停留 8 秒，均未再出現「preloaded using link preload but not used」警告；Dashboard 跑步截圖 signed URL 圖片實測正常載入（`naturalWidth=640、naturalHeight=900`） | `fix-fx09-01-dashboard-after-approve.png`、`fix-fx09-02-leaderboard-member.png` |

## 二、全站回歸結果

| # | 流程 | 結果 | 實測數據 | 截圖 |
|---|------|------|----------|------|
| 1 | 匿名 7 頁 | **PASS** | `/`、`/training`、`/run`、`/events`、`/leaderboard`、`/login`、`/signup` 全部正常渲染、無水平溢出、console error = 0 | `fix-fx01-*.png` |
| 2 | 會員 A 登入 → `/` 會員版 CTA | **PASS** | 登入成功；Hero/底部 CTA 為會員版（「我的帳戶／上傳跑步紀錄」＋「上傳跑步紀錄／報名訓練場次」） | `fix-fx04-02-home-footer.png` |
| 3 | 會員 A `/dashboard` 基線 | **PASS** | 積分 31、總里程 20.8 km、可用優惠券 2（與基線一致） | `fix-fx04-01-dashboard.png` |
| 4 | 會員 A `/dashboard/coupons` QR | **PASS** | 2 張券 QR 皆為 data:image PNG，`naturalWidth=300 / naturalHeight=300` | `fix-fx04-04-coupons.png` |
| 5 | 會員 A `/training` 報名／取消 | **PASS** | 點「報名這一場」→ 狀態變「已報名」；點「取消報名」→ 恢復「報名這一場」；DB 事後核對 `training_checkins` 無殘留列 | `fix-fx04-05`～`fix-fx04-07` |
| 6 | 會員 A `/run` 上傳 7.7 km | **PASS** | `fake-run.png` + 7.7 km 提交成功，訊息「已提交 7.7 公里，等待後台確認…」，進度卡顯示待確認 7.7 km | `fix-fx04-08`、`fix-fx04-09-run-submitted.png` |
| 7 | 會員 A 登出（桌面＋手機） | **PASS** | 桌面：頭像下拉 →「登出」→ 導回首頁，Nav 恢復「會員登入／立即加入」；手機 375：漢堡選單 →「登出」→ 導回首頁，Nav 恢復「立即加入」 | `fix-fx05-01-dropdown.png`、`fix-fx05-02-after-logout.png`、`fix-fx06b-01-hamburger-open.png`、`fix-fx06b-02-after-logout.png` |
| 8 | 管理員登入 → `/admin` | **PASS** | 經 `/login?next=%2Fadmin` 登入後進入後台總覽；待審核跑步提交 = 1；已登入狀態再訪 `/login` 會自動導向 `/admin`（無異常） | `fix-fx07-01-admin-overview.png` |
| 9 | 管理員 `/admin/runs` 審核 7.7 km | **PASS** | 待確認清單顯示阿健 7.7 km → 點「通過」→ 移出待確認；會員端複核：積分 31→**39**（round(7.7)=8 分）、里程 20.8→**28.5 km**、待確認標記消失 | `fix-fx07-02-runs-pending.png`、`fix-fx07-03-runs-after-approve.png`、`fix-fx09-01-dashboard-after-approve.png` |
| 10 | 管理員 `/admin/coupons` 手動發券＋核銷 | **PASS** | 勾選阿健 →「發券給 1 位會員」→ 優惠券 3→4 張，新券碼 `MSW-202609-5023FF`（DB 同步確認 status=active）；輸入券碼核銷 → 訊息「MSW-202609-5023FF 已核銷。」，DB status=used、redeemed_at 已寫入；會員端「已使用」區塊出現該券，3 張 QR naturalWidth 皆 300 | `fix-fx07-04-coupon-issued.png`、`fix-fx08b-01-coupon-redeemed.png`、`fix-fx09-03-coupons-after.png` |
| 11 | 管理員 `/admin/sessions` 建場次 | **PASS** | 建立 2026-11-23「pretest_fix 複驗場次」（澳門街健館，30 人，20:00–21:00）→ 列表出現該列，「已排定場次」9→10 | `fix-fx08b-02-session-form.png`、`fix-fx08b-03-session-created.png` |
| 12 | 管理員手機版巡後台＋登出 | **PASS** | 375×812 下 6 個後台頁面逐一開啟量測（見項目 1）皆無溢出；桌面點頭像 →「登出」→ 導回首頁 | `fix-fx03-*.png`、`fix-fx07-08-admin-after-logout.png` |
| 13 | Console／網路全程監控 | **PASS** | 本輪全部 session 合計：console error = 0、console warning = 0、pageerror = 0、HTTP ≥ 400 = 0、非預期 request failed = 0。備註：`?_rsc=` 路由預取在頁面切換時被瀏覽器主動取消（ERR_ABORTED）屬 Next.js 正常行為，不計入；fx04 曾出現 2 筆 signed URL 圖片請求因腳本立即切頁被中止，fx05 專項覆核停留在頁面上時圖片全部載入成功（naturalWidth=640） | 各 `log_fx*.txt`（`/root/.codebuddy/artifact/`） |

## 三、殘留缺陷清單

**無。P1-1／P2-1／P2-2／P2-3／P3-1 全數修復確認。**

- 無 P0／P1／P2 殘留。
- 無新增 P3。
- 上輪已存在的非阻斷觀察項（首頁 emoji 圖示在部分環境顯示為豆腐方塊等）不在本輪修復範圍，維持原狀，不影響交付判定。

## 四、測試資料清理說明

本輪產生的測試資料已**全數清理並經 DB＋UI＋Storage 三方核對還原**（Supabase Management API SQL ＋ 會員 A Storage API）：

| 測試資料 | 處理 | 核對結果 |
|----------|------|----------|
| 阿健 7.7 km 跑步提交（`e1a079b5-…`，審核後為 approved） | `delete from run_submissions where id='e1a079b5-600b-436c-82c0-520aeb41b90f'` | `run_submissions` 回到 4 筆基線 |
| 對應積分異動「跑步里程 7.70 km（2026-09）+8」（`7b516e70-…`） | `delete from point_transactions …` | 7.70 km 異動計數 = 0 |
| 阿健 profile 數字（審核後 39／28.5） | `update profiles set points=31, total_km=20.8 …` | 31／20.80 ✓ |
| 手動發放測試券 `MSW-202609-5023FF`（已核銷） | `delete from coupons where code='MSW-202609-5023FF'` | 優惠券回到 3 張 active（6572D6／97D5A1／2A0230） |
| 測試場次 2026-11-23「pretest_fix 複驗場次」 | `delete from training_sessions where session_date='2026-11-23' and title='pretest_fix 複驗場次'` | 場次回到 9 場，首頁「已開訓練場次 9 場」 |
| 7.7 km 截圖 storage 物件 `fb8dae8a-…/1790162000653-q8vw7l.png` | Storage API DELETE（會員 A token） | HTTP 200；bucket 僅剩基線 4 物（阿健 2＋小玲 2，與 DB `image_path` 一一對應） |
| `/training` 報名／取消操作 | 取消報名由系統刪除簽到列 | `training_checkins` 無本輪殘留 |

**清理後基線驗證（UI 實測）**：首頁累積里程 **325.8 km**、會員 **4 人**、已開訓練場次 **9 場**；會員 A Dashboard 積分 **31**、總里程 **20.8 km**、可用優惠券 **2**。截圖 `fix-fx10-01-home-baseline.png`、`fix-fx10-02-memberA-dashboard-baseline.png`。

## 五、測試結論

| 層面 | 用例數 | 通過 | 失敗 |
|------|--------|------|------|
| 修復項複驗 | 5 | 5 | 0 |
| 功能回歸 | 13 | 13 | 0 |
| 邊界／權限（本輪未新增案例，沿用上輪已驗證結論） | — | — | — |

**明確結論：可以交付。本網站現在可以交給終端客戶驗收。**

理由：

1. 上一輪判定「不可交付」的唯一 P1（P1-1 後台手機版全面水平溢出）已修復並實測確認：375×812 下 6 個後台頁面 `scrollWidth == clientWidth == 375`，側欄導航改為卡片內橫向捲動，主內容、表格與按鈕皆不超出螢幕；同時手機版 6 個公開／會員頁面未被此次改動弄壞。
2. 三項 P2（匿名頁尾會員入口、`/events` CTA 不同步、nokia 測試帳號殘留）全部複驗通過，兩種身分（匿名／會員）與管理員頁尾各自的顯示規則均正確；公開榜單與後台清單已無任何測試帳號。
3. P3-1 preload warning 已不再出現（10 個 session、含 dashboard/leaderboard 各 8 秒停留觀察，console warning = 0）。
4. 全站回歸 13 項全數通過：修復未打斷任何既有功能；核心商業流程（登入、上傳 7.7 km、審核入帳 31→39 分／20.8→28.5 km、發券、核銷、建場次、QR 生成、桌面與手機登出）實測正常。
5. 全程零 console error、零 pageerror、零 HTTP ≥ 400；測試資料已全數清理，資料基線與交付前一致（325.8 km／4 會員／9 場次／3 張優惠券）。

本輪測試方法限制聲明：本輪以全新 cookie profile 走正常 UI 流程為主，未重複上輪已通過的 API 邊界／越權直測案例（該部分以上輪第四、五輪結論為準）；所有結論均基於線上實際操作與量測，非僅閱讀程式碼。
