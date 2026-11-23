-- =============================================================
-- 兩級管理員權限（資料層）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行（一次跑完）
-- 幂等：add column if not exists / create or replace / drop … if exists
--       本檔從頭到尾可重複執行，第二次跑不會報錯，結果相同
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【這一檔在建什麼】
--   §1  profiles.admin_level（1=最高級 / 2=第二級 / null=非管理員）
--   §2  把兩個指定帳號設為第一級；其餘 admin 一律第二級（不誤升）
--   §3  is_super_admin()              第一級判斷
--   §4  admin_module_access(module)   模組權限查詢：'full' | 'read' | 'none'
--   §5  admin_set_member_admin_level() 第一級調整別人的級別（只能設 0 或 2）
--   §6  profiles.admin_level 護欄觸發器（只有第一級改得動）
--   §7  讓 PostgREST 重載 schema
--   §8  執行後驗證
--   §9  回滾段（註解形式）
--
-- 【分級規則（站主原話的分級）】
--   第一級（admin_level=1）：全部模組可讀可寫，可調整別人的級別。
--                            **只能由 SQL 維護**（RPC 不准把任何人設為 1，
--                            避免第二級自我提權或互相提權）。
--   第二級（admin_level=2）：按模組授予，見 §4 對照表。
--   非管理員（role<>'admin' 或 admin_level is null）：一律 'none'。
--
-- 【⚠️ 未跑本檔時的行為（重要：不可以鎖死站主）】
--   API 層的 authorizeModule() 會先呼叫 admin_module_access；
--   若函式不存在（PGRST202 / 42883）→ **fallback 舊行為**：
--   只要是 admin 就全開。也就是說：程式碼先上線、SQL 未跑，
--   行為與現在完全相同，站主不會被鎖在門外。
--   跑完本檔後，分級才真正生效。
--
-- 【為什麼 admin_level 的護欄是獨立觸發器而不是改 guard_profile_sensitive_fields】
--   後者對「is_admin() 為 true」一律放行；第二級也是 admin，
--   若把 admin_level 加進那支守衛，第二級就能改自己的級別 → 提權漏洞。
--   因此獨立一支 guard_admin_level：只認 is_super_admin()。
-- =============================================================


-- ------------------------------------------------------------
-- §1  profiles.admin_level
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists admin_level smallint;

alter table public.profiles drop constraint if exists profiles_admin_level_chk;
alter table public.profiles add constraint profiles_admin_level_chk
  check (admin_level is null or admin_level in (1, 2));

comment on column public.profiles.admin_level is
  '管理員級別：1=最高級（全部模組 + 可調整別人級別，只能由 SQL 維護）；'
  '2=第二級（按模組授予，見 admin_module_access）；null=非管理員。';

-- 依 admin_level 篩選（後台會員列表／稽核用）
create index if not exists idx_profiles_admin_level
  on public.profiles (admin_level)
  where admin_level is not null;


-- ------------------------------------------------------------
-- §2  指定兩個帳號為第一級；其餘 admin 落第二級
--
--     用 email 對應 auth.users（profiles 沒有 email 欄）。
--     · mswmacau2026@gmail.com = 主管理員（現時已是 admin）
--     · nokiastephy@hotmail.com = 副管理員（現時是 member，這裡一併升 role）
--     其餘現有 admin（如果有的話）→ admin_level=2，**不會誤升到第一級**。
-- ------------------------------------------------------------
update public.profiles p
   set role        = 'admin',
       admin_level = 1
  from auth.users u
 where u.id = p.id
   and lower(u.email) in ('mswmacau2026@gmail.com', 'nokiastephy@hotmail.com');

-- 兜底：所有 admin 都必須有級別；沒被上面命中的一律第二級（可重複執行）
update public.profiles
   set admin_level = 2
 where role = 'admin'
   and admin_level is null;

-- 一致性：非管理員不該有級別
update public.profiles
   set admin_level = null
 where role <> 'admin'
   and admin_level is not null;


-- ------------------------------------------------------------
-- §3  is_super_admin() — 第一級判斷
-- ------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
       and p.admin_level = 1
  );
$$;

comment on function public.is_super_admin() is
  '是否為第一級管理員（role=admin 且 admin_level=1）。';

revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;


