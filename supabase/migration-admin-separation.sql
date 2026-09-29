-- =============================================================
-- 管理員帳號從對外排行榜中分離
-- 日期：2026-09-29
-- 性質：只改 VIEW，不改任何 TABLE 結構、不動資料、不加欄位
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- =============================================================
--
-- 【為什麼要這個 migration】
-- 目前 public.public_leaderboard 直接 `select ... from public.profiles`，
-- 沒有任何角色過濾，因此 role='admin' 的管理員帳號會被當成一般會員，
-- 出現在對外的「累積總榜」（實測：第 4 名顯示為「MSW 管理員」）。
-- 管理員帳號只供後台管理與編輯網頁之用，不屬對外用戶。
--
-- 【本 migration 的範圍（依站主 2026-09-29 指示）】
--   ✅ 改：public_leaderboard（累積總榜）—— 排除管理員
--   ✅ 改：monthly_leaderboard（月度里程榜）—— 它 join public_leaderboard，
--          所以會自動一併排除，這裡只是因為 cascade 而需要重建
--   ❌ 不改：site_stats.members（首頁／關於我們頁的「MSW 會員」數字）
--          依站主決定維持原狀，仍含管理員
--
-- 【⚠️ 已知副作用（站主已確認接受）】
--   site_stats.members 仍含管理員，但排行榜已排除管理員，
--   因此會出現「榜上 N 人、會員數顯示 N+1」的落差。
--   若日後想讓兩者一致，只需額外執行本檔最下方「附錄」的那一段。
--
-- 【不改的東西】
--   - 不改任何 table schema
--   - 不新增／刪除任何資料
--   - 不影響後台 /admin 的功能，管理員仍可正常登入、審核、編輯
--   - total_km / total_runs / total_sessions 的計算方式維持不變
--
-- =============================================================


-- ------------------------------------------------------------
-- 1. 先移除相依 view（monthly_leaderboard 相依於 public_leaderboard）
--    使用 cascade，稍後依序重建
-- ------------------------------------------------------------
drop view if exists public.monthly_leaderboard cascade;
drop view if exists public.public_leaderboard cascade;


-- ------------------------------------------------------------
-- 2. 重建 public_leaderboard：只含 role='member'
--    （原本沒有 where 條件，這是問題根源）
-- ------------------------------------------------------------
create view public.public_leaderboard
with (security_invoker = false) as
select
  id,
  display_name,
  avatar_url,
  points,
  total_km
from public.profiles
where role = 'member';

grant select on public.public_leaderboard to anon, authenticated;


-- ------------------------------------------------------------
-- 3. 重建 monthly_leaderboard
--    定義與原本完全相同，因為它 join 的是 public_leaderboard，
--    管理員已在第 2 步被排除，這裡不需重複加條件
-- ------------------------------------------------------------
create view public.monthly_leaderboard
with (security_invoker = false) as
select
  s.user_id,
  s.period_month,
  s.total_km,
  s.runs,
  p.display_name,
  p.avatar_url,
  p.points
from public.monthly_running_stats s
join public.public_leaderboard p on p.id = s.user_id;

grant select on public.monthly_leaderboard to anon, authenticated;


-- =============================================================
-- 執行後請驗證（在 SQL Editor 分別執行）
-- =============================================================
-- select id, display_name, total_km
-- from public.public_leaderboard
-- order by total_km desc limit 20;
--   → 確認結果中不再出現管理員帳號
--
-- select id, display_name, period_month, total_km
-- from public.monthly_leaderboard
-- order by total_km desc limit 20;
--   → 確認月度榜同樣不含管理員
--
-- select * from public.site_stats;
--   → members 仍含管理員（本次刻意維持不變）


-- =============================================================
-- 還原方式（若需要退回修改前）
-- =============================================================
-- 把下面這段反註解後執行，即可完整還原原本的行為
-- （管理員會重新出現在排行榜）
--
-- drop view if exists public.monthly_leaderboard cascade;
-- drop view if exists public.public_leaderboard cascade;
--
-- create view public.public_leaderboard
-- with (security_invoker = false) as
-- select id, display_name, avatar_url, points, total_km
-- from public.profiles;
--
-- grant select on public.public_leaderboard to anon, authenticated;
--
-- create view public.monthly_leaderboard
-- with (security_invoker = false) as
-- select s.user_id, s.period_month, s.total_km, s.runs,
--        p.display_name, p.avatar_url, p.points
-- from public.monthly_running_stats s
-- join public.public_leaderboard p on p.id = s.user_id;
--
-- grant select on public.monthly_leaderboard to anon, authenticated;


-- =============================================================
-- 附錄：日後若想讓「會員數」與排行榜一致（本次未執行）
-- =============================================================
-- 執行下面這段後，site_stats.members 會排除管理員，
-- 「榜上 N 人、會員數 N+1」的落差即消失。
--
-- create or replace view public.site_stats as
-- select
--   (select count(*) from public.profiles where role = 'member')                        as members,
--   (select coalesce(sum(km), 0) from public.run_submissions where status = 'approved') as total_km,
--   (select count(*) from public.run_submissions where status = 'approved')             as total_runs,
--   (select count(*) from public.training_sessions)                                     as total_sessions;
--
-- 還原（把 members 改回含管理員）：
--
-- create or replace view public.site_stats as
-- select
--   (select count(*) from public.profiles)                                              as members,
--   (select coalesce(sum(km), 0) from public.run_submissions where status = 'approved') as total_km,
--   (select count(*) from public.run_submissions where status = 'approved')             as total_runs,
--   (select count(*) from public.training_sessions)                                     as total_sessions;
