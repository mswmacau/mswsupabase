-- =============================================================
-- migration-redeem-activity-gate.sql
-- 目的：止血 P0 ——「假帳號 8 天換走合作商戶折扣券」
--   完整攻擊鏈與評估見 docs/註冊獎勵濫用評估-20261114.md（本檔對應 §6 方案 C 與 §7 第 1 項）。
--   一句話：註冊白送 200 分 ＋ 每日登入無審核 +10 ＋ 7 日閘只延遲不攔截
--           → 零運動的假信箱帳號第 8 天即可兌換 300 分折扣券，走 pending，
--             商戶掃碼直接核銷，管理員全程不需按下任何按鈕。
--
-- 本檔兩段，**可獨立執行、互不依賴**（A 段不跑，B 段照樣有效；反之亦然）：
--   A 段（P0）：public.redeem_reward 在「⑩ 餘額」與「⑪ 7 日審批閘」之間，
--              插入「需至少一筆已核可運動紀錄」門檻（跑步 OR 簽到，任一即可）。
--   B 段（P2）：app_settings 對 anon 的可讀範圍收窄到 8 個公開內容鍵。
--
-- 執行方式：Supabase Dashboard → SQL Editor → 貼上整份 → Run。可重複執行（全部冪等）。
-- 前置：migration-points-r1-3-redeem.sql 已執行過（redeem_reward 存在）。
--
-- 為什麼另開新檔而不改 migration-points-r1-3-redeem.sql：
--   歷史 migration 線上已執行過，改它會讓「檔案內容」與「實際 DB 狀態」不一致，
--   下一個人重跑 r1-3 就會把門檻又悄悄拿掉。故本檔以 create or replace 獨立重貼完整定義。
--
-- A 段的改動範圍（驗收依據）：
--   函式本體與 migration-points-r1-3-redeem.sql:302-498 **逐字相同**——①~⑫ 的順序、
--   鎖序（reward → profile → redemption）、冪等鍵兩個快路徑、庫存、每人上限、
--   7 日審批閘、扣分、寫 ledger、全部錯誤碼與回傳欄位都沒有改動，
--   唯一差異是標記 BEGIN/END 的那一段。declare 區塊一行未改（新增判斷不需要新變數）。
--   comment on function 與 revoke/grant 亦逐字保留（權限不放寬、不放鬆）。
-- =============================================================

