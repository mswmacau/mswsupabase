-- =============================================================
-- 定期訓練班表：課程定義 / 週期規則 / 場次生成（Migration）
-- 日期：2026-02-XX
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：全部使用 if not exists / drop ... if exists / on conflict do nothing，
--       可重複執行；重複執行不會產生重複資料，也不會刪掉任何既有場次。
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【客戶需求（原話重點）】
-- 1. 定期訓練用日曆表呈現，每週固定、每月按規則重複。
-- 2. 同一時段可以有多堂（不同場地、不同教練）—— 硬需求，
--    所以唯一鍵不能只鎖 (session_date, start_time)，必須帶 class_id。
-- 3. 課程類型就是日曆上的 8 類。
-- 4. 時區一律 Asia/Macau。
--
-- 【本次改動範圍】
-- - 新增兩張表：training_classes（課程定義）、training_rules（週期規則）。
-- - 改造 training_sessions：加課程/時段/教練/場地覆寫欄位，
--   移除「一日一場」的唯一限制，改成 (class_id, session_date, start_time) 唯一。
-- - 新增兩支 RPC：generate_sessions(from, to)、generate_month(year, month)。
-- - 不改 training_checkins（外鍵仍指向 training_sessions(id)，結構未動）。
-- - 不刪任何既有場次資料。
--
-- 【與既有 /api/admin/sessions 的關係（風險提示）】
-- 舊路由用 `.upsert(..., { onConflict: "session_date" })`，
-- 依賴訓練場次「一日一場」的唯一約束。本 migration 依客戶硬需求移除該約束後，
-- 該舊路由的 upsert 會得到 Postgres 42P10（no unique or exclusion constraint
-- matching the ON CONFLICT specification）。修法見檔尾「附註 A」。
-- =============================================================


