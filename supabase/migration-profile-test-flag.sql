-- =============================================================
-- 測試帳號旗標：把測試帳號從公開排行榜與站統計排除
-- 檔名：migration-profile-test-flag.sql
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- Owner：白客（backend-engineer）
--
-- 【站主需求（原文）】
--   「排行榜不需要測試帳號，只需保留真實帳號的紀錄。」
--
-- 【現況（2026-11-14 實測）】
--   profiles 共 8 筆：6 位 role='member'（榜上 6 人）＋ 2 位 admin（本來就不上榜）。
--   其中 3 位是測試帳號：nokia / test / nokiababy。
--   另有 1 位「街健新手」真偽待站主確認 → 本檔刻意不動它。
--
-- 【為什麼用獨立布林旗標，而不是改 role】
--   profiles.role 有 check (role in ('member','admin'))（schema.sql:46），
--   且 admin_* RPC 只接受這兩個值。把測試帳號改成第三種 role 會直接撞約束，
--   也會讓 admin 介面／權限判斷全部要改。用 is_test 是最小侵入面。
--
-- 【本檔做什麼（7 段，全部冪等）】
--   1. profiles 加 is_test boolean not null default false（＋索引）
--   2. 標記已知測試帳號（用 display_name 比對，不寫死 UUID）
--   3. guard_profile_sensitive_fields 加保護：會員 update 自己時 is_test 被還原
--   4. guard_profile_insert 加保護：非管理員 insert 一律 is_test = false
--   5. 重建兩張排行榜 view：加 is_test = false（沿用 migration-leaderboard-no-id.sql
--      的 public_code 版本，不退回含 id 的舊定義 —— 那個 UUID 外洩已經修過）
--   6. site_stats.members 排除測試帳號（首頁數字不該含測試）
--   7. 後台用的兩支函式：admin_list_members 多回一欄 is_test、
--      新增 admin_set_member_test（toggle 用，只有管理員能呼叫）
--
-- 【刻意不動的東西】
--   · 不刪除任何帳號、不改任何人的 points / total_km
--   · 不改 role 與 check 約束
--   · 不改排行榜的欄位（除過濾條件）與排序（排序在前端）
--   · 不動「街健新手」（950d6bf8）→ 待站主確認後由後台開關自行標記
-- =============================================================


-- ------------------------------------------------------------
-- 1. profiles.is_test
--    預設 false：既有 8 位會員跑完本段後全部是 false，
--    沒有被第 2 段標記到的帳號不會被誤排除。
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists is_test boolean not null default false;

comment on column public.profiles.is_test is
  '測試帳號旗標。true = 不計入公開排行榜（public_leaderboard / monthly_leaderboard）與 site_stats。'
  '只有管理員能改（guard_profile_sensitive_fields 會把會員自己的修改還原）。';

-- 排行榜與站統計都是「role='member' and is_test=false」，這條複合索引讓過濾不必全表掃。
create index if not exists idx_profiles_role_is_test
  on public.profiles (role, is_test);


-- ------------------------------------------------------------
-- 2. 標記已知測試帳號
--    用 display_name 比對而不是 UUID：UUID 每個環境都不同，
--    寫死 UUID 的 SQL 貼到別的環境會靜默標錯人（或標不到人）。
--    只在 role='member' 範圍內比對，避免誤傷同名管理員。
--    `and is_test = false` 讓本段可重複執行且不會把站主手動取消的帳號又標回去。
-- ------------------------------------------------------------
update public.profiles
   set is_test = true
 where role = 'member'
   and is_test = false
   and display_name in ('nokia', 'test', 'nokiababy');

do $mark$
declare
  v_test int;
begin
  select count(*) into v_test from public.profiles where is_test;
  raise notice '2 OK — 目前 is_test=true 的帳號數：%', v_test;
end
$mark$;