-- -------------------------------------------------------------
-- A 段（P0）：redeem_reward 加入運動紀錄門檻
-- -------------------------------------------------------------
create or replace function public.redeem_reward(
  p_reward_id       uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_key     text := btrim(coalesce(p_idempotency_key, ''));
  v_feature boolean;
  v_reward  public.rewards%rowtype;
  v_exist   public.reward_redemptions%rowtype;
  v_points  integer;
  v_created timestamptz;
  v_used    integer;
  v_status  text;
  v_code    text;
  v_rid     uuid;
  v_spent   integer;
  v_balance integer;
  v_expires timestamptz;
begin
  -- ① 未登入
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  -- ② 冪等鍵格式（必填，16–64）
  if length(v_key) < 16 or length(v_key) > 64 then
    return jsonb_build_object(
      'ok', false, 'code', 'INVALID_ARGUMENT',
      'detail', 'idempotency_key 必填且長度須為 16–64'
    );
  end if;

  -- ③ 冪等快路徑：同 (user_id, key) 直接回原結果，不扣分
  select * into v_exist
    from public.reward_redemptions r
   where r.user_id = v_uid
     and r.idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'code', v_exist.pickup_code,
      'status', v_exist.status,
      'expires_at', v_exist.expires_at
    );
  end if;

  -- ④ 止血開關（W1 seed：rewards_enabled = false）
  select (s.value #>> '{}')::boolean
    into v_feature
    from public.app_settings s
   where s.key = 'rewards_enabled';

  if v_feature is not null and v_feature = false then
    return jsonb_build_object('ok', false, 'code', 'FEATURE_OFF');
  end if;

  -- ⑤ 鎖 1：reward（同一禮品的兌換全部排隊 → 不會超賣）
  select * into v_reward
    from public.rewards w
   where w.id = p_reward_id
   for update;

  if not found or v_reward.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'REWARD_INACTIVE');
  end if;

  -- ⑥ 拿到鎖後再查一次冪等：兩個同 key 請求同時進來時，
  --    後者在這裡等到前者 commit，然後直接回原結果（不會重扣）。
  select * into v_exist
    from public.reward_redemptions r
   where r.user_id = v_uid
     and r.idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'code', v_exist.pickup_code,
      'status', v_exist.status,
      'expires_at', v_exist.expires_at
    );
  end if;

  -- ⑦ 鎖 2：profile（同時讀 points 與 created_at）
  select p.points, p.created_at
    into v_points, v_created
    from public.profiles p
   where p.id = v_uid
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  -- ⑧ 庫存（stock_remaining is null = 不限量，跳過）
  if v_reward.stock_remaining is not null and v_reward.stock_remaining <= 0 then
    return jsonb_build_object('ok', false, 'code', 'OUT_OF_STOCK');
  end if;

  -- ⑨ 每人上限（只計 pending / pending_approval / completed；cancelled 不計）
  if v_reward.per_user_limit is not null then
    select count(*) into v_used
      from public.reward_redemptions r
     where r.user_id = v_uid
       and r.reward_id = v_reward.id
       and r.status in ('pending', 'pending_approval', 'completed');

    if v_used >= v_reward.per_user_limit then
      return jsonb_build_object(
        'ok', false, 'code', 'PER_USER_LIMIT',
        'limit', v_reward.per_user_limit, 'used', v_used
      );
    end if;
  end if;

  -- ⑩ 餘額
  if coalesce(v_points, 0) < v_reward.points_cost then
    return jsonb_build_object(
      'ok', false, 'code', 'INSUFFICIENT_POINTS',
      'points', coalesce(v_points, 0), 'required', v_reward.points_cost
    );
  end if;
  -- ══ BEGIN 2026-11-15 新增：運動紀錄門檻（migration-redeem-activity-gate.sql）══
  -- ⑩-B 需至少一筆「已核可」的運動紀錄：跑步提交 或 訓練簽到，任一即可
  --      · 用 OR 放寬：只參加講座／只簽到的會員不會被誤擋（報告 §6 方案 C 附註）
  --      · 放在餘額檢查之後：積分不足時仍回 INSUFFICIENT_POINTS，錯誤訊息更具體
  if not (
       exists (
         select 1 from public.run_submissions r
          where r.user_id = v_uid
            and r.status = 'approved'
       )
    or exists (
         select 1 from public.training_checkins c
          where c.user_id = v_uid
            and c.status = 'approved'
       )
  ) then
    return jsonb_build_object(
      'ok', false, 'code', 'NO_ACTIVITY',
      'detail', '需至少一筆已核可的運動紀錄才能兌換'
    );
  end if;
  -- ══ END 2026-11-15 新增 ══

  -- ⑪ 7 日審批閘：新會員分照扣，但券要管理員批准才生效
  if v_created > now() - interval '7 days' then
    v_status := 'pending_approval';
  else
    v_status := 'pending';
  end if;

  v_code  := public.new_pickup_code();
  v_spent := v_reward.points_cost;

  -- ⑫ 寫入 → 扣分 → 扣庫存（同一交易；任何一步失敗整筆回滾）
  begin
    insert into public.reward_redemptions (
      user_id, reward_id, points_spent, status,
      pickup_code, idempotency_key, merchant_id
    ) values (
      v_uid, v_reward.id, v_spent, v_status,
      v_code, v_key, v_reward.merchant_id
    )
    returning id, expires_at into v_rid, v_expires;

    perform public.credit_points(
      v_uid,
      -v_spent,
      '兌換：' || v_reward.name,
      'reward',
      v_rid
    );

    if v_reward.stock_remaining is not null then
      update public.rewards w
         set stock_remaining = w.stock_remaining - 1,
             updated_at      = now()
       where w.id = v_reward.id
         and w.stock_remaining > 0;   -- 第二道保險（鎖已在手，正常必成立）
    end if;

  exception when unique_violation then
    -- 只可能是 (user_id, idempotency_key) 併發撞鍵（pickup_code 已回頭檢查過）
    select * into v_exist
      from public.reward_redemptions r
     where r.user_id = v_uid
       and r.idempotency_key = v_key;

    if found then
      return jsonb_build_object(
        'ok', true, 'duplicate', true,
        'code', v_exist.pickup_code,
        'status', v_exist.status,
        'expires_at', v_exist.expires_at
      );
    end if;

    -- 極端：pickup_code 撞到別人的券（2^60 分之一）
    return jsonb_build_object('ok', false, 'code', 'RETRY');
  end;

  select p.points into v_balance from public.profiles p where p.id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'status', v_status,
    'points_balance', coalesce(v_balance, 0),
    'expires_at', v_expires
  );
end;
$$;

