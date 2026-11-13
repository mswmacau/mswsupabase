-- =============================================================
-- MSW 街健館 — P0 安全修復：會員可自行偽造「已確認付款」
-- 檔名：migration-security-fix-p0.sql
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- 前置條件：已執行 schema.sql / migration-event-registrations.sql /
--           migration-paid-events-1.sql（本檔修的就是該檔 I 段）
-- 可重跑：全部 create or replace / do 區塊（幂等，重跑無副作用、不改既有資料）
-- Owner：白客（backend-engineer）
--
-- 【修的是哪個洞（已實測重現）】
--   攻擊者用公開 anon key + 一般會員 JWT 直接打 PostgREST：
--     POST /rest/v1/event_registrations
--     {"event_id":"<付費活動>","user_id":"<自己>","status":"registered",
--      "payment_status":"confirmed","payment_amount_cents":1,
--      "reviewed_by":"<管理員 uuid>","reviewed_at":"...","admin_note":"..."}
--   → HTTP 201，落庫後管理員視角讀回同樣是 confirmed（等於免費報名 + 偽造審核軌跡）。
--
--   根因：migration-paid-events-1.sql:690-693 的
--   trg_event_registration_payment_default()（before insert）把
--   「呼叫端指定了非預設值」當成「管理員手動補登」而放行，
--   **完全沒有檢查呼叫者是否管理員**。而 INSERT 這條路是開放給會員的
--   （RLS policy event_reg_insert_own：with check auth.uid() = user_id，
--   見 migration-event-registrations.sql:102-104），
--   所以「會員可以 insert 自己的列」＋「trigger 對非預設值一律放行」＝ 可提權。
--
-- 【本檔做什麼（兩道防線）】
--   防線 1（真正的閘門）：重寫 trg_event_registration_payment_default()
--     · 呼叫者是管理員（public.is_admin()）或 service_role → 維持原行為（可補登）
--     · 其他（會員 / anon）→ 付款相關欄位一律強制覆寫成「只能誠實申報」的值：
--         payment_status       := 依活動 fee_cents 決定（>0 → pending_review，=0 → not_required）
--         reviewed_by          := null
--         reviewed_at          := null
--         admin_note           := null
--         payment_amount_cents := null（除非他填的剛好等於該活動 fee_cents）
--         payment_proof_path   := null（除非路徑以 '<自己的 uid>/' 開頭）
--         disclaimer_accepted_at := now()（若他填的時間偏離 now() 超過 ±5 分鐘）
--     · 任何情況下 payment_status 只允許四態之一，非法值直接 raise（22023）
--   防線 2（縱深防禦）：欄位級 UPDATE 權限收回（見第 3 節說明，目前是冪等保險）
--
-- 【刻意不動的東西】
--   · 不改任何 RLS 政策（會員的 insert / select / delete 政策原樣保留）
--   · 不改 review_event_payment / award_paid_event_bonus / submit_event_payment_proof
--     （管理員審核流程、發分流程、會員重交流程的行為完全不變）
--   · 不改前端、不改任何 API route
-- =============================================================


-- ------------------------------------------------------------
-- 1. 付款預設值 trigger 函式（重寫：加管理員判斷 + 強制覆寫）
--
--    與舊版的差異（逐行對照 migration-paid-events-1.sql:681-707）：
--      舊：if new.payment_status <> 'not_required' then return new;  ← 任何人都能指定 confirmed
--      新：先判定 is_admin()/service_role，非管理員一律覆寫
--
--    為什麼 trigger 函式要 security definer？
--      沿用舊版設定（它要讀 public.events.fee_cents）。刻意保留：
--      auth.uid() / auth.role() 讀的是 PostgREST 放進 GUC 的 JWT 宣告，
--      不會因為 security definer 而變成函式擁有者，所以身分判斷仍然可信。
-- ------------------------------------------------------------
create or replace function public.trg_event_registration_payment_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee       integer;
  v_is_admin  boolean;
  v_uid       uuid := auth.uid();
  v_uid_text  text;
  v_path      text;