-- ------------------------------------------------------------
-- §4  admin_module_access(p_module) — 'full' | 'read' | 'none'
--
--     第二級對照（站主拍板）：
--       analytics = none    schedule = full   events  = full   members = read
--       review    = full    points   = full   rewards = read   commerce= full
--       content   = none    slides   = full   coaches = full   theme   = none
--       audit     = none    其他      = none
--
--     未知模組一律 'none'（fail closed）：寧可擋，不可因拼錯字而放行。
-- ------------------------------------------------------------
create or replace function public.admin_module_access(p_module text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_level  smallint;
  v_module text := lower(btrim(coalesce(p_module, '')));
begin
  select p.admin_level
    into v_level
    from public.profiles p
   where p.id = auth.uid()
     and p.role = 'admin';

  -- 非管理員，或管理員但沒有級別（fail closed）→ 全無權
  if v_level is null then
    return 'none';
  end if;

  -- 第一級：全部模組可讀可寫
  if v_level = 1 then
    return 'full';
  end if;

  -- 第二級：逐模組對照
  return case v_module
    when 'schedule' then 'full'
    when 'events'   then 'full'
    when 'review'   then 'full'
    when 'points'   then 'full'
    when 'commerce' then 'full'
    when 'slides'   then 'full'
    when 'coaches'  then 'full'
    when 'members'  then 'read'
    when 'rewards'  then 'read'
    else 'none'   -- analytics / content / theme / audit / 其他（含未知）
  end;
end $$;

comment on function public.admin_module_access(text) is
  '模組權限查詢：非管理員或無級別 → none；第一級 → full；'
  '第二級按對照表（analytics/content/theme/audit → none；members/rewards → read；其餘白名單 → full）；'
  '未知模組一律 none（fail closed）。未建此函式時 API 端 fallback 舊行為（admin 全開）。';

revoke all on function public.admin_module_access(text) from public, anon;
grant execute on function public.admin_module_access(text) to authenticated;


-- ------------------------------------------------------------
-- §5  admin_set_member_admin_level(p_id, p_level)
--
--     只准第一級呼叫。p_level 只接受：
--       0 → 取消管理員（role='member', admin_level=null）
--       2 → 設為第二級（role='admin', admin_level=2）
--     刻意不允許 1：第一級只能由 SQL 維護，防止提權鏈。
--     寫入 admin_audit_log，摘要含**會員名稱**（不是 UUID）。
-- ------------------------------------------------------------
create or replace function public.admin_set_member_admin_level(
  p_id    uuid,
  p_level integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_before smallint;
begin
  if not public.is_super_admin() then
    raise exception '只有最高級管理員可以調整管理員級別';
  end if;

  if p_level is null or p_level not in (0, 2) then
    raise exception '級別只接受 0（取消管理員）或 2（設為第二級）';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), '未命名會員'), p.admin_level
    into v_name, v_before
    from public.profiles p
   where p.id = p_id
     for update;

  if not found then
    raise exception '找不到這位會員';
  end if;

  if p_level = 0 then
    update public.profiles
       set role = 'member', admin_level = null
     where id = p_id;
  else
    update public.profiles
       set role = 'admin', admin_level = 2
     where id = p_id;
  end if;

  insert into public.admin_audit_log (actor_id, module, action, summary)
  values (
    auth.uid(),
    'members',
    'set-admin-level',
    format(
      '調整管理員級別：%s（%s → %s）',
      v_name,
      coalesce((v_before)::text, '非管理員'),
      case when p_level = 0 then '非管理員' else '第二級' end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'level', case when p_level = 0 then null else 2 end,
    'display_name', v_name
  );
end $$;

comment on function public.admin_set_member_admin_level(uuid, integer) is
  '第一級調整別人的管理員級別：0=取消管理員、2=第二級（不允許設 1）；'
  '寫 admin_audit_log（含會員名稱）；回 {ok, level, display_name}。';

revoke all on function public.admin_set_member_admin_level(uuid, integer) from public, anon;
grant execute on function public.admin_set_member_admin_level(uuid, integer) to authenticated;


-- ------------------------------------------------------------
-- §5.5  admin_my_access() — 一次回 13 個模組的權限（側欄用）
--
--       為什麼要這支：側欄要一次知道「我能看哪幾項」。若前端逐個模組
--       呼叫 admin_module_access 就要 13 次往返（手機上尤其慢）。
--       這裡用 jsonb_object_agg 逐模組呼叫同一支函式，
--       好處是**口徑與 admin_module_access 完全一致**（不可能兩邊不同步）。
--
--       非管理員呼叫時不 raise，直接回全部 'none'（側欄照常渲染、只是全隱藏），
--       這樣未登入／非管理員的情境不需要多一層錯誤處理。
-- ------------------------------------------------------------
create or replace function public.admin_my_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_object_agg(m, public.admin_module_access(m))
    from unnest(
      array[
        'analytics', 'schedule', 'events', 'members', 'review', 'points',
        'rewards', 'commerce', 'content', 'slides', 'coaches', 'theme', 'audit'
      ]
    ) as m;
$$;

comment on function public.admin_my_access() is
  '一次回 13 個模組的權限 jsonb（側欄用）：逐模組轉呼叫 admin_module_access，'
  '口徑必然一致；非管理員／無級別回全部 none（不 raise）。';

revoke all on function public.admin_my_access() from public, anon;
grant execute on function public.admin_my_access() to authenticated;


-- ------------------------------------------------------------
-- §6  profiles.admin_level 護欄（只有第一級改得動）
--
--     為什麼獨立一支：guard_profile_sensitive_fields 對 is_admin() 一律放行，
--     而第二級也是 admin → 加進那支會讓第二級改自己的級別（提權）。
--     這裡只認 is_super_admin()；auth.uid() is null（SQL Editor／service_role）
--     放行，讓站主仍可用 SQL 維護第一級。
-- ------------------------------------------------------------
create or replace function public.guard_admin_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;          -- SQL Editor / service_role / 系統
  end if;

  if public.is_super_admin() then
    return new;          -- 第一級可改
  end if;

  -- 其他人（含第二級、普通會員）→ 還原成原值，不 raise（避免鎖死整列更新）
  new.admin_level := old.admin_level;
  return new;
end $$;

comment on function public.guard_admin_level() is
  'profiles.admin_level 護欄：只有第一級或系統（auth.uid() is null）可修改，其餘一律還原。';

drop trigger if exists profiles_guard_admin_level on public.profiles;
create trigger profiles_guard_admin_level
  before update on public.profiles
  for each row execute function public.guard_admin_level();

revoke all on function public.guard_admin_level() from public, anon, authenticated;


-- ------------------------------------------------------------
-- §7  讓 PostgREST 立刻看到新欄位／新函式
-- ------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- §8  執行後驗證（在 SQL Editor 逐段跑）
-- =============================================================
--
-- 8.1 欄位與約束
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='profiles' and column_name='admin_level';
--   → 1 列（smallint, YES）
--
-- 8.2 兩個指定帳號都是第一級
--   select u.email, p.role, p.admin_level
--     from public.profiles p join auth.users u on u.id = p.id
--    where lower(u.email) in ('mswmacau2026@gmail.com','nokiastephy@hotmail.com');
--   → 2 列，role=admin、admin_level=1
--
-- 8.3 沒有其他第一級（不會誤升）
--   select count(*) from public.profiles where admin_level = 1;
--   → 2
--
-- 8.4 所有 admin 都有級別
--   select count(*) from public.profiles where role='admin' and admin_level is null;
--   → 0
--
-- 8.5 四個函式都在
--   select proname from pg_proc
--    where pronamespace='public'::regnamespace
--      and proname in ('is_super_admin','admin_module_access',
--                      'admin_set_member_admin_level','admin_my_access')
--    order by 1;
--   → 4 列
--
-- 8.5b admin_my_access 的形狀（SQL Editor 無 JWT → 應全 none）
--   select public.admin_my_access();
--   → 13 個鍵全部 "none"：{"analytics":"none","schedule":"none",...,"audit":"none"}
--   （真實 JWT 下第一級應全 "full"、第二級應按對照表）
--
-- 8.6 SQL Editor 沒有 JWT → 應 fail closed
--   select public.is_super_admin();          → false
--   select public.admin_module_access('events');  → none
--   （真實 JWT 下的分級請在網站上以兩個管理員帳號驗）
--
-- 8.7 護欄觸發器在
--   select tgname from pg_trigger
--    where tgrelid='public.profiles'::regclass and not tgisinternal;
--   → 應包含 profiles_guard_admin_level
--
-- 8.8 RPC 參數邊界（用第一級 JWT 在網站上驗；SQL Editor 會 raise「只有最高級…」）
--   select public.admin_set_member_admin_level('<uuid>', 1);   → ERROR 級別只接受 0 或 2
-- =============================================================


-- =============================================================
-- §9  回滾段（本檔不執行；要回滾時把下面的註解解開、逐段跑）
--
--     ⚠️ 回滾會丟掉所有分級資訊（admin_level 全部變 null）。
--        回滾後 API 的 authorizeModule 會因函式不存在而 fallback 舊行為
--        （admin 全開），所以功能上不會鎖死，但分級失效。
--
-- -- 9.1 觸發器與函式
-- drop trigger if exists profiles_guard_admin_level on public.profiles;
-- drop function if exists public.guard_admin_level();
-- drop function if exists public.admin_set_member_admin_level(uuid, integer);
-- drop function if exists public.admin_my_access();
-- drop function if exists public.admin_module_access(text);
-- drop function if exists public.is_super_admin();
--
-- -- 9.2 欄位與索引
-- drop index if exists public.idx_profiles_admin_level;
-- alter table public.profiles
--   drop constraint if exists profiles_admin_level_chk,
--   drop column if exists admin_level;
--
-- -- 9.3 讓 PostgREST 重載
-- notify pgrst, 'reload schema';
-- =============================================================
