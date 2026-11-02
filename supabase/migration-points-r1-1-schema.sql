-- =============================================================
-- MSW 街健館 — 積分換領系統 R1（W1／第 1 支）
-- 檔名：migration-points-r1-1-schema.sql
-- 內容：pgcrypto、三張新表（merchants / rewards / reward_redemptions）、
--       索引與防重唯一索引、RLS、11 個積分規則 settings、2 筆商戶 seed、
--       guard_profile_sensitive_fields 重新定義（支援 credit_points 旗標）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- 性質：只「新增」表／索引／政策／設定，不改任何既有表的欄位與資料
-- 可重跑：全部 create ... if not exists / create or replace / drop policy if exists
-- 前置條件：profiles.status 與 profiles.status_updated_at 必須存在
--           （由 migration-admin-members-v2.sql 建立；本檔末段會檢查）
-- 下一支：migration-points-r1-2-earn.sql（賺分函式）
-- =============================================================
--
-- 【本檔不做什麼】
--   不改 profiles / point_transactions / app_settings 的「欄位」。
--   不改 add_points、不改 is_admin、不動 RLS 既有政策。
--   point_transactions 只「加索引」，不改定義。
--
-- 【為什麼 profiles 的 guard trigger 要重寫】
--   新增的 credit_points() 是 SECURITY DEFINER、無 is_admin 閘門，
--   它要能更新 profiles.points。但 profiles_guard_sensitive 會把
--   「非管理員」的 points 還原，導致系統發分全部被吃掉。
--   解法：credit_points 在同一個交易內 set_config('app.points_rpc','on',true)，
--   guard 見到旗標就只放行 points，其餘敏感欄位照樣鎖死。
--   旗標是 transaction-local（第三個參數 true），交易結束自動失效，
--   前端無法從 PostgREST 設定它（PostgREST 只接受特定 GUC）。
--
-- 【pgcrypto schema 說明】
--   Supabase 的 pgcrypto 通常裝在 extensions schema，但自建或搬遷過的
--   專案可能在 public。本檔用 DO 區塊動態解析 pgcrypto 所在 schema 並
--   附加到 search_path，因此 crypt()/gen_salt()/gen_random_bytes() 兩種
--   情況都能呼叫，不需要在每一句手寫 extensions. 前綴。
-- =============================================================


-- ------------------------------------------------------------
-- STEP 1：pgcrypto（PIN hash 用；Supabase 預設裝在 extensions schema）
-- ------------------------------------------------------------
create extension if not exists pgcrypto;

do $$
declare
  v_pgcrypto_schema text;
begin
  select n.nspname
    into v_pgcrypto_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto 未安裝成功，請手動執行：create extension pgcrypto;';
  end if;

  -- 只在本次 session 追加，不改資料庫預設值
  perform set_config(
    'search_path',
    current_setting('search_path') || ', ' || quote_ident(v_pgcrypto_schema),
    false
  );

  raise notice 'STEP 1 OK — pgcrypto 位於 schema %', v_pgcrypto_schema;
end;
$$;


-- ------------------------------------------------------------
-- STEP 2：merchants — 核銷商戶（含 MSW 自營）
--   pin_hash 只存 bcrypt hash，永不回傳明文；must_reset=true 期間
--   W2 的 verify／lookup 一律拒絕（本檔只負責欄位與 seed）。
-- ------------------------------------------------------------
create table if not exists public.merchants (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact_note   text,
  pin_hash       text,
  must_reset     boolean not null default false,
  pin_valid_days integer not null default 90,
  pin_expires_at timestamptz,
  status         text not null default 'active'
                 check (status in ('active', 'inactive')),
  created_at     timestamptz not null default now()
);

alter table public.merchants enable row level security;

-- 若前一版草稿已建過 merchants，補上本次新增的兩欄（新表則為 no-op）
alter table public.merchants add column if not exists pin_expires_at timestamptz;
alter table public.merchants add column if not exists pin_valid_days integer not null default 90;

create index if not exists idx_merchants_status on public.merchants (status);

