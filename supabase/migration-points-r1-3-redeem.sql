-- =============================================================
-- MSW 街健館 — 積分換領系統 R1（W2／第 3 支）
-- 檔名：migration-points-r1-3-redeem.sql
-- 內容：兌換（redeem_reward）、新會員審批（admin_review_redemption）、
--       後備核銷（admin_fulfill_redemption）、公開驗證（merchant_verify_lookup／
--       merchant_verify_redeem）、商戶公開列表、商戶 PIN 產生／重設、取貨碼產生
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- 前置條件：migration-points-r1-1-schema.sql（三張表）
--          migration-points-r1-2-earn.sql（credit_points 必須存在）
-- 可重跑：create or replace／add column if not exists／
--         create index if not exists／drop policy if exists（本檔不新增 RLS 政策）
-- =============================================================
--
-- 【本檔不做什麼】
--   不改 add_points、不改 is_admin、不改 guard_profile_sensitive_fields、
--   不改任何既有 RLS 政策、不改 point_transactions 定義。
--   扣分／退分一律經 credit_points（唯一積分寫入通道）。
--
-- 【原子性】
--   redeem_reward／admin_review_redemption／admin_fulfill_redemption 全部在
--   單一交易內完成「鎖行 → 驗證 → 扣分 → 扣庫存 → 寫紀錄」。
--   任何一步失敗整筆回滾；只有「同 key 併發重打」與「audit 寫入失敗」
--   兩種情況被刻意吞掉（前者回原結果，後者不可回滾主流程）。
--
-- 【固定鎖序：reward → profile → redemption】
--   三支會改多張表的函式一律照此順序取鎖，避免 A 等 B、B 等 A 的迴圈死鎖。
--   merchant_verify_redeem 只鎖自己那張券，不取 reward／profile 鎖，
--   因此不會與上面三支形成循環。
--
-- 【超賣防護】
--   redeem_reward 第一步就 select ... from rewards where id = ? for update。
--   同一禮品的所有兌換請求在此排隊（序列化）；排到的人拿到的是「前一位已扣減後」
--   的最新資料列（READ COMMITTED 的 EvalPlanQual 會重讀最新版本），
--   所以「檢查 stock_remaining > 0」與「stock_remaining - 1」之間不可能被插隊，
--   最後一件只會賣出一次。update 另外加 and stock_remaining > 0 作第二道保險。
--
-- 【錯誤碼（本檔新增的，前端要識別）】
--   UNAUTHENTICATED / INVALID_ARGUMENT / FEATURE_OFF / REWARD_INACTIVE /
--   OUT_OF_STOCK / PER_USER_LIMIT / INSUFFICIENT_POINTS / RETRY（極端撞碼請重試）
--   NOT_ADMIN / NOT_FOUND / INVALID_STATUS（管理端）
--   VERIFY_FAILED（籠統）／PIN_INVALID（附 remaining）／PIN_LOCKED（附 locked_until）
--
-- 【⚠️ 上線前必看：rewards_enabled】
--   W1 在 app_settings seed 了 'rewards_enabled' = false（止血開關）。
--   redeem_reward 尊重這個開關：false → 回 {ok:false, code:'FEATURE_OFF'}。
--   已發出的券不受影響（lookup／verify 照常可用）。
--   要開始收單請先執行：
--     update public.app_settings set value = 'true'::jsonb, updated_at = now()
--      where key = 'rewards_enabled';
--
-- 【pgcrypto 在 extensions schema 的情況】
--   本檔所有函式固定 set search_path = public（與 W1 一致），
--   而 Supabase 的 pgcrypto 通常裝在 extensions schema，
--   此時函式體內直接寫 crypt(...) 會在 runtime 找不到函式。
--   解法：STEP 3 建三個 public 內部封裝（msw_random_bytes／msw_gen_salt／msw_crypt），
--   執行時查 pg_extension 解析 pgcrypto 真正的 schema，再用動態 SQL 呼叫。
--   兩邊（public／extensions）都能跑，且不把 extensions 放進 search_path。
-- =============================================================


-- ------------------------------------------------------------
-- STEP 1：前置檢查（缺東西就即刻 raise，唔好等到 runtime 才炸）
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.rewards') is null
     or to_regclass('public.reward_redemptions') is null
     or to_regclass('public.merchants') is null then
    raise exception '找不到 rewards / reward_redemptions / merchants，請先執行 migration-points-r1-1-schema.sql';
  end if;

  if to_regprocedure('public.credit_points(uuid, integer, text, text, uuid)') is null then
    raise exception '找不到 public.credit_points，請先執行 migration-points-r1-2-earn.sql';
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception '找不到 public.is_admin()，資料庫狀態異常';
  end if;

  if to_regclass('public.admin_audit_log') is null then
    raise exception '找不到 public.admin_audit_log，請先執行 migration-audit-log.sql';
  end if;
end;
$$;

do $$ begin raise notice 'STEP 1 OK — 前置物件齊（三張表 + credit_points + is_admin + audit）'; end $$;


