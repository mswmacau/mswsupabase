-- =============================================================
-- 管理員更正會員總里程（total_km）— P1-1
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 性質：只新增 1 支函式，不改任何表結構、不改任何既有資料
-- 可重複執行（create or replace / revoke / grant 皆冪等）
-- =============================================================
--
-- 【為什麼需要這支函式】
-- 核准跑步提交（review_run_submission）會把 profiles.total_km 直接
-- += 該筆里程並同時加分（見 migration-points-r1-2-earn.sql:767-778）。
-- 誤按「通過」之後，全站**沒有任何路徑**能把里程改回去：
--   · 會員自己改 → guard_profile_sensitive_fields 會還原（非管理員不可改 total_km）
--   · admin_update_member 的參數裡沒有 total_km
--   · profiles 的 RLS 只有 profiles_update_own（schema.sql:743），
--     管理員連別人的列都 update 不到 → 直接 update 會「影響 0 列」而不報錯，
--     這種靜默失敗比報錯更危險，所以一律走 security definer 函式。
-- 一次誤按 = 排行榜永久錯誤 + 300km 達標基準偏移，因此補這支「更正」入口。
--
-- 【為什麼只改 total_km】
-- 這支函式刻意**不碰 points**：
--   · 積分有 ledger（point_transactions）與 credit_points 的一致性規則，
--     直接改 profiles.points 會讓餘額與流水對不上。
--   · 積分要調就走既有的 admin_adjust_points（會寫 ledger 與原因）。
--   · 權限最小化：一支只能改里程的函式，誤用時的最壞後果是可預期的。
--
-- 【為什麼是 security definer】
-- 呼叫者是管理員，但 RLS 不允許管理員更新他人的 profiles 列，
-- 因此需要在函式內以 definer 身分寫入；閘門改用函式入口的 is_admin()。
-- guard_profile_sensitive_fields 對 is_admin() 為 true 的呼叫是放行的
-- （migration-points-r1-1-schema.sql:388-421），所以這裡的 update 不會被還原。
--
-- 【權限設計】
-- anon 一律沒有 execute；authenticated 有 execute，但函式內部再驗 is_admin()。
-- Postgres 預設把 EXECUTE 給 PUBLIC，不 revoke 等於公開，所以下面逐條 revoke。
--
-- 【⚠️ 在 SQL Editor 直接呼叫會失敗（預期行為）】
-- SQL Editor 以 postgres 身分執行、沒有 JWT，auth.uid() 為 null，
-- is_admin() = false，會 raise「只有管理員可以更正總里程」。
-- 驗證請從網站 /admin/members 的會員抽屜操作。
-- =============================================================


-- ------------------------------------------------------------
-- admin_correct_member_km — 直接把某位會員的總里程設定為新值
--
--   參數：p_id  會員 id
--         p_km  新的總里程（0–10000，容許一位小數；函式內再 round 一次）
--   回傳：jsonb { ok, before_km, after_km }
--         before/after 給 API 寫稽核摘要用（「原 0.5 km → 新 0 km」）
--   錯誤：P0001（只有管理員可以更正總里程／範圍錯誤／找不到會員）
-- ------------------------------------------------------------
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

comment on function public.admin_correct_member_km(uuid, numeric) is
  '後台更正會員總里程（管理員限定）：只改 profiles.total_km，不動 points/role/status/'
  'is_test；p_km 限 0–10000 並四捨五入到一位小數；回傳 jsonb {ok, before_km, after_km}。'
  '用途：核准跑步提交誤按後修正里程（排行榜與 300km 達標基準會受影響）。';


-- ------------------------------------------------------------
-- 權限：anon 一律不可執行；authenticated 可執行，但真正的閘門是函式內的 is_admin()
-- ------------------------------------------------------------
revoke all on function public.admin_correct_member_km(uuid, numeric) from public;
revoke all on function public.admin_correct_member_km(uuid, numeric) from anon;
grant execute on function public.admin_correct_member_km(uuid, numeric) to authenticated;

-- PostgREST 的 schema cache 需要重載，否則剛建立的函式會被當成不存在（PGRST202）
notify pgrst, 'reload schema';


-- =============================================================
-- 執行後驗證（在 SQL Editor 分別執行）
-- =============================================================
-- ① 函式存在，且 SECURITY DEFINER 已生效（prosecdef 應為 true）
-- select proname, prosecdef, pg_get_function_identity_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname = 'admin_correct_member_km';
--   → 應有一列，args = p_id uuid, p_km numeric，prosecdef = true
--
-- ② 權限正確：anon 不應有 EXECUTE，authenticated 應有
-- select
--   has_function_privilege('anon',
--     'public.admin_correct_member_km(uuid, numeric)', 'execute') as anon_exec,
--   has_function_privilege('authenticated',
--     'public.admin_correct_member_km(uuid, numeric)', 'execute') as auth_exec;
--   → anon_exec 為 false，auth_exec 為 true
--
-- ③ 直接呼叫會被閘門擋下（SQL Editor 沒有 JWT，這是預期結果）
-- select public.admin_correct_member_km(
--   (select id from public.profiles limit 1), 0
-- );
--   → ERROR: 只有管理員可以更正總里程
--
-- ④ 確認這支函式沒有順便改到積分（比對呼叫前後的 points 應完全相同）
-- select id, total_km, points from public.profiles where id = '<會員 id>';
-- =============================================================