-- ------------------------------------------------------------
-- 3. profiles UPDATE 護欄：把 is_test 列為受保護欄位
--
--    會員的 update 只走 RLS 的 profiles_update_own（schema.sql:717），
--    若護欄不還原 is_test，任何會員都能自己把 is_test 設成 true
--    （＝把自己從榜單隱藏），或反過來把別人的…（不行，RLS 只允許改自己）。
--    總之 is_test 屬於「只有管理員能決定」的欄位，必須進護欄。
--
--    沿用 schema.sql / migration-schema-reconcile.sql 的寫法：
--    profiles.status 是否存在決定用 6 欄版或 bootstrap 3 欄版，
--    重跑不會把護欄降級。（is_test 在這一步一定已存在，兩版都包含它。）
-- ------------------------------------------------------------
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
  -- 沒有 JWT = 後端／service_role／trigger／SQL Editor，已繞過 RLS，放行
  if auth.uid() is null then
    return new;
  end if;

  -- 管理員可改任何欄位（後台 toggle is_test 走 admin_set_member_test，身分是管理員）
  if public.is_admin() then
    return new;
  end if;

  -- 非管理員：一律還原敏感欄位
  new.role              := old.role;
  new.total_km          := old.total_km;
  new.created_at        := old.created_at;
  new.status            := old.status;
  new.status_updated_at := old.status_updated_at;
  new.is_test           := old.is_test;

  -- points 只有 credit_points 在交易內開旗標時才放行
  if not v_points_rpc then
    new.points := old.points;
  end if;

  return new;
end;
$body$;
$fn$;
    raise notice '3 OK — guard_profile_sensitive_fields 已更新（7 欄，含 is_test）';
  else
    execute $fn$
create or replace function public.guard_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  new.role       := old.role;
  new.points     := old.points;
  new.total_km   := old.total_km;
  new.created_at := old.created_at;
  new.is_test    := old.is_test;

  return new;
end;
$body$;
$fn$;
    raise notice '3 OK — guard_profile_sensitive_fields 已更新（bootstrap 版＋is_test；profiles.status 不存在）';
  end if;
end
$guard$;

comment on function public.guard_profile_sensitive_fields() is
  'profiles 敏感欄位護欄：非管理員不可改 role/points/total_km/created_at/status/status_updated_at/is_test；'
  '交易內 app.points_rpc=on（僅 credit_points 設定）時放行 points；auth.uid() 為 null 時全放行。';

drop trigger if exists profiles_guard_sensitive on public.profiles;
create trigger profiles_guard_sensitive
  before update on public.profiles
  for each row execute function public.guard_profile_sensitive_fields();


-- ------------------------------------------------------------
-- 4. profiles INSERT 護欄：非管理員新建的 profile 一律不是測試帳號
--    （否則有人可以在 insert 時就帶 is_test = true 讓自己不出現在榜上）
-- ------------------------------------------------------------
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
    new.is_test  := false;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_insert();


-- ------------------------------------------------------------
-- 5. 排行榜兩張 view
--
--    ⚠️ 定義以 migration-leaderboard-no-id.sql 為基礎（HEAD 已包含），
--       只加 `and is_test = false`。
--       絕對不可退回含 id / user_id 的舊定義 —— 那會讓匿名訪客再次從
--       HTML 撈到會員的 auth UUID（P1-A 修過的問題，不可回歸）。
--
--    先 drop monthly_leaderboard：它的定義相依 public_leaderboard 的歷史版本，
--    且不用 cascade（cascade 會把沒預期到的相依物件一起砍掉）。
-- ------------------------------------------------------------
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
where role = 'member'
  and is_test = false;

comment on view public.public_leaderboard is
  '對外累積總榜：只含 role=member 且 is_test=false。public_code = substr(md5(profiles.id::text),1,8)，'
  '不可逆推 auth UUID；本 view 刻意不暴露 id。';

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
where p.role = 'member'
  and p.is_test = false;

comment on view public.monthly_leaderboard is
  '對外月度里程榜：只含 role=member 且 is_test=false。public_code 與 public_leaderboard 同一個算法，'
  '所以同一會員在兩張榜上的代號一致。刻意不暴露 user_id。';

