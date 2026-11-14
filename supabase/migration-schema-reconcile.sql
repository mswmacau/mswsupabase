-- =============================================================
-- 安全狀態對帳（Schema Reconcile）— 把現行正確狀態重新套一次
-- 檔名：migration-schema-reconcile.sql
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- 幂等：可重複執行，次數不限；不改任何一筆資料、不改任何 table 結構
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【這支檔是什麼】
--   這個專案的安全性靠一串 migration 疊起來，而 schema.sql 是最早的版本，
--   裡面有幾段「已被取代的舊定義」。任何人重跑 schema.sql，安全性就回歸。
--   這支檔的角色是「對帳單」：不管之前被跑過什麼，
--   只要再跑這支一次，就會回到目前唯一正確的狀態。
--
-- 【它會重新套用的 7 件事（每一件都對應一個實測過的漏洞或回歸）】
--   1. guard_profile_sensitive_fields —— 6 欄護欄
--      （重跑 schema.sql 會退回 3 欄 → 被停權會員可自行把 status 改回 active）
--   2. profiles_guard_insert —— INSERT 護欄
--      （缺這支時，日後若出現「auth 使用者有、profile 沒有」的狀態，
--        該使用者可自行 insert role='admin'）
--   3. training_sessions 讀取政策
--      （舊的 sessions_select_all using(true) 與新的 sessions_select_visible
--        形成 permissive OR → 草稿月份班表外洩。這支會先把舊政策 drop 掉）
--   4. public_leaderboard / monthly_leaderboard
--      （舊定義 select 了 id / user_id → 會員 auth UUID 外洩給匿名訪客；
--        且 public_leaderboard 缺 where role='member' → 管理員回到榜上；
--        且 drop 用 cascade 會把 monthly_leaderboard 砍掉卻不重建 → 月度榜消失）
--   5. site_stats.members —— 只算 role='member'
--      （舊定義 count(*) 含管理員 → 與榜單人數、後台會員數不一致）
--   6. monthly_running_stats 收回 anon 直讀
--      （這張 view 以擁有者權限執行，繞過 run_submissions 的 RLS，
--        匿名可讀出全體會員 user_id 與逐月里程）
--   7. training_months 的兩條政策（表存在時才處理）
--
-- 【它刻意不做的事】
--   · 不改任何資料（沒有任何 insert / update / delete）
--   · 不改任何 table 結構（沒有 create table / alter table add column）
--   · 不動 event_registrations 的付款防護（那是 migration-security-fix-p0.sql 的範圍，
--     重跑 schema.sql 不會影響它）
--   · 不動 points 相關的 RPC（migration-points-r1-*.sql 的範圍）
--
-- 【什麼時候該跑】
--   · 任何人「忍不住」跑了 schema.sql 之後
--   · 不確定線上安全性是否完整時（跑一次無害，可重複）
--   · 客戶要驗收安全性時
--
-- 【⚠️ 全新空環境不要跑這支】
--   請先跑 schema.sql → schema-r6.sql → 各 migration → 最後才是這支。
--   這支假設 profiles.status 等欄位已存在；缺欄位時會降級並印 notice，不會中斷，
--   但那就不是「完整正確狀態」了。
-- =============================================================


-- =============================================================
-- 1. profiles 敏感欄位護欄（6 欄）
--    正本：migration-points-r1-1-schema.sql:362-432
-- =============================================================
do $guard$
declare
  v_full boolean;
begin
  select (count(*) = 2) into v_full
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'profiles'
     and column_name in ('status', 'status_updated_at');

  if v_full then
    execute $fn$
create or replace function public.guard_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_points_rpc boolean := coalesce(current_setting('app.points_rpc', true), 'off') = 'on';
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  new.role              := old.role;
  new.total_km          := old.total_km;
  new.created_at        := old.created_at;
  new.status            := old.status;
  new.status_updated_at := old.status_updated_at;

  if not v_points_rpc then
    new.points := old.points;
  end if;

  return new;
end;
$body$;
$fn$;
    raise notice '1 OK — guard_profile_sensitive_fields 已還原為 6 欄版';
  else
    raise notice '1 SKIP — profiles.status / status_updated_at 不存在（請先跑 migration-admin-members-v2.sql）';
  end if;
end
$guard$;

drop trigger if exists profiles_guard_sensitive on public.profiles;
create trigger profiles_guard_sensitive
  before update on public.profiles
  for each row execute function public.guard_profile_sensitive_fields();


-- =============================================================
-- 2. profiles INSERT 護欄
--    正本：schema-r6.sql §5.4
-- =============================================================
create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    new.role     := 'member';
    new.points   := 0;
    new.total_km := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_insert();


-- =============================================================
-- 3. training_sessions 讀取政策：先拆掉舊的 permissive 政策，再建正確的
--    正本：migration-training-months.sql B-2
--
--    ⚠️ 順序很重要：一定要先 drop sessions_select_all。
--       permissive 政策之間是 OR 關係，只要它還在，
--       新的 sessions_select_visible 再嚴也沒用。
-- =============================================================
alter table public.training_sessions enable row level security;

drop policy if exists "sessions_select_all"     on public.training_sessions;
drop policy if exists "sessions_select_visible" on public.training_sessions;

do $sess$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'is_month_visible'
  ) then
    execute $p$
create policy "sessions_select_visible" on public.training_sessions
  for select to anon, authenticated
  using (
    public.is_admin()
    or public.is_month_visible(
         extract(year  from session_date)::int,
         extract(month from session_date)::int
       )
  )$p$;
    raise notice '3 OK — sessions_select_visible 已還原（含 is_month_visible 判斷）';
  else
    execute $p$
