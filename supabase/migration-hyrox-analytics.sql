-- =============================================================
-- HYROX 跨月數據分析 RPC（analytics_hyrox_monthly）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行（一次跑完）
-- 幂等：create or replace function / drop … if exists，可重複執行
-- Owner：白客（backend-engineer）｜方案：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §2.3 G-2
-- =============================================================
--
-- 【這一檔在做什麼】
--   一支分析 RPC：每月一列的 HYROX 報名彙總（報名數、確認數、確認率、
--   總收入分、回頭會員數與率），供 /admin/analytics「戶外 HYROX 月度」
--   區塊與 CSV 匯出使用。
--
-- 【為什麼與 migration-hyrox-results.sql 分開】
--   方案 §2.3 G-2 明訂「與 results migration 分開，站主可分批執行」。
--   本檔只讀既有表（events / event_registrations），不依賴新表；
--   即使不跑本檔，完賽榜與相簿連結照常運作。
--
-- 【回傳形態契約（與既有八支 analytics_* 完全一致）】
--   單列 jsonb 物件（不是陣列、不是純量）：
--     { "months": [ { "month": "2026-11", "registrations": 12,
--                     "confirmed": 10, "confirm_rate": 83.3,
--                     "revenue_cents": 50000,
--                     "returning_members": 4, "returning_rate": 33.3 }, … ] }
--   · 空資料時鍵仍在（months = []）—— 這是 src/app/admin/analytics/page.tsx:57
--     isRpcRow 的硬要求：null／陣列／基本型別一律視為取數失敗。
--   · 每列的鍵固定、順序固定；數字一律 ::int（numeric 的 round 除外）。
--   · 月份降序（最近的在前），最多 p_limit 列。
--
-- 【回頭會員的窗口口徑（白客定稿，方案草式只給了示意）】
--   對某個月份 M：D = 該月所有 HYROX 場次中最早的 event_date。
--   「回頭會員」＝ 該月有報名（status='registered'）的會員當中，
--   曾在 [D − 12 個月, D) 這個窗口內報過任一場 HYROX（同樣 status='registered'）
--   的人數（distinct user_id）。
--   · 錨點用「該月最早場次日」而不是逐場：一個月份只有一個錨點，
--     數字才不會因為同月多場而在事後重算時漂移。
--   · 窗口左閉右開：當月自己的場次不算（否則所有人都是回頭）。
--   · 「報過」以 event_registrations 列存在為準，與付款狀態無關
--     （報了沒付款也是來過的會員）。
--
-- 【統計口徑（與 analytics_event_registrations 對齊）】
--   · 報名數 = status='registered' 的列數（會員取消是 DELETE 該列，
--     故即「目前報名人數」）。
--   · 確認數 = 其中 payment_status='confirmed'。
--   · 收入 = 確認者的 payment_amount_cents 合計（分）。
--   · 場次狀態：只要不是 draft 都算（published / archived / open / closed /
--     photos）。HYROX 場次慣例是 published / archived，放寬是為了
--     站主若用賽事狀態（open/closed/photos）標 HYROX 場時數字不會憑空消失。
--   · 沒有報名的月份不出列（與 analytics_event_registrations 的
--     left-join 全活動不同：這裡的用途是「有經營才有數字」）。
--
-- 【安全性（照本專案既有紀律）】
--   · security definer + set search_path = public（八支 analytics_* 同款）
--   · 函式內 is_admin() 閘門，非管理員呼叫直接 raise
--   · 結尾 revoke from public, anon（Postgres 預設把 EXECUTE 給 PUBLIC，
--     不收回等於公開 —— 見 migration-paid-events-1.sql 檔頭硬性約束 3）
-- =============================================================