begin
  -- ── 0. 狀態值白名單：四態以外一律 raise（不靠後面的 table check 擋）──
  --    註：表上另有 event_registrations_payment_status_check（migration-paid-events-1.sql:225-235），
  --    但 BEFORE trigger 先執行，這裡直接 raise 才能給出可讀的錯誤訊息。
  if new.payment_status is not null
     and new.payment_status not in ('not_required', 'pending_review', 'confirmed', 'rejected')
  then
    raise exception '非法的付款狀態（payment_status 只允許 not_required / pending_review / confirmed / rejected）'
      using errcode = '22023';
  end if;

  -- 該場活動的報名費（分）。活動不存在時為 null → 視為 0（FK 稍後會擋下整列）。
  select coalesce(ev.fee_cents, 0) into v_fee
    from public.events ev
   where ev.id = new.event_id;

  v_is_admin := public.is_admin() or coalesce(auth.role(), '') = 'service_role';

  -- ── 1. 管理員 / service_role：維持原行為（可手動補登，不覆寫）──
  if v_is_admin then
    if new.payment_status is null or new.payment_status = 'not_required' then
      if coalesce(v_fee, 0) > 0 then
        new.payment_status := 'pending_review';
      else
        new.payment_status := 'not_required';
      end if;
    end if;
    return new;
  end if;

  -- ── 2. 非管理員（會員 / anon）：付款相關欄位一律強制覆寫 ──
  -- 2.1 付款狀態只能由「活動收不收費」決定，會員沒有任何話語權
  if coalesce(v_fee, 0) > 0 then
    new.payment_status := 'pending_review';
  else
    new.payment_status := 'not_required';
  end if;

  -- 2.2 審核軌跡一律清空（會員偽造 reviewed_by / reviewed_at / admin_note 的入口）
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.admin_note  := null;

  -- 2.3 自填金額只允許 null 或「剛好等於活動報名費」，其餘丟棄
  --     （false 的申報沒有意義，真正的核對由管理員看截圖判斷）
  if new.payment_amount_cents is not null
     and new.payment_amount_cents is distinct from v_fee
  then
    new.payment_amount_cents := null;
  end if;

  -- 2.4 截圖路徑必須在自己的 uid 目錄下（Storage 路徑慣例 '<uid>/xxx.png'），
  --     否則丟棄。auth.uid() 取不到時（理論上不可能，RLS 已要求登入）一律丟棄。
  --     另外擋掉 '..' 路徑穿越（'<uid>/../<別人>/x.png' 雖然前綴對，語意上不是他的目錄）。
  v_path := nullif(btrim(coalesce(new.payment_proof_path, '')), '');
  if v_path is not null then
    v_uid_text := coalesce(v_uid::text, '');
    if v_uid_text = ''
       or v_path not like (v_uid_text || '/%')
       or v_path like '%/../%'
    then
      new.payment_proof_path := null;
    end if;
  end if;

  -- 2.5 免責聲明同意時間只允許 null 或 now() 前後 5 分鐘內，避免偽造「早就同意了」。
  --     超出範圍者改寫成 now()（同意時間的語意本來就是「送出這一刻」）。
  if new.disclaimer_accepted_at is not null
     and (new.disclaimer_accepted_at < now() - interval '5 minutes'
          or new.disclaimer_accepted_at > now() + interval '5 minutes')
  then
    new.disclaimer_accepted_at := now();
  end if;

  return new;
end;
$$;

comment on function public.trg_event_registration_payment_default() is
  'event_registrations before-insert：管理員／service_role 可指定付款狀態（補登）；'
  '其他身分一律強制覆寫 payment_status/reviewed_*/admin_note/payment_amount_cents/'
  'payment_proof_path/disclaimer_accepted_at，避免會員自行標記已付款。';

-- trigger 函式不需要 EXECUTE 權限（只由 trigger 內部呼叫），
-- 但 Postgres 預設把 EXECUTE 給 PUBLIC，照本專案紀律一併收回（幂等）。
revoke all on function public.trg_event_registration_payment_default()
  from public, anon, authenticated;

-- 重建 trigger（drop + create：確保它指向剛 replace 過的函式，可重跑）
drop trigger if exists event_reg_payment_default on public.event_registrations;
create trigger event_reg_payment_default
  before insert on public.event_registrations
  for each row execute function public.trg_event_registration_payment_default();

do $$ begin
  raise notice '1 OK — trg_event_registration_payment_default（管理員判斷 + 非管理員強制覆寫）';
end $$;


-- ------------------------------------------------------------
-- 2. 第二道防線：欄位級 UPDATE 權限收回
--
--     ⚠️ 先說實話（2026-11 實測）：這條 revoke 在目前的線上是**無實效**的。
--
--     實測方式（用管理員 JWT 對一個不存在的 id 發 PATCH，只驗權限、不動資料）：
--       PATCH /rest/v1/event_registrations?id=eq.00000000-0000-0000-0000-000000000000
--       → HTTP 200 / 204（0 列受影響），代表 authenticated 有表級 UPDATE。
--
--     原因：Supabase 對 public schema 設了 default privileges
--     （alter default privileges … grant all on tables to anon, authenticated, service_role），
--     所以 migration-event-registrations.sql:117「grant select, insert, delete 給 authenticated，
--     刻意不授 update」在線上其實沒有達到「不給 update」的效果。
--
--     Postgres 的權限是「表級授權 OR 欄位級授權」，因此只要表級 UPDATE 還存在，
--     欄位級 REVOKE 一定被蓋過。這條寫上只是留下明示的界線（且是冪等空操作），
--     並且在有人日後真的收掉表級 UPDATE 之後才會變成有效防線。
--
--     ✅ 目前真正擋住「會員改自己的列」的是 RLS：
--        policy event_reg_admin_update（for update using is_admin() with check is_admin()）
--        → 非管理員 update 影響 0 列（不是報錯，是看不到任何可更新的列）。
--        這點已在驗證 harness 的 T13 實測確認。
--
--     要讓這四欄「連管理員以外的人都不可能透過任何路徑改」的最徹底做法，是加一支
--     before update trigger（同樣用 is_admin() 判斷）。本檔刻意不做：
--     派工單限定「只改 INSERT 這條路徑 + 欄位權限」，而且 UPDATE 目前已被 RLS 封住。
--     若日後開放任何「會員可 update 自己的報名列」的功能，務必先加那支 trigger。
--
--     為什麼不會影響管理員後台：後台審核走 review_event_payment（SECURITY DEFINER，
--     以函式擁有者權限執行，見 migration-paid-events-1.sql:377-464），
--     不受 authenticated 的欄位權限限制（harness T8b 已實測）。
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke update (payment_status, reviewed_by, reviewed_at, admin_note) '
         || 'on public.event_registrations from authenticated';
    raise notice '2 OK — revoke update(payment_status, reviewed_by, reviewed_at, admin_note) from authenticated';
  else
    raise notice '2 SKIP — 角色 authenticated 不存在（非 Supabase 環境，可忽略）';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke update (payment_status, reviewed_by, reviewed_at, admin_note) '
         || 'on public.event_registrations from anon';
    raise notice '2 OK — revoke update(payment_status, reviewed_by, reviewed_at, admin_note) from anon';
  else
    raise notice '2 SKIP — 角色 anon 不存在（非 Supabase 環境，可忽略）';
  end if;
