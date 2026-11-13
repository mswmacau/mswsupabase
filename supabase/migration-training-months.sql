-- =============================================================
-- 班表「按月管理與自動上架」（Migration）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：全部使用 if not exists / create or replace / drop policy if exists /
--       on conflict do nothing，可重複執行；重複執行不會產生重複資料，
--       也不會刪掉任何既有場次（含現有 35 筆 2026-11 場次）。
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【客戶需求（原話重點）】
-- 「12 月的班表未出，所以不能按 11 月的去推。我要在後台手動新增日曆表內所有活動，
--   新增出來和 11 月樣式一樣。之後到 12 月時我再後台更新活動資料，
--   之後到 12 月 1 日自動上架 12 月、同步下架 11 月，以此類推。」
--
-- 推導出的三條規則（本檔就是這三條的落地）：
--   1. 班表由人手逐場建立 —— training_rules 只保留為「參考模板」，
--      不再用它自動推導未來月份（generate_sessions 仍在，但不再用於排未來月）。
--   2. 以「月」為發布單位 —— 每月一列 training_months，有 status 與 publish_at；
--      到了生效時間該月自動可見，前一個月自動退出「當月」視圖（資料保留）。
--   3. 不需要 cron —— 可見性用「讀取時比較 now()」實現，
--      即 RLS policy 裡的 is_month_visible()。
--
-- 【本次改動範圍】
--   A. 新表 training_months（月份發布狀態）
--   B. 新函式 is_month_visible()，並把 training_sessions 的讀取政策
--      從「所有人可讀」改成「僅已發布且已到時間的月份可讀」
--   C. 新函式 copy_month_sessions()（按月按日位移複製）與 month_stats()（後台統計）
--   D. notify pgrst reload schema
--
-- 【刻意不動的東西】
--   · 不刪任何 training_sessions 列。
--   · 不動 training_checkins 結構（session_id 外鍵仍是 on delete cascade，
--     所以「刪場次」的保護寫在後台 API，不在 DB）。
--   · 不動 training_classes / training_rules 的結構與政策。
--   · 不改 /api/admin/sessions（legacy 路由）。
-- =============================================================


-- =============================================================
-- A. 月份發布表 training_months
-- =============================================================
-- 語義：一列 = 一個月的發布狀態。
--   status = 'draft'      → 只有管理員看得到該月場次
--   status = 'published'  → 到達生效時間後，所有人可見該月場次
--   publish_at = null     → 生效時間 = 該月 1 日 00:00（Asia/Macau）
--   publish_at 有值         → 生效時間 = publish_at（可為未來時間，即「預先發布」）
create table if not exists public.training_months (
  year       integer not null check (year between 2024 and 2100),
  month      integer not null check (month between 1 and 12),
  status     text not null default 'draft' check (status in ('draft','published')),
  publish_at timestamptz,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (year, month)
);

comment on table public.training_months is
  '班表發布單位＝月。status=published 且 coalesce(publish_at, 該月1日00:00+08) <= now() 時，該月場次對外可見。';
comment on column public.training_months.publish_at is
  '生效時間。NULL 代表「該月 1 日 00:00（Asia/Macau）」。允許未來時間＝預先發布。';

alter table public.training_months enable row level security;

-- 讀：anon + authenticated 只回「已發布」的月份。
-- 理由：草稿月份的存在本身就是資訊（會洩漏「某月班表已在準備」），
-- 因此連月份列都不給非管理員看；未到時間的判斷留給 is_month_visible()。
drop policy if exists "months_select_published" on public.training_months;
create policy "months_select_published" on public.training_months
  for select to anon, authenticated
  using (status = 'published');

-- 寫：只有管理員（含 insert / update / delete）
drop policy if exists "months_admin_all" on public.training_months;
create policy "months_admin_all" on public.training_months
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.training_months to anon, authenticated;
grant insert, update, delete on public.training_months to authenticated;
grant all on public.training_months to service_role;

-- 種子：
--   · 2026-11 立即發布（客戶已認可現有 35 筆場次就是 11 月班表，
--     不發布的話客戶貼完 migration 會發現 11 月突然清空）
--   · 2026-12 先建一列草稿，方便客戶進後台直接編輯
-- on conflict do nothing：客戶日後改過狀態再重跑本檔，不會被種子蓋回去。
insert into public.training_months (year, month, status, publish_at, note)
values
  (2026, 11, 'published', timestamptz '2026-11-01 00:00:00+08',
   '11 月班表已上架（由週期規則生成的既有資料）'),
  (2026, 12, 'draft',     null,
   '12 月班表待客戶手動建立')
