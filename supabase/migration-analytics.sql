-- =============================================================
-- 會員與數據分析：page_views 追蹤表 + 分析 RPC 套件（T-21 / T-23）
-- 日期：2026-10-23
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：create table if not exists / drop policy if exists / create or replace
--       function，可重複執行；不覆蓋用戶已修改過的值
-- =============================================================
--
-- 【用途】
-- (1) page_views：前台頁面瀏覽與停留時長的匿名追蹤表（計劃 §5.3 / §7.2），
--     由 POST /api/track/page-view 以 anon 角色寫入（RLS 放行），
--     讀取一律經本檔的分析 RPC（security definer + is_admin 閘門）。
-- (2) analytics_* RPC 七支（計劃 §8.3）：會員增長／活躍度／行為畫像／
--     場次出席／跑步挑戰／優惠券／頁面流量，供 /admin/analytics 儀表板。
--
-- 【性質】
-- 只新增 page_views 一張新表與七支新函式；不改動任何既有表結構、
-- 既有欄位與既有資料（profiles / training_* / run_submissions / coupons /
-- point_transactions / app_settings / events / coaches 一律不碰）。
-- event_registrations 表與 analytics_event_registrations RPC 屬第三批
-- T-26，本檔刻意不建、不實作（見檔尾註釋）。
--
-- 【私隱紀律（計劃 §5.3，紅線）】
-- 不記 IP、不記 user_id、不記 UA；sid 為客戶端 sessionStorage 隨機 id
-- （8–32 小寫英數，分頁關閉即消失）；is_member 為客戶端自報布林值
-- （可被偽造，只用於粗略拆分，已註記）；表不給 anon select。
--
-- Owner：白客（backend-engineer）
-- =============================================================

