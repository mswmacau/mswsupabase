-- =============================================================
-- 後台「會員管理」：列表 / 改角色 / 調整積分
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 性質：只新增 3 個函式，不改任何 TABLE 結構、不動資料、不加欄位
-- 可重複執行（create or replace + grant 皆為冪等）
-- =============================================================
--
-- 【為什麼需要這支 migration】
-- 1. public.profiles 的 RLS 只有 profiles_update_own（本人可更新），
--    管理員無法透過 RLS 更新「別人」的列，所以後台改角色／改積分
--    一定要走 security definer 函式，不能直接 update。
-- 2. 觸發器 profiles_guard_sensitive 會把非管理員對 role / points 的
--    修改還原；本檔的函式以呼叫者的 JWT 判斷 is_admin()，
--    管理員通過後觸發器才不會還原。
-- 3. 所有函式入口都再做一次 is_admin() 閘門：即使前端直接打 RPC，
--    非管理員也拿不到資料、改不動任何列（雙重防線）。
--
-- 【權限設計】
-- anon 完全沒有 execute；authenticated 有 execute，但函式內部
-- 會先檢查 is_admin()，非管理員一律 raise。
--
-- 【⚠️ 在 SQL Editor 直接呼叫會失敗（預期行為）】
-- SQL Editor 以 postgres 身分執行，沒有 JWT，auth.uid() 為 null，
-- 因此 is_admin() = false，三個函式都會 raise「只有管理員可以管理會員」。
-- 驗證請從網站的 /admin/members 操作，或帶管理員 JWT 呼叫 API。
-- =============================================================


-- ------------------------------------------------------------
-- 1. 會員列表（含電郵、最後登入、三種計數）
-- ------------------------------------------------------------
create or replace function public.admin_list_members(
  p_search text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  member_id       uuid,
  display_name    text,
  email           text,
  role            text,
  points          integer,
  total_km        numeric,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  run_count       bigint,
  checkin_count   bigint,
  coupon_count    bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_admin() then
    raise exception '只有管理員可以管理會員';
  end if;

  return query
  select
    p.id,
    p.display_name,
    u.email::text,
    p.role,
    p.points,
    p.total_km,
    p.created_at,
    u.last_sign_in_at,
    (select count(*) from public.run_submissions r where r.user_id = p.id),
    (select count(*) from public.training_checkins c where c.user_id = p.id),
    (select count(*) from public.coupons cp where cp.user_id = p.id)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where v_search is null
     or p.display_name ilike '%' || v_search || '%'
     or u.email ilike '%' || v_search || '%'
  order by p.role asc, p.points desc, p.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.admin_list_members(text, integer, integer) is
  '後台會員列表（管理員限定）：profiles + auth.users(email/last_sign_in_at) + 提交/簽到/券計數；支援名稱或電郵模糊搜尋。';


-- ------------------------------------------------------------
-- 2. 調整會員角色（member / admin）
--    保護：不可把自己降級、不可移除最後一位管理員
-- ------------------------------------------------------------
create or replace function public.admin_set_member_role(
  p_user_id uuid,
  p_role    text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以管理會員';
  end if;

  if p_role is null or p_role not in ('member', 'admin') then
    raise exception '角色只能是 member 或 admin';
  end if;

  -- 防止管理員把自己鎖在門外
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception '不能移除自己的管理員權限';
  end if;

  -- 防止站上最後一位管理員被降級（之後沒人能進後台）
  if p_role = 'member' then
    if exists (
      select 1 from public.profiles
      where id = p_user_id and role = 'admin'
    ) and (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception '至少要保留一位管理員';
    end if;
  end if;

  update public.profiles p
     set role = p_role
   where p.id = p_user_id
  returning * into v_row;

  if v_row.id is null then
    raise exception '找不到該會員';
  end if;

  return v_row;
end;
$$;

comment on function public.admin_set_member_role(uuid, text) is
  '後台調整會員角色（管理員限定）：只接受 member/admin，禁止自我降級與移除最後一位管理員；回傳更新後的 profiles 列。';


-- ------------------------------------------------------------
-- 3. 調整會員積分（寫 point_transactions + 同步 profiles.points）
--    直接沿用既有 public.add_points()，不重複實作邏輯
-- ------------------------------------------------------------
create or replace function public.admin_adjust_points(
  p_user_id uuid,
  p_delta   integer,
  p_reason  text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_points integer;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以管理會員';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception '積分調整值不可為 0';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception '找不到該會員';
  end if;

  -- add_points 內部已有 is_admin() 閘門，且會用 greatest(points + delta, 0)
  -- 夾住下限；它對 authenticated 的 execute 已被撤銷，但以 security definer
  -- 擁有者身分在函式內部呼叫不受影響。
  perform public.add_points(
    p_user_id,
    p_delta,
    coalesce(v_reason, '管理員手動調整'),
    'manual',
    null
  );

  select p.points into v_points
  from public.profiles p
  where p.id = p_user_id;

  return v_points;
end;
$$;

comment on function public.admin_adjust_points(uuid, integer, text) is
  '後台調整會員積分（管理員限定）：delta 不可為 0，寫入 point_transactions 並同步 profiles.points，回傳新點數。';


-- ------------------------------------------------------------
-- 4. 權限：anon 一律不可執行；authenticated 可執行，
--    但函式內部的 is_admin() 才是真正的閘門
-- ------------------------------------------------------------
revoke all on function public.admin_list_members(text, integer, integer) from public;
revoke all on function public.admin_list_members(text, integer, integer) from anon;
grant execute on function public.admin_list_members(text, integer, integer) to authenticated;

revoke all on function public.admin_set_member_role(uuid, text) from public;
revoke all on function public.admin_set_member_role(uuid, text) from anon;
grant execute on function public.admin_set_member_role(uuid, text) to authenticated;

revoke all on function public.admin_adjust_points(uuid, integer, text) from public;
revoke all on function public.admin_adjust_points(uuid, integer, text) from anon;
grant execute on function public.admin_adjust_points(uuid, integer, text) to authenticated;


-- =============================================================
-- 執行後請驗證（在 SQL Editor 分別執行）
-- =============================================================
-- ① 三個函式都存在，且 security definer 已生效
-- select proname, prosecdef, pg_get_function_identity_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in ('admin_list_members', 'admin_set_member_role', 'admin_adjust_points');
--   → prosecdef 應全為 true
--
-- ② 權限正確：anon 不應有 EXECUTE
-- select has_function_privilege('anon',
--   'public.admin_list_members(text, integer, integer)', 'execute') as anon_can_list,
--   has_function_privilege('authenticated',
--   'public.admin_list_members(text, integer, integer)', 'execute') as auth_can_list;
--   → anon_can_list = false，auth_can_list = true
--
-- ③ 管理員名單（確認至少有一位 admin）
-- select id, display_name, role from public.profiles where role = 'admin';
--
-- ④ 直接呼叫會被閘門擋下（SQL Editor 沒有 JWT，這是預期結果）
-- select * from public.admin_list_members(null, 5, 0);
--   → ERROR: 只有管理員可以管理會員
--   （要測正常路徑，請從網站 /admin/members 操作，或帶管理員 JWT 打 API）
--
-- ⑤ 積分明細可追溯（調整後）
-- select user_id, delta, reason, ref_type, created_at
-- from public.point_transactions
-- order by created_at desc limit 10;
--   → 應看到 ref_type = 'manual'、reason = 你輸入的原因或「管理員手動調整」
-- =============================================================