comment on table  public.merchants is '核銷商戶（R1）。MSW 自營亦為一筆商戶，核銷流程完全一致。';
comment on column public.merchants.pin_hash is '6 位 PIN 的 bcrypt hash（pgcrypto crypt/gen_salt）；永不存明文、永不回傳。';
comment on column public.merchants.must_reset is 'true = 尚未設定正式 PIN（seed 佔位），verify／lookup 一律拒絕。';
comment on column public.merchants.pin_valid_days is 'PIN 有效期（日）。重設 PIN 時以 now() + pin_valid_days 計算 pin_expires_at。';
comment on column public.merchants.pin_expires_at is 'PIN 到期時間；null = 不設到期。到期後核銷一律拒絕（W2 判斷）。';

do $$ begin raise notice 'STEP 2 OK — merchants 建立/補欄 + RLS'; end $$;


-- ------------------------------------------------------------
-- STEP 3：rewards — 禮品（per_user_limit 只建一次）
-- ------------------------------------------------------------
create table if not exists public.rewards (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  image_path      text,
  points_cost     integer not null check (points_cost >= 0),
  stock_total     integer,
  stock_remaining integer,
  per_user_limit  integer,
  merchant_id     uuid not null references public.merchants(id) on delete restrict,
  status          text not null default 'active'
                  check (status in ('active', 'inactive')),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.rewards enable row level security;

-- 新表為 no-op；舊草稿缺欄時補回（per_user_limit 只補一次）
alter table public.rewards add column if not exists per_user_limit integer;
alter table public.rewards add column if not exists merchant_id uuid
  references public.merchants(id) on delete restrict;
alter table public.rewards add column if not exists sort_order integer not null default 0;

create index if not exists idx_rewards_status_sort
  on public.rewards (status, sort_order, created_at desc);

create index if not exists idx_rewards_merchant
  on public.rewards (merchant_id);

comment on table  public.rewards is '禮品目錄（R1）。庫存與積分價只准經後台／RPC 改，前端不可直寫。';
comment on column public.rewards.stock_remaining is '剩餘庫存；null = 不限量（電子券），redeem_reward 跳過庫存檢查。';
comment on column public.rewards.per_user_limit is '每人兌換上限；null = 不限。只計 pending／pending_approval／completed。';

do $$ begin raise notice 'STEP 3 OK — rewards 建立/補欄 + RLS'; end $$;


-- ------------------------------------------------------------
-- STEP 4：reward_redemptions — 兌換紀錄／電子券
--   刻意不 cascade：
--     user_id   → profiles(id) on delete restrict（刪號不抹掉審計）
--     reward_id → rewards(id)  on delete restrict（下架用 status=inactive）
--   ⚠️ 副作用：有兌換紀錄的會員，admin_delete_member 會失敗（見施工說明）。
-- ------------------------------------------------------------
create table if not exists public.reward_redemptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete restrict,
  reward_id            uuid not null references public.rewards(id) on delete restrict,
  points_spent         integer not null check (points_spent >= 0),
  status               text not null default 'pending'
                       check (status in ('pending', 'pending_approval', 'completed', 'cancelled')),
  pickup_code          text,
  idempotency_key      text,
  pin_failed_attempts  integer not null default 0,
  pin_locked_until     timestamptz,
  merchant_id          uuid references public.merchants(id) on delete restrict,
  redeemed_via         text check (redeemed_via in ('admin', 'merchant_page')),
  merchant_verified_at timestamptz,
  note                 text,
  decided_by           uuid references public.profiles(id),
  decided_at           timestamptz,
  created_at           timestamptz not null default now()
);

alter table public.reward_redemptions enable row level security;

-- 舊草稿相容：逐欄補齊（新表全部為 no-op）
alter table public.reward_redemptions add column if not exists pickup_code text;
alter table public.reward_redemptions add column if not exists idempotency_key text;
alter table public.reward_redemptions add column if not exists pin_failed_attempts integer not null default 0;
alter table public.reward_redemptions add column if not exists pin_locked_until timestamptz;
alter table public.reward_redemptions add column if not exists merchant_id uuid
  references public.merchants(id) on delete restrict;
alter table public.reward_redemptions add column if not exists redeemed_via text;
alter table public.reward_redemptions add column if not exists decided_by uuid
  references public.profiles(id);
alter table public.reward_redemptions add column if not exists decided_at timestamptz;