-- =============================================================
-- 【分析 RPC 回傳結構總覽（T-23 定稿；方硯的儀表板照此渲染）】
-- 全部 returns jsonb、單列物件、security definer + is_admin() 閘門；
-- 呼叫方式（管理員 JWT）：supabase.rpc('analytics_xxx', { p_months: 12 })
-- 任何鍵在空資料時仍存在（空陣列／0），不會回傳 null、不會省略鍵。
--
-- 1) analytics_member_growth(p_months int default 12)            → A1 會員增長
--    {
--      "months": [{"month": "2026-10", "new_members": 3, "cumulative_members": 57}, ...],
--        ↑ 近 p_months 個月（含進行中的本月），由舊到新；月份按澳門時間劃分
--      "total_members": 57
--        ↑ 與後台總覽「會員總數」（getAdminCounts.members）交叉驗證一致
--    }
--
-- 2) analytics_activity_overview()                                → A2 會員活躍度
--    {
--      "total_members": 57,
--      "active_30d": 12,             ↑ 近 30 天有 approved 簽到或跑步的人
--      "active_90d": 20,
--      "active_rate_30d": 0.2105,    ↑ 四捨五入至小數 4 位；總數為 0 時回 0
--      "active_rate_90d": 0.3509,
--      "silent_90d": 37              ↑ 90 天無動作 = total_members − active_90d
--    }
--
-- 3) analytics_behavior_segments()                                → A3 行為畫像 + A4 達標率
--    {
--      "points_segments": [{"label": "0 分", "count": 5},
--                          {"label": "1–99 分", "count": 20},
--                          {"label": "100–299 分", "count": 25},
--                          {"label": "300 分以上", "count": 7}],
--      "km_segments":     [{"label": "0 km", ...}, {"label": "1–49 km", ...},
--                          {"label": "50–149 km", ...}, {"label": "150 km 以上", ...}],
--      "checkin_type_90d": 8,        ↑ 近 90 天有 approved 簽到（一人可同時屬兩型）
--      "run_type_90d": 14,
--      "both_type_90d": 5,
--      "monthly_goal_rate": [{"month": "2026-05", "submitters": 10,
--                             "qualified": 3, "rate": 0.3}, ...]
--        ↑ 近 6 個月；達標門檻 = app_settings.monthly_goal_km（預設 300，
--          與 monthly_qualified_list RPC 同源）；分母 = 當月有已確認紀錄
--          的人數（monthly_running_stats 視圖該月列數，見下方口徑註）
--    }
--
-- 4) analytics_session_attendance(p_limit int default 20)         → A5 場次出席
--    {
--      "sessions": [{
--        "session_id": "uuid…", "session_date": "2026-10-05",
--        "title": "MSW 定期訓練", "status": "open", "capacity": 30,
--        "registered": 18,        ↑ 非 rejected 的報名列（pending + approved）
--        "attended": 12,          ↑ approved
--        "attendance_rate": 0.6667,  ↑ attended ÷ registered（0 人報名時 0）
--        "capacity_usage": 0.6       ↑ registered ÷ capacity
--      }, ...]
--        ↑ 依報名人數降序（最多人報名場次 = 前幾列）；含 0 人報名的場次
--    }
--
-- 5) analytics_run_monthly(p_months int default 12)               → A6 跑步挑戰
--    {
--      "months": [{
--        "month": "2026-10",         ↑ period_month（會員選定計入的月份）
--        "total_km": 512.5,          ↑ approved 總公里
--        "submissions": 20,          ↑ 當月提交總列數（所有狀態，含待審／已拒）
--        "pending": 3, "approved": 17,
--        "members": 9,               ↑ 當月有 approved 紀錄的人數
--        "avg_km_per_member": 56.94, ↑ 人均公里 = total_km ÷ members
--        "qualified": 4              ↑ 當月達標人數（≥ monthly_goal_km）
--      }, ...]
--    }
--
-- 6) analytics_coupon_summary()                                   → A7 優惠券
--    {
--      "by_status": {"active": 5, "used": 30, "expired": 2},
--        ↑ by_status.active 與後台總覽「有效優惠券」交叉驗證一致
--      "total": 37,                   ↑ 發放總數
--      "redeemed_rate": 0.8108,       ↑ 核銷率 = used ÷ total
--      "monthly": [{"month": "2026-10", "issued": 4}, ...]   ↑ 近 12 個月發放數
--    }
--
-- 7) analytics_page_stats(p_days int default 30)                  → D3/D4 頁面流量
--    {
--      "days": 30,
--      "total_views": 320,
--      "total_sessions": 88,       ↑ 估算到訪 = distinct sid（同訪客到多頁只算一次）
--      "avg_dwell_ms": 14200,      ↑ 全站平均停留（毫秒，整數）
--      "paths": [{"path": "/", "views": 120, "sessions": 60, "avg_dwell_ms": 15100}, ...]
--        ↑ 依瀏覽量降序；sessions 為該路徑的 distinct sid（各路徑加總可能大於全站數）
--    }
--    口徑註：「估算值」——beacon 被瀏覽器阻擋／Next 連結 prefetch／重整頁面
--    皆會造成偏差（計劃 §5.3），儀表板需標註「估算」。
--
-- 8) analytics_event_registrations —— 依賴 T-26 才建立的 event_registrations
--    表，本檔刻意不實作，順延至第三批 T-26 補上（見檔尾註釋）。
-- =============================================================