-- ------------------------------------------------------------
-- STEP 2：結構補丁與索引
--   ① expires_at：券有效期 90 天。W1 沒有這一欄，本檔補上。
--      注意：add column 帶 volatile default 會重寫整張表，
--      既有（W1 之後已產生）的券會一併拿到「今天 + 90 天」，
--      對尚未上線的 R1 來說可接受（現階段通常 0 列）。
--   ② 兩個 partial unique index：只對非 null 值生效。
--   ③ (status, created_at desc)：後台兌換列表的固定查詢。
-- ------------------------------------------------------------
alter table public.reward_redemptions
  add column if not exists expires_at timestamptz not null
  default (now() + interval '90 days');

comment on column public.reward_redemptions.expires_at is
  '電子券到期時間（兌換當下 +90 天，W2 寫入）。過期後 lookup／verify 一律 VERIFY_FAILED。';

-- ⚠️ W1 已建過 uq_reward_redemptions_pickup_code / uq_reward_redemptions_idem，
--    下面兩個是「同欄位的第二個 unique index」，功能上重複（Postgres 允許）。
--    保留是為了讓本檔自帶完整防護；想省寫入成本可事後執行：
--      drop index if exists public.uq_reward_redemptions_pickup_code;
--      drop index if exists public.uq_reward_redemptions_idem;
--    （兩個都係 unique，刪任何一個都唔會失去約束。）
create unique index if not exists uq_redemption_code
  on public.reward_redemptions (pickup_code)
  where pickup_code is not null;

create unique index if not exists uq_redemption_idem
  on public.reward_redemptions (user_id, idempotency_key)
  where idempotency_key is not null;

-- (status, created_at desc)：W1 已有同名索引，這裡是 no-op；缺了才補。
create index if not exists idx_reward_redemptions_status_created
  on public.reward_redemptions (status, created_at desc);

-- 後台「待審批」與「某商戶的待核銷」都需要，補一個 (merchant_id, status)。
create index if not exists idx_reward_redemptions_merchant_status
  on public.reward_redemptions (merchant_id, status);

do $$ begin raise notice 'STEP 2 OK — expires_at + 3 個索引（2 unique partial）'; end $$;


-- ------------------------------------------------------------
-- STEP 3：pgcrypto 內部封裝（動態解析 schema；不對外開放）
--   為什麼不直接寫 crypt()：函式是 set search_path = public，
--   若 pgcrypto 在 extensions schema，crypt 在 runtime 解析不到。
--   這三支只給本檔其他 definer 函式內部呼叫，全部 revoke。
-- ------------------------------------------------------------
create or replace function public.msw_random_bytes(p_len integer)
returns bytea
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schema text;
  v_out    bytea;
begin
  select n.nspname
    into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  v_schema := coalesce(v_schema, 'public');

  execute format('select %I.gen_random_bytes($1)', v_schema)
     into v_out
    using greatest(coalesce(p_len, 1), 1);

  return v_out;
end;
$$;

comment on function public.msw_random_bytes(integer) is
  '內部：CSPRNG 隨機位元組，自動解析 pgcrypto 所在 schema（public 或 extensions）。';

create or replace function public.msw_gen_salt(p_rounds integer default 12)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schema text;
  v_out    text;
begin
  select n.nspname
    into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  v_schema := coalesce(v_schema, 'public');

  -- bcrypt cost 夾在 4–31（Postgres bcrypt 上限 31，我們固定用 12）
  execute format('select %I.gen_salt($1, $2)', v_schema)
     into v_out
    using 'bf'::text, greatest(least(coalesce(p_rounds, 12), 31), 4);

  return v_out;
end;
$$;

comment on function public.msw_gen_salt(integer) is
  '內部：bcrypt salt（預設 cost 12），自動解析 pgcrypto 所在 schema。';

create or replace function public.msw_crypt(p_plain text, p_salt_or_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schema text;
  v_out    text;
begin
  if p_plain is null or p_salt_or_hash is null then
    return null;
  end if;

  select n.nspname
    into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  v_schema := coalesce(v_schema, 'public');

  execute format('select %I.crypt($1, $2)', v_schema)
     into v_out
    using p_plain, p_salt_or_hash;

  return v_out;
end;
$$;

comment on function public.msw_crypt(text, text) is
  '內部：crypt(明文, salt 或 hash)，自動解析 pgcrypto 所在 schema；參數有 null 回 null。';

revoke all on function public.msw_random_bytes(integer) from public, anon, authenticated;
revoke all on function public.msw_gen_salt(integer) from public, anon, authenticated;
revoke all on function public.msw_crypt(text, text) from public, anon, authenticated;

do $$ begin raise notice 'STEP 3 OK — pgcrypto 封裝（msw_random_bytes / msw_gen_salt / msw_crypt）'; end $$;


-- ------------------------------------------------------------
-- STEP 4：取貨碼 new_pickup_code()
--   Crockford Base32 大寫 12 位，字母表去掉 0 O 1 I L U（易混淆字元）：
--     23456789ABCDEFGHJKMNPQRSTVWXYZ（32 個）
--   每個位元組 mod 32 —— 256 = 32 × 8，整除，所以無 modulo bias。
--   熵：32^12 = 2^60 ≈ 1.15e18（舊 gen_coupon_code 遠不及）。
--   碰撞仍檢查一次（機率可忽略，但代價是一條 index lookup）。
--   內部函式，revoke 全部；只有本檔的 definer 函式會呼叫。
-- ------------------------------------------------------------
create or replace function public.new_pickup_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea;
  v_code     text;
  v_i        integer;
  v_try      integer := 0;
  v_dup      boolean;
begin
  loop
    v_try  := v_try + 1;
    v_bytes := public.msw_random_bytes(12);
    v_code  := '';

    for v_i in 0..11 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_i) % 32) + 1, 1);
    end loop;

    v_dup := exists (
      select 1 from public.reward_redemptions r where r.pickup_code = v_code
    );

    exit when not v_dup;

    if v_try >= 20 then
      raise exception 'new_pickup_code: 連續 20 次撞碼，請檢查隨機源是否正常';
    end if;
  end loop;

  return v_code;