grant select on public.monthly_leaderboard to anon, authenticated;


-- ------------------------------------------------------------
-- 6. site_stats：members 不含測試帳號
--    否則首頁「MSW 會員」數字會大於排行榜人數（榜 3 人、統計卻寫 6 人）。
-- ------------------------------------------------------------
create or replace view public.site_stats as
select
  (select count(*) from public.profiles where role = 'member' and is_test = false)     as members,
  (select coalesce(sum(km), 0) from public.run_submissions where status = 'approved') as total_km,
  (select count(*) from public.run_submissions where status = 'approved')             as total_runs,
  (select count(*) from public.training_sessions)                                     as total_sessions;


-- ------------------------------------------------------------
-- 7-A. admin_list_members：多回一欄 is_test（後台要知道開關現在是開還是關）
--
--      改 return table 的欄位必須先 drop（create or replace 不能改回傳型別）；
--      drop 之後 grant 要重做，否則後台會拿到 42501 權限不足。
-- ------------------------------------------------------------
drop function if exists public.admin_list_members(text, text, text, integer, integer);
-- 更舊的 3 參數版本（若存在）一併清掉，避免多載讓 PostgREST 選錯
drop function if exists public.admin_list_members(text, integer, integer);

create or replace function public.admin_list_members(
  p_search text default null,
  p_role   text default null,
  p_status text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  member_id       uuid,
  display_name    text,
  email           text,
  role            text,
  status          text,
  status_reason   text,
  is_test         boolean,
  points          integer,
  total_km        numeric,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  run_count       bigint,
  checkin_count   bigint,
  coupon_count    bigint,
  total_count     bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_role   text := lower(nullif(btrim(coalesce(p_role, '')), ''));
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
begin
  if not public.is_admin() then
    raise exception '只有管理員可以管理會員';
  end if;

  -- 篩選值非法時不擋請求，視同「不篩選」，避免前端舊快取打爆整頁
  if v_role is not null and v_role not in ('member', 'admin') then
    v_role := null;
  end if;
  if v_status is not null and v_status not in ('active', 'suspended', 'disabled') then
    v_status := null;
  end if;

  return query
  select
    p.id,
    p.display_name,
    u.email::text,
    p.role,
    p.status,
    p.status_reason,
    p.is_test,
    p.points,
    p.total_km,
    p.created_at,
    u.last_sign_in_at,
    (select count(*) from public.run_submissions r where r.user_id = p.id)::bigint,
    (select count(*) from public.training_checkins c where c.user_id = p.id)::bigint,
    (select count(*) from public.coupons cp where cp.user_id = p.id)::bigint,
    count(*) over ()
  from public.profiles p
  left join auth.users u on u.id = p.id
  where (
      v_search is null
      or p.display_name ilike '%' || v_search || '%'
      or u.email ilike '%' || v_search || '%'
    )
    and (v_role is null or p.role = v_role)
    and (v_status is null or p.status = v_status)
  order by case when p.role = 'admin' then 0 else 1 end, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.admin_list_members(text, text, text, integer, integer) is
  '後台會員列表（管理員限定）：profiles + auth.users(email/last_sign_in_at) + 提交/簽到/券計數；'
  '支援名稱或電郵模糊搜尋、角色與狀態篩選、分頁（total_count 為分頁總數）；含 is_test（測試帳號旗標）。';

revoke all on function public.admin_list_members(text, text, text, integer, integer) from public;
revoke all on function public.admin_list_members(text, text, text, integer, integer) from anon;
grant execute on function public.admin_list_members(text, text, text, integer, integer) to authenticated;


-- ------------------------------------------------------------
-- 7-B. admin_set_member_test — 後台「測試帳號」開關
--
--      為什麼要獨立一支 RPC：
--        profiles 的 RLS 只有 profiles_update_own（改自己），管理員改他人列
--        一律走 security definer 函式（與 admin_update_member 同一套路）。
--        這樣 is_test 只能由「已驗證的管理員」變更，會員端完全碰不到
--        （就算直接打 PostgREST，還有第 3 段的護欄把它還原）。
--
--      錯誤碼策略（沿用 admin_* 家族的契約）：
--        · 非管理員 → P0001（API 端不該走到這裡，authorizeAdmin 已先擋 403；
--          這裡是第二道門，防的是「繞過我們的 API 直接打 PostgREST」）
--        · 找不到會員 → P0001「找不到這位會員」→ API 映射 404
-- ------------------------------------------------------------
create or replace function public.admin_set_member_test(p_id uuid, p_is_test boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以標記測試帳號' using errcode = 'P0001';
  end if;

  if p_id is null then
    raise exception '找不到這位會員' using errcode = 'P0001';
  end if;

  update public.profiles
     set is_test = coalesce(p_is_test, false)
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception '找不到這位會員' using errcode = 'P0001';
  end if;

  -- 只回必要欄位，不回 email / phone（這支只給後台 toggle 用，越少帶越好）
  return jsonb_build_object(
    'id',           v_row.id,
    'display_name', v_row.display_name,
    'is_test',      v_row.is_test
  );
end;
$$;

comment on function public.admin_set_member_test(uuid, boolean) is
  '後台標記／取消測試帳號（管理員限定）。is_test=true 的會員不會出現在公開排行榜與 site_stats。';

revoke all on function public.admin_set_member_test(uuid, boolean) from public;
revoke all on function public.admin_set_member_test(uuid, boolean) from anon;
grant execute on function public.admin_set_member_test(uuid, boolean) to authenticated;


-- ------------------------------------------------------------
-- 8. 收尾：讓 PostgREST 立刻看到新的 view 欄位與新函式
--    （不 notify 的話，API 會有一小段時間還回舊欄位，前端會拿到 400）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

do $done$
begin
  raise notice '=== migration-profile-test-flag.sql 完成（8 段，可重複執行）===';
  raise notice '下一步：跑檔尾「執行後驗證」確認榜單只剩真實帳號。';
end
$done$;


-- =============================================================
-- 執行後驗證（貼進 SQL Editor 逐條跑）
-- =============================================================
-- -- 1) 欄位與旗標現況：預期 nokia / test / nokiababy 為 true，
-- --    街健新手 / fly chan / lou kei chan 為 false，兩位 admin 為 false
-- select left(id::text, 8) as id8, display_name, role, points, total_km, is_test
--   from public.profiles
--  order by role, created_at;
--
-- -- 2) 榜單只剩真實帳號（預期 3 人：fly chan / 街健新手 / lou kei chan）
-- select display_name, points, total_km from public.public_leaderboard order by points desc;
--
-- -- 3) 榜單與站統計人數一致
-- select (select count(*) from public.public_leaderboard) as leaderboard_rows,
--        (select members from public.site_stats)          as site_stats_members;
-- -- 預期：3 / 3（若站主確認街健新手也是測試帳號，標記後會變 2 / 2）
--
-- -- 4) view 仍不可外洩識別碼（欄位清單不應出現 id / user_id）
-- select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name in ('public_leaderboard', 'monthly_leaderboard')
--  group by table_name;
--
-- -- 5) 護欄必須含 is_test
-- select pg_get_functiondef('public.guard_profile_sensitive_fields()'::regprocedure);
-- -- 預期在函式原始碼中看到：new.is_test := old.is_test;
--
-- -- 6) 只有 authenticated 能執行 toggle RPC，anon 不行
-- select has_function_privilege('anon',          'public.admin_set_member_test(uuid, boolean)', 'execute') as anon_can,
--        has_function_privilege('authenticated', 'public.admin_set_member_test(uuid, boolean)', 'execute') as auth_can;
-- -- 預期：false / true
--
-- -- 7) 以匿名身分確認榜單讀得到、且看不到任何 UUID
-- begin;
--   set local role anon;
--   select * from public.public_leaderboard limit 5;
-- rollback;
-- =============================================================