comment on table  public.reward_redemptions is '兌換紀錄＝電子券（R1）。一次性核銷；狀態 pending → completed 單向。';
comment on column public.reward_redemptions.pickup_code is '取貨碼：Crockford Base32 大寫 12 位（W2 的 redeem_reward 產生）。';
comment on column public.reward_redemptions.idempotency_key is '前端 UUID v4；(user_id, key) 唯一，重打回原結果不重扣。';
comment on column public.reward_redemptions.pin_failed_attempts is '本券連續錯 PIN 次數；達 5 次鎖 15 分鐘（W2）。';
comment on column public.reward_redemptions.merchant_id is '核銷商戶快照（兌換當時 rewards.merchant_id）。';

do $$ begin raise notice 'STEP 4 OK — reward_redemptions 建立/補欄 + RLS'; end $$;


-- ------------------------------------------------------------
-- STEP 5：索引
-- ------------------------------------------------------------
create unique index if not exists uq_reward_redemptions_pickup_code
  on public.reward_redemptions (pickup_code);

create unique index if not exists uq_reward_redemptions_idem
  on public.reward_redemptions (user_id, idempotency_key);

create index if not exists idx_reward_redemptions_user_status
  on public.reward_redemptions (user_id, status);

create index if not exists idx_reward_redemptions_status_created
  on public.reward_redemptions (status, created_at desc);

create index if not exists idx_reward_redemptions_reward
  on public.reward_redemptions (reward_id);

do $$ begin raise notice 'STEP 5 OK — 5 個索引（2 unique）'; end $$;


-- ------------------------------------------------------------
-- STEP 6：point_transactions 防重唯一索引（不改表定義，只加索引）
--   ① 每日型：每人每日最多一筆（日界線＝Asia/Macau 曆日）
--      daily_login   每日登入
--      login_streak  連續登入獎（每滿 streak_days 天才會嘗試，天然一日一次）
--      birthday      生日（同一年由函式再判，索引只擋同日重複）
--   ② 來源型：每人每個來源記錄最多一筆
--      signup_bonus / event_participation / referral / checkin_bonus / reward / refund
--
--   時間欄位轉換式 (created_at at time zone 'Asia/Macau')::date 是 IMMUTABLE，
--   可以安全用在 expression index。
-- ------------------------------------------------------------
create unique index if not exists uq_point_tx_per_day
  on public.point_transactions (
    user_id,
    ref_type,
    ((created_at at time zone 'Asia/Macau')::date)
  )
  where ref_type in ('daily_login', 'login_streak', 'birthday');

create unique index if not exists uq_point_tx_per_ref
  on public.point_transactions (user_id, ref_type, ref_id)
  where ref_type in ('signup_bonus', 'event_participation', 'referral',
                     'checkin_bonus', 'reward', 'refund');

do $$ begin raise notice 'STEP 6 OK — point_transactions 2 個防重唯一索引'; end $$;


-- ------------------------------------------------------------
-- STEP 7：RLS 政策
--   merchants     ：只有 admin。anon／非 admin 的 authenticated 直讀 → 0 列。
--   rewards       ：authenticated 只讀 status='active'；admin 全權。
--   redemptions   ：會員只讀自己；admin 全權；「刻意不建」任何會員寫入政策，
--                   兌換必須經 W2 的 redeem_reward（SECURITY DEFINER）。
-- ------------------------------------------------------------
-- merchants：只給 admin。
--   故意「保留」anon 的 select 權限：RLS 沒有任何 anon 政策 → 直讀回 0 列，
--   而不是 42501 permission denied（前者符合規格「直讀回空」，
--   後者會在驗證頁／前端 console 留下可被枚舉的錯誤訊息）。
revoke all on public.merchants from anon;
grant select on public.merchants to anon;
grant select, insert, update, delete on public.merchants to authenticated;

drop policy if exists "merchants_admin_all" on public.merchants;
create policy "merchants_admin_all" on public.merchants
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.rewards to authenticated;
grant insert, update, delete on public.rewards to authenticated;

drop policy if exists "rewards_select_active" on public.rewards;
create policy "rewards_select_active" on public.rewards
  for select to authenticated
  using (status = 'active' or public.is_admin());

drop policy if exists "rewards_admin_all" on public.rewards;
create policy "rewards_admin_all" on public.rewards
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.reward_redemptions to authenticated;
grant insert, update, delete on public.reward_redemptions to authenticated;