end;
$$;

comment on function public.new_pickup_code() is
  '取貨碼產生器（內部）：Crockford Base32 大寫 12 位（去 0 O 1 I L U），gen_random_bytes 產生，熵 2^60。';

revoke all on function public.new_pickup_code() from public, anon, authenticated;

do $$ begin raise notice 'STEP 4 OK — new_pickup_code'; end $$;


-- ------------------------------------------------------------
-- STEP 5：redeem_reward — 兌換（會員可呼叫，只為自己兌換）
--   · 不收 p_user_id，一律 auth.uid()
--   · 冪等：p_idempotency_key 必填（16–64），(user_id, key) unique；
--     同 key 重打回原結果（duplicate:true），且必定比對 user_id
--   · 7 日審批閘：profiles.created_at > now() - interval '7 days'
--     → status='pending_approval'（分照扣，券未生效）
--   · 鎖序：reward → profile → redemption
--   · 回傳：{ok:true, code, status, points_balance, expires_at}
--           {ok:true, duplicate:true, code, status, expires_at}
--           {ok:false, code:...}
-- ------------------------------------------------------------
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

do $$ begin raise notice 'STEP 5 OK — redeem_reward'; end $$;


-- ------------------------------------------------------------
-- STEP 6：admin_review_redemption — 新會員兌換審批
--   · 只處理 pending_approval
--   · approved → pending（券生效）
--   · rejected → cancelled + 退分 + 回庫存
--   · 鎖序同 redeem_reward：reward → profile → redemption
--     （先無鎖讀 reward_id，再按序取鎖；兩支都同序 → 不會死鎖）
-- ------------------------------------------------------------
create or replace function public.admin_review_redemption(
  p_id       uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_row      public.reward_redemptions%rowtype;
  v_reward   public.rewards%rowtype;
  v_reward_id uuid;
  v_user_id   uuid;
  v_dummy     uuid;
  v_status    text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if v_decision not in ('approved', 'rejected') then
    return jsonb_build_object(
      'ok', false, 'code', 'INVALID_ARGUMENT',
      'detail', 'p_decision 只准 approved / rejected'
    );
  end if;

  -- 先無鎖讀出 reward_id / user_id，只是為了決定鎖的目標
  select r.reward_id, r.user_id
    into v_reward_id, v_user_id
    from public.reward_redemptions r
   where r.id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- 鎖 1：reward
  select * into v_reward
    from public.rewards w
   where w.id = v_reward_id
   for update;

  -- 鎖 2：profile
  select p.id into v_dummy
    from public.profiles p
   where p.id = v_user_id
   for update;

  -- 鎖 3：redemption（鎖內重讀狀態，防兩個管理員同時操作）
  select * into v_row
    from public.reward_redemptions r
   where r.id = p_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.status <> 'pending_approval' then
    return jsonb_build_object(
      'ok', false, 'code', 'INVALID_STATUS', 'status', v_row.status
    );
  end if;

  if v_decision = 'approved' then
    update public.reward_redemptions r
       set status     = 'pending',
           decided_by = auth.uid(),
           decided_at = now()
     where r.id = p_id;

    v_status := 'pending';
  else
    update public.reward_redemptions r
       set status     = 'cancelled',
           decided_by = auth.uid(),
           decided_at = now()
     where r.id = p_id;

    -- 退分（ref_type='refund'，ref_id=原兌換 id；unique index 天然防重複退款）
    perform public.credit_points(
      v_row.user_id,
      v_row.points_spent,
      '退款：' || v_reward.name,
      'refund',
      v_row.id
    );

    -- 回庫存（不限量禮品 stock_remaining 為 null，不回補）
    if v_reward.stock_remaining is not null then
      update public.rewards w
         set stock_remaining = w.stock_remaining + 1,
             updated_at      = now()
       where w.id = v_reward.id;
    end if;

    v_status := 'cancelled';
  end if;

  insert into public.admin_audit_log (actor_id, module, action, summary)
  values (
    auth.uid(),
    'redemptions',
    'review',
    '審批兌換 ' || v_decision || '：券 …' || right(coalesce(v_row.pickup_code, '????'), 4)
      || '（' || coalesce(v_reward.name, '?') || '）'
  );

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

comment on function public.admin_review_redemption(uuid, text) is
  '新會員兌換審批（管理員）：只處理 pending_approval；approved → pending；'
  'rejected → cancelled + 退分（ref_type=refund）+ 回庫存；寫 decided_by/decided_at 與 audit。';

revoke all on function public.admin_review_redemption(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_review_redemption(uuid, text) to authenticated;

do $$ begin raise notice 'STEP 6 OK — admin_review_redemption'; end $$;


-- ------------------------------------------------------------
-- STEP 7：admin_fulfill_redemption — 後備核銷（現場冇網絡／會員冇帶電話）
--   · 只准 pending 起跳；pending_approval 一律走 admin_review_redemption
--   · completed：只改狀態（單向，不退款）
--   · cancelled：退分 + 回庫存
--   · 鎖序同 STEP 5／6
-- ------------------------------------------------------------
create or replace function public.admin_fulfill_redemption(
  p_id     uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action    text := lower(btrim(coalesce(p_action, '')));
  v_row       public.reward_redemptions%rowtype;
  v_reward    public.rewards%rowtype;
  v_reward_id uuid;
  v_user_id   uuid;
  v_dummy     uuid;
  v_status    text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if v_action not in ('completed', 'cancelled') then
    return jsonb_build_object(
      'ok', false, 'code', 'INVALID_ARGUMENT',
      'detail', 'p_action 只准 completed / cancelled（ready 已廢除）'
    );
  end if;

  select r.reward_id, r.user_id
    into v_reward_id, v_user_id
    from public.reward_redemptions r
   where r.id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select * into v_reward
    from public.rewards w
   where w.id = v_reward_id
   for update;

  select p.id into v_dummy
    from public.profiles p
   where p.id = v_user_id
   for update;

  select * into v_row
    from public.reward_redemptions r
   where r.id = p_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object(
      'ok', false, 'code', 'INVALID_STATUS', 'status', v_row.status
    );
  end if;

  if v_action = 'completed' then
    update public.reward_redemptions r
       set status       = 'completed',
           redeemed_via = 'admin'
     where r.id = p_id;

    v_status := 'completed';
  else
    update public.reward_redemptions r
       set status       = 'cancelled',
           redeemed_via = 'admin'
     where r.id = p_id;

    perform public.credit_points(
      v_row.user_id,
      v_row.points_spent,
      '退款：' || v_reward.name,
      'refund',
      v_row.id
    );

    if v_reward.stock_remaining is not null then
      update public.rewards w
         set stock_remaining = w.stock_remaining + 1,
             updated_at      = now()
       where w.id = v_reward.id;
    end if;

    v_status := 'cancelled';
  end if;

  insert into public.admin_audit_log (actor_id, module, action, summary)
  values (
    auth.uid(),
    'redemptions',
    'fulfill',
    '後備核銷 ' || v_action || '：券 …' || right(coalesce(v_row.pickup_code, '????'), 4)
      || '（' || coalesce(v_reward.name, '?') || '）'
  );

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

comment on function public.admin_fulfill_redemption(uuid, text) is
  '後備核銷（管理員）：只准 pending → completed / cancelled；'
  'cancelled 退分（ref_type=refund）+ 回庫存；pending_approval 不走這支。';

revoke all on function public.admin_fulfill_redemption(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_fulfill_redemption(uuid, text) to authenticated;

do $$ begin raise notice 'STEP 7 OK — admin_fulfill_redemption'; end $$;


-- ------------------------------------------------------------
-- STEP 8：merchant_verify_lookup — 公開驗證（入 PIN 前）
--   錯誤一律籠統：valid / invalid 二元，絕不區分「已用／不存在／未生效／被鎖」
--   （防枚舉 code）。
--   只回 reward / merchant / member_masked；絕不回積分、電話、全名、user_id。
--   member_masked：顯示名第一個字 + ＊＊
-- ------------------------------------------------------------
create or replace function public.merchant_verify_lookup(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code      text := upper(btrim(coalesce(p_code, '')));
  v_row       public.reward_redemptions%rowtype;
  v_reward    text;
  v_merchant  text;
  v_masked    text;
  v_m_reset   boolean;
  v_m_expires timestamptz;
  v_m_hash    text;
  v_m_status  text;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  select * into v_row
    from public.reward_redemptions r
   where r.pickup_code = v_code;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  -- 狀態非 pending（pending_approval / completed / cancelled 一律無效）
  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  -- 券過期
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  -- 被鎖（15 分鐘）
  if v_row.pin_locked_until is not null and v_row.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  select w.name into v_reward
    from public.rewards w
   where w.id = v_row.reward_id;

  select m.name, m.must_reset, m.pin_expires_at, m.pin_hash, m.status
    into v_merchant, v_m_reset, v_m_expires, v_m_hash, v_m_status
    from public.merchants m
   where m.id = v_row.merchant_id;

  -- 核銷方未就緒（seed 佔位 PIN / 未設 PIN / PIN 過期 / 已停用）→ 一律無效
  if v_merchant is null
     or v_m_status is distinct from 'active'
     or coalesce(v_m_reset, true)
     or v_m_hash is null
     or (v_m_expires is not null and v_m_expires <= now()) then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  select left(coalesce(nullif(btrim(p.display_name), ''), '＊'), 1) || '＊＊'
    into v_masked
    from public.profiles p
   where p.id = v_row.user_id;

  return jsonb_build_object(
    'ok', true,
    'reward', v_reward,
    'merchant', v_merchant,
    'member_masked', coalesce(v_masked, '＊＊')
  );
end;
$$;

comment on function public.merchant_verify_lookup(text) is
  '公開驗證（免登入）：只回 {ok:true,reward,merchant,member_masked} 或 {ok:false,code:VERIFY_FAILED}；'
  '錯誤籠統不區分原因（防枚舉），絕不回積分／電話／全名／user_id。';

revoke all on function public.merchant_verify_lookup(text) from public, anon, authenticated;
grant execute on function public.merchant_verify_lookup(text) to anon, authenticated;

do $$ begin raise notice 'STEP 8 OK — merchant_verify_lookup'; end $$;


-- ------------------------------------------------------------
-- STEP 9：merchant_verify_redeem — 公開核銷（一次性）
--   · 先做與 lookup 完全相同的有效性檢查；code 有效時才可回
--     PIN_INVALID（附 remaining）／PIN_LOCKED（附 locked_until）
--   · 用該券快照的 merchant_id 取 pin_hash，crypt(p_pin, hash) = hash
--   · 錯 5 次 → 鎖該券 15 分鐘、計數歸零（只鎖該券，不影響同商戶其他券）
--   · 先更新計數，再寫 audit；audit 用 exception 包住，
--     絕不可因寫日誌失敗而回滾計數（否則計數可被「打爆 audit」重置）
--   · audit 只寫券碼後 4 位，絕不寫 PIN
-- ------------------------------------------------------------
create or replace function public.merchant_verify_redeem(
  p_code text,
  p_pin  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      text := upper(btrim(coalesce(p_code, '')));
  v_pin       text := btrim(coalesce(p_pin, ''));
  v_row       public.reward_redemptions%rowtype;
  v_reward    text;
  v_merchant  text;
  v_masked    text;
  v_m_reset   boolean;
  v_m_expires timestamptz;
  v_m_hash    text;
  v_m_status  text;
  v_attempts  integer;
  v_remaining integer;
  v_at        timestamptz;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  -- 鎖定該券（一次性核銷的關鍵：所有檢查與寫入都在同一把行鎖內）
  select * into v_row
    from public.reward_redemptions r
   where r.pickup_code = v_code
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  -- 被鎖：code 本身有效，只係暫時唔准試 PIN → 可以明確回 PIN_LOCKED
  if v_row.pin_locked_until is not null and v_row.pin_locked_until > now() then
    return jsonb_build_object(
      'ok', false, 'code', 'PIN_LOCKED', 'locked_until', v_row.pin_locked_until
    );
  end if;

  select w.name into v_reward
    from public.rewards w
   where w.id = v_row.reward_id;

  select m.name, m.must_reset, m.pin_expires_at, m.pin_hash, m.status
    into v_merchant, v_m_reset, v_m_expires, v_m_hash, v_m_status
    from public.merchants m
   where m.id = v_row.merchant_id;

  if v_merchant is null
     or v_m_status is distinct from 'active'
     or coalesce(v_m_reset, true)
     or v_m_hash is null
     or (v_m_expires is not null and v_m_expires <= now()) then
    return jsonb_build_object('ok', false, 'code', 'VERIFY_FAILED');
  end if;

  select left(coalesce(nullif(btrim(p.display_name), ''), '＊'), 1) || '＊＊'
    into v_masked
    from public.profiles p
   where p.id = v_row.user_id;

  v_masked := coalesce(v_masked, '＊＊');

  -- 格式錯誤不計次數（6 位數字以外不可能是正確 PIN，屬客戶端問題）
  if v_pin !~ '^[0-9]{6}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'PIN_INVALID',
      'remaining', greatest(5 - coalesce(v_row.pin_failed_attempts, 0), 0)
    );
  end if;

  -- ---------- PIN 正確 → 一次性核銷 ----------
  if public.msw_crypt(v_pin, v_m_hash) = v_m_hash then
    v_at := now();

    update public.reward_redemptions r
       set status               = 'completed',
           redeemed_via         = 'merchant_page',
           merchant_verified_at = v_at,
           pin_failed_attempts  = 0,
           pin_locked_until     = null
     where r.id = v_row.id;

    begin
      insert into public.admin_audit_log (actor_id, module, action, summary)
      values (
        auth.uid(),
        'merchant-verify',
        'redeem',
        '核銷成功：券 …' || right(v_code, 4) || '（' || coalesce(v_reward, '?')
          || '／' || coalesce(v_merchant, '?') || '）'
      );
    exception when others then
      null;  -- 日誌失敗不可令已核銷的券回滾
    end;

    return jsonb_build_object(
      'ok', true,
      'reward', v_reward,
      'merchant', v_merchant,
      'member_masked', v_masked,
      'at', v_at
    );
  end if;

  -- ---------- PIN 錯誤 → 先更新計數（外層交易），再寫 audit（可失敗） ----------
  v_attempts := coalesce(v_row.pin_failed_attempts, 0) + 1;

  if v_attempts >= 5 then
    update public.reward_redemptions r
       set pin_failed_attempts = 0,
           pin_locked_until    = now() + interval '15 minutes'
     where r.id = v_row.id;

    v_remaining := 0;
  else
    update public.reward_redemptions r
       set pin_failed_attempts = v_attempts
     where r.id = v_row.id;

    v_remaining := 5 - v_attempts;
  end if;

  begin
    insert into public.admin_audit_log (actor_id, module, action, summary)
    values (
      auth.uid(),
      'merchant-verify',
      'pin_fail',
      'PIN 驗證失敗：券 …' || right(v_code, 4) || '（第 ' || v_attempts || ' 次）'
    );
  exception when others then
    null;  -- 關鍵：絕不可讓 audit 失敗回滾上面的計數
  end;

  if v_attempts >= 5 then
    return jsonb_build_object('ok', false, 'code', 'PIN_LOCKED', 'remaining', 0);
  end if;

  return jsonb_build_object(
    'ok', false, 'code', 'PIN_INVALID', 'remaining', v_remaining
  );
end;
$$;

comment on function public.merchant_verify_redeem(text, text) is
  '公開核銷（免登入，一次性）：驗證該券所屬商戶的 6 位 PIN（bcrypt）；'
  '錯 5 次鎖該券 15 分鐘；成功 → completed + redeemed_via=merchant_page + merchant_verified_at；'
  '錯誤籠統（VERIFY_FAILED），只有 code 有效時才回 PIN_INVALID/PIN_LOCKED；audit 絕不寫 PIN。';

revoke all on function public.merchant_verify_redeem(text, text) from public, anon, authenticated;
grant execute on function public.merchant_verify_redeem(text, text) to anon, authenticated;

do $$ begin raise notice 'STEP 9 OK — merchant_verify_redeem（含速率限制）'; end $$;


-- ------------------------------------------------------------
-- STEP 10：merchant_public_list — /rewards 顯示核銷方名（不直讀 merchants）
--   只回 active 的 id / name；不含 pin_hash / contact_note / 狀態。
-- ------------------------------------------------------------
create or replace function public.merchant_public_list()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.name
    from public.merchants m
   where m.status = 'active'
   order by m.created_at, m.name;
$$;

comment on function public.merchant_public_list() is
  '公開商戶列表（免登入）：只回 status=active 的 id/name，供 /rewards 顯示核銷方；不含 pin_hash。';

revoke all on function public.merchant_public_list() from public, anon, authenticated;
grant execute on function public.merchant_public_list() to anon, authenticated;

do $$ begin raise notice 'STEP 10 OK — merchant_public_list'; end $$;


-- ------------------------------------------------------------
-- STEP 11：商戶 PIN 產生／重設
--   · PIN：6 位數字（000000–999999，前導零保留）、CSPRNG（gen_random_bytes）
--   · DB 只存 bcrypt hash（cost 12）；明文只回傳這一次
--   · 重設後：must_reset=false、pin_expires_at = now() + p_valid_days 天、
--     該商戶名下券的 pin_failed_attempts 歸零、解鎖（舊 PIN 已作廢，舊鎖無意義）
--   · 內部共用 msw_issue_merchant_pin，兩支對外函式只差 audit action
-- ------------------------------------------------------------
create or replace function public.msw_issue_merchant_pin(
  p_merchant_id uuid,
  p_valid_days  integer,
  p_action      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days    integer := greatest(least(coalesce(p_valid_days, 90), 3650), 1);
  v_name    text;
  v_bytes   bytea;
  v_num     bigint;
  v_pin     text;
  v_salt    text;
  v_hash    text;
  v_expires timestamptz;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select m.name into v_name
    from public.merchants m
   where m.id = p_merchant_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- CSPRNG：4 bytes = 32 bit，mod 1e6，前導零保留（lpad 到 6 位）
  v_bytes := public.msw_random_bytes(4);
  v_num   := get_byte(v_bytes, 0)::bigint * 16777216
           + get_byte(v_bytes, 1)::bigint * 65536
           + get_byte(v_bytes, 2)::bigint * 256
           + get_byte(v_bytes, 3)::bigint;

  v_pin     := lpad((v_num % 1000000)::text, 6, '0');
  v_salt    := public.msw_gen_salt(12);
  v_hash    := public.msw_crypt(v_pin, v_salt);
  v_expires := now() + (v_days || ' days')::interval;

  update public.merchants m
     set pin_hash       = v_hash,
         must_reset     = false,
         pin_valid_days = v_days,
         pin_expires_at = v_expires
   where m.id = p_merchant_id;

  -- 舊 PIN 即刻失效 → 該商戶名下已鎖定的券一併解鎖、計數歸零
  update public.reward_redemptions r
     set pin_failed_attempts = 0,
         pin_locked_until    = null
   where r.merchant_id = p_merchant_id
     and (r.pin_failed_attempts > 0 or r.pin_locked_until is not null);

  insert into public.admin_audit_log (actor_id, module, action, summary)
  values (
    auth.uid(),
    'merchants',
    left(coalesce(p_action, 'pin_generate'), 20),
    (case when p_action = 'pin_reset' then '重設' else '產生' end)
      || '核銷 PIN：' || coalesce(v_name, '?') || '（有效期 ' || v_days || ' 天）'
  );

  return jsonb_build_object('ok', true, 'pin', v_pin, 'expires_at', v_expires);
end;
$$;

comment on function public.msw_issue_merchant_pin(uuid, integer, text) is
  '內部：產生／重設商戶 6 位 PIN（bcrypt cost 12），明文只回傳一次；'
  '同步解鎖該商戶名下已鎖定的券並歸零計數。';

create or replace function public.admin_generate_merchant_pin(
  p_merchant_id uuid,
  p_valid_days  integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return public.msw_issue_merchant_pin(p_merchant_id, p_valid_days, 'pin_generate');
end;
$$;

comment on function public.admin_generate_merchant_pin(uuid, integer) is
  '產生商戶 6 位 PIN（管理員）：回 {ok:true,pin,expires_at}，明文只此一次；DB 只存 bcrypt hash；must_reset→false。';

create or replace function public.admin_reset_merchant_pin(
  p_merchant_id uuid,
  p_valid_days  integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return public.msw_issue_merchant_pin(p_merchant_id, p_valid_days, 'pin_reset');
end;
$$;

comment on function public.admin_reset_merchant_pin(uuid, integer) is
  '重設商戶 6 位 PIN（管理員）：舊 PIN 即時失效，回 {ok:true,pin,expires_at}（明文只此一次）；'
  'must_reset→false、pin_expires_at=now()+p_valid_days、失敗計數歸零。';

revoke all on function public.msw_issue_merchant_pin(uuid, integer, text) from public, anon, authenticated;

revoke all on function public.admin_generate_merchant_pin(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_generate_merchant_pin(uuid, integer) to authenticated;

revoke all on function public.admin_reset_merchant_pin(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_reset_merchant_pin(uuid, integer) to authenticated;

do $$ begin raise notice 'STEP 11 OK — admin_generate_merchant_pin / admin_reset_merchant_pin'; end $$;


-- ------------------------------------------------------------
-- STEP 12：ACL 總表（第二道防手滑）
--   Supabase 預設把 EXECUTE 給 PUBLIC → 每支都要先 revoke 再按需 grant。
--   公開（anon 可叫）：merchant_verify_lookup / merchant_verify_redeem /
--                     merchant_public_list
--   會員：redeem_reward
--   管理員：admin_*（函式內建 is_admin）
--   內部：new_pickup_code / msw_* 全部 revoke
-- ------------------------------------------------------------
revoke all on function public.new_pickup_code() from public;
revoke all on function public.new_pickup_code() from anon;
revoke all on function public.new_pickup_code() from authenticated;

revoke all on function public.msw_random_bytes(integer) from public;
revoke all on function public.msw_random_bytes(integer) from anon;
revoke all on function public.msw_random_bytes(integer) from authenticated;

revoke all on function public.msw_gen_salt(integer) from public;
revoke all on function public.msw_gen_salt(integer) from anon;
revoke all on function public.msw_gen_salt(integer) from authenticated;

revoke all on function public.msw_crypt(text, text) from public;
revoke all on function public.msw_crypt(text, text) from anon;
revoke all on function public.msw_crypt(text, text) from authenticated;

revoke all on function public.msw_issue_merchant_pin(uuid, integer, text) from public;
revoke all on function public.msw_issue_merchant_pin(uuid, integer, text) from anon;
revoke all on function public.msw_issue_merchant_pin(uuid, integer, text) from authenticated;

revoke all on function public.redeem_reward(uuid, text) from public;
revoke all on function public.redeem_reward(uuid, text) from anon;
grant  execute on function public.redeem_reward(uuid, text) to authenticated;

revoke all on function public.admin_review_redemption(uuid, text) from public;
revoke all on function public.admin_review_redemption(uuid, text) from anon;
grant  execute on function public.admin_review_redemption(uuid, text) to authenticated;

revoke all on function public.admin_fulfill_redemption(uuid, text) from public;
revoke all on function public.admin_fulfill_redemption(uuid, text) from anon;
grant  execute on function public.admin_fulfill_redemption(uuid, text) to authenticated;

revoke all on function public.merchant_verify_lookup(text) from public;
grant  execute on function public.merchant_verify_lookup(text) to anon, authenticated;

revoke all on function public.merchant_verify_redeem(text, text) from public;
grant  execute on function public.merchant_verify_redeem(text, text) to anon, authenticated;

revoke all on function public.merchant_public_list() from public;
grant  execute on function public.merchant_public_list() to anon, authenticated;

revoke all on function public.admin_generate_merchant_pin(uuid, integer) from public;
revoke all on function public.admin_generate_merchant_pin(uuid, integer) from anon;
grant  execute on function public.admin_generate_merchant_pin(uuid, integer) to authenticated;

revoke all on function public.admin_reset_merchant_pin(uuid, integer) from public;
revoke all on function public.admin_reset_merchant_pin(uuid, integer) from anon;
grant  execute on function public.admin_reset_merchant_pin(uuid, integer) to authenticated;

do $$ begin raise notice 'STEP 12 OK — ACL（revoke public/anon，按需 grant）'; end $$;


-- =============================================================
-- 執行後驗證（在 SQL Editor 逐段執行；預期結果寫在 → 後面）
-- =============================================================
--
-- ① 函式清單（→ 12 列；prosecdef 全 true，除 merchant_public_list 可為 true/false）
-- select p.proname,
--        p.prosecdef,
--        pg_get_function_identity_arguments(p.oid) as args,
--        pg_get_function_result(p.oid)             as ret
--   from pg_proc p
--  where p.pronamespace = 'public'::regnamespace
--    and p.proname in ('new_pickup_code','redeem_reward','admin_review_redemption',
--                      'admin_fulfill_redemption','merchant_verify_lookup',
--                      'merchant_verify_redeem','merchant_public_list',
--                      'admin_generate_merchant_pin','admin_reset_merchant_pin',
--                      'msw_random_bytes','msw_gen_salt','msw_crypt',
--                      'msw_issue_merchant_pin')
--  order by p.proname;
--
-- ② ACL 表（→ 只有 merchant_verify_* / merchant_public_list 的 anon_can 為 true）
-- select p.proname,
--        has_function_privilege('anon',          p.oid, 'execute') as anon_can,
--        has_function_privilege('authenticated', p.oid, 'execute') as auth_can
--   from pg_proc p
--  where p.pronamespace = 'public'::regnamespace
--    and p.proname in ('new_pickup_code','redeem_reward','admin_review_redemption',
--                      'admin_fulfill_redemption','merchant_verify_lookup',
--                      'merchant_verify_redeem','merchant_public_list',
--                      'admin_generate_merchant_pin','admin_reset_merchant_pin')
--  order by p.proname;
--   → anon_can：merchant_verify_lookup / merchant_verify_redeem / merchant_public_list = true，
--               其餘全 false
--   → auth_can：除 new_pickup_code 外全 true
--
-- ③ 結構補丁（→ 兩列 expires_at / 三個索引）
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'reward_redemptions'
--    and column_name = 'expires_at';
--
-- select indexname from pg_indexes
--  where schemaname = 'public' and tablename = 'reward_redemptions'
--    and indexname in ('uq_redemption_code','uq_redemption_idem',
--                      'idx_reward_redemptions_status_created',
--                      'idx_reward_redemptions_merchant_status');
--
-- ④ 取貨碼產生器（→ 12 位，只含 23456789ABCDEFGHJKMNPQRSTVWXYZ）
-- select public.new_pickup_code();
--
-- ⑤ 商戶 PIN（→ 6 位數字 + 到期時間；記下 pin，下一步要用）
-- select public.admin_generate_merchant_pin(
--          (select id from public.merchants where name = 'Metal Gym Room')
--        );
--
-- ⑥ 兩個種子券的快速測試
--    注意：redeem_reward 需要 JWT（auth.uid()），SQL Editor 跑不到（會回 UNAUTHENTICATED）。
--    在 SQL Editor 直接 insert 兩張券，只測「公開驗證」這一條路徑：
--
--    -- 6-1 準備：挑一個會員、一個 active 禮品
--    -- select id, display_name from public.profiles limit 1;
--    -- select id, name, status, merchant_id from public.rewards where status = 'active' limit 1;
--
--    -- 6-2 種子券 A：正常 pending（應該 valid → 可用 PIN 核銷）
--    -- insert into public.reward_redemptions
--    --   (user_id, reward_id, points_spent, status, pickup_code, merchant_id, expires_at)
--    -- select '<會員uuid>', '<禮品uuid>', 0, 'pending',
--    --        public.new_pickup_code(), r.merchant_id, now() + interval '90 days'
--    --   from public.rewards r where r.id = '<禮品uuid>'
--    -- returning id, pickup_code;
--
--    -- 6-3 種子券 B：pending_approval（應該 invalid → VERIFY_FAILED，證明審批閘有效）
--    -- insert into public.reward_redemptions
--    --   (user_id, reward_id, points_spent, status, pickup_code, merchant_id, expires_at)
--    -- select '<會員uuid>', '<禮品uuid>', 0, 'pending_approval',
--    --        public.new_pickup_code(), r.merchant_id, now() + interval '90 days'
--    --   from public.rewards r where r.id = '<禮品uuid>'
--    -- returning id, pickup_code;
--
--    -- 6-4 用 anon key 呼叫（前端 / curl），把 <codeA> / <codeB> / <pin> 換掉：
--    --   POST /rest/v1/rpc/merchant_verify_lookup  {"p_code":"<codeA>"}
--    --     → {"ok":true,"reward":"...","merchant":"...","member_masked":"X＊＊"}
--    --   POST /rest/v1/rpc/merchant_verify_lookup  {"p_code":"<codeB>"}
--    --     → {"ok":false,"code":"VERIFY_FAILED"}          ← 審批閘生效
--    --   POST /rest/v1/rpc/merchant_verify_redeem  {"p_code":"<codeA>","p_pin":"000000"}
--    --     → {"ok":false,"code":"PIN_INVALID","remaining":4}
--    --   POST /rest/v1/rpc/merchant_verify_redeem  {"p_code":"<codeA>","p_pin":"<pin>"}
--    --     → {"ok":true,"reward":"...","merchant":"...","member_masked":"X＊＊","at":"..."}
--    --   POST /rest/v1/rpc/merchant_verify_redeem  {"p_code":"<codeA>","p_pin":"<pin>"}
--    --     → {"ok":false,"code":"VERIFY_FAILED"}          ← 第二次必拒（一次性）
--
-- ⑦ 速率限制（→ 連錯 5 次後 code=PIN_LOCKED；同商戶其他券照常 valid）
--    -- select pin_failed_attempts, pin_locked_until from public.reward_redemptions
--    --  where pickup_code = '<codeA>';
--    -- 手動解鎖（測試用）：update public.reward_redemptions
--    --   set pin_failed_attempts = 0, pin_locked_until = null where pickup_code = '<codeA>';
--
-- ⑧ 審批流程（管理員 JWT，從 /admin/redemptions 或 API）
--    -- select public.admin_review_redemption('<種子券B id>', 'approved');  → {"ok":true,"status":"pending"}
--    -- 之後 6-4 的 lookup 對 <codeB> 應變 valid
--    -- 再打 rejected（另一張 pending_approval）→ status=cancelled，且
--    --   select * from public.point_transactions where ref_type='refund' and ref_id='<id>' → 一筆正數
--
-- ⑨ 上線前最後一步（見檔頭說明）
--    -- update public.app_settings set value = 'true'::jsonb, updated_at = now()
--    --  where key = 'rewards_enabled';
-- =============================================================