-- ------------------------------------------------------------
-- 1. page_views — 頁面瀏覽與停留追蹤（匿名、聚合用途）
--    只新增這一張表；RLS 見第 3 節。
--    偏差註記：計劃 §7.2 的正則為 '^/[A-Za-z0-9/_-]{1,200}$'，會把首頁
--    「/」擋掉（斜線後至少要 1 個字元），與 §6.2 D3 驗收標準
--    （path=/ 必須產生一行）衝突，故改為 {0,200}（首頁可追蹤，長度上限不變）。
-- ------------------------------------------------------------
create table if not exists public.page_views (
  id         uuid primary key default gen_random_uuid(),
  path       text not null check (path ~ '^/[A-Za-z0-9/_-]{0,200}$'),
  sid        text not null check (sid ~ '^[a-z0-9]{8,32}$'),
  dwell_ms   integer not null check (dwell_ms between 0 and 1800000),
  is_member  boolean not null default false,
  day        date generated always as ((created_at at time zone 'UTC')::date) stored,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. 索引（計劃 §7.2）：(day, path)
--    用途：180 天清理的 day 範圍刪除、日後 page_view_daily 聚合任務。
--    注意：day 為 UTC 日期（created_at::date 依服務器時區，Supabase 預設 UTC），
--    這是計劃 §7.2 指定的 generated 表達式，刻意不改。
-- ------------------------------------------------------------
create index if not exists page_views_day_path_idx
  on public.page_views (day, path);

-- ------------------------------------------------------------
-- 3. RLS（計劃 §7.3 逐字實作）
--    匿名可插入（統計用途），用 check 限制傷害半徑；只有管理員能讀；
--    刻意不給 update / delete——RLS 開啟且無對應政策，等於全民不可改刪
--    （service_role 除外）；清理由技術人員以 SQL 執行（第 4 節）。
-- ------------------------------------------------------------
alter table public.page_views enable row level security;

drop policy if exists "page_views_insert_public" on public.page_views;
create policy "page_views_insert_public" on public.page_views
  for insert to anon, authenticated
  with check (
    path ~ '^/[A-Za-z0-9/_-]{0,200}$'
    and dwell_ms between 0 and 1800000
    and sid ~ '^[a-z0-9]{8,32}$'
  );

drop policy if exists "page_views_admin_select" on public.page_views;
create policy "page_views_admin_select" on public.page_views
  for select using (public.is_admin());

-- 表層級只授 insert：讀取一律經 security definer RPC（is_admin 閘門），
-- 不開放任何人直接 select 整表。
grant insert on public.page_views to anon, authenticated;

-- ------------------------------------------------------------
-- 4. 原始資料 180 天清理 SQL（計劃 §5.3）
--    保留 180 天；由技術人員每季執行一次，或日後加 cron
--    （Vercel 方案對 cron 的限制未查證，列假設，見計劃 §12 假設 6）。
--    用 day 走 page_views_day_path_idx；等價的 created_at 寫法：
--      delete from public.page_views
--      where created_at < now() - interval '180 days';
-- ------------------------------------------------------------
-- delete from public.page_views
-- where day < current_date - 180;

-- ------------------------------------------------------------
-- 5. 第二段設計：page_view_daily 聚合表（觸發條件才建，現在刻意不建）
--    觸發條件（計劃 §4.5 / §5.3）：page_views 超過約 50 萬列，
--    或 analytics_page_stats 查詢變慢。本站目前量級（推測每月數百至數千
--    瀏覽）讀時聚合即可，先跑通再優化，不為未來設計。
--    屆時建議 schema 與物化方式（現在不執行）：
--      create table if not exists public.page_view_daily (
--        path           text not null,
--        day            date not null,
--        views          integer not null default 0,
--        total_dwell_ms bigint  not null default 0,
--        primary key (path, day)
--      );
--    物化方式二選一：
--      (a) 每晚 cron 批量聚合（推薦，不拖慢寫入）：
--          insert into public.page_view_daily (path, day, views, total_dwell_ms)
--          select path, day, count(*), coalesce(sum(dwell_ms), 0)
--            from public.page_views
--           where day = current_date - 1
--           group by path, day
--          on conflict (path, day) do update
--            set views = page_view_daily.views + excluded.views,
--                total_dwell_ms = page_view_daily.total_dwell_ms + excluded.total_dwell_ms;
--      (b) trigger 即時增量維護（數字即時但拖慢每一次插入，不推薦）。
--    切換後 analytics_page_stats 改讀聚合表，明細保留期可縮短為 30 天。
-- ------------------------------------------------------------

-- =============================================================
-- 6. 分析 RPC（T-23）——七支，全部：
--      security definer + set search_path = public + is_admin() 閘門
--      （閘門模式复刻 schema-r6.sql 的 redeem_coupon）
--    回傳結構見本檔開頭的「回傳結構總覽」。
--    收回 anon 執行權（雙重防線）；後台以管理員 JWT（authenticated）呼叫。
-- =============================================================

-- 6.1 analytics_member_growth — A1 會員增長（每月新註冊數 + 累計會員數）
create or replace function public.analytics_member_growth(p_months int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_months int;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  v_months := coalesce(p_months, 12);
  if v_months < 1 or v_months > 36 then
    raise exception 'p_months 需為 1–36 的整數（收到 %）', p_months;
  end if;

  -- 月份按澳門時間（Asia/Macau, UTC+8）劃分，與前台 utils.ts currentMonth()
  -- 同一口徑；Supabase 服務器預設 UTC，故每一處都明確 at time zone 轉換。
  return (
    with series as (
      select generate_series(
        date_trunc('month', now() at time zone 'Asia/Macau')
          - ((v_months - 1) * interval '1 month'),
        date_trunc('month', now() at time zone 'Asia/Macau'),
        interval '1 month'
      ) as month_start
    )
    select jsonb_build_object(
      'months', coalesce(jsonb_agg(
        jsonb_build_object(
          'month', to_char(s.month_start, 'YYYY-MM'),
          'new_members', (
            select count(*)
              from public.profiles p
             where p.created_at >= s.month_start at time zone 'Asia/Macau'
               and p.created_at < (s.month_start + interval '1 month') at time zone 'Asia/Macau'
          ),
          'cumulative_members', (
            select count(*)
              from public.profiles p
             where p.created_at < (s.month_start + interval '1 month') at time zone 'Asia/Macau'
          )
        ) order by s.month_start
      ), '[]'::jsonb),
      'total_members', (select count(*) from public.profiles)
    )
    from series s
  );
end;
$$;

revoke all on function public.analytics_member_growth(int) from anon;
grant execute on function public.analytics_member_growth(int) to authenticated;

-- 6.2 analytics_activity_overview — A2 會員活躍度（總會員／30·90 天活躍／活躍率／沉默數）
create or replace function public.analytics_activity_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total    bigint;
  v_active30 bigint;
  v_active90 bigint;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  select count(*) into v_total from public.profiles;

  -- 「活躍」＝近 N 天內有 status='approved' 的簽到或跑步提交（計劃 §5.2 A2）。
  -- 時間欄位統一取 created_at：training_checkins 無 confirmed_at，
  -- run_submissions 的 reviewed_at 只在確認後有值，兩表取同一欄位才可比。
  with active as (
    select user_id from public.training_checkins
     where status = 'approved' and created_at >= now() - interval '30 days'
    union
    select user_id from public.run_submissions
     where status = 'approved' and created_at >= now() - interval '30 days'
  )
  select count(*) into v_active30 from active;

  with active as (
    select user_id from public.training_checkins
     where status = 'approved' and created_at >= now() - interval '90 days'
    union
    select user_id from public.run_submissions
     where status = 'approved' and created_at >= now() - interval '90 days'
  )
  select count(*) into v_active90 from active;

  return jsonb_build_object(
    'total_members', v_total,
    'active_30d', v_active30,
    'active_90d', v_active90,
    'active_rate_30d', case when v_total > 0
      then round(v_active30::numeric / v_total, 4) else 0 end,
    'active_rate_90d', case when v_total > 0
      then round(v_active90::numeric / v_total, 4) else 0 end,
    'silent_90d', v_total - v_active90
  );
end;
$$;

revoke all on function public.analytics_activity_overview() from anon;
grant execute on function public.analytics_activity_overview() to authenticated;

-- 6.3 analytics_behavior_segments — A3 行為畫像 + A4 月度達標率
create or replace function public.analytics_behavior_segments()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  return jsonb_build_object(
    -- 積分分段（profiles.points）：0 / 1–99 / 100–299 / 300+
    'points_segments', (
      select jsonb_build_array(
        jsonb_build_object('label', '0 分',       'count', count(*) filter (where p.points = 0)),
        jsonb_build_object('label', '1–99 分',    'count', count(*) filter (where p.points between 1 and 99)),
        jsonb_build_object('label', '100–299 分', 'count', count(*) filter (where p.points between 100 and 299)),
        jsonb_build_object('label', '300 分以上', 'count', count(*) filter (where p.points >= 300))
      )
      from public.profiles p
    ),
    -- 總里程分段（profiles.total_km）：0 / 1–49 / 50–149 / 150+ km
    'km_segments', (
      select jsonb_build_array(
        jsonb_build_object('label', '0 km',        'count', count(*) filter (where p.total_km = 0)),
        jsonb_build_object('label', '1–49 km',     'count', count(*) filter (where p.total_km >= 1 and p.total_km < 50)),
        jsonb_build_object('label', '50–149 km',   'count', count(*) filter (where p.total_km >= 50 and p.total_km < 150)),
        jsonb_build_object('label', '150 km 以上', 'count', count(*) filter (where p.total_km >= 150))
      )
      from public.profiles p
    ),
    -- 簽到型 vs 跑步型（近 90 天分別有 approved 紀錄；一人可同時屬兩型）
    'checkin_type_90d', (
      select count(distinct user_id) from public.training_checkins
       where status = 'approved' and created_at >= now() - interval '90 days'
    ),
    'run_type_90d', (
      select count(distinct user_id) from public.run_submissions
       where status = 'approved' and created_at >= now() - interval '90 days'
    ),
    'both_type_90d', (
      select count(*) from (
        select user_id from public.training_checkins
         where status = 'approved' and created_at >= now() - interval '90 days'
        intersect
        select user_id from public.run_submissions
         where status = 'approved' and created_at >= now() - interval '90 days'
      ) b
    ),
    -- 近 6 月達標率（A4）：達標人數 ÷ 當月有已確認紀錄的人數。
    -- 口徑定稿：分子 = monthly_running_stats 中 total_km ≥ 目標值的列數；
    -- 分母 = 該視圖當月列數（視圖只計 approved，見 schema.sql 第 186–194 行，
    -- 即「當月有已確認紀錄的人數」）。目標值取 app_settings.monthly_goal_km
    -- （預設 300，與 monthly_qualified_list RPC 同源，不寫死 300）。
    'monthly_goal_rate', (
      with series as (
        select generate_series(
          date_trunc('month', now() at time zone 'Asia/Macau') - interval '5 months',
          date_trunc('month', now() at time zone 'Asia/Macau'),
          interval '1 month'
        ) as month_start
      ),
      agg as (
        select
          to_char(s.month_start, 'YYYY-MM') as month,
          coalesce(m.n_users, 0) as submitters,
          coalesce(m.n_qualified, 0) as qualified
        from series s
        left join (
          select
            v.period_month,
            count(*) as n_users,
            count(*) filter (where v.total_km >= public.setting_num('monthly_goal_km', 300)) as n_qualified
          from public.monthly_running_stats v
          group by v.period_month
        ) m on m.period_month = to_char(s.month_start, 'YYYY-MM')
      )
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'month', a.month,
          'submitters', a.submitters,
          'qualified', a.qualified,
          'rate', case when a.submitters > 0
            then round(a.qualified::numeric / a.submitters, 4) else 0 end
        ) order by a.month
      ), '[]'::jsonb)
      from agg a
    )
  );