drop policy if exists "redemptions_select_own_or_admin" on public.reward_redemptions;
create policy "redemptions_select_own_or_admin" on public.reward_redemptions
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "redemptions_admin_all" on public.reward_redemptions;
create policy "redemptions_admin_all" on public.reward_redemptions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ⚠️ 注意：上面「grant insert/update/delete」只是表層權限，
--    真正的閘門是 RLS —— reward_redemptions 沒有任何「會員」寫入政策，
--    因此會員的 insert/update/delete 一律影響 0 列（不會報錯，也不會生效）。

do $$ begin raise notice 'STEP 7 OK — RLS 政策 5 條'; end $$;


-- ------------------------------------------------------------
-- STEP 8：app_settings — 11 個積分規則 key
--   ⚠️ on conflict do update：重跑會把數值「重設為預設值」。
--      上線後若管理員已在 /admin/point-rules 調過數值，重跑前請先備份
--      app_settings 或改用 do update ... where false。
--   舊 key monthly_bonus_points=200 保留不動（舊優惠券機制在用），
--   月達標新 key 為 monthly_points_bonus。
-- ------------------------------------------------------------
insert into public.app_settings (key, value, updated_at) values
  ('signup_bonus',         '200'::jsonb,  now()),
  ('daily_login_points',   '10'::jsonb,   now()),
  ('event_bonus',          '50'::jsonb,   now()),
  ('referral_bonus',       '50'::jsonb,   now()),
  ('referral_monthly_cap', '5'::jsonb,    now()),
  ('birthday_bonus',       '100'::jsonb,  now()),
  ('streak_bonus',         '30'::jsonb,   now()),
  ('streak_days',          '7'::jsonb,    now()),
  ('checkin_bonus',        '20'::jsonb,   now()),
  ('checkin_weekly_cap',   '5'::jsonb,    now()),
  ('monthly_points_bonus', '1000'::jsonb, now()),
  -- 止血開關：false = 入口隱藏、兌換 API 回 FEATURE_OFF；已發出的券仍可核銷
  ('rewards_enabled', 'false'::jsonb, now())
on conflict (key) do update
  set value      = excluded.value,
      updated_at = now();

-- 舊 key 的用途標註（append 說明，不改值）
comment on table public.app_settings is
  '後台可調規則。積分 R1 新增 key：signup_bonus / daily_login_points / event_bonus / '
  'referral_bonus / referral_monthly_cap / birthday_bonus / streak_bonus / streak_days / '
  'checkin_bonus / checkin_weekly_cap / monthly_points_bonus。'
  '注意：monthly_bonus_points(200) 屬舊優惠券月達標機制，R1 不再使用但保留。';

do $$ begin raise notice 'STEP 8 OK — app_settings 11 個 key'; end $$;


-- ------------------------------------------------------------
-- STEP 9：商戶 seed（2 筆）
--   merchants.name 沒有 unique 約束（避免影響後台改名），
--   因此用 where not exists 做「同名不覆蓋」，而非 on conflict。
--   pin_hash 為隨機佔位（明文無人知道），must_reset=true，
--   pin_expires_at=null → 管理員重設 PIN 前，W2 的 verify／lookup 一律拒絕。
-- ------------------------------------------------------------
insert into public.merchants (name, contact_note, pin_hash, must_reset, pin_expires_at, status)
select
  v.name,
  v.contact_note,
  crypt(encode(gen_random_bytes(16), 'hex'), gen_salt('bf', 12)),
  true,
  null,
  'active'
from (values
  ('MSW街健館（自營）', '自營領取點：MSW 定期訓練／活動現場'),
  ('Metal Gym Room',   '合作商戶門市（聯絡方式待補）')
) as v(name, contact_note)
where not exists (
  select 1 from public.merchants m where m.name = v.name
);

do $$ begin raise notice 'STEP 9 OK — 商戶 seed（已存在則略過）'; end $$;