-- =============================================================
-- A. 課程定義 training_classes
-- =============================================================
create table if not exists public.training_classes (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  category     text not null check (category in ('strength','hyrox','running','skill','internal','outdoor')),
  color_key    text,
  duration_min integer,
  capacity     integer,
  coach_name   text,
  location     text,
  description  text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- 前台日曆常以 sort_order 排序、以 category 分色
create index if not exists idx_classes_active_sort
  on public.training_classes (is_active, sort_order);

alter table public.training_classes enable row level security;

-- 讀：anon + authenticated 全部可讀（含停用課程）。
-- 理由：管理員後台要能看到停用課程才能重新啟用；RLS 無法依角色分流同一條 policy
-- 的 select 條件（若要分流得寫兩條 policy 並靠 permissive OR 合併，結果仍是全部可讀），
-- 因此 select 一律 true，寫入才是權限邊界。
drop policy if exists "classes_select_all" on public.training_classes;
create policy "classes_select_all" on public.training_classes
  for select using (true);

drop policy if exists "classes_admin_all" on public.training_classes;
create policy "classes_admin_all" on public.training_classes
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.training_classes to anon, authenticated;
grant insert, update, delete on public.training_classes to authenticated;
grant all on public.training_classes to service_role;


-- =============================================================
-- B. 週期規則 training_rules
-- =============================================================
create table if not exists public.training_rules (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.training_classes(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),  -- 1=星期一 … 7=星期日（ISO-8601）
  start_time time not null,
  end_time   time not null,
  location   text,
  coach_name text,
  capacity   integer,
  valid_from date not null default current_date,
  valid_to   date,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint rules_time_order check (end_time > start_time)
);

-- 生成器掃描用：只找啟用中的規則，依 weekday 過濾
create index if not exists idx_rules_active_weekday
  on public.training_rules (weekday) where is_active;
create index if not exists idx_rules_class on public.training_rules (class_id);

alter table public.training_rules enable row level security;

drop policy if exists "rules_select_all" on public.training_rules;
create policy "rules_select_all" on public.training_rules
  for select using (true);

drop policy if exists "rules_admin_all" on public.training_rules;
create policy "rules_admin_all" on public.training_rules
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.training_rules to anon, authenticated;
grant insert, update, delete on public.training_rules to authenticated;
grant all on public.training_rules to service_role;


-- =============================================================
-- C. 場次表改造：允許「同一時段多堂」
-- =============================================================

-- C-1 新增欄位（全部可為 null，既有列不受影響）
alter table public.training_sessions
  add column if not exists class_id          uuid references public.training_classes(id),
  add column if not exists start_time        time,
  add column if not exists end_time          time,
  add column if not exists coach_name        text,
  add column if not exists location_override text;

-- C-2 移除「一日一場」
alter table public.training_sessions drop constraint if exists training_sessions_session_date_key;

-- 若還有「只用 session_date 的單欄唯一索引」殘留（例如手動 create unique index 建的），
-- 用系統目錄判斷後逐一 drop；已不存在的自然跳過。
do $$
declare
  v_index regclass;
begin
  for v_index in
    select i.indexrelid::regclass
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid
     and a.attnum = any (i.indkey)
    where i.indrelid = 'public.training_sessions'::regclass
      and i.indisunique
      and not i.indisprimary
      and i.indnatts = 1
      and a.attname = 'session_date'
  loop
    execute format('drop index if exists %s', v_index);
  end loop;
end $$;

-- C-3 舊資料回填：用 starts_at / ends_at 推回 time（以 Asia/Macau 呈現）。
-- 只補 null 的列，不動任何既有值，也不刪任何列。
update public.training_sessions
set start_time = (starts_at at time zone 'Asia/Macau')::time
where start_time is null and starts_at is not null;

update public.training_sessions
set end_time = (ends_at at time zone 'Asia/Macau')::time
where end_time is null and ends_at is not null;

-- C-4 新的唯一鍵：同課程 + 同日 + 同時段只能一場；
--     不同課程（不同場地／教練）可同時段並存 —— 客戶硬需求。
--     where class_id is not null 讓舊列（class_id 為 null）完全不參與唯一性，
--     因此不會因為多筆舊列同日而建立索引失敗，也不會誤判衝突。
create unique index if not exists uq_sessions_class_date_time
  on public.training_sessions (class_id, session_date, start_time)
  where class_id is not null;

-- C-5 查詢用索引（前台月曆以日期區間掃描、後台以課程反查）
create index if not exists idx_sessions_date_time
  on public.training_sessions (session_date, start_time);
create index if not exists idx_sessions_class
  on public.training_sessions (class_id);


-- =============================================================
-- D. 生成場次 RPC
-- =============================================================

-- ------------------------------------------------------------
-- D-1 generate_sessions(p_from, p_to)
--     · security definer：以函式擁有者身分寫入，繞過 RLS；權限改由函式內部檢查。
--     · 只允許 is_admin() 或 service_role。
--     · 回傳 {ok, created, skipped, from, to} 或 {ok:false, code, message}
-- ------------------------------------------------------------
create or replace function public.generate_sessions(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule       record;
  v_date       date;
  v_created    integer := 0;
  v_candidates integer := 0;
  v_rows       integer;
  v_role       text := '';
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
  if p_from is null or p_to is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RANGE', 'message', '請提供開始日期與結束日期。');
  end if;

  if p_to < p_from then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RANGE', 'message', '結束日期不可早於開始日期。');
  end if;

  if (p_to - p_from) > 400 then
    return jsonb_build_object('ok', false, 'code', 'RANGE_TOO_LARGE', 'message', '單次生成區間不可超過 400 天。');
  end if;

  for v_rule in
    select r.class_id,
           r.weekday,
           r.start_time,
           r.end_time,
           r.valid_from,
           r.valid_to,
           coalesce(r.location, c.location, '澳門街健館') as location,
           coalesce(r.coach_name, c.coach_name)           as coach_name,
           coalesce(r.capacity, c.capacity, 30)           as capacity,
           c.name                                         as class_name
    from public.training_rules r
    join public.training_classes c on c.id = r.class_id
    where r.is_active
      and c.is_active
      and r.valid_from <= p_to
      and (r.valid_to is null or r.valid_to >= p_from)
    order by r.weekday, r.start_time
  loop
    for v_date in
      select g.day::date
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(day)
      where extract(isodow from g.day) = v_rule.weekday
        and g.day::date >= v_rule.valid_from
        and (v_rule.valid_to is null or g.day::date <= v_rule.valid_to)
      order by g.day
    loop
      v_candidates := v_candidates + 1;

      insert into public.training_sessions
        (session_date, start_time, end_time, class_id, title, location,
         coach_name, capacity, starts_at, ends_at, status)
      values
        (v_date, v_rule.start_time, v_rule.end_time, v_rule.class_id,
         v_rule.class_name, v_rule.location,
         v_rule.coach_name, v_rule.capacity,
         (v_date + v_rule.start_time) at time zone 'Asia/Macau',
         (v_date + v_rule.end_time)   at time zone 'Asia/Macau',
         'open')
      -- 必須帶 where class_id is not null，才能推論到 C-4 的部分唯一索引
      -- （Postgres 的 ON CONFLICT 推論要求 index predicate 被 arbiter WHERE 蘊含）。
      -- do nothing：已存在的場次（含管理員手動取消的 cancelled 場次）一律不覆蓋、不復活。
      on conflict (class_id, session_date, start_time) where class_id is not null do nothing;

      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'skipped', v_candidates - v_created,
    'from', p_from,
    'to', p_to
  );
end;
$$;

comment on function public.generate_sessions(date, date) is
  '依 training_rules 週期規則，為 [p_from, p_to] 逐日生成 training_sessions（Asia/Macau）。已存在的場次不覆蓋、不復活。';

revoke all on function public.generate_sessions(date, date) from public, anon;
grant execute on function public.generate_sessions(date, date) to authenticated, service_role;


-- ------------------------------------------------------------
-- D-2 generate_month(p_year, p_month)
--     包一層：算出該月第一天與最後一天後呼叫 generate_sessions。
-- ------------------------------------------------------------
create or replace function public.generate_month(p_year integer, p_month integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date;
  v_to   date;
  v_role text := '';
begin
  begin
    v_role := coalesce(auth.role(), '');
  exception when others then
    v_role := '';
  end;

  if not (public.is_admin() or v_role = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_year is null or p_year < 2024 or p_year > 2100 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS', 'message', '年份需介於 2024 與 2100 之間。');
  end if;

  if p_month is null or p_month < 1 or p_month > 12 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS', 'message', '月份需介於 1 與 12 之間。');
  end if;

  v_from := make_date(p_year, p_month, 1);
  v_to   := (v_from + interval '1 month - 1 day')::date;

  return public.generate_sessions(v_from, v_to);
end;
$$;

comment on function public.generate_month(integer, integer) is
  '生成指定年月的訓練場次（呼叫 generate_sessions，Asia/Macau）。';

revoke all on function public.generate_month(integer, integer) from public, anon;
grant execute on function public.generate_month(integer, integer) to authenticated, service_role;


-- =============================================================
-- E. 種子資料
--    ⚠️ 場地與教練全部是 DEMO 值，客戶之後在後台替換。
-- =============================================================

-- E-1 八類課（依客戶提供的日曆 8 類）
insert into public.training_classes
  (slug, name, category, color_key, duration_min, capacity, coach_name, location, description, sort_order)
values
  ('running-club',      'Running Club',      'running',  'blue',   60, 30, '教練 A（示範）', '戶外跑道（觀音像）',   '每週固定晨跑團練，配速分組進行。',           10),
  ('strength-basics',   '街健基礎力量',       'strength', 'green',  90, 20, '教練 B（示範）', '力量區',               '引體上升、雙槓屈臂撐、核心基礎力量訓練。',   20),
  ('hyrox-foundation',  'Hyrox (Foundation)', 'hyrox',    'amber',  60, 20, '教練 C（示範）', '體能區 A',             'Hyrox 基礎動作與器材熟悉。',                 30),
  ('hyrox-power',       'Hyrox (Power)',      'hyrox',    'amber',  60, 20, '教練 C（示範）', '體能區 A',             'Hyrox 力量段（雪橇推拉、農夫走路）。',        40),
  ('hyrox-engine',      'Hyrox (Engine)',     'hyrox',    'amber',  60, 20, '教練 D（示範）', '體能區 B',             'Hyrox 心肺段（划船機、滑雪機、Burpee）。',   50),
  ('skill-flow',        '街健花式動態',       'skill',    'teal',   90, 16, '教練 E（示範）', '技巧區',               '街健花式動作串接與動態技巧。',               60),
  ('msw-internal',      'MSW 內訓',           'internal', 'violet', 40, 12, '內部',           '全場',                 '教練團隊內部訓練與教學複盤。',               70),
  ('hyrox-outdoor',     'Hyrox (Outdoor)',    'outdoor',  'orange', 60, 40, '教練團隊',       '觀音像海濱休憩區',     '每月一次戶外付費活動（走 events 表，不建週期規則）。', 80)
on conflict (slug) do nothing;

-- E-2 八條週期規則（Hyrox (Outdoor) 刻意不建規則：它是每月一次的付費活動）
--     以「同課程 + 同 weekday + 同開始時間不存在才 insert」判斷，可重複執行。
--     location / coach_name / capacity 刻意留 null：生成器會用
--     coalesce(rule.x, class.x)，之後在後台改課程的場地／教練就會自動套用到所有場次，
--     不必逐條規則改（要為單一時段指定不同場地時，再於該條規則填值即可）。
insert into public.training_rules (class_id, weekday, start_time, end_time, location, coach_name, capacity)
select c.id, v.weekday, v.start_time::time, v.end_time::time, null, null, null
from (values
  ('running-club',     1::smallint, '06:30', '07:30'),
  ('strength-basics',  1::smallint, '19:00', '20:30'),
  ('hyrox-foundation', 1::smallint, '19:30', '20:30'),
  ('hyrox-power',      2::smallint, '20:00', '21:00'),
  ('skill-flow',       4::smallint, '19:00', '20:30'),
  ('hyrox-engine',     4::smallint, '20:00', '21:00'),
  ('msw-internal',     4::smallint, '21:10', '21:50'),
  ('skill-flow',       6::smallint, '19:00', '20:30')
) as v(slug, weekday, start_time, end_time)
join public.training_classes c on c.slug = v.slug
where not exists (
  select 1
  from public.training_rules r
  where r.class_id = c.id
    and r.weekday = v.weekday
    and r.start_time = v.start_time::time
);


-- =============================================================
-- F. 收尾：讓 PostgREST 重新載入 schema（否則新表／新 RPC 要等一陣子才看得到）
-- =============================================================
notify pgrst, 'reload schema';


-- =============================================================
-- 附註 A：既有 /api/admin/sessions 的後續處理（本次刻意不改該檔）
-- =============================================================
-- 舊路由 src/app/api/admin/sessions/route.ts:63-75 使用：
--   .upsert(payload, { onConflict: "session_date" })
-- C-2 移除 session_date 唯一約束後，該 upsert 會回 42P10。
-- 最小修法（3 行，改完即可恢復）：把 upsert 換成先查再寫，例如
--   const { data: existing } = await supabase
--     .from("training_sessions").select("id")
--     .eq("session_date", sessionDate).is("class_id", null).maybeSingle();
--   const q = existing
--     ? supabase.from("training_sessions").update(payload).eq("id", existing.id)
--     : supabase.from("training_sessions").insert(payload);
--   const { error } = await q;
-- 或直接改為 insert（後台新頁面已改走 /api/admin/training/*，不再需要 upsert 語意）。
--
-- 附註 B：C-3 回填的時區語意
-- schema.sql:684 的舊種子用 `(d + time '20:00')::timestamptz`，在 Supabase（UTC session）
-- 下代表 20:00 UTC，以 Asia/Macau 呈現是 04:00 —— 因此舊列的 start_time 會回填成 04:00。
-- 這是忠實反映既有資料的存檔瞬間，本 migration 不擅自改寫舊列的 timestamptz。
-- 新生成的場次改用 `at time zone 'Asia/Macau'`，語意正確。