end $$;


-- 讓 PostgREST 立刻看到變更（可重複執行，無副作用）
notify pgrst, 'reload schema';

do $$
begin
  raise notice '=== migration-security-fix-p0.sql 完成（1 function + 1 trigger + 欄位權限）===';
  raise notice '下一步：照檔尾「執行後驗證」逐條確認，特別是第 3 條（會員重放驗證）。';
end $$;


-- =============================================================
-- 執行後驗證（貼進 SQL Editor 逐條跑；-- 開頭是說明）
-- =============================================================
-- -- 1) 兩個防線物件都在
-- select p.proname, p.prosecdef, pg_get_function_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'trg_event_registration_payment_default';
--
-- select tgname, tgenabled
--   from pg_trigger
--  where tgrelid = 'public.event_registrations'::regclass
--    and tgname = 'event_reg_payment_default';
--
-- -- 2) 欄位權限現況（先看清楚，別誤判這條 revoke 有效）
-- select grantee, column_name, privilege_type
--   from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'event_registrations'
--    and privilege_type = 'UPDATE'
--    and grantee in ('authenticated', 'anon')
--  order by grantee, column_name;
-- -- 期望（本專案線上現況）：仍然查得到 4 欄 —— 因為 authenticated 持有【表級】UPDATE
-- --   （Supabase default privileges），表級授權會蓋過欄位級 revoke。
-- --   這不是本檔寫錯，而是「第二道防線在現況下無實效」，真正的 UPDATE 防線是 RLS：
-- select has_table_privilege('authenticated','public.event_registrations','UPDATE');
-- --   接著用會員 JWT 實測 update（打 PostgREST）：
-- --   PATCH /rest/v1/event_registrations?id=eq.<自己的報名 id>   body {"payment_status":"confirmed"}
-- --   期望：HTTP 200/204 但回傳空陣列、受影響 0 列（RLS 擋掉，不是報錯）
-- --   只有當上面 has_table_privilege 回 false 時，本檔的欄位 revoke 才是有效防線。
--
-- -- 3)【最關鍵】用會員 JWT 重放攻擊 payload，落庫必須是 pending_review、reviewed_by = null
-- --    在 SQL Editor 以外的地方執行（例如用 node/curl 直接打 PostgREST），
-- --    或在本機以「會員 JWT」呼叫下面這支函式模擬（會寫入一列，記得刪）：
-- --    curl -s -X POST "$SUPABASE_URL/rest/v1/event_registrations" \
-- --      -H "apikey: <anon key>" -H "Authorization: Bearer <會員 JWT>" \
-- --      -H "Content-Type: application/json" -H "Prefer: return=representation" \
-- --      -d '{"event_id":"<付費活動 id>","user_id":"<自己 uid>","status":"registered",
-- --           "payment_status":"confirmed","payment_amount_cents":1,
-- --           "reviewed_by":"<管理員 uuid>","reviewed_at":"2026-01-01T00:00:00Z"}'
-- --    → 回應 201，但 payment_status 應為 pending_review、reviewed_by 為 null、
-- --      payment_amount_cents 為 null
--
-- -- 4) 狀態白名單：任何身分都塞不進第五種狀態
-- --    期望：ERROR 22023 非法的付款狀態
-- --    curl ... -d '{"event_id":"<id>","user_id":"<自己>","status":"registered","payment_status":"hacked"}'
--
-- -- 5) 管理員流程沒被改壞：用管理員 JWT 審核 pending_review 的列
-- select public.review_event_payment('<registration-uuid>', 'confirmed', '人工核對轉帳');
-- --    期望：{"ok": true, "payment_status": "confirmed", "award": {"ok": true, "points": 30}}
-- =============================================================