create or replace function public.analytics_hyrox_monthly(p_limit int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  v_limit := coalesce(p_limit, 12);
  if v_limit < 1 or v_limit > 36 then
    raise exception 'p_limit 需為 1–36 的整數（收到 %）', p_limit;
  end if;

  return jsonb_build_object(
    'months', coalesce((
      -- 第 1 層：每月的報名數／確認數／收入，與該月最早場次日（回頭窗口的錨點）
      with monthly as (
        select
          to_char(e.event_date, 'YYYY-MM')                              as month,
          min(e.event_date)                                             as month_first_day,
          count(*)::int                                                 as registrations,
          count(*) filter (where r.payment_status = 'confirmed')::int   as confirmed,
          coalesce(
            sum(r.payment_amount_cents) filter (where r.payment_status = 'confirmed'),
            0
          )::int                                                        as revenue_cents
        from public.events e
        join public.event_registrations r on r.event_id = e.id
        where e.series = 'hyrox'
          and e.status in ('published','archived','open','closed','photos')
          and r.status = 'registered'
        group by 1
      ),
      -- 第 2 層：回頭會員數。先算好是因為 returning_rate 也要用它，
      -- 同一個 jsonb_build_object 的兩個鍵不可以互相引用。
      with_returning as (
        select
          m.*,
          (
            select count(distinct r2.user_id)::int
              from public.event_registrations r2
              join public.events e2 on e2.id = r2.event_id
             where e2.series = 'hyrox'
               and r2.status = 'registered'
               -- 回頭窗口：[該月最早場次日 − 12 個月, 該月最早場次日)
               and e2.event_date >= (m.month_first_day - interval '12 months')
               and e2.event_date <   m.month_first_day
               -- 只數「該月真的有報名」的會員（窗口外的歷史報名不算回頭）
               and r2.user_id in (
                 select r3.user_id
                   from public.event_registrations r3
                   join public.events e3 on e3.id = r3.event_id
                  where e3.series = 'hyrox'
                    and r3.status = 'registered'
                    and to_char(e3.event_date, 'YYYY-MM') = m.month
               )
          ) as returning_members
        from monthly m
      )
      select jsonb_agg(
        jsonb_build_object(
          'month',             wr.month,
          'registrations',     wr.registrations,
          'confirmed',         wr.confirmed,
          'confirm_rate',      round(100.0 * wr.confirmed / greatest(wr.registrations, 1), 1),
          'revenue_cents',     wr.revenue_cents,
          'returning_members', wr.returning_members,
          'returning_rate',    round(100.0 * wr.returning_members / greatest(wr.registrations, 1), 1)
        ) order by wr.month desc
      )
      from (
        select month, registrations, confirmed, revenue_cents, returning_members
          from with_returning
         order by month desc
         limit v_limit
      ) wr
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.analytics_hyrox_monthly(int) is
  'HYROX 月度彙總（管理員限定）：報名數／確認數／確認率／收入分／回頭會員數與率。'
  '回頭口徑＝該月最早場次日前推 12 個月內曾報過任一場 HYROX；空資料回 {months:[]}';

revoke all on function public.analytics_hyrox_monthly(int) from public, anon;
grant execute on function public.analytics_hyrox_monthly(int) to authenticated;

-- 讓 PostgREST 立刻看到新函式（可重複執行，無副作用）
notify pgrst, 'reload schema';


-- =============================================================
-- 執行後驗證（在 SQL Editor 逐段跑）
-- =============================================================
-- 1) 管理員身分（Dashboard 本來就是 postgres，直接跑即可看到資料）：
--    select public.analytics_hyrox_monthly(12);
--    → 單列 jsonb 物件，最少要有 "months" 這個鍵（沒資料時是 []）
--
-- 2) p_limit 邊界：
--    select public.analytics_hyrox_monthly(0);   → 應 raise（需為 1–36）
--    select public.analytics_hyrox_monthly(99);  → 應 raise（需為 1–36）
--
-- 3) 每列的鍵固定（把其中一個月攤開看）：
--    select jsonb_object_keys(value) as k
--      from jsonb_array_elements(
--        (select public.analytics_hyrox_monthly(12) -> 'months')
--      ) value
--     limit 7;
--    → month / registrations / confirmed / confirm_rate / revenue_cents
--      / returning_members / returning_rate（7 個鍵）
--
-- 4) 與 analytics_event_registrations 的報名數對账（同一場的數字要一致）：
--    select (select public.analytics_hyrox_monthly(12) -> 'months')
--     ↔  後台「活動報名」區的 HYROX 場次報名數
-- =============================================================


-- =============================================================
-- 回滾段（本檔不執行；要回滾時把註解解開跑）
-- =============================================================
-- drop function if exists public.analytics_hyrox_monthly(int);
-- notify pgrst, 'reload schema';
-- =============================================================
