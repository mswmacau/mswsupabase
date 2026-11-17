-- ============================================================
-- 場次座位用量檢視（session_seats）
-- ------------------------------------------------------------
-- 用途：日期頁 `/training/[date]` 要顯示「剩餘 N 個名額」。
--
-- 為什麼一定要用檢視，而不是前端直接 count：
--   `training_checkins` 的 RLS 是
--     checkins_select: auth.uid() = user_id or is_admin()
--   會員端（anon / 已登入會員）根本讀不到別人的報名列，
--   所以 `select count(*)` 永遠只會數到自己那一筆 —— 前端算不出剩餘名額。
--   專案也沒有 SUPABASE_SERVICE_ROLE_KEY（刻意不給前台），
--   因此唯一合法的做法是由資料庫提供「只有彙總數字、不含任何會員資料」的檢視。
--
-- 安全性：
--   - 檢視只輸出 session_id / capacity / taken 三個欄位，
--     **不含 user_id、不含姓名、不含任何可識別個資**。
--   - 檢視在 Postgres 預設以 owner 權限執行（未開 security_invoker），
--     因此會繞過底層資料表的 RLS —— 這是本檢視存在的目的，
--     但也代表 grant 對象要精確控制在 anon / authenticated，不可對 public 全開。
--   - 只統計 status <> 'rejected'（被駁回的不佔名額）。
--
-- ⚠️ 冪等：可重複執行（drop view if exists + create view + 重下 grant）。
-- ⚠️ 本檔**尚未執行**，需要站主或工程師在 Supabase SQL Editor 手動跑一次。
--    未執行時前台不會壞：`getSessionsByDate()` 讀不到檢視，`taken` / `remaining`
--    一律為 null，日期頁降級成只顯示「名額 N 人」（不顯示 0，避免假資料）。
-- ============================================================

drop view if exists public.session_seats;

create view public.session_seats as
select
  s.id                                as session_id,
  s.capacity                          as capacity,
  count(c.id) filter (where c.status <> 'rejected') as taken
from public.training_sessions s
left join public.training_checkins c on c.session_id = s.id
group by s.id, s.capacity;

comment on view public.session_seats is
  '場次報名彙總（前台日期頁顯示剩餘名額用）：只輸出 session_id/capacity/taken，不含任何會員資料。';

grant select on public.session_seats to anon, authenticated;

-- ------------------------------------------------------------
-- 驗證：應可看到每個場次的名額與已報名人數
-- ------------------------------------------------------------
-- select s.session_date, s.start_time, s.title,
--        v.capacity, v.taken, (v.capacity - v.taken) as remaining
--   from public.session_seats v
--   join public.training_sessions s on s.id = v.session_id
--  where s.session_date = '2026-11-17'
--  order by s.start_time;

-- ------------------------------------------------------------
-- 回滾
-- ------------------------------------------------------------
-- drop view if exists public.session_seats;