on conflict (year, month) do nothing;


-- =============================================================
-- B. 場次可見性規則（核心）
-- =============================================================

-- ------------------------------------------------------------
-- B-1 is_month_visible(p_year, p_month)
--     這支是整個「自動上架／下架」的唯一判斷點：
--     已發布 + 生效時間已到 → 可見；否則不可見。沒有 cron，全靠 now()。
--
--     為什麼要 SECURITY DEFINER：
--     RLS policy 裡的子查詢**會**再套一次被引用表的 RLS
--     （policy 不是 definer context）。若把 exists(select ... from training_months)
--     直接寫進 training_sessions 的 policy，行為會同時取決於
--     training_months.months_select_published 的內容 —— 現在結果剛好一致，
--     但日後任何人改 months 的 select 政策，就會連帶、無聲地改掉場次可見性。
--     抽成 definer 函式後：可見性只有這一個定義處，且 months 的 RLS 只管 API 直讀。
-- ------------------------------------------------------------
create or replace function public.is_month_visible(p_year integer, p_month integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.training_months m
     where m.year   = p_year
       and m.month  = p_month
       and m.status = 'published'
       -- publish_at 為 NULL ⇒ 該月 1 日 00:00（Asia/Macau）。
       -- 刻意不用 make_timestamptz()：它的 sec 參數是 double precision，
       -- 整數字面值有函式重載解析的風險；make_date + at time zone 零歧義。
       and coalesce(
             m.publish_at,
             (make_date(m.year, m.month, 1)::timestamp at time zone 'Asia/Macau')
           ) <= now()
  );
$$;

comment on function public.is_month_visible(integer, integer) is
  '該年月是否已對外可見：status=published 且 coalesce(publish_at, 該月1日00:00+08) <= now()。';

-- anon 需要能執行（它被 anon 的 select policy 呼叫）；函式只回一個 boolean，
-- 不洩漏任何列內容，開放執行無風險。
revoke all on function public.is_month_visible(integer, integer) from public;
grant execute on function public.is_month_visible(integer, integer)
  to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- B-2 換掉 training_sessions 的讀取政策
--     原本（supabase/schema.sql:589-592）是 for select using (true)：
--     所有人可讀全部場次，包含還沒發布的未來月份 —— 正是客戶要禁止的
--     「12 月班表提前被看到」。
--     新政策：管理員照舊全看；其他人只能看「已發布且已到時間」的月份。
-- ------------------------------------------------------------
drop policy if exists "sessions_select_all"     on public.training_sessions;
drop policy if exists "sessions_select_visible" on public.training_sessions;
create policy "sessions_select_visible" on public.training_sessions
  for select to anon, authenticated
  using (
    public.is_admin()
    or public.is_month_visible(
         extract(year  from session_date)::int,
         extract(month from session_date)::int
       )
  );

comment on policy "sessions_select_visible" on public.training_sessions is
  '管理員全看；其他人只看已發布且生效時間已到的月份（自動上架／下架於讀取時判定）。';

-- sessions_admin_all（for all using is_admin()）刻意保留不動：寫入邊界照舊。

-- ------------------------------------------------------------
-- B-3 查詢索引
--     新的可見性判斷與前台月曆都是「先掃 session_date 區間，再看 status」，
--     既有 idx_sessions_date_time (session_date, start_time) 已能撐住區間掃描，
--     這裡補一個 (session_date, status) 讓後台統計／列表不必回表。
-- ------------------------------------------------------------
create index if not exists idx_sessions_date_status
  on public.training_sessions (session_date, status);


-- =============================================================
-- C. 按月複製與統計的 RPC
-- =============================================================

