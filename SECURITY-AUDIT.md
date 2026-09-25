# MSW 街健館 — 正式交付前安全性稽核報告

| 項目 | 內容 |
|---|---|
| 稽核對象 | MSW 街健館（Macau Street Workout） |
| 程式碼 | `/workspace/msw-street-workout`（Next.js 16.3.6 App Router + Supabase） |
| 正式站 | https://msw-street-workout.vercel.app |
| 資料庫 | Supabase PostgreSQL 17.6（REF `<your-project-ref>`） |
| 稽核日期 | 2026-09-23 |
| 稽核範圍 | 資料庫 RLS、RPC 函式、Storage、API Route、前端程式碼、認證機制、XSS／注入 |
| 稽核方式 | 資料庫結構唯讀查詢 + 正式資料庫唯讀滲透測試（全程僅使用公開 anon key） |
| 是否修改任何程式碼／資料庫 | **否**。本次僅產出報告，未執行任何寫入、DDL 或資料異動 |

---

## 1. 總體結論

### 結論：**暫時不可交付。必須先完成 3 項「危險」修復後才能上線給終端客戶使用。**

程式碼本身（Next.js 那一層）寫得**相當紮實**——管理員 API 都有做身分驗證與 `role='admin'` 檢查、沒有 IDOR、沒有 SQL 拼接、沒有 XSS 破口、沒有密鑰外洩。問題**完全集中在資料庫層**。

核心原因是：**本站在前端與伺服器都導入了 Supabase REST API，而 Supabase 的 REST 端點是公開可達的。** 換句話說，「API Route 有檢查」並不等於安全——攻擊者可以**完全繞過 Next.js**，直接拿瀏覽器裡看得到的 anon key 去打 `https://xxxx.supabase.co/rest/v1/rpc/...`。資料庫層（RLS 與 RPC 授權）才是最後一道、也是唯一一道防線。

而這道防線目前有 **3 個有效的破口**：

1. **任何訪客（不必登入）都能任意竄改任何會員的積分** —— 已實測證實。
2. **任何訪客（不必登入）都能下載含全體會員「姓名 + 電郵」的清單** —— 已實測證實。
3. **正式站上仍有帳密寫死在程式碼裡的示範帳號**（密碼 `Test123456`）—— 已實測證實帳號存在。

其餘項目（Session 設定、XSS 防護、Storage 權限、輸入驗證）**整體表現良好**，屬於業界正常水準，多數建議屬於強化而非急修。

### 修復後的可交付性

完成「危險」等級 3 項後即可交付；「高」等級建議在上線後一個月內處理；「中／低」等級可排入例行維運。

---

## 2. 逐項稽核結果

### 2.1 資料庫 RLS

#### RLS 是否已啟用 —— **安全**

查詢 `pg_class`（稽核查詢 R1）結果：

| 表格 | RLS 啟用 | RLS 強制 |
|---|---|:---:|
| `profiles` | ✅ true | false |
| `training_sessions` | ✅ true | false |
| `training_checkins` | ✅ true | false |
| `run_submissions` | ✅ true | false |
| `coupons` | ✅ true | false |
| `point_transactions` | ✅ true | false |
| `app_settings` | ✅ true | false |

**七張表全部啟用 RLS，沒有任何一張遺漏。** 這一點做得完整，是本案最大的優點之一。

> 附註：`rls_forced = false` 表示擁有者（postgres）不受 RLS 約束，這是 Supabase 預設行為，對本專案無風險（程式碼未使用 service_role key）。

#### Policy 逐一檢視 —— 主體安全，一處支援 defense-in-depth

稽核查詢 R2 列出全部 19 條 policy，逐條判斷如下：

| 表格 | Policy | 命令 | 條件 | 判定 |
|---|---|---|---|:---:|
| profiles | `profiles_select_own_or_admin` | SELECT | `auth.uid()=id or is_admin()` | 安全 |
| profiles | `profiles_update_own` | UPDATE | `auth.uid()=id` | 安全（配合 trigger）|
| profiles | `profiles_insert_self` | INSERT | `auth.uid()=id` | **有支援議**（見 風險 #10）|
| training_sessions | `sessions_select_all` | SELECT | `true` | 安全（公開資訊，本意如此）|
| training_sessions | `sessions_admin_all` | ALL | `is_admin()` | 安全 |
| training_checkins | `checkins_select` | SELECT | `auth.uid()=user_id or is_admin()` | 安全 |
| training_checkins | `checkins_insert_own` | INSERT | `auth.uid()=user_id` | 安全 |
| training_checkins | `checkins_delete_own_pending` | DELETE | `auth.uid()=user_id and status='pending'` | 安全 |
| training_checkins | `checkins_admin_update` | UPDATE | `is_admin()` | 安全 |
| run_submissions | `runs_select` | SELECT | `auth.uid()=user_id or is_admin()` | 安全 |
| run_submissions | `runs_insert_own` | INSERT | `auth.uid()=user_id and status='pending'` | 安全 |
| run_submissions | `runs_delete_own_pending` | DELETE | `auth.uid()=user_id and status='pending'` | 安全 |
| run_submissions | `runs_admin_update` | UPDATE | `is_admin()` | 安全 |
| coupons | `coupons_select` | SELECT | `auth.uid()=user_id or is_admin()` | 安全 |
| coupons | `coupons_admin_all` | ALL | `is_admin()` | 安全 |
| point_transactions | `points_select` | SELECT | `auth.uid()=user_id or is_admin()` | 安全 |
| point_transactions | `points_admin_insert` | INSERT | `is_admin()` | 安全 |
| app_settings | `settings_select_all` | SELECT | `true` | 可接受（公開規則值）|
| app_settings | `settings_admin_write` | ALL | `is_admin()` | 安全 |

#### 三條關鍵問題的答案

**Q：匿名（`anon`）能不能讀到不該讀的會員資料？**

- ✅ **直接讀 `profiles`：不能。** 實測 T1 回傳 `[]`。
- ❌ **透過 RPC `monthly_qualified_list`：能拿到電郵。** 詳見 風險 #2。
- ❌ **透過 view `monthly_running_stats`：能拿到全體會員的 user_id 與逐月里程。** 詳見 風險 #8。

**Q：會員 A 能不能改到會員 B 的積分／里程／提交？**

- ✅ 經 `profiles` / `run_submissions` 表格直接操作：**不能**，RLS 阻擋。
- ✅ 透過 UPDATE 自行改自己的 `role`/`points`/`total_km`：**不能**，`guard_profile_sensitive_fields` trigger（`supabase/schema.sql:69-93`）會強制還原，設計正確。
- ❌ **透過 RPC `add_points`：可以。** 詳見 風險 #1。這是本次稽核最嚴重的發現。

**Q：非管理員能不能呼叫只有管理員能用的 RPC？**

- ✅ `review_run_submission` / `review_checkin` / `issue_coupons` / `redeem_coupon`：**不能**。這四支函式內部都有 `is_admin()` 檢查，實測 T6 匿名呼叫 `redeem_coupon` 正確回傳 `只有管理員可以核銷優惠券`（HTTP 400）。**做得好。**
- ❌ `add_points` / `award_monthly_if_qualified` / `monthly_qualified_list`：**能**。詳見 風險 #1、#4、#2。

#### `public_leaderboard` view 敏感欄位檢查 —— **部分有意外暴露**

```sql
select id, display_name, avatar_url, points, total_km from public.profiles;
```
`supabase/schema.sql:198-206`，且明確設定 `security_invoker = false` + `grant select to anon, authenticated`。

- ✅ **沒有**暴露 `role`、`phone`、`email`、`created_at`。
- ❌ **有**暴露 `id`（會員的 auth user UUID）。這是不必要的，且會成為其他攻擊的目標索引（詳見 風險 #9）。
- ❌ **有**暴露「全體」會員，包含完全沒有任何活動、`total_km = 0` 的會員。實測 T2 回傳全部 5 位會員，其中 3 位為零活動。

