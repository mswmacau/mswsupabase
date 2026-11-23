-- =============================================================
-- 兩級管理員：RPC 守衛（堵住 SECURITY DEFINER 函式繞過模組權限）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【§0 為什麼 RLS 不夠 —— 實測到的 P0】
--   `migration-admin-levels-rls.sql` 收緊的是「表」的門（RLS）。
--   但 `SECURITY DEFINER` 函式是另一扇門：它們以 owner 權限執行，
--   只檢查 `is_admin()`，完全不看 `admin_module_access()`。
--   第二級開 devtools 直接打 PostgREST 就能繞過整個模組分級。
--
--   team-lead 用真實第二級 JWT 實測（members = read）：
--     POST /rest/v1/rpc/admin_purge_member {"p_id":"<某會員>"}
--     → {"ok":true,"deleted":true}  HTTP 200
--     → 該會員 profiles 立即消失（含 auth.users，不可逆）
--
--   這是「會員 可看不可編輯」在 RPC 層完全失效，而且是最嚴重的一種
--   （不可逆刪除）。本檔為 17 個只檢查 is_admin() 的函式補上模組守衛。
--
-- 【貼入前必看：本檔有 1 處會真正執行「刪除」】
--   位置在 §3.3b 的 do 區塊：只在「舊的 3 參數版會員列表函式」仍存在時才刪它。
--   為什麼要刪：它是一個沒有權限檢查的活入口（後台用的是 5 參數版，這支無人呼叫）。
--   貼之前請確認沒有任何外部腳本仍在呼叫 3 參數版；若不確定，先問工程師再貼。
--   檢查方法（含如何排除註解行）寫在檔尾的「回滾段」，貼完也會用 notice 告訴你實際做了什麼。
--
-- 【§1 對照表】
--
--   函式                             模組        L2 權限  守衛參數        預期（L2）
--   ─────────────────────────────────────────────────────────────────────
--   admin_purge_member               members     read    (members,true)  拒絕
--   admin_delete_member              members     read    (members,true)  拒絕
--   admin_update_member              members     read    (members,true)  拒絕
--   admin_set_member_role            members     read    (members,true)  拒絕
--   admin_correct_member_km          members     read    (members,true)  拒絕
--   admin_set_member_test            members     read    (members,true)  拒絕
--   admin_get_member                 members     read    (members,false) 放行（唯讀）
--   admin_list_members               members     read    (members,false) 放行（唯讀）
--   analytics_activity_overview      analytics   none    (analytics,false) 拒絕
--   analytics_behavior_segments      analytics   none    (analytics,false) 拒絕
--   analytics_coupon_summary         analytics   none    (analytics,false) 拒絕
--   analytics_event_registrations    analytics   none    (analytics,false) 拒絕
--   analytics_hyrox_monthly          analytics   none    (analytics,false) 拒絕
--   analytics_member_growth          analytics   none    (analytics,false) 拒絕
--   analytics_page_stats             analytics   none    (analytics,false) 拒絕
--   analytics_run_monthly            analytics   none    (analytics,false) 拒絕
--   analytics_session_attendance     analytics   none    (analytics,false) 拒絕
--
--   刻意不動的函式（L2 = full，本來就該有完整權限）：
--     admin_adjust_points / add_points / admin_fulfill_redemption /
--     admin_review_redemption / admin_run_monthly_settlement /
--     merchant PIN 系列 / monthly_qualified_list
--   以及所有 review 相關函式（review_run_submission 等）——
--   第二級的「審核跑步／簽到」必須照常運作。
--
-- 【§1.1 重要：本檔只「插入一行」，不重寫任何函式邏輯】
--   17 個函式本體逐字沿用原定義（來源檔見 §3 各段標題），
--   唯一差異是 begin 之後多一行 perform public.require_module(...)。
--   交付時已逐函式做 diff：每個都是「+1 行 / -0 行」。
--   簽名、參數名、language、security definer、set search_path 全部不變。
--
-- 【§1.2 為什麼守衛要用 raise 而不是 return jsonb ok:false】
--   既有函式多用 `return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN')`
--   軟失敗。但那是「業務失敗」，不是「權限失敗」。權限失敗應該是不可吞的
--   例外——否則上層可能把「無權限」當成「操作沒成功，重試」，或誤判成
--   業務錯誤。raise exception + errcode P0001，API 層的 rpcFailure 會統一
--   映射成 500 帶明確訊息，不會被靜默吞掉。
--
-- 【§1.3 create or replace 會保留既有 ACL 與 comment】
--   同名同參數的函式被替換時 OID 不變，所以原本的
--   revoke all / grant execute、comment on function 全部保留，
--   本檔不需要重貼那些（也不應該重貼，避免與現況不同步）。
-- =============================================================


