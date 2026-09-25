-- =============================================================
-- MSW 街健館 (Macau Street Workout) — Supabase 一鍵初始化腳本
-- 用法：Supabase 後台 → SQL Editor → 貼上全部 → Run
-- 可重複執行（已加 if not exists / drop policy if exists）
-- R6 追加結構請見同目錄 schema-r6.sql（events / site_theme / site-assets）
-- =============================================================

create extension if not exists "pgcrypto";

-- 注意：is_admin() 定義在 profiles 表建立「之後」（見第 1 節末）。
-- Supabase 的 SQL 執行通道會先解析函式體，表必須先存在。

-- =============================================================
-- 1. profiles — 會員資料（對應 auth.users）
-- =============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_url    text,
  phone         text,
  role          text not null default 'member' check (role in ('member', 'admin')),
  points        integer not null default 0,
  total_km      numeric(10, 2) not null default 0,
  created_at    timestamptz not null default now()
);

-- 判斷目前使用者是否為管理員（security definer 避免在 RLS 中遞迴查詢 profiles）
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- 新使用者註冊時自動建立 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    'member'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 防止會員自行竄改 role / points / total_km
create or replace function public.guard_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() 為 null 代表是後端／服務角色在操作（已繞過 RLS），放行
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    new.role     := old.role;
    new.points   := old.points;
    new.total_km := old.total_km;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_sensitive on public.profiles;
create trigger profiles_guard_sensitive
  before update on public.profiles
  for each row execute function public.guard_profile_sensitive_fields();

-- =============================================================
-- 2. training_sessions — 定期訓練活動（逢星期一 20:00–21:00）
-- =============================================================
create table if not exists public.training_sessions (
  id           uuid primary key default gen_random_uuid(),
  session_date date not null unique,
  title        text not null default 'MSW 定期訓練',
  location     text not null default '澳門街健館',
  starts_at    timestamptz,
  ends_at      timestamptz,
  capacity     integer not null default 30,
  note         text,
  status       text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at   timestamptz not null default now()
);

