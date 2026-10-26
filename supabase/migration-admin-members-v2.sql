-- =============================================================
-- 後台「會員管理」v2：帳號狀態 + 完整 CRUD RPC
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 性質：只新增 3 個欄位 / 1 個索引 / 4 支函式，不改既有資料
-- 可重複執行（alter ... if not exists / create or replace / drop if exists）
-- =============================================================
--
-- 【為什麼需要這支 migration】
-- 1. v1 只有「列表 + 改角色 + 調積分」，沒有停權 / 停用 / 刪除，
--    也沒有 email 以外的會員詳情。v2 補上 status 三態與完整 CRUD。
-- 2. public.profiles 的 RLS 只有 profiles_update_own（本人可更新），
--    管理員改「別人」的列一律走 security definer 函式，不能直接 update。
-- 3. 觸發器 profiles_guard_sensitive 會把非管理員對 role / points / total_km
--    的修改還原；本檔函式在入口先驗 is_admin()，管理員通過後才不會被還原。
-- 4. auth.users 的刪除需要 service_role（API 端處理），本檔完全不碰 auth schema，
--    admin_delete_member 只刪 public.profiles，子表靠 on delete cascade 清掉。
--
-- 【權限設計】
-- anon 一律沒有 execute；authenticated 有 execute，但函式內部再驗 is_admin()。
--
-- 【⚠️ 在 SQL Editor 直接呼叫會失敗（預期行為）】
-- SQL Editor 以 postgres 身分執行，沒有 JWT，auth.uid() 為 null，
-- is_admin() = false，所有函式都會 raise「只有管理員可以管理會員」。
-- 驗證請從網站 /admin/members 操作，或帶管理員 JWT 呼叫 API。
-- =============================================================


-- ------------------------------------------------------------
-- 1. profiles 新增帳號狀態欄位
-- ------------------------------------------------------------
alter table public.profiles add column if not exists status text not null default 'active'
  check (status in ('active', 'suspended', 'disabled'));

alter table public.profiles add column if not exists status_reason text;

alter table public.profiles add column if not exists status_updated_at timestamptz;

-- 若 status 欄位是「先前手動加過、但沒有 check」的情況，補上具名約束
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_status_check
      check (status in ('active', 'suspended', 'disabled'));
  end if;
end;
$$;

create index if not exists profiles_status_idx on public.profiles (status);


-- ------------------------------------------------------------
-- 2. 舊版 3 參數列表函式必須先移除
--    create or replace 不能改簽名；不移除會留下一個沒人用的多載，
--    且新舊版本對 same name 的 grant 會混淆。
-- ------------------------------------------------------------
drop function if exists public.admin_list_members(text, integer, integer);


-- ------------------------------------------------------------
-- 3. admin_list_members — 會員列表（搜尋 / 篩選 / 分頁）
-- ------------------------------------------------------------
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
  '後台會員列表（管理員限定）：profiles + auth.users(email/last_sign_in_at) + 提交/簽到/券計數；支援名稱或電郵模糊搜尋、角色與狀態篩選、分頁（total_count 為分頁總數）。';


-- ------------------------------------------------------------
-- 4. admin_get_member — 單一會員詳情
-- ------------------------------------------------------------
create or replace function public.admin_get_member(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member jsonb;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以管理會員';
  end if;

  select jsonb_build_object(
    'id',                p.id,
    'display_name',      p.display_name,
    'email',             u.email::text,
    'phone',             p.phone,
    'avatar_url',        p.avatar_url,
    'role',              p.role,
    'status',            p.status,
    'status_reason',     p.status_reason,
    'status_updated_at', p.status_updated_at,
    'points',            p.points,
    'total_km',          p.total_km,
    'created_at',        p.created_at,
    'last_sign_in_at',   u.last_sign_in_at,
    'counts', jsonb_build_object(
      'run_count',        (select count(*) from public.run_submissions r where r.user_id = p.id),
      'run_approved',     (select count(*) from public.run_submissions r where r.user_id = p.id and r.status = 'approved'),
      'checkin_count',    (select count(*) from public.training_checkins c where c.user_id = p.id),
      'checkin_approved', (select count(*) from public.training_checkins c where c.user_id = p.id and c.status = 'approved'),
      'coupon_count',     (select count(*) from public.coupons cp where cp.user_id = p.id),
      'coupon_active',    (select count(*) from public.coupons cp where cp.user_id = p.id and cp.status = 'active')
    ),
    'recent_runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from (
        select r2.id, r2.km, r2.period_month, r2.status, r2.created_at
        from public.run_submissions r2
        where r2.user_id = p.id
        order by r2.created_at desc
        limit 10
      ) r
    ), '[]'::jsonb),
    'recent_checkins', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from (
        select c2.id, c2.session_id, c2.status, c2.created_at
        from public.training_checkins c2
        where c2.user_id = p.id
        order by c2.created_at desc
        limit 10
      ) c
    ), '[]'::jsonb)
  )
  into v_member
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_id;

  if v_member is null then
    raise exception '找不到這位會員';
  end if;

  return v_member;