create policy "sessions_select_visible" on public.training_sessions
  for select to anon, authenticated
  using (public.is_admin())$p$;
    raise notice '3 WARN — is_month_visible() 不存在，班表暫設為僅管理員；請跑 migration-training-months.sql';
  end if;
end
$sess$;

drop policy if exists "sessions_admin_all" on public.training_sessions;
create policy "sessions_admin_all" on public.training_sessions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- =============================================================
-- 4. 排行榜兩張 view：無 id、無 user_id、只有 role='member'
--    正本：migration-leaderboard-no-id.sql
-- =============================================================
drop view if exists public.monthly_leaderboard;
drop view if exists public.public_leaderboard;

create view public.public_leaderboard
with (security_invoker = false) as
select
  substr(md5(id::text), 1, 8) as public_code,
  display_name,
  avatar_url,
  points,
  total_km
from public.profiles
where role = 'member';

grant select on public.public_leaderboard to anon, authenticated;

create view public.monthly_leaderboard
with (security_invoker = false) as
select
  substr(md5(s.user_id::text), 1, 8) as public_code,
  s.period_month,
  s.total_km,
  s.runs,
  p.display_name,
  p.avatar_url,
  p.points
from public.monthly_running_stats s
join public.profiles p on p.id = s.user_id
where p.role = 'member';

grant select on public.monthly_leaderboard to anon, authenticated;


-- =============================================================
-- 5. monthly_running_stats：收回匿名直讀
--    正本：schema-r6.sql §5.3
--    這張 view 以擁有者權限執行，繞過 run_submissions 的 RLS ——
--    匿名可讀出全體會員 user_id 與逐月里程。
--    收回後不影響排行榜：monthly_leaderboard 是 security_invoker=false，
--    仍以擁有者權限 join 這張 view。
-- =============================================================
revoke select on public.monthly_running_stats from anon;


-- =============================================================
-- 6. site_stats：members 只算 role='member'
--    線上實測 members=6、榜單 6 列、後台會員 6 人，三者一致。
-- =============================================================
create or replace view public.site_stats as
select
  (select count(*) from public.profiles where role = 'member')                        as members,
  (select coalesce(sum(km), 0) from public.run_submissions where status = 'approved') as total_km,
  (select count(*) from public.run_submissions where status = 'approved')             as total_runs,
  (select count(*) from public.training_sessions)                                     as total_sessions;


-- =============================================================
-- 7. training_months 政策（表存在時才處理）
--    正本：migration-training-months.sql A 段
-- =============================================================
do $months$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'training_months'
  ) then
    execute 'alter table public.training_months enable row level security';

    execute 'drop policy if exists "months_select_published" on public.training_months';
    execute $p$
create policy "months_select_published" on public.training_months
  for select to anon, authenticated
  using (status = 'published')$p$;

    execute 'drop policy if exists "months_admin_all" on public.training_months';
    execute $p$
create policy "months_admin_all" on public.training_months
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin())$p$;

    execute 'grant select on public.training_months to anon, authenticated';
    raise notice '7 OK — training_months 政策已還原';
  else
    raise notice '7 SKIP — training_months 不存在（請先跑 migration-training-months.sql）';
  end if;
end
$months$;


-- =============================================================
-- 8. 收尾：讓 PostgREST 重新載入 schema（view 欄位變了，不 reload 會回舊欄位）
-- =============================================================
notify pgrst, 'reload schema';

do $done$
begin
  raise notice '=== migration-schema-reconcile.sql 完成（7 項，可重複執行）===';
  raise notice '下一步：跑檔尾「執行後驗證」逐條確認。';
end
$done$;


-- =============================================================
-- 執行後驗證（貼進 SQL Editor 逐條跑）
-- =============================================================
-- -- 1) 排行榜欄位必須沒有 id / user_id
-- select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name in ('public_leaderboard', 'monthly_leaderboard')
--  group by table_name;
-- -- 預期 public_leaderboard：public_code, display_name, avatar_url, points, total_km
-- -- 預期 monthly_leaderboard：public_code, period_month, total_km, runs, display_name, avatar_url, points
--
-- -- 2) 榜單列數與會員數、統計數三者一致（線上應同為 6）
-- select (select count(*) from public.public_leaderboard) as leaderboard_rows,
--        (select members from public.site_stats)          as site_stats_members;
--
-- -- 3) 舊的 permissive 政策必須不存在
-- select policyname, cmd, qual
--   from pg_policies
--  where schemaname = 'public' and tablename = 'training_sessions'
--  order by policyname;
-- -- 預期只有 sessions_admin_all 與 sessions_select_visible；不應出現 sessions_select_all
--
-- -- 4) 護欄必須是 6 欄版（函式原始碼裡要能看到 status_updated_at）
-- select pg_get_functiondef('public.guard_profile_sensitive_fields()'::regprocedure);
--
-- -- 5) 匿名不可直讀 monthly_running_stats
-- select has_table_privilege('anon', 'public.monthly_running_stats', 'SELECT');
-- -- 預期 false
--
-- -- 6) 以匿名身分確認榜單仍讀得到、且看不到任何識別碼
-- begin;
--   set local role anon;
--   select count(*) from public.public_leaderboard;      -- 預期 6
--   select * from public.public_leaderboard limit 1;     -- 不應出現 UUID
-- rollback;
-- =============================================================
