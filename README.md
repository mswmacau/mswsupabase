# MSW 街健館 · Macau Street Workout

以 **Next.js 16（App Router）+ Supabase** 建置的澳門街頭健身社群網站。包含會員系統、積分累積、定期訓練報名簽到、月度跑步里程上傳與後台人工審核、達標發放電子優惠券（含 QR Code）。

---

## 一、開站三步（約 10 分鐘）

### 步驟 1 — 建立 Supabase 專案（免費）

1. 到 [supabase.com](https://supabase.com) 註冊／登入（可用 GitHub 帳號快速註冊）
2. 點 **New project**，名稱填 `msw-street-workout`，Region 選 **Southeast Asia (Singapore)**（離澳門最近）
3. 等待約 2 分鐘專案建立完成

### 步驟 2 — 執行資料庫腳本

1. 左側選 **SQL Editor** → **New query**
2. 把 `supabase/schema.sql` 的**全部內容**貼進去
3. 點 **Run**

這一支腳本會建立：

| 資料表 | 用途 |
| --- | --- |
| `profiles` | 會員資料（名稱、角色、積分、總里程） |
| `training_sessions` | 定期訓練場次（並自動建立未來 8 週的週一場次） |
| `training_checkins` | 訓練簽到紀錄 |
| `run_submissions` | 跑步提交（公里數 + 截圖路徑 + 審核狀態） |
| `coupons` | 優惠券（券碼、狀態、期限） |
| `point_transactions` | 積分明細 |
| `monthly_running_stats` / `site_stats` | 統計檢視表 |

同時建立 **RLS 安全政策**、**Storage bucket `run-screenshots`**（私有，靠 Signed URL 讀取），以及 6 個後台用的資料庫函式（審核、加分、自動發券等）。

### 步驟 3 — 填入環境變數並啟動

```bash
cp .env.example .env.local
```

到 Supabase → **Project Settings → API** 複製 **Project URL** 與 **anon public key**，填入 `.env.local`。

```bash
pnpm install
pnpm dev
```

開啟 [http://localhost:3000](http://localhost:3000)。

> **還沒註冊 Supabase 也能先看版型**：不填 `.env.local` 直接 `pnpm dev`，網站會正常顯示（頂部有一條黃色提示），只是沒有資料。

---

## 二、把自己設為管理員

註冊一個會員帳號後，回到 Supabase **SQL Editor** 執行（換成你的 email）：

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

登出再登入，導覽列頭像選單就會出現「後台管理」。

> **想跳過電郵驗證**：Supabase → **Authentication → Sign In / Providers → Email**，關閉 **Confirm email**。開發階段建議關閉，上線前再打開。

---

## 三、功能與規則

### 積分規則（集中在 `src/lib/config.ts` 的 `RULES`，改一行就生效）

| 行為 | 積分 |
| --- | --- |
| 訓練簽到（後台確認後） | +10 |
| 跑步里程（後台確認後） | 每公里 +1 |
| 當月累積達 300 km | 額外 +200，並發送優惠券 |

### 活動一：定期訓練

- 逢**星期一 20:00–21:00**
- 會員在 `/training` 線上報名 → 現場訓練 → 管理員在 `/admin/checkins` 確認 → 自動 +10 分

### 活動二：月度跑步挑戰（300 km）

1. 會員在 `/run` 上傳跑步 app 截圖 + 輸入公里數 + 選擇計入月份
2. 圖片上傳到私有 bucket `run-screenshots`，路徑為 `{uid}/{timestamp}.{ext}`
3. 管理員在 `/admin/runs` 逐筆核對截圖，可填備註後「通過」或「駁回」
4. 通過時資料庫函式自動完成：累加總里程 → 每公里 +1 分 → **檢查該月是否滿 300 km** → 達標則 +200 分並**自動產生優惠券**（同一個月只發一次）
5. 月底在 `/admin/monthly` 查看達標名單，可批量補發或額外發券
6. 會員在 `/dashboard/coupons` 看到含 **QR Code** 的電子優惠券；管理員在 `/admin/coupons` 輸入券碼核銷

---

## 四、頁面結構

```
/                     首頁（Hero、累積數據、兩大活動、訓練項目、排行榜、CTA）
/events               活動總覽
/training             定期訓練（場次列表、報名／取消）
/run                  月度跑步挑戰（進度條、上傳表單、我的提交）
/leaderboard          排行榜（月度 / 累積，可切換月份）
/login  /signup       會員登入／註冊
/dashboard            我的帳戶（積分、里程、進度、明細）
/dashboard/coupons    我的優惠券（QR Code）
/admin                後台總覽
/admin/runs           跑步審核（通過／駁回）
/admin/checkins       簽到確認
/admin/monthly        月度達標名單 + 批量發券
/admin/coupons        優惠券管理 + 核銷
/admin/sessions       訓練場次管理
```

---

## 五、技術架構

```
src/
├── app/                    App Router 頁面
│   ├── actions/            Server Actions（auth / runs / training / admin）
│   ├── auth/               電郵驗證回調、登出
│   ├── admin/              後台（layout 內做 role 檢查）
│   └── dashboard/          會員中心
├── components/             Nav、Footer、卡片、QR 優惠券、進度條等
├── lib/
│   ├── config.ts           品牌與積分規則（改這裡）
│   ├── queries.ts          所有資料讀取（未連 Supabase 時安全回傳空值）
│   ├── utils.ts            日期／格式化／狀態標籤
│   └── supabase/           client / server / env
└── proxy.ts                路由保護（/dashboard、/admin 需登入）
supabase/schema.sql         一鍵初始化腳本
```

**安全設計**

- 所有敏感操作走資料庫函式 + `security definer`，前端無法直接改分數
- `profiles` 有 trigger 阻止非管理員修改 `role / points / total_km`
- RLS 確保會員只能看到自己的提交與優惠券
- `run-screenshots` 為私有 bucket，只有本人與管理員能拿到 Signed URL

---

## 六、部署到 Vercel

1. 把程式碼推到 GitHub
2. 到 [vercel.com](https://vercel.com) → **Import Project**
3. 環境變數填入與 `.env.local` 相同的三個值（`NEXT_PUBLIC_SITE_URL` 改成 Vercel 網址）
4. Supabase → **Authentication → URL Configuration → Site URL** 填上 Vercel 網址

---

## 七、常見問題

**Q：上傳截圖後會員看不到自己的圖片？**
Storage bucket 是私有的，圖片透過 1 小時有效的 Signed URL 顯示。若看不到，確認 `schema.sql` 的 Storage policy 有成功建立。

**Q：註冊後無法登入？**
預設 Supabase 要求電郵驗證。到信箱點連結，或關閉 Confirm email（見第二節）。

**Q：想改積分或月度目標？**
改 `src/lib/config.ts` 的 `RULES`；資料庫端的達標門檻在 `schema.sql` 的 `award_monthly_if_qualified`（目前寫死 300，可改成讀設定表）。

**Q：想要 Google 登入？**
Supabase → Authentication → Providers → 啟用 Google，然後在 `src/app/actions/auth.ts` 加上 `signInWithOAuth`。