end;
$$;

revoke all on function public.analytics_behavior_segments() from anon;
grant execute on function public.analytics_behavior_segments() to authenticated;

-- 6.4 analytics_session_attendance — A5 訓練場次出席（=「最多人報名」場次版）
create or replace function public.analytics_session_attendance(p_limit int default 20)
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

  v_limit := coalesce(p_limit, 20);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'p_limit 需為 1–100 的整數（收到 %）', p_limit;
  end if;

  -- 口徑（計劃 §5.2 A5 與其註）：報名人數 = 非 rejected 的 checkins 列數
  -- （pending 兼任「已報名、待管理員確認」；會員取消報名是 DELETE 該列）。
  -- 含 0 人報名的場次（left join），依報名人數降序，前幾列即 TOP N。
  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'session_id', t.session_id,
          'session_date', t.session_date,
          'title', t.title,
          'status', t.status,
          'capacity', t.capacity,
          'registered', t.registered,
          'attended', t.attended,
          'attendance_rate', t.attendance_rate,
          'capacity_usage', t.capacity_usage
        ) order by t.registered desc, t.session_date desc
      )
      from (
        select
          s.id as session_id,
          s.session_date,
          s.title,
          s.status,
          s.capacity,
          count(c.id) filter (where c.status <> 'rejected') as registered,
          count(c.id) filter (where c.status = 'approved') as attended,
          case
            when count(c.id) filter (where c.status <> 'rejected') > 0
            then round(
              (count(c.id) filter (where c.status = 'approved'))::numeric
              / (count(c.id) filter (where c.status <> 'rejected')), 4)
            else 0
          end as attendance_rate,
          case
            when s.capacity > 0
            then round(
              (count(c.id) filter (where c.status <> 'rejected'))::numeric / s.capacity, 4)
            else 0
          end as capacity_usage
        from public.training_sessions s
        left join public.training_checkins c on c.session_id = s.id
        group by s.id
        order by registered desc, s.session_date desc
        limit v_limit
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.analytics_session_attendance(int) from anon;
grant execute on function public.analytics_session_attendance(int) to authenticated;

-- 6.5 analytics_run_monthly — A6 跑步挑戰（每月公里／提交／待審／人均／達標人數）
create or replace function public.analytics_run_monthly(p_months int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_months int;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  v_months := coalesce(p_months, 12);
  if v_months < 1 or v_months > 36 then
    raise exception 'p_months 需為 1–36 的整數（收到 %）', p_months;
  end if;

  -- 月份以會員選定計入的 period_month 分組（與前台 /run、後台 /admin/monthly、
  -- monthly_running_stats 視圖同源；非以提交時間分組，避免跨月補交錯位）。
  -- 口徑定稿：submissions = 當月提交總列數（所有狀態）；
  -- 人均公里 = approved 總公里 ÷ 當月有 approved 紀錄的人數。
  return (
    with series as (
      select generate_series(
        date_trunc('month', now() at time zone 'Asia/Macau')
          - ((v_months - 1) * interval '1 month'),
        date_trunc('month', now() at time zone 'Asia/Macau'),
        interval '1 month'
      ) as month_start
    ),
    runs as (
      select
        r.period_month,
        count(*) as submissions,
        count(*) filter (where r.status = 'pending') as pending,
        count(*) filter (where r.status = 'approved') as approved,
        count(distinct r.user_id) filter (where r.status = 'approved') as members,
        coalesce(sum(r.km) filter (where r.status = 'approved'), 0) as total_km
      from public.run_submissions r
      where r.period_month >= to_char((select min(month_start) from series), 'YYYY-MM')
      group by r.period_month
    ),
    qualified as (
      select v.period_month, count(*) as n_qualified
      from public.monthly_running_stats v
      where v.total_km >= public.setting_num('monthly_goal_km', 300)
      group by v.period_month
    )
    select jsonb_build_object(
      'months', coalesce(jsonb_agg(
        jsonb_build_object(
          'month', to_char(s.month_start, 'YYYY-MM'),
          'total_km', round(coalesce(runs.total_km, 0), 2),
          'submissions', coalesce(runs.submissions, 0),
          'pending', coalesce(runs.pending, 0),
          'approved', coalesce(runs.approved, 0),
          'members', coalesce(runs.members, 0),
          'avg_km_per_member', case
            when coalesce(runs.members, 0) > 0
            then round(coalesce(runs.total_km, 0) / runs.members, 2)
            else 0 end,
          'qualified', coalesce(q.n_qualified, 0)
        ) order by s.month_start
      ), '[]'::jsonb)
    )
    from series s
    left join runs on runs.period_month = to_char(s.month_start, 'YYYY-MM')
    left join qualified q on q.period_month = to_char(s.month_start, 'YYYY-MM')
  );
end;
$$;

revoke all on function public.analytics_run_monthly(int) from anon;
grant execute on function public.analytics_run_monthly(int) to authenticated;

-- 6.6 analytics_coupon_summary — A7 優惠券（各狀態張數／按月發放／核銷率）
create or replace function public.analytics_coupon_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  -- 口徑定稿（計劃 §5.2 A7）：核銷率 = used ÷ 發放總數（全部張數）；
  -- by_status 補上 schema 既有的 expired 狀態（計劃只列 active/used，
  -- 但 coupons.status check 有三值，漏掉它數字會對不平）。
  -- 按月發放數按 created_at 的澳門月份歸屬（近 12 個月，含本月）。
  return (
    with series as (
      select generate_series(
        date_trunc('month', now() at time zone 'Asia/Macau') - interval '11 months',
        date_trunc('month', now() at time zone 'Asia/Macau'),
        interval '1 month'
      ) as month_start
    ),
    monthly as (
      select
        to_char(s.month_start, 'YYYY-MM') as month,
        count(c.id) as issued
      from series s
      left join public.coupons c
        on to_char(c.created_at at time zone 'Asia/Macau', 'YYYY-MM')
         = to_char(s.month_start, 'YYYY-MM')
      group by s.month_start
    )
    select jsonb_build_object(
      'by_status', jsonb_build_object(
        'active',  (select count(*) from public.coupons where status = 'active'),
        'used',    (select count(*) from public.coupons where status = 'used'),
        'expired', (select count(*) from public.coupons where status = 'expired')
      ),
      'total', (select count(*) from public.coupons),
      'redeemed_rate', case
        when (select count(*) from public.coupons) > 0
        then round(
          (select count(*) from public.coupons where status = 'used')::numeric
          / (select count(*) from public.coupons), 4)
        else 0
      end,
      'monthly', coalesce((
        select jsonb_agg(
          jsonb_build_object('month', m.month, 'issued', m.issued) order by m.month
        )
        from monthly m
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.analytics_coupon_summary() from anon;
grant execute on function public.analytics_coupon_summary() to authenticated;

-- 6.7 analytics_page_stats — D3/D4 頁面流量（路徑／瀏覽量／估算到訪／平均停留）
create or replace function public.analytics_page_stats(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  v_days := coalesce(p_days, 30);
  -- 上限 180 天 = 原始資料保留期（第 4 節清理）；超過只會得到更少資料，故直接拒。
  if v_days < 1 or v_days > 180 then
    raise exception 'p_days 需為 1–180 的整數（收到 %）', p_days;
  end if;

  return (
    with scoped as (
      select v.*
      from public.page_views v
      where v.created_at >= now() - (v_days * interval '1 day')
    )
    select jsonb_build_object(
      'days', v_days,
      'total_views', (select count(*) from scoped),
      'total_sessions', (select count(distinct sid) from scoped),
      'avg_dwell_ms', coalesce((select round(avg(dwell_ms))::int from scoped), 0),
      'paths', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'path', p.path,
            'views', p.views,
            'sessions', p.sessions,
            'avg_dwell_ms', p.avg_dwell_ms
          ) order by p.views desc, p.path
        )
        from (
          select
            v.path,
            count(*) as views,
            count(distinct v.sid) as sessions,
            round(avg(v.dwell_ms))::int as avg_dwell_ms
          from scoped v
          group by v.path
        ) p
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.analytics_page_stats(int) from anon;
grant execute on function public.analytics_page_stats(int) to authenticated;

-- 讓 PostgREST 立刻看到新函式（可重複執行，無副作用；复刻 schema-r6.sql 做法）
notify pgrst, 'reload schema';

-- =============================================================
-- 7. 檔尾註釋：event_registrations 與 analytics_event_registrations 順延
-- =============================================================
-- 計劃 §8.3 的第 8 支 RPC analytics_event_registrations(p_limit int default 20)
-- （活動／站內報名人數排序，D5）依賴第三批 T-26 才建立的 event_registrations
-- 表（結構見計劃 §7.2：id / event_id → events(id) cascade / user_id →
-- profiles(id) cascade / status in ('registered','cancelled') / unique
-- (event_id, user_id) / 索引 (event_id, status)）。
--
-- 本次（第二批）如實處理：
--   - 本檔只建 page_views 與 7 支 RPC，不建 event_registrations 表；
--   - analytics_event_registrations 留待 T-26 與該表同一批補上，
--     屆時以 create or replace function 追加（幂等，不影響本檔已執行的部分）；
--   - 儀表板（方砚）在 T-26 前不渲染「活動報名」區，或標示「即將支援」。
--
-- 執行後驗證（T-21 驗收點）：
--   select count(*) from public.page_views;            -- anon 可 insert 合法行
--   -- 以 anon key 執行 select 應被 RLS 拒（0 列或 permission denied）；
--   -- 以管理員 JWT 呼叫 select public.analytics_page_stats(30) 應回 jsonb。
-- =============================================================