---

### 2.2 RPC 函式（security definer）

#### 函式清單與設定（稽核查詢 R3）

| 函式 | security definer | `search_path` | 內部授權檢查 |
|---|:---:|:---:|:---:|
| `is_admin` | ✅ definer | ✅ `public` | 不適用（只回傳布林值）|
| `handle_new_user` | ✅ definer | ✅ `public` | 不適用（trigger）|
| `guard_profile_sensitive_fields` | ✅ definer | ✅ `public` | 不適用（trigger）|
| `setting_num` | ✅ definer | ✅ `public` | ❌ 無（唯讀，可接受）|
| `gen_coupon_code` | ❌ invoker | ❌ **未設定** | ❌ 無（見 風險 #11）|
| **`add_points`** | ✅ definer | ✅ `public` | ❌ **無 → 危險 #1** |
| **`award_monthly_if_qualified`** | ✅ definer | ✅ `public` | ❌ **無 → 風險 #4** |
| **`monthly_qualified_list`** | ✅ definer | ✅ `public` | ❌ **無 → 危險 #2** |
| `review_run_submission` | ✅ definer | ✅ `public` | ✅ `is_admin()` |
| `review_checkin` | ✅ definer | ✅ `public` | ✅ `is_admin()` |
| `issue_coupons` | ✅ definer | ✅ `public` | ✅ `is_admin()` |
| `redeem_coupon` | ✅ definer | ✅ `public` | ✅ `is_admin()` |

#### `search_path` 是否鎖定

✅ **11/12 支函式已明確鎖定 `set search_path = public`**，可有效防止 search_path 注入攻擊。這是很多 Supabase 專案會漏掉的細節，本案做得到位。

❌ 唯一例外：`gen_coupon_code`（`supabase/schema.sql:286-301`）未設定。但因它是 `security invoker`（呼叫者 = `anon`/`authenticated`，無建物件權限），實務上無法利用，列為低風險。#11

#### 誰可以 EXECUTE？（稽核查詢 R4）

Supabase 預設會把 `public` schema 所有函式的 EXECUTE 授予 **`anon`、`authenticated`、`service_role`、`PUBLIC`**。本案中此預設權限**從未被收回**，因此：

> ⚠️ 所有 12 支函式，包含 `add_points`，**匿名訪客都可以呼叫**。

---

### 2.3 Storage（跑步截圖）

#### bucket 是否私有 —— **安全**

```json
{"id":"run-screenshots","public":false,"file_size_limit":null,"allowed_mime_types":null}
```
稽核查詢 R6：**`public = false`，確認為私有 bucket。** ✅

#### `storage.objects` policy（稽核查詢 R5）

| Policy | 命令 | 角色 | 條件 |
|---|---|---|---|
| `runshots_insert_own` | INSERT | authenticated | `bucket_id='run-screenshots' and foldername(name)[1] = auth.uid()::text` |
| `runshots_select` | SELECT | authenticated | `foldername(name)[1] = auth.uid()::text or is_admin()` |
| `runshots_delete_own` | DELETE | authenticated | `foldername(name)[1] = auth.uid()::text or is_admin()` |

逐題回答：

**Q：匿名能不能列出／下載別人的截圖？**
✅ **不能。** 三條 policy 的 `roles` 都只給 `authenticated`，匿名完全無法讀寫任何物件。實測 T8（匿名列 buckets）回傳 `[]`；實測 T9（匿名直接下載他人截圖）回傳 `404 Object not found`。

**Q：會員能不能上傳到別人的目錄 `{user_id}/...`？**
✅ **不能。** `runshots_insert_own` 的 `with check` 強制路徑第一段等於自己的 UUID。實測 4 筆物件的 `owner` 欄位與路徑第一段完全一致，路徑格式正確。

**Q：只有本人與管理員能取得 signed URL？**
✅ **是。** 依 Supabase 官方文件，`createSignedUrl` / `createSignedUrls` 需要在 `storage.objects` 上通過 **SELECT RLS policy**，而 `runshots_select` 只允許本人或管理員。因此會員 A 無法為會員 B 的截圖產生有效 signed URL。
實測 T10：匿名存取偽造的簽名路徑回傳 `400 InvalidJWT`。

#### signed URL 有效期限

`src/lib/queries.ts:181-183`：
```ts
const { data } = await supabase.storage
  .from("run-screenshots")
  .createSignedUrls(paths, 60 * 60);   // 1 小時
```
✅ **3600 秒（1 小時）是合理設定**，對燒圖／外洩風險控制得宜。

⚠️ **但要注意一個 Supabase 特性**（值得告知客戶）：signed URL 是用專案專屬內部金鑰簽署的，**與 Auth JWT 金鑰無關**。因此輪替 API 金鑰、甚至停用使用者帳號，**都不會讓已簽發的 URL 失效**；它們會一直有效到期滿為止，若要提前撤銷必須請 Supabase 支援介入。所簽發 URL 是由 server-side 產生並隨頁面動態輸出（所有頁面均為 `force-dynamic`，不會被快取），實際曝露時間極短，可接受。

#### 其餘發現

⚠️ bucket 未設定 `file_size_limit` 與 `allowed_mime_types`（稽核查詢 R12）。程式碼端有驗證（8MB、副檔名白名單），但攻擊者可繞過 Next.js 直接打 Storage API 上傳任意類型／大小的檔案。詳見 風險 #5。

---

### 2.4 API Route 與前端程式碼

#### 寫入型 API 的身分驗證與授權 —— **安全**

| Route | 身分驗證 | 管理員檢查 | 判定 |
|---|---|---|:---:|
| `POST /api/auth/login` | 不適用 | 不適用 | ✅ |
| `POST /api/auth/signup` | 不適用 | 不適用 | ✅ |
| `POST /api/auth/logout` | 不適用 | 不適用 | ✅ |
| `POST /api/runs` | ✅ `auth.getUser()` | 不適用（自用）| ✅ |
| `DELETE /api/runs` | ✅ | 不適用 + `.eq("user_id", user.id)` | ✅ |
| `POST /api/training/checkins` | ✅ | 不適用 | ✅ |
| `DELETE /api/training/checkins` | ✅ | 不適用 + 本人過濾 | ✅ |
| `POST /api/admin/review-run` | ✅ | ✅ 401/403 | ✅ |
| `POST /api/admin/review-checkin` | ✅ | ✅ 401/403 | ✅ |
| `POST /api/admin/coupons` | ✅ | ✅ 401/403 | ✅ |
| `PATCH /api/admin/coupons` | ✅ | ✅ 401/403 | ✅ |
| `POST /api/admin/sessions` | ✅ | ✅ 401/403 | ✅ |

所有管理員 API 都遵循相同且正確的模式，例如 `src/app/api/admin/review-run/route.ts:15-28`：
```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "請先登入。" }, { status: 401 });   // 未登入 → 401

const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
if (profile?.role !== "admin")
  return NextResponse.json({ error: "權限不足。" }, { status: 403 });            // 非管理員 → 403
```
錯誤訊息是可讀中文、不洩漏堆疊或內部細節，符合良好實務。✅

#### IDOR 檢查 —— **安全**

✅ **不存在 IDOR。** 所有需要 user id 的地方都取自 session，不使用客戶端傳來的 `user_id`：
- `src/app/dashboard/page.tsx:28-37` → `getUserXxx(profile.id, ...)`，`profile` 來自 `getCurrentProfile()`（session 派生）
- `src/app/run/page.tsx:21` → `getUserSubmissions(profile.id, 30)`
- `src/app/dashboard/coupons/page.tsx:16` → `getUserCoupons(profile.id)`
- `src/app/api/runs/route.ts:50` → 上傳路徑用 `user.id`；`:107-131` 刪除時額外加 `.eq("user_id", user.id)`
- `src/app/api/training/checkins/route.ts:26,59` → 使用 `user.id` 且不開放 `user_id` 欄位