comment on function public.redeem_reward(uuid, text) is
  '兌換禮品（會員，限本人）：單一交易完成扣分（credit_points, ref_type=reward）、扣庫存、'
  '產生 12 位取貨碼；冪等鍵 (user_id, idempotency_key) 重打回原結果；'
  '新會員（profiles.created_at 未滿 7 日）→ pending_approval（分照扣，券未生效）。';

revoke all on function public.redeem_reward(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_reward(uuid, text) to authenticated;

-- -------------------------------------------------------------
-- B 段（P2，報告 §7 第 1 項）：app_settings 對 anon 的可讀範圍收窄
--
-- 原始問題：GET /rest/v1/app_settings 帶 anon key 可回 200，並回傳全部 25 個 key
--           （含 signup_bonus / daily_login_points / streak_bonus 等積分規則與 rewards_enabled），
--           攻擊者可先確認規則再下手。
--
-- 查證結果（2026-11-15，全 repo grep）：**不能整表對 anon 撤銷 select**。
--   公開頁面是用「不含 cookie 的 anon client」讀 app_settings 的，撤了會白畫面：
--     src/lib/queries.ts:516  site_theme      （root layout 主題）
--     src/lib/queries.ts:560  site_content    （首頁文案）
--     src/lib/queries.ts:589  site_nav        （導覽）
--     src/lib/queries.ts:617  site_contact    （聯絡資訊）
--     src/lib/queries.ts:645  site_pages      （自訂頁）
--     src/lib/queries.ts:673  site_blocks     （區塊內容）
--     src/lib/queries.ts:701  site_seo        （SEO meta）
--     src/lib/rewards.ts:112  rewards_enabled （止血開關；讀不到會 fail-safe 成 false → 全站禮品入口消失）
--   以上 8 個鍵是公開內容，本來就要給匿名訪客看。
--
-- 因此改採「只收窄非公開鍵」：anon 只保留上列 8 鍵；authenticated 僅管理員可讀
--   （管理後台讀積分規則走的是登入態 client：
--     src/app/api/admin/point-rules/route.ts:133、src/app/admin/point-rules/load.ts:56、
--     src/lib/queries.ts:1472 getPointsPerKm（僅 src/app/admin/** 呼叫））。
--   效果：假帳號（註冊即成 authenticated 但非 admin）也讀不到積分規則，不只是擋匿名。
--   不受影響：DB 內部邏輯走 security definer 函式（setting_num、credit_points），不經 RLS；
--             小程序 API 用 service_role（src/lib/mp/db.js），亦繞過 RLS。
--
-- 若站主只想做 A 段（P0 止血）、暫不動權限：**整段 B 略過不執行即可**，不影響 A 段。
-- -------------------------------------------------------------

-- 舊政策：settings_select_all（用 true 對所有角色開放）→ 由 schema.sql:412-414 建立
drop policy if exists "settings_select_all" on public.app_settings;

-- anon：僅 8 個公開內容鍵
drop policy if exists "settings_select_public_anon" on public.app_settings;
create policy "settings_select_public_anon" on public.app_settings
  for select to anon
  using (
    key = any (array[
      'site_theme', 'site_content', 'site_nav', 'site_contact',
      'site_pages', 'site_blocks', 'site_seo', 'rewards_enabled'
    ]::text[])
  );

-- authenticated：僅管理員可讀全部鍵（會員與假帳號讀不到積分規則）
drop policy if exists "settings_select_admin" on public.app_settings;
create policy "settings_select_admin" on public.app_settings
  for select to authenticated
  using (public.is_admin());

-- 寫入政策未動（settings_admin_write，schema.sql:416-418 已限定 is_admin()）。

do $$ begin raise notice 'A 段 OK — redeem_reward 已加入運動紀錄門檻；B 段 OK — app_settings anon 收權'; end $$;

-- =============================================================
-- 站主執行後驗證（Dashboard → SQL Editor，逐條貼上執行）
-- =============================================================

-- 【驗證 1】函式是否真的換成新版（應為 1 列，prosecdef = true，proconfig 含 search_path=public）
--   select p.proname, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'redeem_reward';
--   再確認函式內含新閘：
--   select position('NO_ACTIVITY' in pg_get_functiondef(p.oid)) as has_gate
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'redeem_reward';
--   → has_gate 應 > 0（0 或 null 表示沒換到）

-- 【驗證 2】會被擋下的帳號（預期：3 個 200 分的假帳號全部在名單內）
--   判準 = 沒有任何已核可跑步、也沒有任何已核可簽到
--   select p.id, p.display_name, p.points, p.role, p.created_at
--     from public.profiles p
--    where not exists (select 1 from public.run_submissions r
--                       where r.user_id = p.id and r.status = 'approved')
--      and not exists (select 1 from public.training_checkins c
--                       where c.user_id = p.id and c.status = 'approved')
--    order by p.points desc;
--   預期看到：lou kei chan、街健新手、nokiababy（各 200 分）、fly chan（30 分）
--   —— fly chan 目前分數不足 300，實際上還換不到東西，只是同樣沒有運動紀錄。

-- 【驗證 3】不受影響的帳號（預期：4 位有已核可跑步紀錄者照樣可兌換）
--   select p.id, p.display_name, p.points,
--          (select count(*) from public.run_submissions r
--            where r.user_id = p.id and r.status = 'approved') as approved_runs,
--          (select count(*) from public.training_checkins c
--            where c.user_id = p.id and c.status = 'approved') as approved_checkins
--     from public.profiles p
--    where exists (select 1 from public.run_submissions r
--                   where r.user_id = p.id and r.status = 'approved')
--       or exists (select 1 from public.training_checkins c
--                   where c.user_id = p.id and c.status = 'approved')
--    order by p.points desc;

-- 【驗證 4】app_settings 收權結果（B 段）
--   以 anon key 打（不帶任何登入 token）：
--     GET /rest/v1/app_settings?select=key
--   → 執行前：25 列；執行後：應只剩 8 列（site_theme / site_content / site_nav /
--     site_contact / site_pages / site_blocks / site_seo / rewards_enabled）
--   以管理員登入態打 → 應仍為全部 25 列（後台積分規則頁不得壞）
--   以一般會員登入態打 → 應為 0 列（無法再探測規則）

-- =============================================================
-- 需要暫時放行某個帳號時（例：會員確實參加過活動，但紀錄漏登）
--   本閘沒有「白名單開關」——它是查真實紀錄，不查旗標。正確做法是「補登真實紀錄」，
--   而不是加例外（加例外等於又開一條不用運動的路）。
--   1) 請該會員在 App／網站補上傳跑步紀錄，管理員在後台核可（推薦，全程留痕）；
--   2) 若活動已結束、無法補上傳，由管理員以 SQL 補一筆**真實**紀錄（下方僅為格式範例，
--      所有值必須是事實，不可為了放行而造假）：
--        insert into public.run_submissions
--               (user_id, km, period_month, image_path, note, status, reviewed_at)
--        values ('<會員 uuid>', <實際公里數>, '<YYYY-MM>', '<截圖 storage 路徑或補登說明>',
--                '管理員補登（原因：<填寫>）', 'approved', now());
--      或（該會員是參加訓練課）：
--        insert into public.training_checkins
--               (session_id, user_id, status, admin_note, confirmed_by, created_at)
--        values ('<場次 uuid>', '<會員 uuid>', 'approved', '管理員補登（原因：<填寫>）',
--                '<管理員 uuid>', now())
--        on conflict (session_id, user_id) do update
--           set status = 'approved', admin_note = excluded.admin_note, confirmed_by = excluded.confirmed_by;
--   3) 反向（要讓某帳號連既有紀錄都換不到）：把該帳號的紀錄改回 rejected／刪除即可，
--      但請先確認那不是真實權益——刪資料前先備份：
--        create table if not exists public.run_submissions_bak_20261115 as
--          select * from public.run_submissions;
-- =============================================================

-- =============================================================
-- 回滾（兩段各自可回滾）
--   A 段：把舊定義貼回去即可。
--     · 來源：supabase/migration-points-r1-3-redeem.sql:302-498（redeem_reward 完整定義）
--             以及同檔 :500-506（comment on function ＋ revoke/grant）
--     · 做法：完整貼上上述行號區間（不含本檔的插入段），在 SQL Editor 執行。
--     · 無資料遷移：本閘只做「查詢判斷」，不改任何表結構、不寫任何資料，
--       已發出的券、已扣的分、point_transactions 帳本全部不受影響。
--   B 段：把政策還原成 schema.sql:412-414 的定義
--        drop policy if exists "settings_select_public_anon" on public.app_settings;
--        drop policy if exists "settings_select_admin" on public.app_settings;
--        drop policy if exists "settings_select_all" on public.app_settings;
--        create policy "settings_select_all" on public.app_settings
--          for select using (true);
--     （CRUD 權限 GRANT 從頭到尾沒動過，所以還原政策即可完全復原。）
-- =============================================================