-- ------------------------------------------------------------
-- §2  守衛函式
--
--     注意：第一級（is_super_admin）短路放行 —— 這是「不鎖死站主」的保證。
--     若日後 L1 也被擋，先查 is_super_admin() 本身，不要改這支。
-- ------------------------------------------------------------
create or replace function public.require_module(p_module text, p_write boolean default true)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  -- 第一級：全部模組全開（短路，不看模組）
  if public.is_super_admin() then
    return;
  end if;

  v := public.admin_module_access(p_module);

  if v = 'none' then
    raise exception '沒有 % 模組的權限', p_module using errcode = 'P0001';
  end if;

  if p_write and v <> 'full' then
    raise exception '只有檢視權限，不能修改 % 模組', p_module using errcode = 'P0001';
  end if;
end $$;

comment on function public.require_module(text, boolean) is
  'RPC 層模組守衛：第一級短路放行；none → raise（讀也不行）；'
  'p_write=true 且僅 read → raise；full 全通過。';

revoke all on function public.require_module(text, boolean) from public, anon;
grant execute on function public.require_module(text, boolean) to authenticated;


-- =============================================================
-- §3  17 個函式重貼（本體逐字沿用，只插一行守衛）
-- =============================================================

-- ------------------------------------------------------------
-- §3.1 members 寫入（L2 = read → 全部拒絕）
-- ------------------------------------------------------------

