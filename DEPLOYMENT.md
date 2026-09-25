# MSW 街健館 — 正式上線交付文件

> **文件版本**：v1.0
> **撰寫日期**：2026-09-23
> **適用對象**：MSW 街健館（澳門街頭健身社群）營運負責人
> **撰寫**：部署工程師
> **狀態**：網站已通過 QA 四輪驗證（14 項必測全 PASS，零 P0／P1／P2），可進入上線程序

---

## 目錄

- [零、開始前必讀](#零開始前必讀)
- [一、三種上線路徑比較與推薦](#一三種上線路徑比較與推薦)
- [二、完整部署步驟（推薦方案：Vercel）](#二完整部署步驟推薦方案vercel)
- [三、方案二：自有 VPS（PM2／Docker）](#三方案二自有-vpspm2docker)
- [四、方案三：騰訊雲／阿里雲等國內平台](#四方案三騰訊雲阿里雲等國內平台)
- [五、環境變數清單](#五環境變數清單)
- [六、上線檢查清單（Go-live Checklist）](#六上線檢查清單go-live-checklist)
- [七、回滾預案](#七回滾預案)
- [八、日常維運手冊](#八日常維運手冊)
- [九、常見問題排查](#九常見問題排查)
- [十、已知殘留問題與後續建議](#十已知殘留問題與後續建議)

---

## 零、開始前必讀

### 0.1 系統全貌（你要顧的是三個東西）

```
┌─────────────────┐        ┌──────────────────────┐        ┌─────────────────────┐
│  會員的瀏覽器    │ HTTPS  │  前端（Next.js 16）    │ HTTPS  │  Supabase            │
│  澳門 / 手機為主 │ ─────► │  Vercel 或自有 VPS     │ ─────► │  Auth + Postgres     │
│                 │        │  無狀態、可重啟        │        │  + Storage（截圖）   │
└─────────────────┘        └──────────────────────┘        └─────────────────────┘
                                    │                                  │
                                    └── 三個環境變數串起來 ─────────────┘
```

- **前端**：純 Next.js，沒有自己的資料庫，重啟、重部署都不會掉資料。
- **Supabase**：所有會員、積分、里程、優惠券、截圖都在這裡。**要備份的是它**。
- **兩邊透過三個環境變數連接**（見第五章）。

### 0.2 本文件的佔位符約定

為避免機密外洩，本文件一律使用佔位符。請自行替換，**不要**把真實值貼回本文件：

| 佔位符 | 代表什麼 |
| --- | --- |
| `<你的 Supabase Project URL>` | 形如 `https://xxxxxxxxxxxx.supabase.co` |
| `<你的 Supabase anon key>` | 一長串 `eyJhbGciOi...` 開頭的公開金鑰 |
| `<你的正式網址>` | 例如 `https://www.mswmacau.com`（**不含**結尾斜線） |
| `<PROJECT_REF>` | Supabase 專案 ID（URL 裡 `https://` 後面那段） |
| `<DB_PASSWORD>` | 建立 Supabase 專案時設的資料庫密碼 |
| `<SSH_HOST>` | 自有 VPS 的 IP 或網域 |

### 0.3 交付現況（重要）

| 項目 | 狀態 |
| --- | --- |
| 程式碼 | 完成，位於交付目錄，`pnpm build` 已實測通過 |
| QA | 六輪完成，最後一輪 13 項回歸全 PASS，無殘留缺陷 |
| **正式線上網址（Vercel）** | **`https://msw-street-workout.vercel.app`** ← 對外請用這個 |
| Vercel 專案 | `msw-street-workout`（獨立專案，不影響你原有的 `msw2026`） |
| 備用網址（沙箱） | `https://a1c3aee7df1da69a8.app.workbuddy.host` — 僅內部看版用，隨時可能下線，**不要對外宣傳** |
| 你要做的事 | 可選：綁定自己的網域（見 §2.10）；或改用你自己的 Supabase 專案完全自主（見 §1） |

### 0.3.1 目前 Vercel 環境的環境變數（已設定完成）

| 變數 | 值 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | （已存在 Vercel 專案設定中，加密保存） |
| `NEXT_PUBLIC_SITE_URL` | `https://msw-street-workout.vercel.app` |

> 若日後綁定自有網域，記得把 `NEXT_PUBLIC_SITE_URL` 改成新網域，**並重新部署**（`NEXT_PUBLIC_*` 是建置階段寫進前端的，改值不重新部署不會生效）。

### 0.4 技術版本（環境要對得上，否則 build 會失敗）

| 項目 | 版本 / 要求 |
| --- | --- |
| Next.js | 16.3.6（App Router + Turbopack） |
| React | 19.2.8 |
| Node.js | **≥ 20.9.0**，建議 22 LTS（實測 22.13.1 通過） |
| 套件管理器 | pnpm 10.28.2 |
| 資料庫 | Supabase Postgres（建議 region `ap-southeast-1` 新加坡，離澳門最近） |

---

## 一、三種上線路徑比較與推薦

### 1.1 快速比較總表

| | **① Vercel**（推薦） | **② 自有 VPS + PM2/Docker** | **③ 騰訊雲 / 阿里雲等國內平台** |
| --- | --- | --- | --- |
| 一句話 | 程式碼推上 GitHub，其餘平台幫你做 | 自己租一台主機，自己顧 | 用國內大廠的托管服務 |
| 部署難度 | ★☆☆ 最低（約 30 分鐘） | ★★★ 需 Linux 基礎 | ★★☆ 介面中文，但設定瑣碎 |
| 日常維運 | 幾乎為零（自動 HTTPS、自動擴容） | 要自己打安全性更新、續 SSL 憑證、看磁碟 | 半托管，仍需自己管容器 |
| HTTPS 憑證 | 自動核發、自動續期 | 需自己裝 Certbot 並設自動續期 | 平台提供（部分需付費） |
| 澳門／香港連線速度 | 佳（邊緣節點，含香港） | 看你租哪裡（香港 VPS 最佳） | 中國大陸節點最快，但**澳門連線不一定比香港快** |
| ICP 備案 | **不需要** | **不需要**（選香港／新加坡／澳門機房） | 用中國大陸節點**必須備案**（門檻最高） |
| 大致成本 | Hobby 方案免費（非商業用途）；Pro 約 US$20／月／人 | 香港 VPS 約 HK$100–300／月 | 輕量應用伺服器約 RMB 100–300／月 |
| 資料庫 | 另用 Supabase（免費額度或 Pro 約 US$25／月） | 同上 | 同上（或改用國內 Postgres，但程式碼要改） |
| 付款方式 | 需國際信用卡（Visa / Mastercard） | 視供應商，多數可用信用卡／轉帳 | 人民幣、支付寶、微信，澳門用戶亦可 |
| 客服語言 | 英文為主，文件與社群資源極豐富 | 供應商而异 | **中文客服**（優勢） |
| 適用情境 | 沒有專職 IT、想專心辦活動 | 有 IT 人員／想完全掌控資料 | 會員主要在中國大陸、或堅持中文客服與國內付款 |

### 1.2 各方案詳評

#### ① Vercel

**優點**
- Next.js 的原生平台，本專案用的是 Next.js 16，相容性零風險，不用寫任何設定檔。
- 推 GitHub 就自動部署，回滾是「點一下」（見第七章）。
- 免費 HTTPS、全球 CDN、澳門與香港連線延遲低。
- 不需要 ICP 備案，網域在哪裡註冊都可以。

**缺點**
- Hobby（免費）方案條款上僅限非商業／個人用途；社群網站若有商業營利行為，應升級 Pro。
- 客服與介面是英文。
- 若日後有大量會員從中國大陸訪問，連線品質可能不穩（這是中國大陸網路的普遍現象，不是本網站的問題）。

#### ② 自有 VPS（香港／新加坡）+ PM2 或 Docker

**優點**
- 完全掌控，資料與主機都在自己手上。
- 香港 VPS 對澳門連線速度極佳（< 20ms）。
- 成本固定、可預測。

**缺點**
- 所有維運自己扛：系統更新、防火牆、SSL 續期、磁碟滿了、主機掛了要自己救。
- 沒有自動擴容，流量突然暴增（例如活動宣傳）會撐不住。
- 需要有 Linux 指令基礎，或固定請人維護。

#### ③ 騰訊雲／阿里雲等國內平台

**優點**
- 中文介面與中文客服，溝通零障礙；可用人民幣／本地支付方式付款。
- 若會員主要在中國大陸，訪問速度最好。
- 生態完整（可順便買網域、CDN、WAF）。

**缺點**
- **使用中國大陸節點必須完成 ICP 備案**（個人或企業），對澳門社團而言是實質門檻。
- 調教成本高：容器、環境變數、CDN、HTTPS 都要自己串。
- 部署流程較不標準化，日後換人維護較困難。
- 若選其香港節點，則可免備案，但就失去「國內速度」的優勢。

### 1.3 ★ 我的推薦：方案 ① Vercel ＋ Supabase

**理由（針對你的情況：澳門、流量小、無專職 IT、需要長期穩定營運）**：

1. **澳門用戶最在意的是「不要有備案麻煩」**——Vercel＋自有網域完全不需要 ICP 備案，今天買網域、今天就能上線。
2. **流量小**——社群網站平日幾十人到幾百人，Vercel 的免費／Pro 額度綽綽有餘，成本遠低於養一台 VPS。
3. **沒有 IT 人力**——Vercel 把 HTTPS、CDN、自動擴容、零停機部署全部做掉，你只需要專心辦訓練活動和審核資料。
4. **回滾最容易**——出問題點一下就退回上一版，這是本專案交付時我最重視的一點（見第七章）。
5. 關於「中文客服／付款便利性」：Vercel 與 Supabase 確實是英文介面，但**本文件已把每一步寫成可照抄的指令**，日常九成以上的操作（審核、發券、排訓練）都在網站後台用中文介面完成，**不需要去看平台介面**。付款只需一張國際信用卡，澳門發行的 Visa／Mastercard 都能用。

**配套建議**：
- **網域**：建議自行購買（GoDaddy、Namecheap、或澳門本地註冊商皆可），例如 `mswmacau.com`／`.mo`。買好後在 Vercel 後台加網域、照指示設 DNS 即可。
- **Supabase**：正式營運**建議升級 Pro 方案**。原因很實際——免費方案在專案連續 7 天沒有活動時會**自動暫停**，且**不提供每日自動備份**。社群網站需要可靠備份，這筆錢不能省。（實際價格與額度請以 Supabase 官網公告為準。）
- **若日後會員大量來自中國大陸**：再評估搬到騰訊雲香港節點（免備案、中文客服、大陸連線品質較好）。

---

## 二、完整部署步驟（推薦方案：Vercel）

> 全程約 40–60 分鐘（不含網域 DNS 生效時間，DNS 可能要等 10 分鐘到數小時）。
> 標示 **[需人工確認]** 的步驟請看清楚再執行，特別是任何刪除動作。

### 2.1 前置準備

```bash
# 1) 確認 Node 版本 ≥ 20.9.0（建議 22 LTS）
node -v

# 2) 啟用 pnpm（Node 22 內建 corepack）
corepack enable
pnpm -v      # 應顯示 10.x

# 3) 安裝依賴並確認可以正常建置
cd /path/to/msw-street-workout
pnpm install --frozen-lockfile
pnpm build
```

看到路由清單（`/`、`/run`、`/admin`、`/api/...`）且最後出現 `Proxy (Middleware)` 即代表建置成功。

**[需人工確認] 上線前請刪除測試腳本 `seed.mjs`**

`seed.mjs` 是開發期用來建立測試會員的一次性腳本，**內含測試帳號密碼與 Supabase 專案網址**，正式交付環境不應保留：

```bash
rm -f /path/to/msw-street-workout/seed.mjs
```

### 2.2 建立 Supabase 專案

1. 到 [https://supabase.com](https://supabase.com) 註冊／登入（可用 GitHub 帳號快速註冊）。
2. 點 **New project**：
   - **Name**：`msw-street-workout`
   - **Database Password**：自訂一組強密碼，**請另外存好**（第五章的 `<DB_PASSWORD>` 就是它，日後備份與還原要用）。
   - **Region**：選 **Southeast Asia (Singapore) — `ap-southeast-1`**（離澳門最近的節點）。
3. 等待約 2 分鐘專案建立完成。

### 2.3 執行資料庫初始化腳本

1. 左側選 **SQL Editor** → **New query**。
2. 打開 `supabase/schema.sql`，**全選、複製、整段貼進去**。
3. 點 **Run**，看到 `Success. No rows returned` 即完成。

這一支腳本會建立：

| 類別 | 內容 |
| --- | --- |
| 資料表 | `profiles`（會員）、`training_sessions`（訓練場次）、`training_checkins`（簽到）、`run_submissions`（跑步提交）、`coupons`（優惠券）、`point_transactions`（積分明細）、`app_settings`（後台可調規則） |
| 檢視表 | `monthly_running_stats`、`public_leaderboard`（公開排行榜）、`site_stats`（首頁數字） |
| 觸發器 | 註冊自動建立 profile；防止會員自行竄改 `role`／`points`／`total_km` |
| 資料庫函式 | 8 個業務函式（`add_points`、`gen_coupon_code`、`award_monthly_if_qualified`、`review_run_submission`、`review_checkin`、`issue_coupons`、`redeem_coupon`、`monthly_qualified_list`）+ 4 個輔助函式（`is_admin`、`handle_new_user`、`guard_profile_sensitive_fields`、`setting_num`），共 12 個 |
| RLS 政策 | 全部資料表啟用列級安全，會員只能讀寫自己的資料 |
| Storage | 建立私有 bucket `run-screenshots` 及其存取政策 |
| 種子資料 | 自動產生「本週起往後 8 週、每週一 20:00–21:00」的訓練場次 |

> **這支腳本可以重複執行**（已加 `if not exists` / `drop policy if exists`）。日後若不確定有沒有跑完整，再貼一次 Run 一次即可，**不會**蓋掉現有會員資料。

### 2.4 設定 Authentication（登入／註冊）

1. Supabase 左側 **Authentication** → **URL Configuration**：
   - **Site URL**：填 `<你的正式網址>`（例如 `https://www.mswmacau.com`，**不要**結尾斜線）。
     - 若還沒買網域，先填 Vercel 給的網址（形如 `https://msw-street-workout.vercel.app`），買了網域之後再回來改。
   - **Redirect URLs**：新增這一行（電郵驗證連結要靠它導回）：
     ```
     <你的正式網址>/auth/callback
     ```
     > 建議同時把 `http://localhost:3000/auth/callback` 也加進去，方便日後本機測試。
2. **Authentication** → **Sign In / Providers** → **Email**：
   - **Confirm email**：
     - **關閉**（`mailer_autoconfirm`）：會員註冊後**立刻可以登入**，不用收信。優點是不會有「收不到信」的客訴；缺點是任何人都能用任意電郵註冊（含假信箱）。
     - **開啟**：註冊後須點信箱連結才能登入，會員資料較真實。
   - **建議**：社群規模小、以現場招募為主 → **先關閉**，省去大量客服麻煩；日後會員變多再開啟。若要開啟，請務必先完成 2.6 節的 SMTP 設定，否則會員完全收不到信。
   - 其他：確認 **Allow new users to sign up** 為開啟狀態。

### 2.5 確認 Storage bucket

1. 左側 **Storage**，應看到 bucket **`run-screenshots`**。
2. 點進去 → **Policies**，應看到三條政策：`runshots_insert_own`、`runshots_select`、`runshots_delete_own`。
3. 若 bucket 不存在（例如腳本執行到一半失敗），可手動建立：**Storage → New bucket**，名稱填 `run-screenshots`，**Public bucket 取消勾選**（必須是私有），然後回 2.3 重跑一次 `schema.sql` 補上政策。

> 免費方案 Storage 容量約 1GB。一張截圖約 0.3–2MB，約可放 500–3000 張。建議每季清理已審核且超過半年的舊截圖（見 8.5）。

### 2.6（選用）設定 SMTP 自訂寄件服務

只有在 2.4 選擇「開啟電郵驗證」時才需要。Supabase 內建寄件服務有每小時寄送上限且容易被當成垃圾郵件。

1. 準備一個寄件信箱（建議用 Gmail 或企業信箱，開啟「應用程式密碼」）。
2. Supabase → **Project Settings** → **Authentication** → **SMTP Settings**，填入 SMTP 主機、埠、帳號、密碼（**這些值請只存在 Supabase 後台，不要寫進任何交付文件**）。
3. 寄完測試信確認可收到再對外開放註冊。

### 2.7 把第一位管理員帳號設為 admin

`schema.sql` 最末尾（第 12 節）有這段**被註解掉的 SQL**，用途就是把某個已註冊的帳號升級為管理員：

```sql
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'mswmacau2026@gmail.com');
```

**用法（三步）**：

1. 先用一般流程在網站上註冊一個屬於你自己的會員帳號（例如 `admin@mswmacau.com`）。
2. 回到 Supabase → **SQL Editor** → **New query**，貼上以下指令，**把 email 換成你剛註冊的那個**：

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'admin@mswmacau.com');
```

3. 點 **Run**，然後執行這段確認有成功（應回傳一列，`role` 為 `admin`）：

```sql
select id, display_name, role from public.profiles where role = 'admin';
```

4. **回網站「登出再重新登入」**，導覽列才會出現「後台管理」入口。

> **常見失誤**：改完 SQL 沒登出重登，一直以為沒生效。請務必登出 → 登入。
> **第二位管理員**：重複上面步驟即可（把 email 換成對方註冊的帳號）。
> **降級為一般會員**：把 `'admin'` 改成 `'member'` 執行一次。

### 2.8 把程式碼推上 GitHub

Vercel 是透過 GitHub 抓程式碼的，所以要先建立一個 repository。

```bash
cd /path/to/msw-street-workout

# 初始化（本專案目前還不是 git repository）
git init
git add .
git commit -m "MSW 街健館 — 正式上線版本"

# 在 GitHub 建立一個新的 Private repository，然後：
git remote add origin https://github.com/<你的帳號>/msw-street-workout.git
git branch -M main
git push -u origin main
```

**[需人工確認] 上推送前請再三確認以下檔案「沒有」被推上去**：

```bash
git status --short | grep -E "\.env"     # 不應出現 .env.local
ls seed.mjs 2>/dev/null                  # 不應存在（已在 2.1 刪除）
```

本專案的 `.gitignore` 已包含 `.env*`，`.env.local` 預設不會被推送，**這是正確且必要的安全設計**——金鑰要在 Vercel 後台另外填（2.9 節）。建議 repository 設為 **Private**。

### 2.9 在 Vercel 建立專案並設定環境變數

1. 到 [https://vercel.com](https://vercel.com)，用 GitHub 帳號登入。
2. **Add New → Project**，匯入剛剛的 `msw-street-workout` repository。
3. **Framework Preset** 會自動偵測為 Next.js，**不要改**任何 Build Command 與 Output Directory（預設 `next build`／`.next` 就對）。
4. 展開 **Environment Variables**，新增三筆（**三個環境都勾選**：Production / Preview / Development）：

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `<你的 Supabase Project URL>` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<你的 Supabase anon key>` |
| `NEXT_PUBLIC_SITE_URL` | `<你的正式網址>`（先填 Vercel 網址，綁網域後再改） |

   > 取得位置：Supabase → **Project Settings** → **API** → 複製 **Project URL** 與 **Project API keys → anon public**。
5. 點 **Deploy**，等約 1–3 分鐘。
6. 部署完成後會得到一個網址（形如 `https://msw-street-workout.vercel.app`）。

> **重要**：環境變數改動後，必須 **Redeploy** 才會生效（因為 `NEXT_PUBLIC_*` 在建置階段就被寫入前端 bundle）。

### 2.10 綁定自有網域

1. Vercel 專案 → **Settings** → **Domains** → 輸入你的網域（例如 `www.mswmacau.com`）→ **Add**。
2. Vercel 會顯示要設定的 DNS 紀錄，到你的網域註冊商後台照著加：
   - `www` → **CNAME** 指向 `cname.vercel-dns.com`
   - 根網域（`mswmacau.com`）→ **A** 指向 Vercel 提供的 IP（或用註冊商的 URL Redirect 把根網域導到 `www`）
3. 等 DNS 生效（10 分鐘～數小時），Vercel 會自動核發 HTTPS 憑證。
4. **網域生效後，回頭改兩個地方**：
   - Vercel → **Settings → Environment Variables** → 把 `NEXT_PUBLIC_SITE_URL` 改成 `https://www.mswmacau.com` → **Redeploy**。
   - Supabase → **Authentication → URL Configuration** → Site URL 與 Redirect URLs 一併更新（2.4 節）。

### 2.10.1 ★ 目前已完成：免費永久網址

網站**已經部署在 Vercel 免費方案**，網址：

```
https://msw-street-workout.vercel.app
```

- **免費方案是永久有效的**（不會像沙箱環境一樣過期），HTTPS 自動核發與續期、全球 CDN。
- Vercel 免費方案的限制：每月 100 GB 流量、每次部署 100 GB-小時。以澳門社群網站的規模（平日數十到數百人）**完全用不完**。
- 免費方案的**建議事項**：專案超過 30 天完全無人存取會被標記為休眠（有訪客自動喚醒，首次稍慢）；若之後要正式營運，可升 Pro（US$20/月）解鎖團隊協作、密碼保護與更長日誌。
- **不需要 ICP 備案**即可使用。

**日後更新網站內容的方式（兩種，任選）**

1. **命令行（最快）**：在你的專案目錄執行
   ```bash
   vercel --prod
   ```
   首次執行會要你登入並連結專案（選 `msw-street-workout`），之後一行指令就完成部署。

2. **接上 GitHub（推薦長期維護）**：把程式碼 push 到自己的 GitHub 私有倉庫，在 Vercel 專案 → **Settings → Git** 連結該倉庫。之後每次 `git push` 到 `main` 就會自動部署，也能在 Vercel 後台看到每次部署的歷史與差異。

> ⚠️ **不要動到 `msw2026` 專案**。你的 Vercel 帳號下有兩個專案：這套網站是 `msw-street-workout`，另一個 `msw2026`（連著 GitHub `mswmacau/msw2026`）是原本就存在的，本次部署完全沒有碰它。

### 2.11 上線後的驗證（照著點一次）

| # | 動作 | 預期結果 |
| --- | --- | --- |
| 1 | 開 `<你的正式網址>` | 首頁正常顯示，頂部**沒有**黃色「尚未連接 Supabase」提示條 |
| 2 | 註冊一個測試帳號 | 成功；若關閉電郵驗證則直接登入 |
| 3 | `/run` 上傳一張截圖 + 填公里數 | 出現「已提交…等待後台確認」 |
| 4 | 管理員登入 → `/admin/runs` → 通過該筆 | 該筆變「已通過」，會員積分與里程增加 |
| 5 | `/admin/checkins` 確認一筆簽到 | 會員 +10 分 |
| 6 | `/admin/coupons` 手動發一張券 → 用券碼核銷 | 券狀態變「已使用」 |
| 7 | `/leaderboard` | 有會員暱稱與積分 |
| 8 | 用手機開一次 | 版面正常、選單可操作 |

測完記得把測試帳號與測試資料刪掉（見 8.6）。

---

## 三、方案二：自有 VPS（PM2／Docker）

適合：你有 IT 人員，或希望資料與主機都在自己手上。以下以 **Ubuntu 22.04 / 24.04 + 香港 VPS** 為例。

### 3.1 安裝執行環境

```bash
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm 與 PM2
sudo corepack enable
sudo npm install -g pm2

# 確認版本
node -v && pnpm -v
```

### 3.2 佈署程式

```bash
sudo mkdir -p /var/www/msw-street-workout
sudo chown -R $USER:$USER /var/www/msw-street-workout
cd /var/www/msw-street-workout

# 方式 A：從 git 拉（推薦，日後回滾就是用 git checkout）
git clone https://github.com/<你的帳號>/msw-street-workout.git .

# 方式 B：從本機上傳（注意：不要用 rsync --delete，會刪掉目標端的 .env.local）
# rsync -avz --exclude node_modules --exclude .next ./ user@<SSH_HOST>:/var/www/msw-street-workout/
```

### 3.3 設定環境變數（伺服器端）

```bash
cd /var/www/msw-street-workout
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=<你的 Supabase Project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<你的 Supabase anon key>
NEXT_PUBLIC_SITE_URL=<你的正式網址>
EOF

chmod 600 .env.local     # 只有本人可讀
```

### 3.4 建置與啟動（PM2）

```bash
cd /var/www/msw-street-workout
pnpm install --frozen-lockfile
pnpm build

pm2 start pnpm --name msw -- start
pm2 save
pm2 startup            # 照畫面輸出的指令再執行一次，開機才會自動啟動

pm2 status             # 應顯示 msw → online
pm2 logs msw --lines 50
```

服務會跑在 `localhost:3000`，對外由 Nginx 代理。

### 3.5 Nginx 反向代理 + HTTPS

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/msw > /dev/null <<'EOF'
server {
    listen 80;
    server_name <你的正式網址>;

    client_max_body_size 10m;      # 上傳截圖用，太小會傳不上去

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/msw /etc/nginx/sites-enabled/msw
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 核發 HTTPS 憑證（certbot 會自動設定每 90 天續期）
sudo certbot --nginx -d <你的正式網址>
```

### 3.6 （替代）Docker 部署

若要用 Docker，**必須先在 `next.config.ts` 加上 standalone 輸出**：

```ts
const nextConfig: NextConfig = {
  output: "standalone",           // ← 加這一行，Docker 映像才會變小
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  images: { remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }] },
};
```

```dockerfile
# Dockerfile
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t msw:$(git rev-parse --short HEAD) .
docker run -d --name msw -p 3000:3000 --env-file .env.local --restart unless-stopped msw:<commit>
```

> Docker 部署時，`NEXT_PUBLIC_*` 在建置階段就寫入映像，**改環境變數必須重新 build**，不是重啟容器就好。

### 3.7 VPS 的日常維運責任（選擇本方案就要扛）

```bash
# 每月檢查一次
df -h                          # 磁碟剩餘（建議 >20%）
free -m                        # 記憶體
sudo apt-get update && sudo apt-get upgrade -y   # 系統更新
pm2 status && pm2 logs msw --lines 100           # 服務狀態與錯誤
sudo certbot renew --dry-run                     # 確認憑證續期機制正常
```

---

## 四、方案三：騰訊雲／阿里雲等國內平台

適合：會員主要在中國大陸，或堅持中文客服與國內付款。**若要使用中國大陸節點，必須先完成 ICP 備案**（這是最大門檻）。若不想備案，請選其**香港／新加坡節點**。

### 重點步驟

1. **選型**：
   - 最單純：雲伺服器（騰訊雲 CVM / 輕量應用伺服器、阿里雲 ECS），**香港地域**，2 核 4GB 起。→ 然後**完全照第三章的步驟做**（Node 22 + PM2 + Nginx + Certbot）。
   - 或：容器服務（TKE / ACK）+ 映像倉庫，照 3.6 的 Dockerfile 做。
2. **安全組（防火牆）**：**只開 80、443**（以及你自己 SSH 的 22 埠，並限制來源 IP）。3000 埠**不要**對外開。
3. **網域與備案**：
   - 香港／新加坡節點：網域不必備案，DNS 指到主機 IP 即可。
   - 中國大陸節點：必須完成 ICP 備案（個人或企業主體），備案核准前無法對外服務。
4. **HTTPS**：可在平台申請免費憑證並綁定，或用 Certbot（香港節點可）。
5. **CDN 與 WAF（重要提醒）**：若啟用 CDN／WAF，請參考 9.9 的說明——本專案**不使用** Next.js Server Action，就是為了避免被 WAF 誤判攔截。若日後加開 WAF 的嚴格規則，請先測一次註冊與上傳流程。

---

## 五、環境變數清單

| 變數名稱 | 用途 | 要去哪裡取得 | 是否會出現在前端 | 必要 |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案網址，前端連線資料庫與登入用 | Supabase → **Project Settings → API → Project URL** | 是 | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名公開金鑰，前端用它通過 RLS 存取資料 | Supabase → **Project Settings → API → Project API keys → anon public** | 是 | ✅ |
| `NEXT_PUBLIC_SITE_URL` | 網站正式網址；用於電郵驗證連結導回（`/auth/callback`） | 你自己買的網域，例如 `https://www.mswmacau.com`（**不含**結尾斜線） | 是 | ✅ |
| `SUPABASE_SERVICE_KEY` | **僅**維運腳本（如 `seed.mjs`）與資料搬遷使用，可繞過 RLS | Supabase → **Project Settings → API → service_role** | 否 | ❌ 日常不需要 |

### ⚠️ 金鑰安全守則（請務必遵守）

1. `NEXT_PUBLIC_SUPABASE_ANON_KEY` 雖然名為「公開」金鑰、會出現在前端程式碼中，但**所有資料表都已啟用 RLS**，任何人拿到它也只能讀到公開排行榜與自己的資料。這是 Supabase 的標準設計，**不是漏洞**。
2. **`service_role` key 絕對不能**加上 `NEXT_PUBLIC_` 前綴、不能放進 `.env.local` 給網站用、不能推上 GitHub。它會繞過所有 RLS，等同資料庫管理員權限。
3. `.env.local` 已被 `.gitignore` 排除，**不要**把它的內容貼進任何聊天視窗、Email 或這份文件。
4. 若懷疑金鑰外洩：Supabase → **Project Settings → API → Reset API keys**（重設後要同步更新 Vercel 的環境變數並 Redeploy）。

---

## 六、上線檢查清單（Go-live Checklist）

> 建議列印出來，逐項勾。每一項都要**親眼看過**，不要假設。

### A. 基礎設施

- [ ] Node.js ≥ 20.9.0（建議 22 LTS）已安裝
- [ ] `pnpm build` 在正式環境執行成功
- [ ] 正式網址可連，HTTPS 憑證有效（瀏覽器網址列是鎖頭、無警告）
- [ ] `http://` 會自動導到 `https://`
- [ ] 手機版版面檢查過（iOS Safari + Android Chrome）
- [ ] `seed.mjs` 已刪除
- [ ] Git repository 為 **Private**，且 `.env.local` 未被推送

### B. Supabase 設定

- [ ] 專案 region 為 `ap-southeast-1`（新加坡）
- [ ] `schema.sql` 已完整執行成功
- [ ] 七張資料表皆存在（`profiles` / `training_sessions` / `training_checkins` / `run_submissions` / `coupons` / `point_transactions` / `app_settings`）
- [ ] Storage bucket `run-screenshots` 存在，且為**私有**（Public 未勾選）
- [ ] Storage 三條政策已建立
- [ ] Authentication → Site URL 已設為正式網址
- [ ] Authentication → Redirect URLs 已加入 `<你的正式網址>/auth/callback`
- [ ] Confirm email 設定已確認（開啟或關閉，並了解其影響）
- [ ] 資料庫密碼已另外妥善保存（備份要用）

### C. 環境變數

- [ ] `NEXT_PUBLIC_SUPABASE_URL` 正確
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` 正確
- [ ] `NEXT_PUBLIC_SITE_URL` = 正式網址（無結尾斜線）
- [ ] 改動後已執行 Redeploy

### D. 功能面（實際操作一次）

- [ ] **註冊**：新帳號可註冊成功
- [ ] **登入**：可登入，重整頁面後仍保持登入（session 正常）
- [ ] **登出**：可登出，登出後進 `/dashboard` 會被導到 `/login`
- [ ] **上傳**：`/run` 可上傳截圖並送出（含 8MB 以下各種格式）
- [ ] **審核**：`/admin/runs` 看得到待審清單，通過後會員積分與里程正確增加
- [ ] **駁回**：駁回後不會加分，會員端看得到狀態
- [ ] **訓練報名**：`/training` 可報名與取消
- [ ] **簽到確認**：`/admin/checkins` 可確認，會員 +10 分
- [ ] **發券**：`/admin/coupons` 手動發券，會員端 `/dashboard/coupons` 看得到 QR Code
- [ ] **月度發券**：`/admin/monthly` 達標名單正確，發券後會員收到券
- [ ] **核銷**：輸入券碼可核銷，重複核銷不會噴錯
- [ ] **排行榜**：`/leaderboard` 有資料，月度／累積可切換，未登入訪客也看得到
- [ ] **首頁數字**：會員數、總里程、總場次正確（非 0）
- [ ] **建場次**：`/admin/sessions` 可新增／修改訓練場次

### E. 安全面

- [ ] 所有資料表 RLS 已啟用（Supabase → **Database → Tables**，每張表應顯示 `RLS enabled`）
- [ ] 用**一般會員**帳號開 `/admin` → 應顯示「權限不足」而非進入後台
- [ ] 一般會員無法修改自己的 `points`／`total_km`（已由 trigger 防護）
- [ ] anon key 只存在於部署平台的環境變數，未出現在任何公開文件
- [ ] `service_role` key 未放進任何環境變數或程式碼
- [ ] 管理員帳號數量最小化（只給真的需要的人）
- [ ] 管理員帳號使用強密碼（建議 12 位以上，含大小寫與數字）

### F. 資料面

- [ ] 已做一次上線前資料庫快照（見 8.1），並確認檔案可開啟、有大小
- [ ] 知道備份檔案放在哪裡（**不要**只存在同一台主機）
- [ ] Storage 容量與成長速度已評估（見 8.5）
- [ ] 已規劃備份頻率與負責人（見 8.1）
- [ ] 已建立「回滾演練」的認知：知道第七章的步驟在哪一頁

### G. 營運準備（非技術，但上線前要有）

- [ ] 網站有「聯絡我們」或 IG 聯絡方式（目前網站頁尾已有 IG `@msw.streetworkout` 與 Email，請確認正確）
- [ ] 已準備會員使用說明（如何上傳截圖、如何領券）
- [ ] 已考量個資告知（澳門《個人資料保護法》第 8/2005 號法律）：建議於網站加入隱私政策，說明會員暱稱與積分會顯示於**公開**排行榜
- [ ] 優惠券的兌換內容與期限已對外說明清楚

---

## 七、回滾預案

> **鐵律：任何上線動作都要有回滾方案，且回滾步驟要在上線前就讀過一遍。**

### 7.1 觸發回滾的條件（出現任一項就執行）

| 現象 | 嚴重度 |
| --- | --- |
| 網站完全打不開（5xx / 建置失敗） | 立即回滾 |
| 會員無法註冊或登入（全體性） | 立即回滾 |
| 上傳截圖全部失敗 | 立即回滾 |
| 後台無法審核 | 立即回滾 |
| 積分或里程計算錯誤（數字明顯不對） | 立即回滾並凍結資料 |
| 資料被誤刪／誤審核 | **不需回滾程式碼**，用 7.4 精準修正 |
| 單一頁面版面破損但核心功能正常 | 可先修再上，不必回滾 |

### 7.2 程式碼回滾（Vercel）— 最快，約 1 分鐘

1. Vercel 專案 → **Deployments**
2. 找到上一個正常的部署（標示 `Ready` 且是你上線前那一版）→ 右側 **⋯** → **Promote to Production**
3. 等待約 30 秒，正式網址即回到舊版。
4. 驗證：開網站確認首頁與登入正常。

> **為什麼這麼快**：Vercel 保留每一次部署的完整產物，回滾只是把流量指回舊產物，不需要重新建置。

**若已來不及在介面操作**（例如網站整片掛掉），用指令：

```bash
cd /path/to/msw-street-workout
git log --oneline -5          # 找到上一個正常版本的 commit
git revert <壞掉的 commit>
git push origin main          # Vercel 會自動部署
```

### 7.3 程式碼回滾（VPS / PM2）— 約 3 分鐘

```bash
cd /var/www/msw-street-workout
git log --oneline -5
git checkout <上一個正常的 commit>

pnpm install --frozen-lockfile
pnpm build
pm2 restart msw

pm2 logs msw --lines 50       # 確認無錯誤
curl -I http://127.0.0.1:3000 # 應回 200
```

**Docker**：

```bash
docker ps --format '{{.Image}}'          # 找到上一個映像 tag
docker stop msw && docker rm msw
docker run -d --name msw -p 3000:3000 --env-file .env.local --restart unless-stopped msw:<上一個 commit>
```

### 7.4 資料庫回滾／資料修正

**分清楚兩種情況，處理方式完全不同：**

#### 情況 A：資料被誤改（誤審核、誤發券、誤加分）→ 精準修正，**不要**還原整個資料庫

還原整個資料庫會把其他會員這段時間的正常使用一起清掉，損失更大。請用 SQL 精準修正：

```sql
-- 1) 先看清楚錯在哪裡（把 ? 換成實際條件）
select id, user_id, km, period_month, status, reviewed_at
from public.run_submissions
where status = 'approved'
order by reviewed_at desc
limit 20;

-- 2) 找到對應的積分明細
select id, user_id, delta, reason, ref_type, ref_id, created_at
from public.point_transactions
where ref_id = '<誤審的提交 id>';

-- 3) 修正（範例：撤銷一筆誤審的 5km 提交與其積分）
--    ⚠️ 執行前請先做一次備份（8.1），並把金額/數字再核對一次
update public.run_submissions
   set status = 'pending', reviewed_by = null, reviewed_at = null, admin_note = null
 where id = '<誤審的提交 id>';

update public.profiles
   set total_km = total_km - 5
 where id = '<該會員 id>';

-- 手動補一筆負向積分明細，讓帳目對得起來（points 欄位一起扣）
select public.add_points('<該會員 id>', -5, '撤銷誤審的跑步里程', 'manual');
```

> `add_points` 內部有 `greatest(points + delta, 0)` 保護，不會把積分扣成負數。
> 若誤發了優惠券，直接把該券作廢：`update public.coupons set status = 'expired' where code = '<券碼>';`

#### 情況 B：Schema 或大量資料壞掉 → 走備份還原

**Supabase Pro 方案**（有每日自動備份與時間點還原）：

1. Supabase → **Project Settings → Database → Backups**
2. 選擇要還原的時間點 → **Restore**
3. **強烈建議選「還原到新的專案」**，確認資料正確後再切換環境變數指過去，避免直接覆蓋現有專案。
4. 預計耗時：10–30 分鐘（視資料量）。

**手動還原（任何方案都適用，前提是你有做過 8.1 的 pg_dump）**：

```bash
# ⚠️ 這會覆寫現有資料。執行前請再確認一次備份檔與目標專案。
pg_restore --clean --if-exists --no-owner \
  -h aws-0-ap-southeast-1.pooler.supabase.com -p 5432 \
  -U postgres.<PROJECT_REF> -d postgres \
  backup_20260923_1200.dump
```

### 7.5 回滾後必做

1. 確認網站可開、可登入（跑一次 2.11 的驗證表）
2. 在 Vercel / 伺服器日誌確認錯誤已消失
3. **把問題記下來**（現象、發生時間、處理方式），回報開發方
4. 未找出根因前，**不要**再重新部署同一個版本

### 7.6 預計耗時總表

| 回滾類型 | 預計耗時 | 資料損失風險 |
| --- | --- | --- |
| Vercel 程式碼回滾 | 1 分鐘 | 無 |
| VPS 程式碼回滾 | 3–5 分鐘 | 無 |
| SQL 精準修正 | 10–30 分鐘 | 極低（只動指定筆） |
| 資料庫時間點還原 | 10–30 分鐘 | **有**：還原點之後的資料會全部消失 |

---

## 八、日常維運手冊

> 這一章是你日後最常翻的部分。**99% 的日常操作在網站後台就能完成，不用碰資料庫。**

### 8.1 備份頻率建議

| 項目 | 頻率 | 做法 |
| --- | --- | --- |
| 資料庫 | **每週一次**（活動密集期建議每日） | 手動 `pg_dump`，或用 Supabase Pro 的每日自動備份 |
| 資料庫 | 每次改 schema 或大量改資料**之前** | 手動 `pg_dump` |
| Storage 截圖 | 每季一次 | 後台手動下載，或用 CLI 批次下載 |
| 備份存放 | — | **至少一份放在雲端硬碟／本機**，不要只留在同一台主機 |

**手動備份指令**（在本機或任何一台裝了 PostgreSQL 用戶端工具的機器執行）：

```bash
# 需要 PostgreSQL 用戶端工具（macOS: brew install postgresql@16；Ubuntu: apt-get install postgresql-client）
pg_dump \
  -h aws-0-ap-southeast-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.<PROJECT_REF> \
  -d postgres \
  -n public \
  -Fc \
  -f ~/msw-backup/public_$(date +%Y%m%d_%H%M).dump

# 確認備份檔有內容
ls -lh ~/msw-backup/
```

> `-n public` 表示只備份本站的資料表（不含 Supabase 系統 schema），還原時較安全。
> 密碼就是 2.2 節設的 `<DB_PASSWORD>`。
> **Storage 裡的截圖不在 `pg_dump` 範圍內**，需另外備份（見 8.5）。

**還原驗證（每次備份後建議做一次）**：把備份檔還原到一個**新的** Supabase 測試專案，確認能開、資料筆數正確。**沒驗證過的備份不算備份。**

### 8.2 查看會員資料

**不用寫 SQL**，用後台：

| 需求 | 位置 |
| --- | --- |
| 會員清單、積分、總里程 | Supabase → **Table Editor → profiles** |
| 積分明細 | Supabase → **Table Editor → point_transactions** |
| 某會員的所有提交 | Supabase → **Table Editor → run_submissions** → 篩選 `user_id` |

**常用查詢 SQL**（SQL Editor 貼上即可）：

```sql
-- 全體會員總覽（積分由高至低）
select display_name, role, points, total_km, created_at
from public.profiles
order by points desc;

-- 查某位會員（用暱稱模糊查詢）
select id, display_name, role, points, total_km
from public.profiles
where display_name ilike '%阿健%';

-- 本月跑步提交統計
select period_month, count(*) as 筆數, sum(km) as 總公里
from public.run_submissions
where status = 'approved'
group by period_month
order by period_month desc;

-- 尚未審核的積壓量（每天都該是 0 或很少）
select
  (select count(*) from public.run_submissions where status = 'pending') as 待審提交,
  (select count(*) from public.training_checkins where status = 'pending') as 待確認簽到;
```

### 8.3 審核作業（後台，每天或每週固定做）

1. 管理員登入 → `/admin`
2. **`/admin/runs`**：逐筆比對截圖與填寫的公里數 → 「通過」或「駁回」（可填備註）
   - 通過後系統自動：累加總里程 → 每公里加分 → 檢查該月是否達標 → 達標則自動發券
3. **`/admin/checkins`**：現場點名後確認簽到 → 會員 +10 分
4. **`/admin/monthly`**：月底查看達標名單（會標示「已發放／未發放」）→ 勾選未發放者 → 發券
5. **`/admin/coupons`**：會員出示券時，輸入券碼 → 核銷

**審核 SOP 建議**：固定每週一訓練結束後與每月最後一天各審一次，避免積壓。

### 8.4 調整積分規則（`app_settings` 表 + `setting_num()`）

積分規則**不用改程式碼**，改資料庫的 `app_settings` 表即可，改完**立即生效**。

**目前的四個設定（預設值）**：

| key（設定名稱） | 預設值 | 說明 |
| --- | --- | --- |
| `points_per_checkin` | `10` | 每次訓練簽到通過後加幾分 |
| `points_per_km` | `1` | 每 1 公里加幾分 |
| `monthly_bonus_points` | `200` | 月度達標額外加幾分 |
| `monthly_goal_km` | `300` | 月度目標公里數 |

**查看目前設定**：

```sql
select key, value from public.app_settings order by key;
```

**修改設定**（範例：簽到改成 15 分、月度目標改成 200km）：

```sql
update public.app_settings set value = '15'::jsonb,  updated_at = now() where key = 'points_per_checkin';
update public.app_settings set value = '200'::jsonb, updated_at = now() where key = 'monthly_goal_km';
```

**新增設定**（若日後程式碼用到新 key）：

```sql
insert into public.app_settings (key, value)
values ('your_new_key', '123'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

> **⚠️ 已知的坑（請務必知道）**：後台 `/admin/monthly` 的達標名單是由 `monthly_qualified_list()` 函式產生的，該函式裡的門檻**寫死為 300**，**不會**讀取 `app_settings` 的 `monthly_goal_km`。
> 也就是說：如果你把 `monthly_goal_km` 改成 200，**自動發券的門檻會變成 200km（正確）**，但**後台達標名單仍只列出 300km 以上的人**。
> **解法**：改門檻時，請一併執行以下指令，把函式裡的 300 改成你的新目標：

```sql
-- 把 200 換成你的新目標公里數（與 monthly_goal_km 一致）
create or replace function public.monthly_qualified_list(p_month text)
returns table (user_id uuid, name text, email text, total_km numeric, runs bigint, has_coupon boolean)
language sql stable security definer set search_path = public
as $$
  select s.user_id, p.display_name, u.email::text, s.total_km, s.runs,
         exists (select 1 from public.coupons c
                  where c.user_id = s.user_id and c.month_awarded = p_month) as has_coupon
    from public.monthly_running_stats s
    join public.profiles p on p.id = s.user_id
    left join auth.users u on u.id = s.user_id
   where s.period_month = p_month and s.total_km >= 200     -- ← 改這裡
   order by s.total_km desc;
$$;
```

> 積分計算採**四捨五入**（`round(km * points_per_km)`），例如 2.5km × 1 分 = 3 分。這是已知的正常語意，不是 bug。

### 8.5 把訓練場次排到未來幾個月

`schema.sql` 只自動產生「未來 8 週」的週一場次。要往後排更遠，用後台或 SQL。

**方式 A：後台新增（少量場次）**
`/admin/sessions` → 填日期、標題、地點、起訖時間、人數上限、備註 → 建立。
> 同一天重複建立會**覆蓋**該日場次（以 `session_date` 為唯一鍵 upsert），不用擔心產生重複。

**方式 B：SQL 批量產生（推薦，一次排半年）**

```sql
-- 產生從「本週一」起、往後 26 週（約半年）的每週一 20:00–21:00 場次
insert into public.training_sessions (session_date, title, location, starts_at, ends_at, note)
select
  d::date,
  'MSW 定期訓練',
  '澳門街健館',
  (d + time '20:00')::timestamptz,
  (d + time '21:00')::timestamptz,
  '街健基礎訓練：引體上升、雙槓屈臂撐、核心訓練。請自備毛巾與水。'
from generate_series(
  date_trunc('week', current_date)::date,
  date_trunc('week', current_date)::date + (7 * 26),   -- ← 改 26 這個數字調整週數
  interval '1 week'
) as d
on conflict (session_date) do nothing;   -- 已存在的日期不會被覆蓋
```

```sql
-- 確認排程結果
select session_date, title, location, starts_at, ends_at, status
from public.training_sessions
where session_date >= current_date
order by session_date;
```

**取消／關閉單一場次**（不要用 DELETE，保留紀錄）：

```sql
update public.training_sessions set status = 'cancelled' where session_date = '2026-10-05';
-- 或改成 'closed'（額滿/截止報名），恢復時改回 'open'
```

> **時區提醒**：`starts_at` 是 `timestamptz`，Supabase 專案時區預設 UTC。若後台顯示時間與澳門時間（UTC+8）差 8 小時，請在 Supabase → **Project Settings → General → Database → Timezone** 確認，或直接在建立場次時填入你期望顯示的時間。

### 8.6 清理測試資料與舊資料

**上線前清理測試帳號**（把 email 換成你的測試帳號）：

```sql
-- ⚠️ 刪除動作，執行前請先備份。這會連帶刪除該會員的提交、簽到、優惠券、積分明細（foreign key cascade）
delete from auth.users where email = 'test@example.com';
```

**定期清理舊截圖**（釋放 Storage 空間）：

```sql
-- 先列出半年以上、已審核的提交
select id, user_id, image_path, created_at
from public.run_submissions
where status = 'approved' and created_at < now() - interval '6 months';
```

再到 Supabase → **Storage → run-screenshots**，照 `image_path`（格式為 `{會員id}/{時間戳}.{副檔名}`）找到對應檔案刪除。**建議保留資料庫紀錄（積分與里程歷史），只刪圖片檔案。**

### 8.7 管理員帳號管理

| 需求 | SQL |
| --- | --- |
| 新增管理員 | `update public.profiles set role = 'admin' where id = (select id from auth.users where email = '<對方 email>');` |
| 取消管理員 | 同上，把 `'admin'` 改成 `'member'` |
| 列出所有管理員 | `select display_name, role from public.profiles where role = 'admin';` |
| 忘記密碼 | Supabase → **Authentication → Users** → 點該使用者 → **Send password recovery**（或手動設一組新密碼） |

> 新增／取消管理員後，對方須**登出再登入**才會生效。

---

## 九、常見問題排查

### 9.1 註冊收不到驗證信

**可能原因與解法**：

1. **Supabase 內建寄件服務被擋或達上限** → 到 **Authentication → Emails** 檢查是否被退信；長期解法是設定自訂 SMTP（2.6 節）。
2. **信被丟進垃圾郵件匣** → 請會員檢查「垃圾郵件／促銷內容」分類。
3. **Site URL 或 Redirect URLs 沒設好** → 驗證連結會導到錯誤的地方。回 2.4 檢查。
4. **根本不想處理這件事** → 到 **Authentication → Sign In / Providers → Email** 關閉 **Confirm email**，會員註冊後直接可登入（2.4 節）。

### 9.2 註冊成功但無法登入（出現「請先到電郵信箱點擊驗證連結」）

代表 Confirm email 是**開啟**狀態但會員還沒驗證。兩種解法：
- 請會員收信點連結；
- 或管理員到 Supabase → **Authentication → Users** → 點該使用者 → **Confirm user**（手動幫他驗證）。

### 9.3 上傳截圖後會員看不到圖片

**原因與解法**（依序檢查）：

1. **這是正常現象的一種**：bucket 是私有的，圖片用 **1 小時有效**的 Signed URL 顯示。超過 1 小時後重整頁面，系統會重新簽發，理論上不影響。若持續看不到，往下檢查。
2. **Storage policy 沒建立** → 回 2.5 確認三條政策存在；沒有就重跑一次 `schema.sql`（可重複執行）。
3. **bucket 不存在或名稱打錯** → 必須正好是 `run-screenshots`。
4. **圖片超過 8MB** → 網站會擋下並顯示錯誤；請會員壓縮或截更小的圖。
5. **副檔名不支援** → 僅接受 jpg / jpeg / png / webp / heic。
6. **累積容量超出免費額度** → Supabase → **Settings → Usage** 檢查 Storage 用量。

### 9.4 排行榜空白

| 現象 | 原因 | 解法 |
| --- | --- | --- |
| 總榜完全空白 | 無任何會員，或 `public_leaderboard` 檢視表權限掉了 | 重跑 `schema.sql`（會重建檢視表並 `grant select to anon`） |
| 月度榜空白但總榜有資料 | 該月沒有**已審核**的跑步提交 | 到 `/admin/runs` 審核後就會出現（**只有 approved 會計入**） |
| 積分全是 0 | 簽到／提交尚未審核 | 審核後自動加分 |
| 未登入訪客看不到 | 同上，檢視表權限問題 | 重跑 `schema.sql` |

> 隱私提醒：`public_leaderboard` 設計為**任何人（含未登入訪客）都可見**會員暱稱、頭像、積分、總里程。若不希望公開，請告知開發方調整。

### 9.5 管理員進不去後台

**依序檢查這四項**（九成是前兩項）：

1. **登出了嗎？** 改完 `role` 後必須**登出再重新登入**。這是最常見的原因。
2. **`role` 真的改成 admin 了嗎？** 執行確認：
   ```sql
   select display_name, role from public.profiles where role = 'admin';
   ```
   若查無結果，重做 2.7 節（注意 email 要完全正確、含大小寫）。
3. **是不是有兩個帳號？** 你可能註冊時用了一個 email、改 SQL 時填了另一個。用這段查出所有帳號：
   ```sql
   select p.display_name, p.role, u.email
   from public.profiles p join auth.users u on u.id = p.id
   order by p.created_at;
   ```
4. **看到「後台尚未啟用」** → 代表環境變數沒設好（網站連不上 Supabase）。回 2.9 檢查三個環境變數，並確認改完有 **Redeploy**。

> 若一般會員進 `/admin` 顯示「權限不足」——那是**正確的防護**，不是 bug。

### 9.6 上傳一直失敗 / 出現 403

- 若 403 頁面上出現「WAF」字樣 → 見 9.9。
- 若錯誤訊息是「圖片上傳失敗：...」→ 通常是 Storage policy 或 bucket 問題，見 9.3。
- 若超過 8MB → 壓縮圖片。

### 9.7 首頁的數字都是 0

`site_stats` 只統計**已審核（approved）**的資料。若剛上線還沒人審核，顯示 0 是正常的。審核幾筆後重整即可。

### 9.8 會員說「我的積分少了／里程不對」

1. 到 Supabase → **Table Editor → point_transactions**，篩選該會員，看每一筆加減紀錄。
2. 到 `run_submissions` 篩選該會員，確認各筆狀態（只有 `approved` 計入）。
3. 若確認是誤審，依 7.4 情況 A 修正。

### 9.9 ⚠️ 重要：`next-action` 被 WAF 攔截（給未來開發者的警示）

**背景**：本專案在沙箱環境驗收時曾發生「所有表單全部失效」——原因是部署平台的邊緣 WAF 把帶有 `next-action` 標頭的 POST 請求（Next.js Server Action 的特徵）判定為攻擊並回 403。

**目前的狀態**：全站寫入操作（註冊、登入、上傳、審核、報名、發券、核銷、建場次）**都已改用 API Route**（位於 `src/app/api/`），已徹底避開此問題，並通過線上驗證。

**給日後開發的硬規定**：
> **未來新增任何寫入功能，請用 API Route（`src/app/api/.../route.ts`），不要使用 Next.js Server Action。**
> 否則在啟用了 CDN／WAF 的部署環境（騰訊雲 EdgeOne、Cloudflare 等）可能再次被 403 攔截，且這類問題只會在正式環境出現、本機測不出來。

### 9.10 Next.js 16 的檔案位置異動（給未來開發者的第二個警示）

Next.js 16 起，**`middleware.ts` 已改名為 `src/proxy.ts`**。本專案的路由保護（`/dashboard`、`/admin` 需登入）就在 `src/proxy.ts`。日後若要調整登入導向邏輯，請改這個檔案，**不要**另外新增 `middleware.ts`（會衝突）。

### 9.11 網站突然顯示「尚未連接 Supabase」

頂部出現黃色提示條 = 前端拿不到環境變數。檢查：
1. Vercel → **Settings → Environment Variables** 三個值都還在嗎？
2. 改過環境變數後有沒有 **Redeploy**？
3. Supabase 專案是否因為免費方案**連續 7 天無活動而自動暫停**？→ 到 Supabase 後台點 **Restore／Unpause**。**這也是建議升級 Pro 方案的主因。**

### 9.12 優惠券 QR Code 掃不出來

QR Code 的內容是**券碼字串**（形如 `MSW-202609-A1B2C3`），不是網址，所以某些相機 App 掃了會顯示「純文字」而非開網頁，**這是正常的**。
管理員核銷時，直接請會員出示券碼，或自己在 `/admin/coupons` 輸入券碼即可，不一定要掃描。

---

## 十、已知殘留問題與後續建議

上線時請把以下項目納入認知，均**不影響正常營運**（QA 判定為 P3 等級）。

| # | 問題 | 影響 | 建議處理 |
| --- | --- | --- | --- |
| 1 | **重複發券無強制防呆**：`/admin/monthly` 可對「已發放」的會員再發一張券，目前只有 `confirm` 二次確認提示 | 低（需人工誤操作才會發生） | 營運時看「已發放／未發放」標籤再勾選；日後小改版可在資料庫加唯一約束 |
| 2 | `DELETE /api/runs` 對不存在或非本人的提交會回 `200 {"ok":true}`（靜默無操作） | 極低（無實際副作用） | 可忽略 |
| 3 | `monthly_qualified_list()` 門檻寫死 300，不讀 `app_settings` | 中（改月度目標時要記得同步改，見 8.4） | 改門檻時一併執行 8.4 的函式重建指令 |
| 4 | 優惠券核銷未檢查 `expires_at`（已過期但狀態仍為 `active` 的券也能核銷） | 低 | 核銷時請人工目視券的有效期限 |
| 5 | 積分採四捨五入（`round`） | 無（已知語意） | 了解即可 |

### 後續建議（非必要，可排入小改版）

1. **隱私政策頁**：澳門適用《個人資料保護法》（第 8/2005 號法律）；因排行榜公開顯示暱稱與積分，建議加入隱私說明與會員同意機制。
2. **忘記密碼流程**：目前需要管理員到 Supabase 後台手動協助，會員無法自助重設。會員變多後建議補上 `/forgot-password`。
3. **Google / Facebook 登入**：社群網站用社群帳號登入可降低註冊摩擦，Supabase 支援，需開發方新增。
4. **自動化備份**：若維持 Supabase Pro，開啟每日備份與時間點還原（PITR），並每季做一次還原演練。
5. **通知**：審核通過／發券時發送 Email 或 IG 通知，可提升會員活躍度。

---

## 附錄 A：交付物清單

| 檔案 / 項目 | 說明 |
| --- | --- |
| 完整程式碼（Next.js 16 專案） | 含所有頁面、後台、API Route |
| `supabase/schema.sql` | 資料庫一鍵初始化腳本（可重複執行） |
| `.env.example` | 環境變數範本（**不含真實金鑰**） |
| `README.md` | 開發者快速上手文件 |
| `VERIFICATION.md` | QA 四輪驗證報告 |
| `DEPLOYMENT.md` | 本文件（上線交付文件） |

## 附錄 B：緊急速查卡

```
網站掛了        → Vercel → Deployments → 上一個 Ready → Promote to Production（1 分鐘）
改管理員        → Supabase → SQL Editor → update profiles set role='admin' where id=(select id from auth.users where email='...');
                 然後請對方「登出再登入」
改積分規則      → SQL Editor → update app_settings set value='15'::jsonb where key='points_per_checkin';
排訓練場次      → /admin/sessions 單筆新增，或用 8.5 的 SQL 一次排半年
備份資料庫      → pg_dump -h aws-0-ap-southeast-1.pooler.supabase.com -p 5432 \
                    -U postgres.<PROJECT_REF> -d postgres -n public -Fc -f backup_$(date +%Y%m%d).dump
查會員資料      → Supabase → Table Editor → profiles / point_transactions / run_submissions
忘記密碼        → Supabase → Authentication → Users → 點使用者 → Send password recovery
感覺得救不回來  → 先做資料庫快照，再回到第七章照步驟執行
```

---

**本文件到此結束。** 上線當天請帶著第六章的檢查清單逐項勾選，並在執行任何刪除／還原動作前，先確認已有一份可開啟的備份檔。
