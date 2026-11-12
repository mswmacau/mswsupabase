-- =============================================================
-- supabase/migration-member-purge.sql
-- 後台「永久刪除會員」— SECURITY DEFINER RPC
--
-- 為什麼需要這支檔案：
--   本專案刻意「不」配置 SUPABASE_SERVICE_ROLE_KEY（先前誤填 anon key 造成
--   42501，已移除）。因此 /api/admin/members 的 DELETE 只能把 status 設成
--   'disabled'（軟刪除），客戶在後台按「刪除」永遠清不掉測試帳號。
--
--   本函式以 SECURITY DEFINER（函式擁有者 postgres）執行，可直接
--   `delete from auth.users`，**不需要**應用層持有 service_role 金鑰。
--
-- 安全性：
--   · security definer + set search_path → 防止 search_path 注入
--   · 內部 is_admin() 閘門 = 真正的權限來源（不依賴應用層）
--   · 檔尾 revoke from public, anon（Postgres 預設把 EXECUTE 給 PUBLIC，
--     不 revoke 等於沒鎖——這是本專案踩過的坑）
--
-- 可重複執行：create or replace function / revoke / grant 皆幂等。
--
-- -------------------------------------------------------------
-- 執行後應看到（驗證查詢，貼在 SQL Editor 一起跑）：
--   select count(*) from auth.users
--    where email = 'hyrox-api-test-1759@msw.test';   -- 應為 0
-- =============================================================

-- -------------------------------------------------------------
-- 0. 外鍵刪除規則盤點（決定函式內要先處理哪些子表）
--
--    規則代碼：c=cascade  n=set null  a=no action（預設）  r=restrict
--
--    ┌─ 子表.欄位                          → 父表             規則    來源
--    ├─ profiles.id                        → auth.users       c       supabase/schema.sql:17
--    ├─ training_checkins.session_id       → training_sessions c      supabase/schema.sql:117
--    ├─ training_checkins.user_id          → profiles         c       supabase/schema.sql:118
--    ├─ training_checkins.confirmed_by     → profiles         **a**   supabase/schema.sql:121  ← 必須先 set null
--    ├─ run_submissions.user_id            → profiles         c       supabase/schema.sql:134
--    ├─ run_submissions.reviewed_by        → profiles         **a**   supabase/schema.sql:141  ← 必須先 set null
--    ├─ coupons.user_id                    → profiles         c       supabase/schema.sql:156
--    ├─ point_transactions.user_id         → profiles         c       supabase/schema.sql:173
--    ├─ event_registrations.event_id       → events           c       supabase/migration-event-registrations.sql:66
--    ├─ event_registrations.user_id        → profiles         c       supabase/migration-event-registrations.sql:67
--    ├─ events.created_by                  → profiles         n       supabase/schema-r6.sql:34
--    ├─ admin_audit_log.actor_id           → profiles         n       supabase/migration-audit-log.sql:44
--    ├─ page_views                         （無 user 外鍵，只有 is_member boolean）
--    │                                                              supabase/migration-analytics.sql:131
--    ├─ mp_orders.member_id                （text，**沒有**外鍵）  见 002_mp_orders.sql:15
--    └─ rewards / reward_redemptions / merchants.created_by
--                                          （本地無 DDL，實際規則未知 → 交給 §4-b 動態兜底）
--
--    結論：
--      · 規則 c 的子表不必處理（auth.users → profiles → 子表 級聯刪除）
--      · 規則 n 的子表不必處理（父列消失時 DB 自己 set null）
--      · 規則 a / r 的子表**必須在 delete 前處理**，否則
--        `delete from auth.users` 會因 23503 foreign_key_violation 失敗
--      · 已知的 a 只有 confirmed_by / reviewed_by 兩欄 → §4-a 明確處理
--      · 其餘（含本地沒有 DDL 的 rewards / reward_redemptions / merchants）
--        由 §4-b 掃 pg_constraint 動態兜底，避免「客戶資料庫多了一張表就爆」
--
--    ⚠️ 取捨（請客戶確認）：動態兜底對「NOT NULL 的 no action 外鍵」只能刪列。
--       例如某表 created_by uuid not null references profiles(id)（no action），
--       刪會員時該表屬於此會員的列會一起消失。若那不是你要的行為，
--       請先跑文末的 FK 查詢核對，把該欄位改成 on delete set null 或改為可為空，
--       再執行本檔。
-- -------------------------------------------------------------

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

comment on function public.admin_purge_member(uuid) is
  '後台永久刪除會員（管理員限定）：security definer，直接 delete from auth.users，不需要 service_role 金鑰。禁止刪自己與最後一位管理員；刪除前先處理 no action/restrict 外鍵（training_checkins.confirmed_by、run_submissions.reviewed_by 及 pg_constraint 動態兜底），並清除 mp_orders 孤兒列。回 jsonb：{ok:true,deleted:true} 或 {ok:false,code:NOT_ADMIN|SELF|NOT_FOUND|LAST_ADMIN}。';

-- -------------------------------------------------------------
-- 8. 權限：anon 一律不可執行；authenticated 可執行，
--    但函式內部的 is_admin() 才是真正的閘門。
--    ⚠️ Postgres 預設把 EXECUTE 給 PUBLIC，不 revoke 等於沒鎖。
-- -------------------------------------------------------------
revoke all on function public.admin_purge_member(uuid) from public;
revoke all on function public.admin_purge_member(uuid) from anon;
grant execute on function public.admin_purge_member(uuid) to authenticated;

-- -------------------------------------------------------------
-- 8-b. 立刻叫 PostgREST 重新載入 schema cache。
--      不跑這一行，API 端會持續收到 PGRST202「找不到函式」而默默
--      降級成軟刪除（本專案實測過的現象），要等 Supabase 自己刷新。
-- -------------------------------------------------------------
notify pgrst, 'reload schema';

-- -------------------------------------------------------------
-- 9. 執行後的自我檢查（應該看到 3 列，且 prosecdef = true）
-- -------------------------------------------------------------
-- select p.proname,
--        p.prosecdef as security_definer,
--        p.proconfig,
--        has_function_privilege('authenticated', p.oid, 'execute') as auth_can_exec,
--        has_function_privilege('anon',          p.oid, 'execute') as anon_can_exec
--   from pg_proc p
--  where p.pronamespace = 'public'::regnamespace
--    and p.proname = 'admin_purge_member';
--   → security_definer = true、auth_can_exec = true、anon_can_exec = false

-- 實際外鍵規則（在客戶資料庫上是唯一可信來源，建議一併執行核對）：
-- select c.conrelid::regclass as child_table,
--        a.attname             as child_col,
--        case c.confdeltype when 'c' then 'cascade'
--                           when 'n' then 'set null'
--                           when 'a' then 'no action'
--                           when 'r' then 'restrict'
--                           when 'd' then 'set default' end as on_delete
--   from pg_constraint c
--   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
--  where c.contype = 'f'
--    and cardinality(c.conkey) = 1
--    and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
--  order by 1, 2;