end;
$$;

comment on function public.admin_get_member(uuid) is
  '後台會員詳情（管理員限定）：基本資料 + email/last_sign_in_at + 提交/簽到/券計數（含 approved）+ 最近 10 筆提交與簽到；查無資料 raise。';


-- ------------------------------------------------------------
-- 5. admin_update_member — 更新會員資料 / 角色 / 狀態
--    參數為 null 表示「不改這一欄」
-- ------------------------------------------------------------
create or replace function public.admin_update_member(
  p_id            uuid,
  p_display_name  text,
  p_phone         text,
  p_role          text,
  p_status        text,
  p_status_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text := lower(nullif(btrim(coalesce(p_role, '')), ''));
  v_status      text := lower(nullif(btrim(coalesce(p_status, '')), ''));
  v_row         public.profiles;
  v_admin_count integer;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以管理會員';
  end if;

  if v_role is not null and v_role not in ('member', 'admin') then
    raise exception '角色只能是 member 或 admin';
  end if;

  if v_status is not null and v_status not in ('active', 'suspended', 'disabled') then
    raise exception '狀態只能是 active、suspended 或 disabled';
  end if;

  select * into v_row from public.profiles p where p.id = p_id for update;
  if v_row.id is null then
    raise exception '找不到這位會員';
  end if;

  -- 保護：不可把自己降級 / 停權 / 停用（避免管理員把自己鎖在門外）
  if p_id = auth.uid() then
    if v_role = 'member' then
      raise exception '不可移除自己的管理員權限';
    end if;
    if v_status in ('suspended', 'disabled') then
      raise exception '不可停權或停用自己的帳號';
    end if;
  end if;

  -- 保護：目標是目前唯一的管理員時，不可降級或改成非 active
  if v_row.role = 'admin'
     and (v_role = 'member' or (v_status is not null and v_status <> 'active')) then
    select count(*) into v_admin_count
    from public.profiles p
    where p.role = 'admin';

    if v_admin_count <= 1 then
      raise exception '至少要保留一位管理員';
    end if;
  end if;

  update public.profiles p
     set display_name = case
                          when p_display_name is null then p.display_name
                          else nullif(btrim(p_display_name), '')
                        end,
         phone = case
                   when p_phone is null then p.phone
                   else nullif(btrim(p_phone), '')
                 end,
         role = coalesce(v_role, p.role),
         status = coalesce(v_status, p.status),
         status_updated_at = case
                               when v_status is null then p.status_updated_at
                               else now()
                             end,
         status_reason = case
                           when v_status is null then p.status_reason
                           when v_status = 'active' then null
                           else nullif(btrim(coalesce(p_status_reason, '')), '')
                         end
   where p.id = p_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

comment on function public.admin_update_member(uuid, text, text, text, text, text) is
  '後台更新會員（管理員限定）：null 參數代表不改該欄；role 只收 member/admin、status 只收 active/suspended/disabled；禁止自我降級與自我停權，禁止移除最後一位管理員；改 status 時同步 status_updated_at/status_reason；回傳更新後的 profiles 列（jsonb）。';


-- ------------------------------------------------------------
-- 6. admin_delete_member — 刪除會員 profile
--    只刪 public.profiles；auth.users 由 API 以 service_role 刪除
--    （profiles.id references auth.users on delete cascade，
--      反向刪 profile 不會動到 auth.users）
-- ------------------------------------------------------------
create or replace function public.admin_delete_member(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text;
  v_admin_count integer;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以管理會員';
  end if;

  if p_id = auth.uid() then
    raise exception '不可刪除自己的帳號';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_id;
  if v_role is null then
    raise exception '找不到這位會員';
  end if;

  if v_role = 'admin' then
    select count(*) into v_admin_count
    from public.profiles p
    where p.role = 'admin';

    if v_admin_count <= 1 then
      raise exception '至少要保留一位管理員';
    end if;
  end if;

  delete from public.profiles p where p.id = p_id;
end;
$$;

comment on function public.admin_delete_member(uuid) is
  '後台刪除會員（管理員限定）：禁止刪自己與最後一位管理員；只刪 public.profiles（子表 on delete cascade），不動 auth.users。';


-- ------------------------------------------------------------
-- 7. 權限：anon 一律不可執行；authenticated 可執行，
--    但函式內部的 is_admin() 才是真正的閘門
-- ------------------------------------------------------------
revoke all on function public.admin_list_members(text, text, text, integer, integer) from public;
revoke all on function public.admin_list_members(text, text, text, integer, integer) from anon;
grant execute on function public.admin_list_members(text, text, text, integer, integer) to authenticated;

revoke all on function public.admin_get_member(uuid) from public;
revoke all on function public.admin_get_member(uuid) from anon;
grant execute on function public.admin_get_member(uuid) to authenticated;

revoke all on function public.admin_update_member(uuid, text, text, text, text, text) from public;
revoke all on function public.admin_update_member(uuid, text, text, text, text, text) from anon;
grant execute on function public.admin_update_member(uuid, text, text, text, text, text) to authenticated;

revoke all on function public.admin_delete_member(uuid) from public;
revoke all on function public.admin_delete_member(uuid) from anon;
grant execute on function public.admin_delete_member(uuid) to authenticated;


-- =============================================================
-- 8. 執行後驗證（在 SQL Editor 分別執行）
-- =============================================================
-- ① 三個欄位與索引都在
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'profiles'
--   and column_name in ('status', 'status_reason', 'status_updated_at');
--   → 應有三列；status 為 NO / 'active'::text
--
-- select indexname from pg_indexes
-- where schemaname = 'public' and tablename = 'profiles' and indexname = 'profiles_status_idx';
--   → 應有一列
--
-- ② 四支函式存在，且 SECURITY DEFINER 已生效（prosecdef 應全為 true）
-- select proname, prosecdef, pg_get_function_identity_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in ('admin_list_members', 'admin_get_member',
--                   'admin_update_member', 'admin_delete_member')
-- order by proname;
--
-- ③ 權限正確：anon 不應有 EXECUTE，authenticated 應有
-- select
--   has_function_privilege('anon',
--     'public.admin_list_members(text, text, text, integer, integer)', 'execute') as anon_list,
--   has_function_privilege('authenticated',
--     'public.admin_list_members(text, text, text, integer, integer)', 'execute') as auth_list,
--   has_function_privilege('anon',
--     'public.admin_get_member(uuid)', 'execute') as anon_get,
--   has_function_privilege('anon',
--     'public.admin_update_member(uuid, text, text, text, text, text)', 'execute') as anon_update,
--   has_function_privilege('anon',
--     'public.admin_delete_member(uuid)', 'execute') as anon_delete;
--   → anon_* 全為 false，auth_list 為 true
--
-- ④ 舊版 3 參數多載已移除（避免兩個同名函式混淆）
-- select count(*) from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname = 'admin_list_members'
--   and pg_get_function_identity_arguments(oid) = 'text, integer, integer';
--   → 應為 0
--
-- ⑤ 直接呼叫會被閘門擋下（SQL Editor 沒有 JWT，這是預期結果）
-- select * from public.admin_list_members(null, null, null, 5, 0);
--   → ERROR: 只有管理員可以管理會員
-- =============================================================