-- ------------------------------------------------------------
-- C-1 copy_month_sessions(p_from_year, p_from_month, p_to_year, p_to_month)
--     用途：客戶說「新增出來和 11 月樣式一樣」——
--     把來源月的場次按「同一個月內第幾天」平移到目標月，客戶再逐場改資料。
--
--     規則：
--       · 只複製 status <> 'cancelled' 的場次（已取消的不該被帶到下個月）
--       · 來源 11/20 → 目標 12/20（同日號）
--       · 目標月沒有該日號（例如來源 1/31、目標 2 月）→ 跳過，計入 skipped，
--         不拋 date field value out of range
--       · class_id / start_time / end_time / coach_name / location /
--         location_override / capacity / note / status 全部沿用
--       · starts_at / ends_at 依目標日期重算（帶 Asia/Macau 語義，
--         不沿用來源的 timestamptz，否則日期會是錯的）
--       · on conflict do nothing ⇒ 同一個目標月重複複製不會產生重複場次
--       · 回傳 created（真的新增的）／skipped（目標月沒有該日號）／
--         conflicts（目標月已有同課同日同時段）。三者相加＝來源月未取消的場次數。
-- ------------------------------------------------------------
create or replace function public.copy_month_sessions(
  p_from_year  integer,
  p_from_month integer,
  p_to_year    integer,
  p_to_month   integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text := '';
  v_from_start  date;
  v_to_start    date;
  v_to_last_day integer;
  v_from_label  text;
  v_to_label    text;
  v_src         record;
  v_dom         integer;
  v_target_date date;
  v_start_time  time;
  v_end_time    time;
  v_start_at    timestamptz;
  v_end_at      timestamptz;
  v_created     integer := 0;
  v_skipped     integer := 0;
  v_candidates  integer := 0;
  v_conflict    integer := 0;
  v_rows        integer;
begin
  -- 權限：管理員或 service_role；其他一律拒絕（含 anon / 普通會員）
  begin
    v_role := coalesce(auth.role(), '');
  exception when others then
    v_role := '';
  end;

  if not (public.is_admin() or v_role = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  -- 參數保護
  if p_from_year is null or p_from_year < 2024 or p_from_year > 2100
     or p_to_year is null or p_to_year < 2024 or p_to_year > 2100 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS',
                              'message', '年份需介於 2024 與 2100 之間。');
  end if;

  if p_from_month is null or p_from_month < 1 or p_from_month > 12
     or p_to_month is null or p_to_month < 1 or p_to_month > 12 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS',
                              'message', '月份需介於 1 與 12 之間。');
  end if;

  v_from_label := p_from_year::text || '-' || lpad(p_from_month::text, 2, '0');
  v_to_label   := p_to_year::text   || '-' || lpad(p_to_month::text,   2, '0');

  if p_from_year = p_to_year and p_from_month = p_to_month then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS',
                              'message', '來源月份與目標月份不可相同。');
  end if;

  if (p_to_year * 12 + p_to_month) < (p_from_year * 12 + p_from_month) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RANGE',
                              'message', '目標月份不可早於來源月份。');
  end if;

  v_from_start  := make_date(p_from_year, p_from_month, 1);
  v_to_start    := make_date(p_to_year, p_to_month, 1);
  v_to_last_day := extract(day from (v_to_start + interval '1 month - 1 day'))::int;

  for v_src in
    select s.session_date, s.class_id, s.start_time, s.end_time,
           s.title, s.location, s.location_override, s.coach_name,
           s.capacity, s.note, s.status, s.starts_at, s.ends_at
      from public.training_sessions s
     where s.session_date >= v_from_start
       and s.session_date <  (v_from_start + interval '1 month')
       and s.status <> 'cancelled'
     order by s.session_date, s.start_time nulls first, s.id
  loop
    v_dom := extract(day from v_src.session_date)::int;

    -- 目標月沒有這一天（例如 1/31 → 2 月）→ 跳過並計入 skipped
    if v_dom > v_to_last_day then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_target_date := make_date(p_to_year, p_to_month, v_dom);
    v_candidates  := v_candidates + 1;

    -- 時間沿用：優先 start_time（time 欄位），舊資料沒有 start_time 才用 starts_at 反推
    v_start_time := coalesce(v_src.start_time, (v_src.starts_at at time zone 'Asia/Macau')::time);
    v_end_time   := coalesce(v_src.end_time,   (v_src.ends_at   at time zone 'Asia/Macau')::time);

    -- 目標月的 timestamptz 必須重算，不可沿用來源（否則日期會停在來源月）
    v_start_at := case
                    when v_start_time is null then null
                    else (v_target_date + v_start_time) at time zone 'Asia/Macau'
                  end;
    v_end_at   := case
                    when v_end_time is null then null
                    else (v_target_date + v_end_time) at time zone 'Asia/Macau'
                  end;

    if v_src.class_id is not null then
      -- 走部分唯一索引 uq_sessions_class_date_time，重複複製自動略過
      insert into public.training_sessions
        (session_date, class_id, start_time, end_time, title, location,
         location_override, coach_name, capacity, note, status, starts_at, ends_at)
      values
        (v_target_date, v_src.class_id, v_start_time, v_end_time, v_src.title, v_src.location,
         v_src.location_override, v_src.coach_name, v_src.capacity, v_src.note, v_src.status,
         v_start_at, v_end_at)
      on conflict (class_id, session_date, start_time) where class_id is not null do nothing;
    else
      -- 舊資料（class_id 為 null）不參與唯一索引，改用 not exists 保證幂等
      insert into public.training_sessions
        (session_date, class_id, start_time, end_time, title, location,
         location_override, coach_name, capacity, note, status, starts_at, ends_at)
      select v_target_date, null, v_start_time, v_end_time, v_src.title, v_src.location,
             v_src.location_override, v_src.coach_name, v_src.capacity, v_src.note, v_src.status,
             v_start_at, v_end_at
      where not exists (
        select 1
          from public.training_sessions t
         where t.class_id is null
           and t.session_date = v_target_date
           and t.title = v_src.title
           and coalesce(t.start_time, time '00:00') = coalesce(v_start_time, time '00:00')
      );
    end if;

    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  -- 目標月已有同課同日同時段的場次時，on conflict do nothing 不會新增也不會拋錯，
  -- 這種「因重複而略過」與「因目標月沒有該日號而略過」是兩件事，
  -- 後台要能分別顯示，否則客戶重複按一次「複製」會看到 created=0/skipped=0，
  -- 誤以為功能壞了。
  v_conflict := v_candidates - v_created;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'skipped', v_skipped,
    'conflicts', v_conflict,
    'from', v_from_label,
    'to', v_to_label
  );