-- ------------------------------------------------------------
-- STEP 10：guard_profile_sensitive_fields 重新定義
--   變更點（相對 schema.sql 原版）：
--     1. 保護欄位由 3 個擴充為 6 個：role / points / total_km /
--        created_at / status / status_updated_at
--     2. 若交易內 app.points_rpc='on'（只有 credit_points 會設），
--        放行 points，其餘仍鎖死
--     3. auth.uid() is null 時整段放行（service_role／trigger／SQL Editor）
--   其餘行為與原版一致；trigger 名稱沿用 profiles_guard_sensitive。
--
--   前置檢查：status / status_updated_at 必須存在，否則這裡就會 raise，
--   而不是等到會員改個人資料時才在 runtime 炸掉。
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'status'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'status_updated_at'
  ) then
    raise exception 'profiles.status / status_updated_at 不存在，請先執行 migration-admin-members-v2.sql';
  end if;
end;
$$;

create or replace function public.guard_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points_rpc boolean := coalesce(current_setting('app.points_rpc', true), 'off') = 'on';
begin
  -- 沒有 JWT = 後端／service_role／trigger／SQL Editor，已繞過 RLS，放行
  if auth.uid() is null then
    return new;
  end if;

  -- 管理員可改任何欄位
  if public.is_admin() then
    return new;
  end if;

  -- 非管理員：一律還原敏感欄位
  new.role              := old.role;
  new.total_km          := old.total_km;
  new.created_at        := old.created_at;
  new.status            := old.status;
  new.status_updated_at := old.status_updated_at;

  -- points 只有 credit_points 在交易內開旗標時才放行
  if not v_points_rpc then
    new.points := old.points;
  end if;

  return new;
end;
$$;

comment on function public.guard_profile_sensitive_fields() is
  'profiles 敏感欄位護欄：非管理員不可改 role/points/total_km/created_at/status/status_updated_at；'
  '交易內 app.points_rpc=on（僅 credit_points 設定）時放行 points；auth.uid() 為 null 時全放行。';

drop trigger if exists profiles_guard_sensitive on public.profiles;
create trigger profiles_guard_sensitive
  before update on public.profiles
  for each row execute function public.guard_profile_sensitive_fields();

do $$ begin raise notice 'STEP 10 OK — guard_profile_sensitive_fields 已更新'; end $$;


-- =============================================================
-- 執行後驗證（在 SQL Editor 逐段執行；預期結果寫在 → 後面）
-- =============================================================
-- ① 三張新表都在（→ 3）
-- select count(*) from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('merchants', 'rewards', 'reward_redemptions');
--
-- ② 三張表的欄位數與關鍵欄（→ merchants 9、rewards 13、redemptions 16）
-- select table_name, count(*) as cols
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name in ('merchants', 'rewards', 'reward_redemptions')
--  group by table_name order by table_name;
--
-- ③ 三張表都開了 RLS（→ 三個 rowsecurity = true）
-- select relname, relrowsecurity from pg_class
--  where relnamespace = 'public'::regnamespace
--    and relname in ('merchants', 'rewards', 'reward_redemptions');
--
-- ④ 政策數（→ 5 條）
-- select tablename, policyname, cmd from pg_policies
--  where schemaname = 'public'
--    and tablename in ('merchants', 'rewards', 'reward_redemptions')
--  order by tablename, policyname;
--
-- ⑤ 11 個積分 key 都在（→ 11 列，monthly_points_bonus = 1000）
-- select key, value from public.app_settings
--  where key in ('signup_bonus','daily_login_points','event_bonus','referral_bonus',
--                'referral_monthly_cap','birthday_bonus','streak_bonus','streak_days',
--                'checkin_bonus','checkin_weekly_cap','monthly_points_bonus','rewards_enabled')
--  order by key;
--
-- ⑥ 商戶 seed（→ 2 列，must_reset = true，pin_hash 非 null）
-- select name, must_reset, pin_valid_days, pin_expires_at, left(pin_hash, 7) as hash_prefix
--   from public.merchants order by created_at;
--
-- ⑦ 防重索引（→ 2 列）
-- select indexname from pg_indexes
--  where schemaname = 'public' and tablename = 'point_transactions'
--    and indexname in ('uq_point_tx_per_day', 'uq_point_tx_per_ref');
--
-- ⑧ guard trigger 仍是同一個名字、指向新函式（→ 1 列）
-- select tgname, p.proname
--   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--  where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal;
--
-- ⑨ RLS 實際效果（用 anon key 從前端測，或 SQL Editor 模擬）
--    select * from public.merchants;        -- 應回 0 列（SQL Editor 是 postgres，會看到全部，屬正常）
-- =============================================================