-- =============================================================
-- 3. training_checkins — 訓練簽到（後台確認）
-- =============================================================
create table if not exists public.training_checkins (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.training_sessions(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note     text,
  confirmed_by   uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  unique (session_id, user_id)
);

create index if not exists idx_checkins_user  on public.training_checkins (user_id);
create index if not exists idx_checkins_status on public.training_checkins (status);

-- =============================================================
-- 4. run_submissions — 跑步里程提交（上傳截圖 + 輸入公里數）
-- =============================================================
create table if not exists public.run_submissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  km            numeric(8, 2) not null check (km > 0 and km <= 200),
  period_month  text not null,                 -- 格式 'YYYY-MM'
  image_path    text not null,                 -- storage 物件路徑：{uid}/{timestamp}.{ext}
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note    text,
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_runs_user   on public.run_submissions (user_id);
create index if not exists idx_runs_status on public.run_submissions (status);
create index if not exists idx_runs_month  on public.run_submissions (period_month);

-- =============================================================
-- 5. coupons — 優惠券（電子券碼 + QR Code）
-- =============================================================
create table if not exists public.coupons (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  description   text,
  month_awarded text,                          -- 'YYYY-MM'，來自月度任務獎勵
  status        text not null default 'active' check (status in ('active', 'used', 'expired')),
  expires_at    date,
  redeemed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_coupons_user on public.coupons (user_id);

-- =============================================================
-- 6. point_transactions — 積分明細
-- =============================================================
create table if not exists public.point_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  ref_type   text,                             -- 'run' | 'checkin' | 'monthly_bonus' | 'manual'
  ref_id     uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_points_user on public.point_transactions (user_id);

-- =============================================================
-- 7. 檢視表：月度跑步統計（只計 approved）
-- =============================================================
create or replace view public.monthly_running_stats as
select
  user_id,
  period_month,
  sum(km)     as total_km,
  count(*)    as runs
from public.run_submissions
where status = 'approved'
group by user_id, period_month;

-- 公開排行榜檢視表：只暴露暱稱／頭像／積分／里程，不暴露 role 與其他欄位。
-- security_invoker = false → 以擁有者（postgres）權限讀取，匿名訪客也能看到排行榜。
drop view if exists public.public_leaderboard cascade;
create view public.public_leaderboard
with (security_invoker = false) as
select
  id,
  display_name,
  avatar_url,
  points,
  total_km
from public.profiles;

grant select on public.public_leaderboard to anon, authenticated;

-- 全站統計（首頁數字用）
create or replace view public.site_stats as
select
  (select count(*) from public.profiles)                                              as members,
  (select coalesce(sum(km), 0) from public.run_submissions where status = 'approved') as total_km,
  (select count(*) from public.run_submissions where status = 'approved')             as total_runs,
  (select count(*) from public.training_sessions)                                     as total_sessions;

-- =============================================================
-- 7.5 app_settings — 後台可調的積分與任務規則
-- =============================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('points_per_checkin',   '10'::jsonb),
  ('points_per_km',        '1'::jsonb),
  ('monthly_bonus_points', '200'::jsonb),
  ('monthly_goal_km',      '300'::jsonb)
on conflict (key) do nothing;

-- 取得數值設定（找不到就用預設）
create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value #>> '{}')::numeric from public.app_settings where key = p_key),
    p_default
  );
$$;

alter table public.app_settings enable row level security;

drop policy if exists "settings_select_all" on public.app_settings;
create policy "settings_select_all" on public.app_settings
  for select using (true);

drop policy if exists "settings_admin_write" on public.app_settings;
create policy "settings_admin_write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- =============================================================
-- 8. 核心商業邏輯（RPC）
-- =============================================================

-- 8.1 寫入積分並同步 profiles.points
create or replace function public.add_points(
  p_user_id uuid,
  p_delta   integer,
  p_reason  text,
  p_ref_type text default null,
  p_ref_id   uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 安全：只有管理員能調整積分（防止任何人直接打 RPC 竄改）
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

-- 此函式只由其他 security-definer 函式內部呼叫，前端與 API 都不直接呼叫，
-- 因此收回 anon / authenticated 的執行權（雙重防線）。
revoke all on function public.add_points(uuid, integer, text, text, uuid)
  from anon, authenticated;

-- 8.2 產生優惠券碼
create or replace function public.gen_coupon_code(p_month text)
returns text
language plpgsql
volatile
as $$
declare
  v_code text;
begin
  loop
    v_code := 'MSW-' || replace(p_month, '-', '') || '-'
              || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.coupons where code = v_code);
  end loop;
  return v_code;
end;
$$;

-- 8.3 月度達標檢查：滿 300km → +200 分 + 發券（同一個月只發一次）
create or replace function public.award_monthly_if_qualified(p_user_id uuid, p_month text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(10, 2);
  v_goal  numeric := public.setting_num('monthly_goal_km', 300);
  v_bonus integer := public.setting_num('monthly_bonus_points', 200)::int;
begin
  select coalesce(sum(km), 0) into v_total
    from public.run_submissions
   where user_id = p_user_id and period_month = p_month and status = 'approved';

  if v_total < v_goal then
    return false;
  end if;

  -- 該月已發過就不再發
  if exists (
    select 1 from public.coupons
     where user_id = p_user_id and month_awarded = p_month
  ) then
    return false;
  end if;

  perform public.add_points(
    p_user_id,
    v_bonus,
    '月度任務達成獎勵（' || p_month || ' 滿 ' || v_goal || 'km）',
    'monthly_bonus'
  );

  insert into public.coupons (code, user_id, title, description, month_awarded, expires_at)
  values (
    public.gen_coupon_code(p_month),
    p_user_id,
    '月度 ' || v_goal || 'km 達成優惠券',
    '恭喜完成 ' || p_month || ' 月度 ' || v_goal
      || ' 公里挑戰，可於 MSW 街健館兌換指定優惠。',
    p_month,
    (date_trunc('month', (p_month || '-01')::date) + interval '3 months')::date
  );

  return true;
end;
$$;

-- 8.4 後台審核跑步提交（通過 → 加分 + 累加里程 + 檢查月度達標）
create or replace function public.review_run_submission(
  p_submission_id uuid,
  p_approve       boolean,
  p_admin_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub      public.run_submissions%rowtype;
  v_awarded  boolean := false;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以審核提交';
  end if;

  select * into v_sub from public.run_submissions where id = p_submission_id for update;
  if not found then
    raise exception '找不到該提交';
  end if;
  if v_sub.status <> 'pending' then
    raise exception '該提交已審核過';
  end if;

  if p_approve then
    update public.run_submissions
       set status = 'approved',
           admin_note = p_admin_note,
           reviewed_by = auth.uid(),
           reviewed_at = now()
     where id = p_submission_id;

    update public.profiles
       set total_km = total_km + v_sub.km
     where id = v_sub.user_id;

    -- 每公里積分（可在後台 app_settings 調整）
    perform public.add_points(
      v_sub.user_id,
      round(v_sub.km * public.setting_num('points_per_km', 1))::int,
      '跑步里程 ' || v_sub.km || ' km（' || v_sub.period_month || '）',
      'run',
      v_sub.id
    );

    select public.award_monthly_if_qualified(v_sub.user_id, v_sub.period_month) into v_awarded;
  else
    update public.run_submissions
       set status = 'rejected',
           admin_note = p_admin_note,
           reviewed_by = auth.uid(),
           reviewed_at = now()
     where id = p_submission_id;
  end if;

  return jsonb_build_object('ok', true, 'monthly_awarded', v_awarded);
end;
$$;

-- 8.5 後台確認訓練簽到（通過 → +10 分）
create or replace function public.review_checkin(
  p_checkin_id uuid,
  p_approve    boolean,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.training_checkins%rowtype;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以確認簽到';
  end if;

  select * into v_c from public.training_checkins where id = p_checkin_id for update;
  if not found then
    raise exception '找不到該簽到紀錄';
  end if;
  if v_c.status <> 'pending' then
    raise exception '該簽到已確認過';
  end if;

  if p_approve then
    update public.training_checkins
       set status = 'approved', admin_note = p_admin_note, confirmed_by = auth.uid()
     where id = p_checkin_id;
    perform public.add_points(
      v_c.user_id,
      public.setting_num('points_per_checkin', 10)::int,
      '定期訓練簽到',
      'checkin',
      v_c.id
    );
  else
    update public.training_checkins
       set status = 'rejected', admin_note = p_admin_note, confirmed_by = auth.uid()
     where id = p_checkin_id;
  end if;
end;
$$;

-- 8.6 管理員手動批量發券
create or replace function public.issue_coupons(
  p_user_ids uuid[],
  p_title    text default 'MSW 專屬優惠券',
  p_desc     text default null,
  p_month    text default null,
  p_days     integer default 90
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_n   integer := 0;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以發放優惠券';
  end if;

  foreach v_uid in array p_user_ids loop
    insert into public.coupons (code, user_id, title, description, month_awarded, expires_at)
    values (
      public.gen_coupon_code(coalesce(p_month, to_char(now(), 'YYYY-MM'))),
      v_uid, p_title, p_desc, p_month,
      (current_date + (p_days || ' days')::interval)::date
    );
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- 8.7 核銷優惠券（管理員）
create or replace function public.redeem_coupon(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理員可以核銷優惠券';
  end if;

  update public.coupons
     set status = 'used', redeemed_at = now()
   where code = p_code and status = 'active';
end;
$$;

-- 8.8 後台儀表板用的月度達標名單
create or replace function public.monthly_qualified_list(p_month text)
returns table (
  user_id    uuid,
  name       text,
  email      text,
  total_km   numeric,
  runs       bigint,
  has_coupon boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- 安全：達標名單含會員電郵，只有管理員可查閱
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
                  where c.user_id = s.user_id and c.month_awarded = p_month) as has_coupon
    from public.monthly_running_stats s
    join public.profiles p on p.id = s.user_id
    left join auth.users u on u.id = s.user_id
   where s.period_month = p_month
     and s.total_km >= public.setting_num('monthly_goal_km', 300)
   order by s.total_km desc;
end;
$$;

-- 收回匿名呼叫權；後台页面用管理員 JWT（authenticated）呼叫，保留執行權
revoke all on function public.monthly_qualified_list(text) from anon;
grant execute on function public.monthly_qualified_list(text) to authenticated;

-- =============================================================
-- 9. Row Level Security
-- =============================================================
alter table public.profiles           enable row level security;
alter table public.training_sessions  enable row level security;
alter table public.training_checkins  enable row level security;
alter table public.run_submissions    enable row level security;
alter table public.coupons            enable row level security;
alter table public.point_transactions enable row level security;

-- profiles
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);

-- training_sessions：所有人可讀，管理員可寫
drop policy if exists "sessions_select_all" on public.training_sessions;
create policy "sessions_select_all" on public.training_sessions
  for select using (true);

drop policy if exists "sessions_admin_all" on public.training_sessions;
create policy "sessions_admin_all" on public.training_sessions
  for all using (public.is_admin()) with check (public.is_admin());

-- training_checkins：會員可報名/看自己的，管理員可改
drop policy if exists "checkins_select" on public.training_checkins;
create policy "checkins_select" on public.training_checkins
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "checkins_insert_own" on public.training_checkins;
create policy "checkins_insert_own" on public.training_checkins
  for insert with check (auth.uid() = user_id);

drop policy if exists "checkins_delete_own_pending" on public.training_checkins;
create policy "checkins_delete_own_pending" on public.training_checkins
  for delete using (auth.uid() = user_id and status = 'pending');

drop policy if exists "checkins_admin_update" on public.training_checkins;
create policy "checkins_admin_update" on public.training_checkins
  for update using (public.is_admin()) with check (public.is_admin());

-- run_submissions
drop policy if exists "runs_select" on public.run_submissions;
create policy "runs_select" on public.run_submissions
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "runs_insert_own" on public.run_submissions;
create policy "runs_insert_own" on public.run_submissions
  for insert with check (auth.uid() = user_id and status = 'pending');

drop policy if exists "runs_delete_own_pending" on public.run_submissions;
create policy "runs_delete_own_pending" on public.run_submissions
  for delete using (auth.uid() = user_id and status = 'pending');

drop policy if exists "runs_admin_update" on public.run_submissions;
create policy "runs_admin_update" on public.run_submissions
  for update using (public.is_admin()) with check (public.is_admin());

-- coupons
drop policy if exists "coupons_select" on public.coupons;
create policy "coupons_select" on public.coupons
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "coupons_admin_all" on public.coupons;
create policy "coupons_admin_all" on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());

-- point_transactions
drop policy if exists "points_select" on public.point_transactions;
create policy "points_select" on public.point_transactions
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "points_admin_insert" on public.point_transactions;
create policy "points_admin_insert" on public.point_transactions
  for insert with check (public.is_admin());

-- =============================================================
-- 10. Storage：跑步截圖（私有 bucket，靠 signed URL 讀取）
-- =============================================================
insert into storage.buckets (id, name, public)
values ('run-screenshots', 'run-screenshots', false)
on conflict (id) do nothing;

drop policy if exists "runshots_insert_own" on storage.objects;
create policy "runshots_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'run-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "runshots_select" on storage.objects;
create policy "runshots_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'run-screenshots'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "runshots_delete_own" on storage.objects;
create policy "runshots_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'run-screenshots'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- =============================================================
-- 11. 種子資料：未來 8 週的定期訓練（逢星期一 20:00–21:00）
-- =============================================================
insert into public.training_sessions (session_date, title, location, starts_at, ends_at, note)
select
  d::date,
  'MSW 定期訓練',
  '澳門街健館',
  (d + time '20:00')::timestamptz,
  (d + time '21:00')::timestamptz,
  '街健基礎訓練：引體上升、雙槓屈臂撐、核心訓練。請自備毛巾與水。'
from generate_series(
  date_trunc('week', current_date)::date + 0,   -- 本週一
  date_trunc('week', current_date)::date + 56,  -- 往後 8 週
  interval '1 week'
) as d
on conflict (session_date) do nothing;

-- =============================================================
-- 12. 把自己設為管理員（註冊後執行一次，把 email 換成你的）
-- =============================================================
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'mswmacau2026@gmail.com');
