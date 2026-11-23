-- =============================================================
-- migration-security-monthly-stats.sql
-- 修復：一般會員可讀到其他會員的 user_id 與每月跑量
--
-- 【發現（2026-11-23，由 Supabase Security Advisor 的 Security Definer View
--        警告觸發的人工核查）】
--   `public.monthly_running_stats` 是 security definer view；
--   `revoke select … from anon` 只擋了匿名訪客，**authenticated 仍可讀全部列**。
--   實測（真會員帳號）：
--     GET /rest/v1/monthly_running_stats?select=user_id,period_month,total_km
--   → 讀到 4 位會員的 auth UUID 與每月公里數；
--   同時讀 `run_submissions` 底表是 0 列（RLS 正常）——即底表有保護，view 繞過了它。
--
-- 【影響】中。外洩「會員 UUID + 每月跑量」，不含姓名／電話／email。
--         但 UUID 是永久識別碼，且跑量屬行為資料，不應讓其他會員看到。
--
-- 【為什麼不能只加 WHERE 就算】
--   `public.monthly_leaderboard`（公開月度榜）就建在 monthly_running_stats 之上。
--   如果只在 stats 加 `user_id = auth.uid()`，匿名訪客 auth.uid() 是 null →
--   公開月度榜會變成 0 列。所以必須先把月度榜改成獨立聚合，再加限制。
--
-- 【本檔做三件事】
--   ① 重建 monthly_leaderboard：直接由 run_submissions 聚合（不再依賴 stats view），
--      對外仍只出 public_code（md5 前 8 位），不出 user_id。
--   ② 重建 monthly_running_stats：加 `and (user_id = auth.uid() or public.is_admin())`
--      → 會員只讀到自己、管理員照舊讀全部（後台月度總覽與 analytics RPC 不受影響）。
--   ③ 收權：anon 對 stats 保持被擋（原本已 revoke，這裡再寫一次）。
--
-- 【性質】全部 create or replace view，**不改任何資料、不改表結構**。
--         欄位名與型別順序與原版完全一致（避免 CREATE OR REPLACE 失敗）。
--         可重複執行。
--
-- 【誰要跑】站主在 Supabase → SQL Editor 貼上執行（一次性）。
--
-- 【驗證（跑完在 SQL Editor 執行）】
--   ① 公開月度榜仍有數（匿名可見）：
--      select count(*) from public.monthly_leaderboard;
--   ② 管理員讀 stats 仍是全部（應等於有跑步紀錄的會員月數）：
--      select count(*) from public.monthly_running_stats;
--   ③ 會員身分只讀到自己（在網站 console 或 PostgREST 用會員 JWT）：
--      應只回自己那一列。
--   ④ 匿名讀 stats 仍被擋：
--      用 anon key GET /rest/v1/monthly_running_stats → 42501。
--
-- 【回滾】
--   重跑 schema.sql:305（stats 原版）+ migration-leaderboard-no-id.sql §3
--   （月度榜原版）。但請勿回滾——那正是本檔要修的洞。
-- =============================================================

-- ------------------------------------------------------------
-- ① 月度里程榜：改為直接聚合 run_submissions，脫離對 stats view 的依賴
--    欄位順序／型別與原版一致：public_code, period_month, total_km, runs,
--    display_name, avatar_url, points
-- ------------------------------------------------------------
create or replace view public.monthly_leaderboard
with (security_invoker = false) as
select
  substr(md5(s.user_id::text), 1, 8) as public_code,
  s.period_month,
  sum(s.km)                          as total_km,
  count(*)                           as runs,
  p.display_name,
  p.avatar_url,
  p.points
from public.run_submissions s
join public.profiles p on p.id = s.user_id
where s.status = 'approved'
  and p.role = 'member'
group by s.user_id, s.period_month, p.display_name, p.avatar_url, p.points;

comment on view public.monthly_leaderboard is
  '對外月度里程榜：只含 role=member，public_code 與 public_leaderboard 同一算法。2026-11-23 起改為直接聚合 run_submissions，不再依賴 monthly_running_stats（避免把後者的權限限制傳染給公開榜）。';

grant select on public.monthly_leaderboard to anon, authenticated;

-- ------------------------------------------------------------
-- ② 每月跑步統計：加「本人或管理員」限制
-- ------------------------------------------------------------
create or replace view public.monthly_running_stats as
select
  user_id,
  period_month,
  sum(km)  as total_km,
  count(*) as runs
from public.run_submissions
where status = 'approved'
  -- 2026-11-23 修補：只讓本人或管理員讀到
  and (user_id = auth.uid() or public.is_admin())
group by user_id, period_month;

comment on view public.monthly_running_stats is
  '每月跑步統計（每人每月公里數與次數）。2026-11-23 起限制為「本人或管理員」可見，修復 authenticated 可讀全體 user_id 的洩漏。公開月度榜已改為獨立聚合，不依賴本視圖。';

-- ③ anon 保持被擋
revoke select on public.monthly_running_stats from anon;

notify pgrst, 'reload schema';