end;
$$;

comment on function public.copy_month_sessions(integer, integer, integer, integer) is
  '把來源月所有未取消場次按「同日號」複製到目標月（Asia/Macau），目標月沒有的日號跳過並計入 skipped。';

revoke all on function public.copy_month_sessions(integer, integer, integer, integer) from public, anon;
grant execute on function public.copy_month_sessions(integer, integer, integer, integer)
  to authenticated, service_role;


-- ------------------------------------------------------------
-- C-2 month_stats(p_year, p_month)
--     後台顯示「本月共幾場、佔幾天、已取消幾場」。
--     統計一律排除 cancelled（cancelled 單獨一個數字），
--     因為客戶關心的是「這個月實際上幾堂課」。
-- ------------------------------------------------------------
create or replace function public.month_stats(p_year integer, p_month integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      text := '';
  v_from      date;
  v_to        date;
  v_sessions  bigint;
  v_days      bigint;
  v_cancelled bigint;
begin
  begin
    v_role := coalesce(auth.role(), '');
  exception when others then
    v_role := '';
  end;

  if not (public.is_admin() or v_role = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_year is null or p_year < 2024 or p_year > 2100
     or p_month is null or p_month < 1 or p_month > 12 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS',
                              'message', '年月參數不合法。');
  end if;

  v_from := make_date(p_year, p_month, 1);
  v_to   := (v_from + interval '1 month')::date;

  select count(*) filter (where status <> 'cancelled'),
         count(distinct session_date) filter (where status <> 'cancelled'),
         count(*) filter (where status = 'cancelled')
    into v_sessions, v_days, v_cancelled
    from public.training_sessions
   where session_date >= v_from
     and session_date <  v_to;

  return jsonb_build_object(
    'ok', true,
    'sessions', coalesce(v_sessions, 0),
    'days', coalesce(v_days, 0),
    'cancelled', coalesce(v_cancelled, 0)
  );
end;
$$;

comment on function public.month_stats(integer, integer) is
  '後台用該月統計：sessions（排除 cancelled）、days（有場次的天數）、cancelled。';

revoke all on function public.month_stats(integer, integer) from public, anon;
grant execute on function public.month_stats(integer, integer)
  to authenticated, service_role;


-- =============================================================
-- D. 收尾：讓 PostgREST 重新載入 schema
--    （不 notify 的話新表／新 RPC 要等一陣子才看得到，後台會先拿到 500）
-- =============================================================
notify pgrst, 'reload schema';


-- =============================================================
-- 附註 A：貼完之後客戶自己驗（Supabase SQL Editor 逐「段」執行）
-- =============================================================
-- ⚠️ 為何以 `begin; … rollback;` 包起來：
--    RLS 只對 anon / authenticated 生效，SQL Editor 預設用 postgres（superuser）
--    身分執行，直接查詢會看到全部資料 —— 那不是 bug，是你繞過了 RLS。
--    要驗證「會員看到什麼」，必須 `set local role anon;` 模擬匿名使用者，
--    而 SET LOCAL 只在交易區塊內有效，所以一定要用 begin … rollback 包住，
--    否則分開執行時 SET LOCAL 會被忽略，你會誤以為政策沒生效。
--
-- A-1 檢查表與政策都在（這段用預設身分即可，只查目錄）
--   select year, month, status, publish_at from public.training_months order by year, month;
--   -- 預期兩列：2026-11 published（publish_at 2026-11-01 00:00+08）、2026-12 draft（publish_at 空）
--
--   select policyname, cmd, qual from pg_policies
--    where schemaname='public' and tablename in ('training_sessions','training_months')
--    order by tablename, policyname;
--   -- 預期 training_sessions 有 sessions_select_visible / sessions_admin_all
--   --      training_months 有 months_select_published / months_admin_all
--
-- A-2 驗證「11 月可見」（以匿名身分查，11 月種子已發布且生效時間已過）
--   begin;
--     set local role anon;
--     select count(*) from public.training_sessions
--      where session_date >= '2026-11-01' and session_date < '2026-12-01';
--   rollback;
--   -- 預期 35（非 0）。若得到 0，檢查 training_months 是否有 2026-11 且 status='published'
--
-- A-3 驗證「12 月仍是 draft 時，匿名看不到」
--   begin;
--     set local role anon;
--     select count(*) from public.training_sessions
--      where session_date >= '2026-12-01' and session_date < '2027-01-01';
--   rollback;
--   -- 預期 0
--
-- A-4 驗證「發布 12 月但生效時間未到，仍不可見」
--   -- 4-1 先標成 published，但生效時間設在未來（這一步會真的改資料，屬預期）
--   update public.training_months
--      set status = 'published',
--          publish_at = timestamptz '2027-01-01 00:00:00+08',
--          updated_at = now()
--    where year = 2026 and month = 12;
--
--   -- 4-2 匿名查：狀態已發布但時間沒到 → 應仍為 0
--   begin;
--     set local role anon;
--     select count(*) from public.training_sessions
--      where session_date >= '2026-12-01' and session_date < '2027-01-01';
--   rollback;
--
--   -- 4-3 把生效時間改回過去
--   update public.training_months
--      set publish_at = timestamptz '2026-01-01 00:00:00+08', updated_at = now()
--    where year = 2026 and month = 12;
--
--   -- 4-4 匿名查：這次應該看得到（12 月還沒建場次時會是 0，
--   --     先在後台「複製 11 月到 12 月」再驗，預期變成該月場次數）
--   begin;
--     set local role anon;
--     select count(*) from public.training_sessions
--      where session_date >= '2026-12-01' and session_date < '2027-01-01';
--   rollback;
--
--   -- 4-5 驗完若不想讓 12 月提前上架，改回草稿：
--   update public.training_months
--      set status = 'draft', publish_at = null, updated_at = now()
--    where year = 2026 and month = 12;
--
-- 附註 B：可見性判定只看 training_months，與 training_sessions.status 無關。
--   某場次 status='cancelled' 仍然「可見」，由前台畫成取消樣式 ——
--   這是刻意的：客戶取消一堂課，會員要看到「這堂取消了」，
--   而不是那堂課從月曆上無聲消失。
--
-- 附註 C：RLS 收緊後，任何用 anon key 直讀 training_sessions 的前台查詢
--   （含 queries.ts 的 getCachedUpcomingSessions / getCachedAllSessions）
--   都會自動只看得到已發布月份，不需要逐支改寫。這是本次改動的主要紅利。
-- =============================================================
