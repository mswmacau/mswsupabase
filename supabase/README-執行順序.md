# Supabase SQL 執行順序與「不要重跑」清單

> 最後更新：2026-11-14（P1-A / P1-B 安全修補同批）
> 專案：mswsupabase　Supabase ref：`yaacbsdltqfdzwmawzes`
> 適用對象：任何要在這個專案上跑 SQL 的人（含未來的你）

## 先看這三句

1. **`schema.sql` 不要重跑。** 它是 2026 年初的 bootstrap，之後被 20 支 migration 層層取代。重跑會把 4 個已修好的安全性洞打回原形（見下方「重跑就回歸的四個洞」）。
2. **不確定現在是什麼狀態？跑 `migration-schema-reconcile.sql`。** 它冪等、不改資料、不改表結構，跑完就把安全性拉回正確狀態。
3. **只想確認有沒有事？** 跳到文末「三條驗證 SQL」。

---

## 一、正確的執行順序（全新環境重建時）

分六組，**組內順序不可顛倒**，組間有依賴的已標註。

### 第 0 組：bootstrap

| # | 檔案 | 性質 |
|---|---|---|
| 1 | `schema.sql` | 建表、RLS 政策、核心 RPC。**僅供全新空環境** |
| 2 | `schema-r6.sql` | events / site_theme / storage bucket / `monthly_leaderboard` |

### 第 1 組：會員與管理員

| # | 檔案 | 性質 |
|---|---|---|
| 3 | `migration-admin-members.sql` | 3 支會員管理函式 |
| 4 | `migration-admin-members-v2.sql` | **新增 `profiles.status` / `status_reason` / `status_updated_at`** ← 第 5 組的前置條件 |
| 5 | `migration-member-purge.sql` | 會員資料清除 |

### 第 2 組：班表

| # | 檔案 | 性質 |
|---|---|---|
| 6 | `migration-training-schedule.sql` | 移除「一日一場」唯一約束、多課並行 |
| 7 | `migration-coaches.sql` | 教練資料 |
| 8 | `migration-schedule-legend.sql` | 班表圖例 |
| 9 | `migration-training-months.sql` | **按月發布 + `is_month_visible()`；並取代 `sessions_select_all`** |

> 第 9 支必須最後跑：它的 B-2 段會 `drop policy "sessions_select_all"`。
> 若之後有人重跑 `schema.sql`，那條 `using (true)` 會復活，與這裡的
> `sessions_select_visible` 形成 permissive OR → 草稿月份班表外洩。

### 第 3 組：活動、報名、付款

| # | 檔案 | 性質 |
|---|---|---|
| 10 | `migration-analytics.sql` | `page_views` |
| 11 | `migration-event-registrations.sql` | 活動報名（依賴第 10 支的分析表） |
| 12 | `migration-paid-events-1.sql` | 付費活動、`review_event_payment`、`award_paid_event_bonus` |
| 13 | `migration-security-fix-p0.sql` | **必須在第 12 支之後**：重寫付款預設值 trigger |
| 14 | `migration-hyrox-photos.sql` | HYROX 場次相片 |

### 第 4 組：網站內容

| # | 檔案 | 性質 |
|---|---|---|
| 15 | `migration-site-content.sql` | 內容與區塊設定（寫 `app_settings`） |
| 16 | `migration-site-draft.sql` | 草稿／發佈 |
| 17 | `migration-site-seo.sql` | SEO |
| 18 | `migration-home-slides.sql` | 首頁輪播 |
| 19 | `migration-audit-log.sql` | **`admin_audit_log`** ← 稽核日誌的唯一來源 |

### 第 5 組：點數

| # | 檔案 | 性質 | 前置 |
|---|---|---|---|
| 20 | `migration-points-r1-1-schema.sql` | 點數三表 + **6 欄版 `guard_profile_sensitive_fields`** | 需要第 4 支的 `profiles.status` |
| 21 | `migration-points-r1-2-earn.sql` | `award_*` 系列 | 第 20 支 |
| 22 | `migration-points-r1-3-redeem.sql` | 兌換 | 第 20 支 |
| 23 | `migration-points-r1-4-admin-grants.sql` | 管理員授權 | 第 20 支 |

### 第 6 組：排行榜與對帳（**2026-11-14 新增三支**）

| # | 檔案 | 性質 |
|---|---|---|
| 24 | `migration-admin-separation.sql` | 排行榜排除管理員 |
| 25 | `migration-leaderboard-no-id.sql` | **新**：排行榜移除 `id` / `user_id`，改 `public_code`（md5 前 8 碼） |
| 26 | `migration-schema-reconcile.sql` | **新**：冪等對帳，把上面所有安全性重新套一次（會順手補 `profiles.is_test` 欄位，但**不標記任何人**） |
| 27 | `migration-profile-test-flag.sql` | **新**：測試帳號旗標 `profiles.is_test`。標記 `nokia` / `test` / `nokiababy`，重建兩張排行榜 view 與 `site_stats` 加 `is_test = false`，新增後台 `admin_set_member_test` toggle，並把 `is_test` 納入 `guard_profile_sensitive_fields` 護欄。**站主在後台按「測試帳號」開關前必須先跑這支** |

### 資料類（不是 migration，**不要重跑**）