-- admin_purge_member（來源：migration-member-purge.sql，原 128 行，本檔僅新增 require_module 一行）
create or replace function public.admin_purge_member(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role        text;
  v_admin_count integer;
  v_exists      boolean;
  r             record;
begin
  perform public.require_module('members', true);
  -- -----------------------------------------------------------
  -- 1. 閘門：只有管理員可以永久刪除會員
  -- -----------------------------------------------------------
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  -- -----------------------------------------------------------
  -- 2. 不可刪除自己的帳號
  -- -----------------------------------------------------------
  if p_id = auth.uid() then
    return jsonb_build_object('ok', false, 'code', 'SELF');
  end if;

  -- -----------------------------------------------------------
  -- 3. 目標必須存在（以 auth.users 為準：允許清掉「profile 已無、
  --    auth 使用者還在」的孤兒帳號——那正是 service_role 缺失時
  --    API 註解（route.ts:637）提到的最難處理情境）
  -- -----------------------------------------------------------
  select exists (select 1 from auth.users u where u.id = p_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- -----------------------------------------------------------
  -- 4-a. 明確處理「no action」外鍵（見 §0 表格）
  --      兩欄都可為 null，所以 set null 而不是刪列——保留其他人
  --      的簽到／跑步紀錄，只是失去審核人資訊。
  -- -----------------------------------------------------------
  if to_regclass('public.training_checkins') is not null then
    update public.training_checkins
       set confirmed_by = null
     where confirmed_by = p_id;
  end if;

  if to_regclass('public.run_submissions') is not null then
    update public.run_submissions
       set reviewed_by = null
     where reviewed_by = p_id;
  end if;

  -- -----------------------------------------------------------
  -- 4-b. 動態兜底：掃 pg_constraint，把「本地 DDL 沒涵蓋」的
  --      no action / restrict 外鍵一併處理。
  --      可為 null 的欄位 → set null（保住別人的資料列）
  --      不可為 null 的欄位 → 刪除子列（別無選擇）
  --      cascade / set null / set default 的外鍵不在此迴圈內。
  --
  --      刻意排除 public.profiles 自己（c.conrelid <> profiles）：
  --      若 profiles 有指向自身的 no action 外鍵（例如 referred_by），
  --      動態刪除會把「其他會員」的列一起刪掉。寧可讓 delete 以
  --      23503 失敗、由人來處理，也不要靜默誤刪真實會員。
  --      （profiles → auth.users 是 cascade，本來就不會被這個迴圈選中。）
  -- -----------------------------------------------------------
  for r in
    select c.conrelid::regclass::text as child_table,
           a.attname                 as child_col,
           (not a.attnotnull)        as col_nullable
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum   = c.conkey[1]
     where c.contype = 'f'
       and cardinality(c.conkey) = 1
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       and c.conrelid <> 'public.profiles'::regclass  -- profiles 由 cascade 處理
       and c.confdeltype in ('a', 'r')                -- no action / restrict
  loop
    if r.col_nullable then
      execute format(
        'update %s set %I = null where %I = $1',
        r.child_table, r.child_col, r.child_col
      ) using p_id;
    else
      execute format(
        'delete from %s where %I = $1',
        r.child_table, r.child_col
      ) using p_id;
    end if;
  end loop;

  -- -----------------------------------------------------------
  -- 5. mp_orders：member_id 是 text，**沒有**外鍵，所以不會讓
  --    delete 失敗；但它是會員的交易紀錄，永久刪除時一併清掉，
  --    避免留下永遠對不到會員的孤兒訂單。
  --    （若貴司要保留交易紀錄作帳，把這 3 行刪掉即可。）
  -- -----------------------------------------------------------
  if to_regclass('public.mp_orders') is not null then
    execute 'delete from public.mp_orders where member_id::text = $1::text' using p_id;
  end if;

  -- -----------------------------------------------------------
  -- 6. 最後一位管理員保護（放在刪除前，避免把後台鎖死）
  -- -----------------------------------------------------------
  select p.role into v_role from public.profiles p where p.id = p_id;
  if v_role = 'admin' then
    select count(*) into v_admin_count
      from public.profiles p
     where p.role = 'admin';
    if v_admin_count <= 1 then
      return jsonb_build_object('ok', false, 'code', 'LAST_ADMIN');
    end if;
  end if;

  -- -----------------------------------------------------------
  -- 7. 主體：刪 auth 使用者。
  --    auth.users → profiles 是 on delete cascade，
  --    auth.identities / sessions / refresh_tokens 亦由 Supabase 自帶的
  --    cascade 外鍵處理；profiles 的子表再各自 cascade。
  --    整支函式在同一個隱式交易內，任何一步失敗全部回滾。
  -- -----------------------------------------------------------
  delete from auth.users u where u.id = p_id;

  return jsonb_build_object('ok', true, 'deleted', true);
end;
$$;

-- admin_delete_member（來源：migration-admin-members-v2.sql，原 36 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('members', true);
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

-- admin_update_member（來源：migration-admin-members-v2.sql，原 84 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('members', true);
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

-- admin_set_member_role（來源：migration-admin-members.sql，原 47 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('members', true);
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

-- admin_correct_member_km（來源：migration-member-km-correction.sql，原 50 行，本檔僅新增 require_module 一行）
create or replace function public.admin_correct_member_km(
  p_id uuid,
  p_km numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after  numeric;
begin
  perform public.require_module('members', true);
  if not public.is_admin() then
    raise exception '只有管理員可以更正總里程';
  end if;

  if p_id is null then
    raise exception '找不到這位會員';
  end if;

  -- 範圍與精度：0–10000 公里、容許一位小數
  if p_km is null or p_km < 0 or p_km > 10000 then
    raise exception '總里程必須介於 0 到 10000 公里之間';
  end if;

  v_after := round(p_km, 1);

  select p.total_km into v_before
  from public.profiles p
  where p.id = p_id
  for update;

  if not found then
    raise exception '找不到這位會員';
  end if;

  -- 只改 total_km。這一行是這支函式的全部權限邊界：
  -- 不可順便改 points / role / status / is_test / status_updated_at。
  update public.profiles p
     set total_km = v_after
   where p.id = p_id;

  return jsonb_build_object(
    'ok', true,
    'before_km', coalesce(v_before, 0),
    'after_km', v_after
  );
end;
$$;

-- admin_set_member_test（來源：migration-profile-test-flag.sql，原 34 行，本檔僅新增 require_module 一行）
create or replace function public.admin_set_member_test(p_id uuid, p_is_test boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  perform public.require_module('members', true);
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

-- ------------------------------------------------------------
-- §3.2 members 唯讀（L2 = read → 放行）
-- ------------------------------------------------------------

-- admin_get_member（來源：migration-admin-members-v2.sql，原 68 行，本檔僅新增 require_module 一行）
create or replace function public.admin_get_member(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member jsonb;
begin
  perform public.require_module('members', false);
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
    'admin_level',       p.admin_level,
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

-- admin_list_members（來源：migration-profile-test-flag.sql，原 76 行，本檔僅新增 require_module 一行）
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
  admin_level     smallint,
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
  perform public.require_module('members', false);
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
    p.admin_level,
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

-- ------------------------------------------------------------
-- §3.3 analytics 讀取（L2 = none → 全部拒絕）
-- ------------------------------------------------------------

-- analytics_activity_overview（來源：migration-analytics.sql，原 51 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('analytics', false);
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

-- analytics_behavior_segments（來源：migration-analytics.sql，原 93 行，本檔僅新增 require_module 一行）
create or replace function public.analytics_behavior_segments()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_module('analytics', false);
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

-- analytics_coupon_summary（來源：migration-analytics.sql，原 58 行，本檔僅新增 require_module 一行）
create or replace function public.analytics_coupon_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_module('analytics', false);
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

-- analytics_event_registrations（來源：migration-event-registrations.sql，原 49 行，本檔僅新增 require_module 一行）
create or replace function public.analytics_event_registrations(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
begin
  perform public.require_module('analytics', false);
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  v_limit := coalesce(p_limit, 20);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'p_limit 需為 1–100 的整數（收到 %）', p_limit;
  end if;

  -- 口徑：registered = status='registered' 的列數（會員取消 = DELETE 該列，
  -- 故即「目前報名人數」）。含 0 人報名的活動（left join），依人數降序。
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_id', t.event_id,
          'event_date', t.event_date,
          'title', t.title,
          'status', t.status,
          'registered', t.registered
        ) order by t.registered desc, t.event_date desc
      )
      from (
        select
          ev.id as event_id,
          ev.event_date,
          ev.title,
          ev.status,
          count(r.id) filter (where r.status = 'registered') as registered
        from public.events ev
        left join public.event_registrations r on r.event_id = ev.id
        group by ev.id
        order by registered desc, ev.event_date desc
        limit v_limit
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- analytics_hyrox_monthly（來源：migration-event-attendance.sql，原 102 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('analytics', false);
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  v_limit := coalesce(p_limit, 12);
  if v_limit < 1 or v_limit > 36 then
    raise exception 'p_limit 需為 1–36 的整數（收到 %）', p_limit;
  end if;

  return jsonb_build_object(
    'months', coalesce((
      -- 第 1 層：每月的報名／確認／出席／收入，與該月最早場次日（回頭窗口的錨點）
      with monthly as (
        select
          to_char(e.event_date, 'YYYY-MM')                              as month,
          min(e.event_date)                                             as month_first_day,
          count(*)::int                                                 as registrations,
          count(*) filter (where r.payment_status = 'confirmed')::int   as confirmed,
          count(*) filter (where r.attended_at is not null)::int        as attended,
          -- 已付款且出席：與 confirmed 同一集合，attendance_rate 的分子
          -- （2026-11-22 修正：原本用 attended 當分子，含未付款者，
          --   會算出 >100% 或「沒有人付款卻 100%」的荒謬值）
          count(*) filter (
            where r.payment_status = 'confirmed' and r.attended_at is not null
          )::int                                                        as attended_confirmed,
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
      -- 第 2 層：回頭會員數（returning_rate 也要用它，所以先算好）
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
          'returning_rate',    round(100.0 * wr.returning_members / greatest(wr.registrations, 1), 1),
          'attended',          wr.attended,
          -- 已付款且出席的人數（與 confirmed 同一集合）
          'attended_confirmed', wr.attended_confirmed,
          -- confirmed = 0 → 固定 0.0（沒有任何已付款的人，出席率無意義）；
          -- 否則分子分母同一集合，恆在 0–100（不會出現 >100%）
          'attendance_rate',   case
                                 when wr.confirmed = 0 then 0.0
                                 else round(100.0 * wr.attended_confirmed / wr.confirmed, 1)
                               end
        ) order by wr.month desc
      )
      from (
        select month, registrations, confirmed, attended, attended_confirmed,
               revenue_cents, returning_members
          from with_returning
         order by month desc
         limit v_limit
      ) wr
    ), '[]'::jsonb)
  );
end;
$$;

-- analytics_member_growth（來源：migration-analytics.sql，原 53 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('analytics', false);
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

-- analytics_page_stats（來源：migration-analytics.sql，原 54 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('analytics', false);
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

-- analytics_run_monthly（來源：migration-analytics.sql，原 73 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('analytics', false);
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

-- analytics_session_attendance（來源：migration-analytics.sql，原 69 行，本檔僅新增 require_module 一行）
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
  perform public.require_module('analytics', false);
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


-- ------------------------------------------------------------
-- §3.3b  清理廢棄多載：admin_list_members(text, integer, integer)
--
--   3 參數版是舊版（migration-admin-members.sql:32 的原始簽名），
--   API 只用 5 參數版（p_search/p_role/p_status/p_limit/p_offset）。
--   若線上仍殘留 3 參數版，它就是一條**沒有守衛的旁路**——任何
--   authenticated 都能直接呼叫。
--
--   ⚠️ 這裡刻意用「條件式 drop」而不是「create or replace 也給它加守衛」：
--      create or replace 在函式**不存在**時會**新建**一個，
--      等於我們親手造出一條多餘的入口（原本沒有、跑完反而有了）。
--      正確做法是：有就刪掉，沒有就什麼都不做。
--
--   ⚠️ 定位方式用 pronargs（參數個數）而不是字串比對：
--      · pg_get_function_identity_arguments() 只回**類型**（"text, integer, integer"），
--        不含參數名；若拿 "p_search text, ..."（那是 pg_get_function_arguments
--        的格式）去比對，永遠不中 → 靜默跳過 → 入口還在。
--      · pronargs 是穩定的事實（3 vs 5），不依賴任何文字格式。
--      · drop 時再用 identity_arguments 的**輸出原文**餵進 format，做到
--        「找到哪個就刪哪個」，不猜簽名。
-- ------------------------------------------------------------
do $$
declare
  v_oid oid;
begin
  select p.oid
    into v_oid
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'admin_list_members'
     and p.pronargs = 3;

  if v_oid is not null then
    execute format(
      'drop function public.admin_list_members(%s)',
      pg_get_function_identity_arguments(v_oid)
    );
    raise notice '已刪除廢棄多載 admin_list_members（3 參數版）';
  else
    raise notice '線上沒有 3 參數版，無需處理';
  end if;
end $$;


-- ------------------------------------------------------------
-- §3.4  讓 PostgREST 重載函式定義
-- ------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- §4 執行後驗證
-- =============================================================
--
-- 4.1 守衛函式在，簽名正確
--   select proname, pg_get_function_identity_arguments(oid) as args
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('require_module','admin_purge_member','admin_list_members',
--                      'admin_update_member','analytics_hyrox_monthly')
--    order by 1;
--   → require_module(text, boolean)；其餘簽名與執行前一致
--
-- 4.2 SQL Editor（無 JWT）呼叫守衛 → is_super_admin false、admin_module_access none
--   select public.require_module('members', true);
--   → ERROR P0001: 沒有 members 模組的權限
--   （這是預期的：SQL Editor 沒有 auth.uid()）
--
-- 4.3 ★驗收格 A：第一級改會員資料必須成功（走 is_super_admin 短路）
--   用 L1 的真實 JWT，經後台或 REST：
--     POST /rest/v1/rpc/admin_update_member {"p_id":"<會員>","p_display_name":"<同值>"}
--   → 必須成功（不是 P0001）
--   若這裡被擋 → 查 is_super_admin()，不要改 require_module
--
-- 4.4 ★驗收格 B：第二級 purge 必須被拒（本檔要修的就是這條）
--   用 L2 的真實 JWT：
--     POST /rest/v1/rpc/admin_purge_member {"p_id":"<L2 自己建的臨時帳號>"}
--   → 必須 ERROR P0001「沒有 members 模組的權限」
--   且該帳號必須仍然存在（不可逆操作，務必確認沒被刪）
--
-- 4.5 第二級唯讀仍可用
--     POST /rest/v1/rpc/admin_list_members {"p_search":null,"p_limit":5}
--   → 200，正常回列表（members=read → require_module('members', false) 放行）
--
-- 4.6 第二級 analytics 全部被拒
--     POST /rest/v1/rpc/analytics_hyrox_monthly {"p_limit":12}
--   → ERROR P0001「沒有 analytics 模組的權限」
--
-- 4.7 ★迴歸：review 相關函式不受影響（本檔完全沒碰）
--     第二級審核一筆跑步提交 → review_run_submission 應成功
--     （review=full；若這條壞了，說明本檔誤改了不該動的函式）
--
-- 4.8 ★迴歸：members 寫入的 API 路徑仍以 403 為第一道
--     第二級打 DELETE /api/admin/members?userId=... → 403（authorizeModule 先擋）
--     RPC 守衛是第二道；正常不該看到 P0001（那代表 API 層漏了）
-- =============================================================


-- =============================================================
-- §5 回滾段（本檔不執行；要回滾時把下面的註解解開、逐段跑）
--
--     ⚠️ 回滾 = 重跑各函式的原始定義（本檔只是 +1 行，沒有改邏輯，
--        所以「重跑原 migration」就能完全還原）。
--
-- -- 5.1 逐個重跑來源檔（順序不限）：
-- --   supabase/migration-member-purge.sql          （admin_purge_member）
-- --   supabase/migration-admin-members-v2.sql      （admin_delete_member / admin_update_member / admin_get_member）
-- --   supabase/migration-admin-members.sql         （admin_set_member_role）
-- --   supabase/migration-member-km-correction.sql  （admin_correct_member_km）
-- --   supabase/migration-profile-test-flag.sql     （admin_set_member_test / admin_list_members）
-- --   supabase/migration-analytics.sql             （6 個 analytics_*）
-- --   supabase/migration-event-registrations.sql   （analytics_event_registrations）
-- --   supabase/migration-event-attendance.sql      （analytics_hyrox_monthly）
--
-- -- 5.2 刪掉守衛函式（可留可刪；留著無害，但沒有任何函式會呼叫它）
-- --
-- -- ⚠️ 本段全部是註解，不會執行。
-- --    要確認「本檔有幾處真正會執行的刪除語句」，請排除註解行再數：
-- --      grep -n "drop function" supabase/migration-admin-levels-rpc.sql | grep -v ':--'
-- --    預期只剩 1 行：§3.3b 的 do 區塊（admin_list_members 3 參數版）。
-- --    直接 grep -c 會把本段註解也算進去，那不是真的刪除。
-- drop function if exists public.require_module(text, boolean);
--
-- -- 5.3 讓 PostgREST 重載
-- notify pgrst, 'reload schema';
-- =============================================================