`searchParams` 僅用於 `m`（月份）、`status`、`next` 等非識別欄位，未作為資料歸屬判斷依據。✅

#### 輸入驗證 —— **良好**

| 輸入 | 驗證位置 | 驗證內容 |
|---|---|---|
| km | `src/app/api/runs/route.ts:25-33` | 必須為數字、`> 0`、上限 `RULES.MAX_KM_PER_SUBMISSION`（200），DB 另有 `check (km > 0 and km <= 200)` 雙重防護 |
| period_month | `:36-37` | `/^\d{4}-\d{2}$/` 正規驗證（後台 `leaderboard/page.tsx:22` 亦有）|
| session_date | `src/app/api/admin/sessions/route.ts:40-41` | `/^\d{4}-\d{2}-\d{2}$/` |
| 上傳檔案大小 | `src/app/api/runs/route.ts:42-46` | 上限 8MB |
| 檔名／副檔名 | `:48-50` | 白名單 `jpg/jpeg/png/webp/heic`，且**重組為 `{uuid}/{timestamp}-{random}.{ext}`**，不使用客戶端原檔名 ✅ |
| capacity / days | `sessions/route.ts:45`、`coupons/route.ts:41,48` | `Number.isFinite()` 檢查 + 預設值 |
| admin_note | `review-run/route.ts:42` | `?.trim()` 後傳入 RPC 參數 |

✅ 輸入驗證整體完整，且重要地方都有 **DB 層約束（CHECK constraint）做雙重把關**，這是很好的設計。

僅 `p.psql` UUID 格式未显式正規驗證（`review-run/route.ts` 的 `submission_id` 等），但因為全部使用**參數化 RPC 呼叫**，非法 UUID 會由 PostgreSQL 直接回傳型別錯誤，**不構成安全風險**，僅影響錯誤訊息可讀性。

#### 敏感資訊是否外洩 —— **安全**

```
[1] src/ 中搜尋 service_role / sbp_ / SUPABASE_SERVICE / SECRET  → 無匹配 ✅
[2] .next/static/**/*.js 搜尋 sbp_[a-f0-9]{20,} / service_role    → 無匹配 ✅
[3] src/ 中搜尋 dangerouslySetInnerHTML / innerHTML               → 無匹配 ✅
```