| # | 檔案 | 性質 | 為什麼不要重跑 |
|---|---|---|---|
| 27 | `seed-coach-fly.sql` | 教練種子 | 會重複插入 |
| 28 | `seed-events.sql` | 活動種子 | 會重複插入 |
| 29 | `cleanup-test-data.sql` | 清除測試資料 | **會刪資料**，且有 `where` 條件式刪除 |

---

## 二、重跑 `schema.sql` 會回歸的四個洞

這四個都實測過，也都已經在 `schema.sql` 內就地修正。列出來是為了讓你知道「為什麼不能重跑」不是迷信。

| # | 位置（修補前的 `schema.sql`） | 重跑後會發生什麼 | 現行正本在 |
|---|---|---|---|
| 1 | `schema.sql` 的 `sessions_select_all … using (true)` | 與 `sessions_select_visible` 形成 permissive OR → **草稿月份班表外洩** | `migration-training-months.sql` B-2 |
| 2 | `public_leaderboard` 定義缺 `where role = 'member'` | **管理員回到對外榜上** | `migration-admin-separation.sql` |
| 3 | `guard_profile_sensitive_fields` 只還原 3 欄 | 被停權會員可自行把 `status` 改回 `active` → **自我解封** | `migration-points-r1-1-schema.sql:362-432` |
| 4 | `drop view public_leaderboard **cascade**` | 把 `monthly_leaderboard` 一起砍掉卻不重建 → **月度榜消失** | `migration-leaderboard-no-id.sql` |

同一次修補另外處理了兩個同類問題（不在原清單，但同一類回歸）：

| # | 位置 | 問題 |
|---|---|---|
| 5 | `schema.sql` 的 `site_stats.members` | `count(*) from profiles` 含管理員（=8），與榜單 6 人、後台 6 人不一致 |
| 6 | `schema-r6.sql` §3 `monthly_leaderboard` | `join public_leaderboard p on p.id` —— 第 25 支移除 `id` 後這個 join 會斷，且它本身也外洩 `user_id` |

---

## 三、目前線上的實際狀態（2026-11-14 實測）

以 anon key 直打 PostgREST 探測，**所有 migration 建立的 21 張表都存在**，代表 27 支既有 SQL 全部已執行過。

| 項目 | 實測值 | 怎麼測的 |
|---|---|---|
| `site_stats.members` | 6 | `GET /rest/v1/site_stats?select=*` |
| `public_leaderboard` 列數 | 6 | `GET /rest/v1/public_leaderboard?select=*` |
| 後台會員數（含管理員） | 8 | service_role 查 `profiles`（客戶端提供之實測值） |
| `training_months` | 2026-11 published、2026-12 draft | `GET /rest/v1/training_months?select=*` |
| `public_leaderboard` 欄位 | `id, display_name, avatar_url, points, total_km` | **`id` 尚未移除 → 第 25 支還沒跑** |

> 三者（榜單 6 / 會員 6 / 統計 6）現在吻合，是因為 `site_stats` 已經排除管理員。
> 但 `id` 還在 view 裡，**P1-A 尚未修完，第 25 支一定要跑**。

---

## 四、三條驗證 SQL（貼進 SQL Editor）

```sql
-- 1) 排行榜欄位必須沒有 id / user_id（第 25 支跑完後）
select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('public_leaderboard', 'monthly_leaderboard')
 group by table_name;

-- 2) 舊的 permissive 政策必須不存在（只應看到 sessions_admin_all / sessions_select_visible）
select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'training_sessions'
 order by policyname;

-- 3) 護欄必須是 6 欄版（原始碼裡要看得到 status_updated_at）
select pg_get_functiondef('public.guard_profile_sensitive_fields()'::regprocedure);
```

再加一條「以匿名身分讀，看不到任何 UUID」：

```sql
begin;
  set local role anon;
  select * from public.public_leaderboard limit 1;
rollback;
```

---

## 五、常見誤操作

| 你可能想做的事 | 不要這樣做 | 應該這樣做 |
|---|---|---|
| 覺得資料怪，想「重新初始化」 | 跑 `schema.sql` | 跑 `migration-schema-reconcile.sql` |
| 想加一個新欄位 | 改 `schema.sql` 再跑一次 | 開一支新 migration |
| 想確認政策對不對 | 用 SQL Editor 直接 `select`（那是 postgres 身分，繞過 RLS） | 用 `begin; set local role anon; … rollback;` |
| 想讓排行榜恢復正常 | 只跑 migration（前端還是新的） | SQL 先跑，前端才部署（見下） |

### ⚠️ 部署順序

`migration-leaderboard-no-id.sql` 與前端（`src/lib/queries.ts` 改 select `public_code`）建議**一起上，SQL 先跑**。

- 順序正確：SQL → 部署前端 → 榜單 6 列正常、HTML 無任何 UUID
- 順序顛倒（前端先部署）：前端查 `public_code` 會拿到 42703「欄位不存在」，
  程式會自動降級改查舊欄位並印 `console.warn`，**榜單照常顯示 6 列不會消失**，
  但「較上月名次升降」會退化成用顯示名稱比對（改了暱稱的人會顯示 NEW）。
  這是刻意的保險，不是正常路徑；看到那行 warning 就代表 SQL 還沒跑。
