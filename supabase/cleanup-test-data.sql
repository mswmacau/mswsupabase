-- =============================================================
-- 一次性維護：清除測試帳號與異常數據
-- 日期：2026-10-26
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上
--
-- ⚠️ 破壞性操作：會刪除帳號及其所有跑步／簽到／積分紀錄。
--    請先跑【第 0 節】看清楚名單，確認無誤再跑【第 1 節】。
--
-- 為什麼要重算：profiles.total_km / points 是「審核通過時累加」的
-- 反正欄位，刪掉提交紀錄後不會自動回退，就會出現
-- 「0 次提交卻有 305 km / 505 分」的矛盾。所以要由來源重算。
-- =============================================================

-- ------------------------------------------------------------
-- 0) 預覽（純查詢，不會刪任何東西）
-- ------------------------------------------------------------
select
  p.id,
  p.display_name,
  p.role,
  p.points,
  p.total_km,
  u.email,
  (select count(*) from public.run_submissions r where r.user_id = p.id) as run_rows,
  (select count(*) from public.training_checkins c where c.user_id = p.id) as checkin_rows,
  (select coalesce(sum(t.delta), 0) from public.point_transactions t where t.user_id = p.id) as points_ledger
from public.profiles p
left join auth.users u on u.id = p.id
order by p.role, p.points desc, p.display_name;

-- ------------------------------------------------------------
-- 1) 清除（單一交易；任何一步失敗會全部回滾）
--    刪除對象：非 admin，且符合以下任一
--      - 電郵結尾 @msw.test（seed.mjs 建立的 阿健／小玲／阿明）
--      - 顯示名稱在黑名單（MSW 自動測試會員／測試員／1）
-- ------------------------------------------------------------
begin;

create temp table _targets on commit drop as
select p.id, p.display_name, u.email
from public.profiles p
join auth.users u on u.id = p.id
where p.role <> 'admin'
  and (
    u.email like '%@msw.test'
    or p.display_name in ('MSW 自動測試會員', '測試員', '1')
  );

-- 這一步會列出實際將被刪除的帳號，請核對
select * from _targets;

-- 解除「審核人」參照，避免外鍵阻擋刪除
update public.run_submissions
   set reviewed_by = null
 where reviewed_by in (select id from _targets);

update public.training_checkins
   set confirmed_by = null
 where confirmed_by in (select id from _targets);

-- profiles 的子表（run_submissions / training_checkins /
-- point_transactions / coupons / event_registrations）皆為 on delete cascade
delete from public.profiles where id in (select id from _targets);
delete from auth.users   where id in (select id from _targets);

-- 由來源重算所有會員的里程與積分（修正歷史漂移）
update public.profiles p
   set total_km = coalesce((
         select sum(r.km) from public.run_submissions r
          where r.user_id = p.id and r.status = 'approved'
       ), 0),
       points   = coalesce((
         select sum(t.delta) from public.point_transactions t
          where t.user_id = p.id
       ), 0);

commit;

-- ------------------------------------------------------------
-- 2) 驗證：排行榜應只剩真實會員，且里程與提交數一致
-- ------------------------------------------------------------
select display_name, points, total_km
from public.public_leaderboard
order by total_km desc, points desc;
