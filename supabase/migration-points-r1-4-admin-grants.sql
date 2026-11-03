/*
 * supabase/migration-points-r1-4-admin-grants.sql
 *
 * 目的：讓後台「積分規則 → 手動補發」可以從管理員 session 呼叫 award_* RPC。
 *
 * 背景：migration-points-r1-2-earn.sql 建完四支 award_* 後，
 *       把它們的 EXECUTE 從 public / anon / authenticated 全部 revoke
 *       （原本只預期由 trigger 或 service_role 呼叫）。
 *       但後台補發是「管理員手動觸發」，anon key + 管理員 JWT 會收到
 *       42501 permission denied for function。
 *
 * 安全性：四支函式內部第一行就是
 *       if not (public.is_admin() or coalesce(auth.role(),'') = 'service_role')
 *         then return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
 *       因此 grant 給 authenticated 不會讓普通會員可以加分——非管理員一律回 NOT_ADMIN。
 *       本檔不改任何函式簽名、不改表結構、不改 RLS。
 *
 * 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run（可重複執行）
 * 備註：若已在環境變數設定 SUPABASE_SERVICE_ROLE_KEY，後台會自動改用 service_role
 *       客戶端呼叫，本 migration 可以不執行；兩者並存亦不衝突。
 */

grant execute on function public.award_birthday(uuid) to authenticated;
grant execute on function public.award_referral(uuid, uuid) to authenticated;
grant execute on function public.award_event_participation(uuid, uuid) to authenticated;
grant execute on function public.award_checkin_bonus(uuid, uuid) to authenticated;

grant execute on function public.award_birthday(uuid) to service_role;
grant execute on function public.award_referral(uuid, uuid) to service_role;
grant execute on function public.award_event_participation(uuid, uuid) to service_role;
grant execute on function public.award_checkin_bonus(uuid, uuid) to service_role;