`.env.local` 內容（已遮蔽）：
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJ****REDACTED****        ← 僅 anon key
NEXT_PUBLIC_SITE_URL=https://a1c3aee7df1da69a8.app.workbuddy.host
```
✅ **沒有 service_role key、沒有資料庫密碼**。
✅ `.gitignore` 已包含 `.env*`，`.env.local` 不會進版控。
✅ `src/lib/supabase/client.ts`（瀏覽器端 client）**從未被任何檔案 import**，所有寫入一律走 server-side，`src/lib/supabase/server.ts`。這消除了「前端直連資料庫」的整類風險。

⚠️ 唯一例外：`seed.mjs:20-24` 寫死了示範帳號密碼 —— 詳見 危險 #3。

#### `NEXT_PUBLIC_*` 說明

專案只使用了三個 `NEXT_PUBLIC_*` 變數（`src/lib/supabase/env.ts:1-3`、`src/app/api/auth/signup/route.ts:36`）：

| 變數 | 是否曝光 | 是否可接受 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | ✅ 可接受。專案網址本來就出現在每個請求裡，不是機密。 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 是 | ✅ **可接受，且為正常設計**。anon key 的唯一用途就是放在前端識別專案；它**完全繞不過 RLS**。真正的機密是 `service_role` key（本案從未使用、也未出現在任何檔案）。 |

> **白話說明（給客戶）：** 前端出現的那組「anon key」就像店家的招牌地址，公開是正常的、所有人都看得到。它本身沒有任何權限可以看或修改資料——真正能不能看由資料庫的「存取規則（RLS）」決定。真正危險的那把萬能鑰匙（service_role）從來沒有放進程式碼裡，這點本案做得正確。

---

### 2.5 認證與 Session

#### Cookie 設定 —— **安全**

本案使用 `@supabase/ssr` 0.12.7 的標準 cookie 處理（`src/lib/supabase/server.ts:12-27`、`src/proxy.ts:10-25`、`src/app/api/auth/logout/route.ts:15-26`），`@supabase/ssr` 的預設值為：

| 屬性 | 值 | 判定 |
|---|---|:---:|
| `httpOnly` | `true` | ✅ JS 讀不到 auth token，可防 XSS 盜用 token |
| `Secure` | `true`（生產環境） | ✅ 僅走 HTTPS |
| `SameSite` | `Lax` | ✅ 防大部分 CSRF |
| `path` | `/` | ✅ |

> 限制說明：稽核環境的網路無法連線至 `msw-street-workout.vercel.app`（TLS 握手失敗），因此**未能從正式站 HTTP 回應標頭直接取樣驗證**。以上結論來自程式碼與函式庫預設值推導。建議在上線檢查清單中補一步 `curl -I` 目視確認 `Set-Cookie` 標頭。

#### CSRF 風險 —— **低，可接受**

- 所有寫入 API 皆為 **`POST`/`DELETE`/`PATCH` + `application/json`**，`<form>` 表單（`application/x-www-form-urlencoded`）**跨站偽造無法產生**此 content-type（除非搭配 CORS 通過的 XHR，而瀏覽器同源政策會擋）。
- Cookie 為 `SameSite=Lax`，跨站請求不會自動帶上 session cookie。
- ✅ **CSRF 風險評為「低」。**

#### `mailer_autoconfirm = true` —— **有風險，建議修**

經 Supabase Management API 讀取正式專案設定（`GET /v1/projects/{ref}/config/auth`）：

```
mailer_autoconfirm = True
```

任何人拿任意電郵（**不需證明擁有權**）即可註冊並立刻取得完整 session（`src/app/api/auth/signup/route.ts:53-56` 已處理「直接拿到 session」分支）。

- ⚠️ 可被大量註冊垃圾／假帳號。由於 `public_leaderboard` 會列出**全體**會員，惡意使用者註冊的假帳號會**直接出現在公開排行榜上**，造成可見的聲譽損害，並污染 `site_stats.members` 的首頁數字。
- ⚠️ 忘記密碼功能會把重設連結寄到未驗證的電郵，若該電郵非本人所有，等同把會員帳號交給別人。
- ⚠️ 無法保證帳號＝真實會員，優惠券核銷時難以驗證身分。

建議：改為 `false` 並設定 SMTP；若營運上堅持免驗證，至少 (a) 對註冊來源 IP 做速率限制; (b) 啟用 Captcha; (c) 限制排行榜只列出「有已確認活動」的會員。

#### 暴力破解防護 —— **有風險，建議修（高等級）**

正式專案 Auth 設定實測值：

| 設定 | 目前值 | 期望值 |
|---|---|---|
| `security_captcha_enabled` | **`false`** | `true` |
| `password_min_length` | **`6`** | ≥ 8（本案前端也是 6，`signup/route.ts:23`）|
| `security_update_password_require_reauthentication` | **`false`** | `true` |
| `sessions_timebox` | `0`（永不過期）| 建議 ≥ 建議天花板值 |
| `sessions_inactivity_timeout` | `0`（無閒置登出）| 建議例如 `86400`（24 小時）|
| `jwt_exp` | `3600` | ✅ 合理 |
| `refresh_token_rotation_enabled` | `true` | ✅ 良好 |
| `mfa_totp_enroll_enabled` | `true` | ✅ 可用（建議管理員強制啟用）|
| 應用層登入失敗次數限制 | **無** | 建議加入 |
| Auth 速率限制 | 未明確設定（依賴 Supabase 平台預設，按 IP 計算）| 建議明確認證涵蓋範圍 |

⚠️ 沒有 Captcha、沒有帳號鎖定機制、密碼最短僅 6 碼，攻擊者可對管理員帳號做長期密碼猜測。管理員帳號一旦被盜，攻擊者就能核准自己的假跑步提交、自我發券、並核銷優惠券。評為 **高** 風險。

---

### 2.6 XSS / 注入

#### XSS —— **安全**

使用者可控內容包括 `display_name`（暱稱）、`note`（備註）、`admin_note`、`coupons.title` / `description`。

- ✅ 全專案搜尋 `dangerouslySetInnerHTML` / `innerHTML` → **0 處匹配**。
- ✅ React / JSX 的 `{value}` 會自動做 HTML 跳脫，`src/components/*.tsx` 與各 page 均使用標準 JSX 表達式渲染。
- ✅ 所有使用者輸入流向 React 文字節點，未流向 `href` / `src` / `style` 等具脈絡的位置。

#### SQL 注入 —— **安全**

- ✅ 全專案**沒有任何 SQL 字串拼接**。所有資料存取一律透過 Supabase 客戶端的查詢建構器（`.from().select().eq()`）或**參數化 RPC 呼叫**（`.rpc("name", { p_x: ... })`）。
- ✅ 唯一特殊寫法為外鍵消歧義（`$src/lib/queries.ts:250-251` 的 `profile:profiles!run_submissions_user_id_fkey(...)`），這是 PostgREST 的語法，不是 SQL 拼接。
- ✅ database 端的 plpgsql 函式內部 SQL 皆使用變數綁定（`v_sub.km` 等），無動態 SQL。

---

## 3. 風險清單

### 🔴 危險（必須修）

#### 危險 #1 — `add_points` RPC 可被任意人呼叫，導致積分可被任意竄改

- **位置**：`supabase/schema.sql:263-283`；資料庫物件 `public.add_points(uuid, integer, text, text, uuid)`
- **風險說明**：此函式為 `security definer`，但**函式體內完全沒有任何身分或權限檢查**，且未被收回 Supabase 預設授予 `anon` / `authenticated` 的 EXECUTE 權限。它接受任意 `p_user_id` 與 `p_delta`，執行後會同時寫入 `point_transactions` 並更新 `profiles.points`。
- **攻擊情境**（**已實際驗證成功**）：
  1. 攻擊者開啟網站 → 開瀏覽器開發者工具 → 從 JS bundle 取得 anon key（本來就是公開的）。
  2. 呼叫 `GET /rest/v1/public_leaderboard` 取得全體會員 UUID（**不需任何登入**）。
  3. 執行一行指令即完成攻擊：
     ```bash
     curl -X POST 'https://<your-project-ref>.supabase.co/rest/v1/rpc/add_points' \
       -H 'apikey: <anon key>' -H 'Content-Type: application/json' \
       -d '{"p_user_id":"<任意會員 uuid>","p_delta":999999,"p_reason":"x"}'
     ```
  - 結果：該會員積分立刻變成 999999，`point_transactions` 同時被寫入偽造紀錄。也可對他人傳負值把積分歸零（`greatest(points + p_delta, 0)`）。**整個攻擊過程不需要註冊、不需要登入、不需要任何程式技巧。**
- **實測證據**（見附錄 T5）：以**匿名**呼叫，伺服器回傳
  `HTTP 409 {"code":"23503","message":"insert or update on table \"point_transactions\" violates foreign key constraint"}`。
  這個「外鍵錯誤」代表**程式已經順利通過權限檢查並執行到 INSERT 語句**——若被擋下，應該像對照組 T6 一樣回傳 `只有管理員可以核銷優惠券`。我們刻意使用不存在的 UUID，讓交易在寫入前就 rollback，**正式資料庫零變動**。
- **修法**（兩者都做，深度防禦）：
  ```sql
  -- (a) 函式內加檢查（主要防線）
  create or replace function public.add_points(
    p_user_id uuid, p_delta integer, p_reason text,
    p_ref_type text default null, p_ref_id uuid default null
  )
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if not public.is_admin() then
      raise exception '只有管理員可以調整積分';
    end if;

    insert into public.point_transactions (user_id, delta, reason, ref_type, ref_id)
    values (p_user_id, p_delta, p_reason, p_ref_type, p_ref_id);

    update public.profiles
       set points = greatest(points + p_delta, 0)
     where id = p_user_id;
  end;
  $$;

  -- (b) 收回匿名/一般會員的呼叫權（此函式從未被前端或 API 直接呼叫，可安全收回）
  revoke all on function public.add_points(uuid, integer, text, text, uuid)
    from anon, authenticated;
  ```
  > 註：`add_points` 目前僅由 `review_run_submission`、`review_checkin`、`award_monthly_if_qualified` 三支 security-definer 函式**內部**呼叫；這三支都已先做 `is_admin()` 檢查，因此加上權限檢查不會影響任何正常功能。經 grep 確認 `src/` 中沒有任何地方直接呼叫 `add_points`。
  > 註：`CREATE OR REPLACE FUNCTION` 會保留既有的 ACL，所以日後重跑 schema.sql 不會讓 revoke 失效。

#### 危險 #2 — `monthly_qualified_list` RPC 洩漏全體達標會員的電郵

- **位置**：`supabase/schema.sql:514-540`；資料庫物件 `public.monthly_qualified_list(text)`
- **風險說明**：此函式為 `security definer`，**沒有任何授權檢查**，且 `left join auth.users u` 明確取出 `u.email`。因為以 definer 權限執行，它**繞過了 `auth.users` 的保護**——正常情況下匿名角色絕對讀不到 auth.users。
- **攻擊情境**：任何訪客（不必登入）猜任一月份即可下載「姓名 + 電郵 + 里程」清單。攻擊者只要用簡單迴圈遍歷 `2026-01` ~ `2026-12`，就能建立完整的**會員名單（含電郵）**，可直接用於釣魚郵件或轉賣。對澳門社團而言，這同時涉及《個人資料保護法》的通報義務。
- **實測證據**（見附錄 T11，電郵已遮蔽）：
  ```
  POST /rest/v1/rpc/monthly_qualified_list  {"p_month":"2026-09"}
  HTTP 200
  [{"user_id":"915fb674-...","name":"小玲","email":"runner2@****.test",
    "total_km":305.00,"runs":2,"has_coupon":true}]
  ```
  **未帶任何 Authorization、僅用 anon key，即成功取得會員電郵。**
- **修法**：改寫為 plpgsql 並加入管理員檢查。
  ```sql
  create or replace function public.monthly_qualified_list(p_month text)
  returns table (user_id uuid, name text, email text, total_km numeric,
                 runs bigint, has_coupon boolean)
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
  begin
    if not public.is_admin() then
      raise exception '只有管理員可以查閱達標名單';
    end if;

    return query
    select s.user_id,
           p.display_name,
           u.email::text,
           s.total_km,
           s.runs,
           exists (select 1 from public.coupons c
                    where c.user_id = s.user_id and c.month_awarded = p_month)
      from public.monthly_running_stats s
      join public.profiles p on p.id = s.user_id
      left join auth.users u on u.id = s.user_id
     where s.period_month = p_month
       and s.total_km >= public.setting_num('monthly_goal_km', 300)
     order by s.total_km desc;
  end;
  $$;

  -- 收回匿名呼叫權（後台頁面用 admin 的 JWT 呼叫，屬於 authenticated，保留）
  revoke all on function public.monthly_qualified_list(text) from anon;
  grant execute on function public.monthly_qualified_list(text) to authenticated;
  ```
  > 附帶修正：原函式把 300km 門檻寫死，與後台 `monthly_goal_km` 設定不一致，改寫時一併改為讀取設定值。

#### 危險 #3 — 正式環境存在帳密寫死在程式碼中的示範帳號

- **位置**：`seed.mjs:20-24`
  ```js
  const USERS = [
    { email: "runner1@msw.test", password: "Test123456", name: "阿健" },
    { email: "runner2@msw.test", password: "Test123456", name: "小玲" },
    { email: "runner3@msw.test", password: "Test123456", name: "阿明" },
  ];
  ```
- **風險說明**：三個共用同一組弱密碼（`Test123456`）的示範帳號**確實存在於正式資料庫中**（稽核確認 `profiles` 有 5 筆、`auth.users` 有 5 筆，且 `runner2@msw.test` 的電郵在 T11 真實回傳）。密碼與電郵都以明文寫死在版本控管的檔案裡。
- **攻擊情境**：任何能看到此程式碼的人（若 repo 曾公開、外洩、或交付給客戶的壓縮檔含此檔）都能直接登入這些帳號。登入後：
  1. 呼叫 `GET /rest/v1/coupons?select=*` 即可取得**該帳號所有優惠券的券碼**（RLS 允許本人讀取自己的券）→ **可在實體店直接核銷盜用**。
  2. 呼叫 `createSignedUrls` 取得並下載該帳號的跑步截圖。
  3. 若搭配 危險 #1，還能自我灌積分登上排行榜首名。
  目前不須 high-tech hacking，只要「知道帳密」即可得手。
- **修法**：
  1. **立即**在正式 Supabase 停用或刪除這三個 `*.msw.test` 帳號（Dashboard → Authentication → Users，或改為 `UPDATE auth.users SET banned_until = 'infinity'`）。
  2. 清理他們已產生的 `coupons` / `run_submissions` 資料，或將其重建為不含有效券碼的乾淨帳號。
  3. 確認 `seed.mjs` 不會被執行到正式環境；把示範密碼改從環境變數讀取，或直接從 repo 移除這份檔案。
  4. 交付給客戶前，全面盤點是否有其他「測試用帳號」殘留（含管理員帳號）。

---

### 🟠 高（建議修）

#### 高 #4 — `award_monthly_if_qualified` RPC 缺少授權檢查

- **位置**：`supabase/schema.sql:304-351`
- **風險說明**：與 #1 同類——`security definer`、`search_path` 有鎖、**但沒有任何 `is_admin()` 或 `auth.uid()` 檢查**，且 `anon` / `authenticated` 都有 EXECUTE 權限。任何人可以替任意 `p_user_id` 觸發月度獎勵結算。
- **攻擊情境**：雖然函式內有「當月已 approved 里程須達標」與「同一個月只發一次」兩道檢查，攻擊者無法單靠它憑空生積分，但仍可：
  - 對已達標會員強制發放獎勵券（干擾後台作業節奏、團擾）；
  - 透過回傳的 boolean 值側向探測「某會員某月是否已達標」（資訊洩漏）；
  - 大量併發呼叫造成資料庫負載（`gen_coupon_code` 內含迴圈）。
- **修法**：此函式僅由 `review_run_submission` 內部呼叫，`src/` 中沒有任何地方直接呼叫，可安全收回權限：
  ```sql
  revoke all on function public.award_monthly_if_qualified(uuid, text)
    from anon, authenticated;
  ```
  建議同時收回同樣「僅供內部使用」的兩個輔助函式：
  ```sql
  revoke all on function public.setting_num(text, numeric) from anon, authenticated;
  revoke all on function public.gen_coupon_code(text)      from anon, authenticated;
  revoke all on function public.is_admin()                 from anon, authenticated;
  ```

#### 高 #5 — Storage bucket 未限制檔案大小與 MIME 類型

- **位置**：`supabase/schema.sql:629-631`；`storage.buckets` 的 `file_size_limit = null`、`allowed_mime_types = null`
- **風險說明**：所有使用者 invokable  Upload 限制只做在 Next.js 層（`src/app/api/runs/route.ts:42-50` 的 8MB 與副檔名白名單）。攻擊者可用自己的 JWT **繞過網站直接打 Storage API**，上傳任意 MIME、任意大小的檔案到自己的目錄。
- **攻擊情境**：
  1. 上傳 `x.html` 或含 script 的 `.svg`，再透過 signed URL 在 `*.supabase.co` 網域下開啟 → **可用於釣魚頁面**（內容會顯示在可信的 Supabase 網域）。
  2. 反覆上傳大型檔案（例如單檔 5GB）→ **耗盡專案儲存空間與流量配額**，造成服務中斷與額外費用；免費／Pro 方案的 Supabase 有配額限制。
- **修法**：
  ```sql
  update storage.buckets
     set file_size_limit    = 10485760,                        -- 10MB
         allowed_mime_types = array['image/png','image/jpeg','image/webp','image/heic']
   where id = 'run-screenshots';
  ```
  這會在 Storage 服務層擋下不合規的上傳，程式碼層的檢查繼續保留做第二道防線。

#### 高 #6 — 缺少暴力破解防護（無 Captcha、密碼過短、無鎖定機制）

- **位置**：Supabase 專案 Auth 設定；前端 `src/app/api/auth/signup/route.ts:23`
- **風險說明**：`security_captcha_enabled=false`、`password_min_length=6`、應用層完全沒有登入失敗次數限制。雖然 Supabase 平台有基礎的按 IP 速率限制，但它是**按來源 IP 計算**，對單一帳號的分散式密碼猜測幫助有限，也無法防止針對特定管理員帳號的長期嘗試。
- **攻擊情境**：攻擊者針對已知的管理員帳號持續嘗試弱密碼。管理員帳號一旦淪陷，攻擊者可自行核准假跑步紀錄、自我發券、並替自己的券核銷——等同完全控制積分與優惠券體系。
- **修法**：
  1. Supabase Dashboard → Authentication → Settings：啟用 **CAPTCHA**（hCaptcha 或 Turnstile），並套用到 Sign up / Sign in。考量澳門使用者體驗，**Cloudflare Turnstile** 干擾較低。
  2. 提高密碼最短長度至 **8 碼以上**，前後端同步修改：`src/app/api/auth/signup/route.ts:23`
     ```ts
     if (password.length < 8)
       return NextResponse.json({ ok:false, error:"密碼至少需要 8 個字元。" }, { status:400 });
     ```
  3. 為管理員帳號啟用 **MFA（TOTP）**——專案已支援（`mfa_totp_enroll_enabled=true`）。
  4. 建議設定 `sessions_inactivity_timeout`（例如 86400 秒）降低長期 session 被盜用風險。
  5. 上線後持續監看 Supabase Dashboard 的 Auth 日誌，對異常失敗次數進行告警。

#### 高 #7 — `mailer_autoconfirm = true`（免電郵驗證）

- **位置**：Supabase 專案 Auth 設定
- **風險說明**：詳見 §2.5。無法驗證 membership 真實性，可被大量註冊假帳號污染公開排行榜與 `site_stats.members`；忘記密碼流程亦可能把帳號控制權交給非電郵所有人。
- **修法**：
  1. **建議做法**：Dashboard → Authentication → Sign In / Providers → 關閉 `Confirm email`。並設定 SMTP，讓本站 `src/app/api/auth/signup/route.ts:36,43` 既有的 `emailRedirectTo` 機制生效（程式碼**已經寫好**了，只差開關）。
  2. 若營運上堅持保留免驗證（降低註冊摩擦）：
     - 務必搭配 #6 的 Captcha；
     - 修改 `public_leaderboard` 只列出「當月有 approved 活動」的會員（同時緩解 #9）；
     - 在註冊頁面明確告知這是社群網站、公開資訊有哪些。

---

### 🟡 中（可排程）

#### 中 #8 — `monthly_running_stats` view 匿名可讀，洩漏全體會員逐月里程

- **位置**：`supabase/schema.sql:185-193`
- **風險說明**：此 view 由 `postgres` 擁有、未設定 `security_invoker`，在 PostgreSQL 17 預設即為**擁有者權限執行**，因此**完全繞過底層 `run_submissions` 的 RLS**。任何匿名訪客都能讀取所有會員的 user_id、月份、當月里程、活動次數。
- **實測證據**（見附錄 T3）：匿名呼叫回傳
  `[{"user_id":"915fb674-...","period_month":"2026-09","total_km":305.00,"runs":2}, ...]`
- **修法**：改為只由後端使用的 RPC，或改寫 view 隱去 user_id、只提供名次 + 暱稱：
  ```sql
  -- 方案 A（推薦）：建立不暴露 user_id 的公開 view，並收回匿名對原 view 的讀取權
  create view public.leaderboard_monthly
  with (security_invoker = false) as
  select row_number() over (partition by s.period_month order by s.total_km desc) as rank,
         s.period_month, p.display_name, p.avatar_url, s.total_km, s.runs
    from public.monthly_running_stats s
    join public.profiles p on p.id = s.user_id;

  grant select on public.leaderboard_monthly to anon, authenticated;
  revoke select on public.monthly_running_stats from anon, authenticated;
  ```
  再把 `src/lib/queries.ts:77-90` 的 `getMonthlyLeaderboard` 改讀 `leaderboard_monthly`（不再需要第二段 `public_leaderboard` 查詢）。

#### 中 #9 — `public_leaderboard` 暴露全體會員 UUID 與零活動會員名冊

- **位置**：`supabase/schema.sql:197-208`
- **風險說明**：view 同時輸出 `id`（auth user UUID）與全體會員，包含完全沒有任何活動者。雖然這是刻意設計（`security_invoker=false` + `grant to anon`），但 (a) 洩露的 UUID 是 #1 攻擊的現成目標清單；(b) 對註冊網站而言，「所有註冊者暱稱一律公開」應取得會員同意。
- **實測證據**（見附錄 T2）：匿名回傳全部 5 位會員，其中 3 位 `total_km = 0`。
- **修法**：
  ```sql
  -- 移除 id 欄位，且只列出有實際活動記錄的會員
  drop view if exists public.public_leaderboard cascade;
  create view public.public_leaderboard
  with (security_invoker = false) as
  select display_name, avatar_url, points, total_km
    from public.profiles
   where total_km > 0 or points > 0;

  grant select on public.public_leaderboard to anon, authenticated;
  ```
  > 注意：`src/lib/queries.ts:87-90` 目前用 `.in("id", ids)` 依賴 `id` 欄位，移除後必須同步改寫 `getMonthlyLeaderboard`（可配合 #8 的方案 A 一併調整）。

#### 中 #10 — `profiles` INSERT policy 未限制 `role` / `points` / `total_km`

- **位置**：`supabase/schema.sql:561-563`
  ```sql
  create policy "profiles_insert_self" on public.profiles
    for insert with check (auth.uid() = id);
  ```
- **風險說明**：`guard_profile_sensitive_fields` trigger（`supabase/schema.sql:90-93`）只掛在 **`BEFORE UPDATE`**，沒有對應的 `BEFORE INSERT` 防護。正常註冊流程下 `handle_new_user` trigger 會立刻建立 profile，會員無法插入第二筆（PK 衝突），所以目前無法利用。但若日後因資料修復／GDPR 刪除請求等原因造成「auth 使用者存在、profile 卻不存在」的狀態，該會員就能自行 INSERT 並指定 `role='admin'`、`points=999999`，**瞬間取得管理員身分**。
- **修法**（深度防禦，同時補上 INSERT 防護）：
  ```sql
  create or replace function public.guard_profile_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if auth.uid() is null then return new; end if;   -- 後端/service_role 放行
    if not public.is_admin() then
      new.role     := 'member';
      new.points   := 0;
      new.total_km := 0;
    end if;
    return new;
  end;
  $$;

  drop trigger if exists profiles_guard_insert on public.profiles;
  create trigger profiles_guard_insert
    before insert on public.profiles
    for each row execute function public.guard_profile_insert();
  ```

#### 中 #11 — 管理員操作缺少稽核軌跡

- **位置**：`review_run_submission`、`review_checkin`、`issue_coupons`、`redeem_coupon`
- **風險說明**：這四支函式雖然都有正確的 `is_admin()` 檢查，但**都沒有寫入稽核紀錄**。若發生爭議（例如管理員否認核銷過某張券、或疑似內部濫權），無法追溯是誰在什麼時間做了什麼。`run_submissions.reviewed_by` / `reviewed_at` 有記錄，**但 `coupons.redeemed_at` 沒有 `redeemed_by`**，`training_checkins.confirmed_by` 有記錄但 `point_transactions` 沒有操作者欄位。
- **修法**：為 `coupons` 增加 `redeemed_by uuid references profiles(id)`，並在 `redeem_coupon` 中寫入；長期建議建立統一的 `admin_audit_log` 表記錄所有管理員操作。

---

### 🟢 低（可接受）

#### 低 #12 — `gen_coupon_code` 未設定 `search_path`

- **位置**：`supabase/schema.sql:286-301`
- **說明**：唯一未設定 `set search_path = public` 的函式。但它是 `security invoker`，呼叫者（`anon`/`authenticated`）無權建立物件，實務上無法構成注入攻擊。建議補上以求一致性：
  ```sql
  alter function public.gen_coupon_code(text) set search_path = public;
  ```

#### 低 #13 — UUID 參數未做格式驗證

- **位置**：`src/app/api/admin/review-run/route.ts:36`、`review-checkin/route.ts:33`、`src/app/api/runs/route.ts:103`
- **說明**：`submission_id` / `checkin_id` / `id` 未先驗證 UUID 格式即傳入 DB。因全部走參數化 RPC，非法值會由 PostgreSQL 回傳型別錯誤，**無注入風險**，僅錯誤訊息較不友善。可選修正：
  ```ts
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!submission_id || !UUID_RE.test(submission_id))
    return NextResponse.json({ ok:false, error:"提交編號格式錯誤。" }, { status:400 });
  ```

#### 低 #14 — `app_settings` 對匿名可讀

- **位置**：`supabase/schema.sql:250-252`
- **說明**：`settings_select_all` 政策對所有人開放，匿名可讀取 `points_per_km`、`monthly_goal_km` 等商業規則。這些並非機密，且設定本就要讓所有人知道遊戲規則，屬於**可接受**。但需注意未來若把任何敏感資訊放進 `app_settings` 就會外洩，建議在檔案加註警語。

#### 低 #15 — Session 無閒置／絕對逾時上限

- **位置**：Supabase Auth 設定 `sessions_timebox = 0`、`sessions_inactivity_timeout = 0`
- **說明**：目前 session 只要持續活動就不會過期（`jwt_exp=3600` + refresh token rotation 啟用 ✅）。對一般社群網站屬可接受，建議管理員端設定較短的 `inactivity_timeout`。

#### 低 #16 — 未定義自訂 Security Headers

- **位置**：`next.config.ts`（無 `headers()` 區塊）
- **說明**：未設定 CSP、`X-Frame-Options`、`Referrer-Policy` 等。因本站無 `dangerouslySetInnerHTML`、無第三方腳本，`SameSite=Lax` cookie 已有基本防護，XSS/點擊劫持風險低。列為強化建議：
  ```ts
  const securityHeaders = [
    { key: "X-Frame-Options",        value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
  ];
  ```

---

## 4. 安全性確認清單（客戶問答）

> 以下每題皆附上本次稽核的實測依據。

**Q1：會員資料是否只存在後端資料庫？**
✅ **是。** 所有會員資料（暱稱、電郵、電話、積分、里程）都存放在 Supabase 的 `profiles` / `auth.users` 表中。稽核確認：前端 JS bundle（`.next/static/**`）**不含任何會員資料**，也**不含任何密鑰**；瀏覽器執行的程式碼沒有直接連資料庫的能力（所有寫入都走伺服器端 API）。
⚠️ **但要注意**：為了排行榜功能，`public_leaderboard` view 會把**全體會員的暱稱、積分、里程**公開給任何訪客。這是設計上的取捨，建議調整為只列出有活動記錄者（中 #9）。**電郵與電話從未公開**——唯一的例外是危險 #2，必須修掉。

**Q2：跑步截圖是否只有本人與管理員可以看？**
✅ **基本是的。** 稽核確認：bucket 為私有（`public=false`）；三條 Storage policy 都只授權 `authenticated`，且強制「路徑第一段 = 自己 UUID」或「是管理員」；**匿名訪客實測下載他人截圖失敗（404）**；Supabase 官方規範下，產生 signed URL 需要通過同一條 SELECT policy，因此**會員 A 無法替會員 B 產生連結**。
⚠️ **一個前提補充**：signed URL 一旦產生，就是「持有連結者在 1 小時內都能開」，不受登入狀態限制（這是雲端儲存的一般特性）。本站由伺服器動態產生、有效期限 1 小時、且頁面不快取，**實際風險很低**。若日後有「會員把截圖連結貼到群組」的疑慮，可再縮短期限或改為伺服器端代理下載。

**Q3：非管理員能否竄改積分？**
❌ **目前「可以」——這是本次最嚴重的問題，必須立即修復。**
雖然網站本身的程式碼完全正確（後台 API 都有擋），但攻擊者可以完全繞過網站，只靠瀏覽器裡公開的 anon key 直接呼叫資料庫的 `add_points` 函式，把任何人的積分改成任意數字。**已實際驗證成功**（危險 #1）。修法請見 §3 的 SQL，約 15 行即可修完。

**Q4：會員 A 能否看到或修改會員 B 的資料？**
✅ **透過資料庫表格：不能。** 七張表的 RLS policy 正確限制為「本人或管理員」。
❌ **透過 RPC：目前部分可以。** `monthly_qualified_list` 會洩漏他人姓名與電郵（危險 #2）、`add_points` 可修改他人積分（危險 #1）、`monthly_running_stats` 可看到他人逐月里程（中 #8）。修完這三項後即可完全回答「不能」。

**Q5：攻擊者能否取得層'ls.admin' 管理員權限？**
✅ **不能。** 管理員權限由 `profiles.role` 決定，`guard_profile_sensitive_fields` trigger 會阻止非管理員修改自己的 role；也沒有任何可以自我提升權限的路徑。
⚠️ **但管理員帳號本身的保護不足**：無 MFA（技術上已支援）、無 Captcha、密碼最短 6 碼、無登入失敗鎖定。**強烈建議為管理員啟用 MFA**（高 #6）。

**Q6：網站有沒有被植入恶意程式的風險（XSS）？**
✅ **沒有發現。** 全專案沒有使用 `dangerouslySetInnerHTML` 或直接操作 `innerHTML`；React 會自動跳脫所有使用者輸入（暱稱、備註、券券說明）。駭客在暱稱欄貼 `<script>` 也只會顯示成純文字。

**Q7：資料庫有沒有被盜資料的風險（SQL 注入）？**
✅ **沒有發現。** 全專案沒有任何 SQL 字串拼接，一律使用 Supabase 客戶端或參數化 RPC。

**Q8：有沒有萬能鑰匙（service_role key）外洩？**
✅ **沒有。** 程式碼、環境變數、編譯產物中都搜尋不到 `service_role`、`sbp_`、`SUPABASE_SERVICE`。`.env.local` 只有 anon key 與網址，且已被 `.gitignore` 排除於版控。**本案從頭到尾沒有使用 service_role key**，這是很好的做法。

**Q9：網站的連線是否加密？**
✅ 是。全站強制 HTTPS（Vercel 預設 + Supabase 皆為 HTTPS），session cookie 為 `httpOnly` + `Secure` + `SameSite=Lax`。

---

## 5. 建議修復順序

| 順序 | 項目 | 預估工時 | 可否立即上線 |
|---|---|---|---|
| **1（上線前必做）** | 危險 #1 `add_points` 加管理員檢查 + 收回權限 | 15 分鐘 | ❌ 修完才能上線 |
| **2（上線前必做）** | 危險 #2 `monthly_qualified_list` 重構 + 收回匿名權 | 15 分鐘 | ❌ 修完才能上線 |
| **3（上線前必做）** | 危險 #3 停用／刪除正式站 3 個示範帳號 | 20 分鐘 | ❌ 修完才能上線 |
| 4 | 高 #4 收回 `award_monthly_if_qualified` 等內部函式權限 | 5 分鐘 | ✅ |
| 5 | 高 #5 設定 bucket 檔案大小／MIME 限制 | 5 分鐘 | ✅ |
| 6 | 高 #6 啟用 Captcha、密碼改 8 碼、管理員啟 MFA | 1 小時 | ✅ |
| 7 | 高 #7 決定是否開啟電郵驗證 | 1 小時 | ✅ |
| 8 | 中 #8 / #9 整頓公開排行榜 view | 2 小時 | ✅ |
| 9 | 中 #10 補 INSERT trigger | 20 分鐘 | ✅ |
| 10 | 中 #11 管理員操作稽核軌跡 | 半天 | ✅ |
| 11 | 低 #12～#16 強化項目 | 半天 | ✅ |

> 全部 1～3 項合計約 **50 分鐘**即可完成，之後本站在安全性上就是可交付的狀態。

---

## 6. 修復後驗證方式（提供給負責修復的同仁）

修完 #1、#2 後，請用以下指令確認已封堵（**全程唯讀，不會寫入資料**）：

```bash
# 測試 #1 是否已修 → 應回傳 401/403 或「只有管理員可以調整積分」，不再是 23503
curl -i -X POST 'https://<your-project-ref>.supabase.co/rest/v1/rpc/add_points' \
  -H "apikey: <anon key>" -H 'Content-Type: application/json' \
  -d '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_delta":1,"p_reason":"verify"}'
#  預期：HTTP 401/403 或 message 含「只有管理員」；❌ 若仍出現 23503 表示未修好

# 測試 #2 是否已修 → 匿名呼叫應被拒絕，不得回傳含 email 的資料
curl -i -X POST 'https://<your-project-ref>.supabase.co/rest/v1/rpc/monthly_qualified_list' \
  -H "apikey: <anon key>" -H 'Content-Type: application/json' \
  -d '{"p_month":"2026-09"}'
#  預期：HTTP 401/403；❌ 若回傳 200 且含有 email 欄位表示未修好
```

---

## 7. 給非技術客戶看的重點摘要

1. **網站的設計本身是好的，但有 3 個地方要在交付前補起來。**
   技術團隊把程式寫得很仔細，該檢查權限的地方幾乎都有做。問題出在資料庫設定比較鬆，而這 3 個問題的修法都很快（加起來約 50 分鐘），不需要打掉重寫。

2. **目前任何人都能幫自己或別人灌積分（最嚴重）。**
   不需要駭客技術，只要複製網站程式裡公開的一組驗證碼，就能把排行榜的積分改成任何數字。這會讓排行榜失去公信力。**這是本次唯一「建議修正前不要上線」的項目之一**，但修法很單純。

3. **目前任何人都能下載會員的電郵清單（涉及個資）。**
   不需要登入就能取得「姓名 + 電郵 + 跑步里程」的清單，可能被用來發垃圾信或詐騙。澳門《個人資料保護法》對這類洩漏有規範，**建議正式招收會員前務必先修掉**。

4. **正式站上還留著測試用的會員帳號，密碼是寫在程式裡的固定值。**
   這些帳號有拿到優惠券的能力。建議在上線前把這幾個測試帳號刪掉，避免日後有人用它們領走真的優惠。

5. **會員的資料和跑步截圖，保護得比很多人想像的好。**
   截圖只有本人跟管理員看得到（駭客拿不到）；電郵電話沒有公開在網站上；跑步里程雖然在排行榜上公開，但那是網站本身的功能。比較需要注意的是管理員帳號本身沒有雙重驗證，建議啟用以防被人猜到密碼。

---

## 8. 附錄：實測證據

> 以下所有測試**全程僅使用網站前端本來就公開的 anon key**，且**未對正式資料庫寫入任何資料**。
> 對可能造成寫入的 RPC（`add_points`），刻意傳入不存在的 UUID，讓交易在寫入前因外鍵限制而 rollback，確保資料庫零變動。

### T1 — 匿名讀取 `profiles`（預期：被 RLS 阻擋）
```
GET /rest/v1/profiles?select=id,display_name,role,points,phone
Authorization: Bearer <anon key>     （僅 apikey + anon role，無使用者 JWT）
=> HTTP 200
[]
```
✅ **通過**：匿名無法讀取任何會員資料。

### T2 — 匿名讀取 `public_leaderboard`（洩漏全體會員 UUID）
```
GET /rest/v1/public_leaderboard?select=id,display_name,points,total_km
=> HTTP 200
[{"id":"3e018b5d-...","display_name":"阿明","points":0,"total_km":0.00},
 {"id":"e713f790-...","display_name":"MSW 管理員","points":0,"total_km":0.00},
 {"id":"915fb674-...","display_name":"小玲","points":505,"total_km":305.00},
 {"id":"fb8dae8a-...","display_name":"阿健","points":31,"total_km":20.80},
 {"id":"9776a096-...","display_name":"nokia","points":0,"total_km":0.00}]
```
⚠️ **發現**：全體 5 位會員含 UUID 全數曝光，其中 3 位完全無活動記錄。（中 #9）

### T3 — 匿名讀取 `monthly_running_stats`（繞過 RLS）
```
GET /rest/v1/monthly_running_stats?select=*
=> HTTP 200
[{"user_id":"915fb674-...","period_month":"2026-09","total_km":305.00,"runs":2},
 {"user_id":"fb8dae8a-...","period_month":"2026-09","total_km":20.80,"runs":2}]
```
⚠️ **發現**：匿名取得全體會員逐月里程。（中 #8）

### T4 — 匿名呼叫 `monthly_qualified_list`（錯誤月份，無資料）
```
POST /rest/v1/rpc/monthly_qualified_list   {"p_month":"2025-09"}
=> HTTP 200  []
```

### T5 — 匿名呼叫 `add_points`（🔴 關鍵證據）
```
POST /rest/v1/rpc/add_points
{"p_user_id":"00000000-0000-0000-0000-000000000000","p_delta":1,"p_reason":"audit-probe"}
=> HTTP 409
{"code":"23503",
 "details":"Key (user_id)=(00000000-0000-0000-0000-000000000000) is not present in table \"profiles\".",
 "message":"insert or update on table \"point_transactions\" violates foreign key constraint"}
```
🔴 **證明 #1 成立**：「23503 外鍵違反」代表程式**已通過 EXECUTE 權限檢查並實際執行到 INSERT 語句**。若函式有正確授權檢查，應像 T6 一樣回傳業務錯誤。攻擊者只要換成真實 UUID（可由 T2/T3 匿名取得），即可任意竄改積分。**本測試刻意使用不存在 UUID，交易已 rollback，資料庫零變動。**

### T6 — 匿名呼叫 `redeem_coupon`（對照組，預期被擋）
```
POST /rest/v1/rpc/redeem_coupon   {"p_code":"MSW-000000-XXXXX"}
=> HTTP 400  {"code":"P0001","message":"只有管理員可以核銷優惠券"}
```
✅ **通過**：證明 T5 的差異來自「此函式有檢查、add_points 沒有」，而非環境因素。

### T7 — 匿名讀取 storage objects 列表
```
GET /rest/v1/objects?select=name&bucket_id=eq.run-screenshots
=> HTTP 404  {"code":"PGRST205","message":"Could not find the table 'public.objects'"}
```

### T8 — 匿名列出 storage buckets
```
GET /storage/v1/bucket
=> HTTP 200  []
```
✅ **通過**：匿名無法列舉儲存空間。

### T9 — 匿名直接下載他人截圖（無 signed URL）
```
GET /storage/v1/object/run-screenshots/915fb674-.../1790136638107-8u25sl.png
=> HTTP 400  {"statusCode":"404","error":"not_found","message":"Object not found"}
```
✅ **通過**：截圖受保護。

### T10 — 匿名存取偽造的簽名路徑
```
GET /storage/v1/object/sign/run-screenshots/915fb674-.../1790136638107-8u25sl.png?token=forged
=> HTTP 400  {"statusCode":"400","error":"InvalidJWT","message":"Invalid Compact JWS"}
```
✅ **通過**：簽名無法偽造。

### T11 — 匿名呼叫 `monthly_qualified_list`（正確月份，🔴 電郵洩漏）
```
POST /rest/v1/rpc/monthly_qualified_list   {"p_month":"2026-09"}
Authorization: Bearer <anon key>
=> HTTP 200
[{"user_id":"915fb674-...","name":"小玲","email":"runner2@****.test",
  "total_km":305.00,"runs":2,"has_coupon":true}]
```
🔴 **證明 #2 成立**：**完全未登入、僅用公開 anon key，即取得會員真實電郵。**（報告中電郵已部分遮蔽）

---

### 資料庫結構查詢（唯讀）

| 編號 | 查詢內容 | 結果摘要 |
|---|---|---|
| R1 | `pg_class` RLS 狀態 | 7 張表全部 `relrowsecurity = true` ✅ |
| R2 | `pg_policies` (public) | 19 條 policy，逐條審閱完畢 |
| R3 | `pg_proc` 函式設定 | 12 支函式，11 支已鎖 `search_path`；6 支缺內部授權檢查 |
| R4 | 函式 EXECUTE 授權 | **`anon` 與 `authenticated` 對全部 12 支函式都有 EXECUTE** ⚠️ |
| R5 | `pg_policies` (storage) | 3 條 policy，均限制 `authenticated` + 路徑歸屬 ✅ |
| R6 | `storage.buckets` | `public = false` ✅；`file_size_limit` / `allowed_mime_types` 皆為 null ⚠️ |
| R7 | view 的 `security_invoker` | `public_leaderboard` 明確 `false`；`monthly_running_stats`、`site_stats` 未設定（等同 owner 權限）⚠️ |
| R8 | 資料表授權 | anon/authenticated 對各表有完整 DML 授權（Supabase 預設，靠 RLS 保護）|
| R9 | PostgreSQL 版本 | 17.6 |
| R10 | 資料筆數 | profiles 5、run_submissions 4、checkins 1、coupons 3、points 6、sessions 9、auth.users 5、storage.objects 4 |
| R11 | storage 物件清單 | 4 筆，路徑格式 `{uid}/{ts}-{rand}.png`，`owner` 與路徑第一段一致 ✅ |
| R12 | bucket 限制設定 | 見 R6 |

### Supabase Auth 設定（唯讀，取自 Management API）

| 設定 | 值 | 判定 |
|---|---|:---:|
| `mailer_autoconfirm` | `True` | ⚠️ 高 #7 |
| `security_captcha_enabled` | `False` | ⚠️ 高 #6 |
| `password_min_length` | `6` | ⚠️ 高 #6 |
| `security_update_password_require_reauthentication` | `False` | 低 |
| `sessions_timebox` / `sessions_inactivity_timeout` | `0` / `0` | 低 #15 |
| `jwt_exp` | `3600` | ✅ |
| `refresh_token_rotation_enabled` | `True` | ✅ |
| `mfa_totp_enroll_enabled` / `verify_enabled` | `True` / `True` | ✅ 可用 |
| `disable_signup` | `False` | — |
| `rate_limit_email_sent` / `verify` / `otp` | `2` / `30` / `30` | ✅ 平台級存在 |

---

*本報告由後端工程師白客產出。稽核過程未修改任何程式碼、未執行任何寫入或 DDL、未變動任何正式資料。*
