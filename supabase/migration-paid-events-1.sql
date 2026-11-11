-- =============================================================
-- MSW 街健館 — 付費活動（HYROX）＋會員實名資料
-- 檔名：migration-paid-events-1.sql
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- 前置條件：已執行 schema.sql / migration-points-r1-1-schema.sql /
--           migration-points-r1-2-earn.sql / migration-event-registrations.sql
-- 可重跑：全部 add column if not exists / create or replace / drop ... if exists
--         / 約束與索引用 DO 區塊或 if not exists 包住
-- Owner：白客（backend-engineer）
--
-- 【本檔做什麼】
--   A. profiles 加實名欄位（full_name / gender / id_last4）
--   B. events 加系列與收款欄位（series / payment_qr_path / payment_phone / payment_note）
--   C. event_registrations 加付款審核欄位與報名表三題
--   D. app_settings 加 paid_event_bonus = 30
--   E. award_paid_event_bonus(user, ref)   — 付費活動發分（30 分，走 credit_points）
--   F. review_event_payment(reg, decision, note) — 後台審核付款（狀態機 + 同交易發分）
--   G. handle_new_user() 改寫 — 把註冊時填的實名資料由 raw_user_meta_data 搬進 profiles
--   H.（規格外必要補充）submit_event_payment_proof(...) — 會員重交付款證明（見 H 段說明）
--   I.（規格外必要補充）event_registrations 付款狀態預設值的 before insert trigger（見 I 段說明）
--
-- 【硬性約束（照專案既有紀律）】
--   1. 所有發分一律走 public.credit_points(uuid, integer, text, text, uuid)，
--      它會在交易內 set_config('app.points_rpc','on') 放行 guard_profile_sensitive_fields；
--      絕不直接 update profiles.points（會被 guard 還原，且繞過 ledger）。
--   2. 所有函式 security definer + set search_path = public。
--   3. 每支新函式結尾都 revoke from public, anon, authenticated；
--      Postgres 預設把 EXECUTE 給 PUBLIC，不 revoke 等於公開。
--   4. ref_type 只准用既有固定字串；本檔用 'event_participation'（合法值，
--      見 migration-points-r1-2-earn.sql:37-38）。
--   5. 防重靠 uq_point_tx_per_ref (user_id, ref_type, ref_id)
--      （migration-points-r1-1-schema.sql:235-238），本檔 ref_id = registration id。
--
-- 【為什麼不動 guard_profile_sensitive_fields】
--   該 trigger（migration-points-r1-1-schema.sql:388-421）只還原
--   role/points/total_km/created_at/status/status_updated_at，
--   新加的 full_name/gender/id_last4 不在保護範圍 → 會員可自行更新（這是需求：
--   /api/profile/complete 就是會員改自己的實名資料）。
--   為避免繞過 API 直接打 PostgREST 寫入超長字串，另在 A 段補長度 check。
-- =============================================================


-- ------------------------------------------------------------
-- A. profiles — 會員實名資料
--   full_name 允許 null：既有會員（migration 前註冊）沒有真實姓名，
--   不可用 not null 逼他們補，否則整站會員列表的 insert 全部會炸。
--   id_last4 只存身分證／護照號後四位（用途：活動報名及保險登記），
--   不存完整證號 —— 降低外洩風險，也避開個資法規的完整蒐集義務。
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists gender    text,
  add column if not exists id_last4  text;

comment on column public.profiles.full_name is
  '真實姓名（活動報名／保險登記用）。允許 null：migration 前的既有會員尚未補資料。';
comment on column public.profiles.gender is
  '性別（保險與分組用）：male / female / undisclosed；null = 尚未填寫。';
comment on column public.profiles.id_last4 is
  '身分證件號後四位（只存後四位，用途：活動報名及保險登記）。格式：4 位數字。';

-- 約束（用 DO 包住，重跑不會撞 duplicate_object）
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_gender_check'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_gender_check
      check (gender is null or gender in ('male', 'female', 'undisclosed'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_id_last4_check'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_last4_check
      check (id_last4 is null or id_last4 ~ '^[0-9]{4}$');
  end if;

  -- 長度護欄：API 已驗 2–40 字，這裡是「繞過 API 直接打 PostgREST」的最後防線
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_full_name_len_check'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_full_name_len_check
      check (full_name is null or char_length(btrim(full_name)) between 2 and 40);
  end if;

  -- phone 是既有欄位（線上可能已有資料），所以先確認沒有超長列再加約束。
  -- 直接 add constraint 遇上舊資料會讓整支 migration 失敗，這種失敗很難查。
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_phone_len_check'
       and conrelid = 'public.profiles'::regclass
  ) and not exists (
    select 1 from public.profiles
     where phone is not null and char_length(phone) > 30
  ) then
    alter table public.profiles
      add constraint profiles_phone_len_check
      check (phone is null or char_length(phone) <= 30);
  end if;
end $$;

do $$ begin raise notice 'A OK — profiles: full_name / gender / id_last4'; end $$;


-- ------------------------------------------------------------
-- B. events — 系列與收款資訊
--   series：'hyrox' 之類的分類標籤；null = 一般活動（既有資料不受影響）
--   fee_cents：線上已有（int，現值 0）。這裡 add column if not exists 只是
--   讓新環境（staging / 本機）也能跑，線上不會有任何變化。
--   payment_*：付費活動的收款 QR、收款電話、備註（前台顯示用）
-- ------------------------------------------------------------
alter table public.events
  add column if not exists series          text,
  add column if not exists fee_cents        integer not null default 0,
  add column if not exists payment_qr_path  text,
  add column if not exists payment_phone    text,
  add column if not exists payment_note     text;

comment on column public.events.series is
  '活動系列標籤（例如 hyrox）。null = 一般活動；HYROX 頁以此篩場次。';
comment on column public.events.fee_cents is
  '報名費（分為單位）。0 = 免費活動（報名不需要付款審核）。';
comment on column public.events.payment_qr_path is
  '收款 QR 圖片的 Storage 路徑（例如 events/qr/xxx.png），前台轉 public URL 顯示。';
comment on column public.events.payment_phone is
  '收款電話（轉帳／行動支付用），純文字，最長 30 字。';
comment on column public.events.payment_note is
  '付款說明（例如「轉帳後上傳截圖，兩個工作日內審核」），最長 300 字。';

-- 約束（長度護欄；重跑安全）
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'events_series_len_check'
       and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_series_len_check
      check (series is null or char_length(series) between 1 and 40);
  end if;

  -- fee_cents 也是既有欄位，同樣先確認沒有越界值再加約束
  if not exists (
    select 1 from pg_constraint
     where conname = 'events_fee_cents_check'
       and conrelid = 'public.events'::regclass
  ) and not exists (
    select 1 from public.events
     where fee_cents is not null and (fee_cents < 0 or fee_cents > 10000000)
  ) then
    alter table public.events
      add constraint events_fee_cents_check
      check (fee_cents is null or fee_cents between 0 and 10000000);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'events_payment_text_len_check'
       and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_payment_text_len_check
      check (
        (payment_phone is null or char_length(payment_phone) <= 30)
        and (payment_note is null or char_length(payment_note) <= 300)
        and (payment_qr_path is null or char_length(payment_qr_path) <= 500)
      );
  end if;
end $$;

-- HYROX 頁查場次：where series = 'hyrox' order by event_date
create index if not exists idx_events_series_date
  on public.events (series, event_date);

do $$ begin raise notice 'B OK — events: series / fee_cents / payment_*'; end $$;


-- ------------------------------------------------------------
-- C. event_registrations — 付款審核欄位 + 報名表三題
--   payment_status 四態：
--     not_required   免費活動，不需要付款（既有列的預設值）
--     pending_review 已報名／已重交，等管理員看截圖
--     confirmed      審核通過（發分）
--     rejected       審核退回（不發分，可重交）
--   reviewed_by 用 on delete set null：管理員帳號被刪不可連累報名紀錄。
-- ------------------------------------------------------------
alter table public.event_registrations
  add column if not exists payment_status        text not null default 'not_required',
  add column if not exists payment_proof_path    text,
  add column if not exists payment_amount_cents  integer,
  add column if not exists group_pref            text,
  add column if not exists weekly_freq           text,
  add column if not exists longest_run           text,
  add column if not exists disclaimer_accepted_at timestamptz,
  add column if not exists reviewed_by           uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at           timestamptz,
  add column if not exists admin_note            text;

comment on column public.event_registrations.payment_status is
  '付款狀態：not_required（免費活動）/ pending_review（待審）/ confirmed（已通過）/ rejected（已退回，可重交）。';
comment on column public.event_registrations.payment_proof_path is
  '付款截圖的 Storage 路徑。只存路徑，不存 public URL（換網域不用改資料）。';
comment on column public.event_registrations.payment_amount_cents is
  '會員自填的付款金額（分）。與 events.fee_cents 的差額由管理員人工判斷。';
comment on column public.event_registrations.group_pref is
  '報名表問題一：分組意願（自由文字）。';
comment on column public.event_registrations.weekly_freq is
  '報名表問題二：每週訓練頻率（自由文字）。';
comment on column public.event_registrations.longest_run is
  '報名表問題三：最長跑步距離（自由文字）。';
comment on column public.event_registrations.disclaimer_accepted_at is
  '免責聲明同意時間。null = 未同意（報名流程應要求非 null 才可送審）。';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'event_registrations_payment_status_check'
       and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_payment_status_check
      check (payment_status in ('not_required', 'pending_review', 'confirmed', 'rejected'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'event_registrations_payment_amount_check'
       and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_payment_amount_check
      check (payment_amount_cents is null
             or payment_amount_cents between 0 and 10000000);
  end if;

  -- 三題自由文字：長度上限，避免有人塞 1MB 字串（API 亦驗 200 字）
  if not exists (
    select 1 from pg_constraint
     where conname = 'event_registrations_form_answer_len_check'
       and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_form_answer_len_check
      check (
        (group_pref  is null or char_length(group_pref)  <= 200)
        and (weekly_freq is null or char_length(weekly_freq) <= 200)
        and (longest_run is null or char_length(longest_run) <= 200)
        and (admin_note  is null or char_length(admin_note)  <= 500)
        and (payment_proof_path is null or char_length(payment_proof_path) <= 500)
      );
  end if;
end $$;

-- 後台審核清單：where payment_status = 'pending_review' order by created_at
-- 部分索引只收 pending_review 的列，清單再長也不拖慢。
create index if not exists idx_event_reg_pending_payment
  on public.event_registrations (created_at)
  where payment_status = 'pending_review';

do $$ begin raise notice 'C OK — event_registrations 付款審核欄位'; end $$;


-- ------------------------------------------------------------
-- D. app_settings — 付費活動報名獎 30 分
--   已存在就不覆蓋（後台可能已手動調過）。jsonb number 30，setting_num 取得到。
-- ------------------------------------------------------------
insert into public.app_settings (key, value)
values ('paid_event_bonus', '30'::jsonb)
on conflict (key) do nothing;

do $$ begin raise notice 'D OK — app_settings.paid_event_bonus'; end $$;


-- ------------------------------------------------------------
-- E. award_paid_event_bonus — 付費活動報名獎（30 分）
--   授權：is_admin() 或 auth.role() = 'service_role'
--     （用 auth.role() 而非 auth.uid() is null：後者只是「沒登入」，可被匿名請求觸發；
--       前者是 JWT 宣告，會員偽造不了。口徑同 award_event_participation
--       migration-points-r1-2-earn.sql:337-348，閘門在第 346-348 行）
--   防重：point_transactions 已有 (user_id, ref_type='event_participation', ref_id=p_ref)
--         → 回 skipped。最終防線是 uq_point_tx_per_ref 的 unique_violation。
--   注意：與既有 award_event_participation 共用 ref_type='event_participation'，
--         但金額來源不同（paid_event_bonus vs event_bonus）。同一筆 ref_id 只會發一次。
-- ------------------------------------------------------------
create or replace function public.award_paid_event_bonus(p_user_id uuid, p_ref uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer := public.setting_num('paid_event_bonus', 30)::int;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_user_id is null or p_ref is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  -- 後台把設定改成 0 或負數 = 停發（不寫 0 分 ledger，避免污染帳本）
  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ZERO_POINTS');
  end if;

  if exists (
    select 1 from public.point_transactions t
     where t.user_id = p_user_id
       and t.ref_type = 'event_participation'
       and t.ref_id = p_ref
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end if;

  begin
    -- 簽名：credit_points(p_user_id uuid, p_delta integer, p_reason text,
    --                    p_ref_type text, p_ref_id uuid) returns void
    --   （migration-points-r1-2-earn.sql:91-97）
    perform public.credit_points(
      p_user_id, v_points, 'HYROX 活動報名', 'event_participation', p_ref
    );
  exception when unique_violation then
    -- 併發雙擊／重複呼叫：unique 索引擋下，視為已發
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end;

  return jsonb_build_object('ok', true, 'points', v_points);
end;
$$;

comment on function public.award_paid_event_bonus(uuid, uuid) is
  '付費活動報名獎（admin／service_role）：ref_id = event_registrations.id 防重，'
  '金額讀 app_settings.paid_event_bonus（預設 30）；一律經 credit_points 寫 ledger。';

revoke all on function public.award_paid_event_bonus(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.award_paid_event_bonus(uuid, uuid) to authenticated;

-- service_role 在部分自架環境不存在，用 DO 區塊保險（線上 Supabase 一定有）
do $$
begin
  begin
    grant execute on function public.award_paid_event_bonus(uuid, uuid) to service_role;
  exception when undefined_object then
    raise notice 'service_role 不存在，跳過 grant（本機環境可忽略）';
  end;
end $$;

do $$ begin raise notice 'E OK — award_paid_event_bonus'; end $$;


-- ------------------------------------------------------------
-- F. review_event_payment — 後台審核付款（狀態機 + 同交易發分）
--   回傳 jsonb：{ok:true, payment_status, award} 或 {ok:false, code:...}
--     NOT_ADMIN / INVALID_ARGUMENT / INVALID_DECISION / NOT_FOUND / ALREADY_REVIEWED
--   狀態機：只有 payment_status='pending_review' 可審；
--           已 confirmed 或 not_required → ALREADY_REVIEWED（含 payment_status 現值）。
--   為什麼 rejected 之後可以再審？
--     會員重交（H 段 RPC）會把 payment_status 推回 pending_review 並清空 reviewed_*，
--     所以管理員之後能再審一次，不會卡死。
--   為什麼不碰 status（registered/cancelled）？
--     付款狀態與報名狀態是兩個維度：退款／取消報名另有流程，這裡不混在一起改。
-- ------------------------------------------------------------
create or replace function public.review_event_payment(
  p_registration_id uuid,
  p_decision        text,
  p_note            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg    public.event_registrations%rowtype;
  v_dec    text;
  v_note   text;
  v_award  jsonb;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_registration_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  v_dec := lower(btrim(coalesce(p_decision, '')));
  if v_dec not in ('confirmed', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DECISION');
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  -- 鎖住這一列，避免兩個管理員同時審同一筆（第二個會等到第一個 commit 後
  -- 讀到新狀態，於是拿到 ALREADY_REVIEWED，而不是重複發分）
  select * into v_reg
    from public.event_registrations
   where id = p_registration_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_reg.payment_status <> 'pending_review' then
    return jsonb_build_object(
      'ok', false,
      'code', 'ALREADY_REVIEWED',
      'payment_status', v_reg.payment_status
    );
  end if;

  if v_dec = 'confirmed' then
    update public.event_registrations
       set payment_status = 'confirmed',
           reviewed_by    = auth.uid(),
           reviewed_at    = now(),
           admin_note     = v_note
     where id = p_registration_id;

    -- 同一交易內發分：若發分失敗，上面的 update 會一併回滾（不會出現
    -- 「已通過但沒發分」的半套狀態）。skipped 仍算成功。
    v_award := public.award_paid_event_bonus(v_reg.user_id, v_reg.id);

    return jsonb_build_object(
      'ok', true,
      'payment_status', 'confirmed',
      'award', coalesce(v_award, '{}'::jsonb)
    );
  end if;

  -- rejected：只改狀態與備註，不發分；reviewed_* 保留（留審核軌跡），
  -- 會員重交時由 H 段 RPC 清空。
  update public.event_registrations
     set payment_status = 'rejected',
         reviewed_by    = auth.uid(),
         reviewed_at    = now(),
         admin_note     = v_note
   where id = p_registration_id;

  return jsonb_build_object(
    'ok', true,
    'payment_status', 'rejected',
    'award', jsonb_build_object('ok', true, 'skipped', true, 'reason', 'REJECTED')
  );
end;
$$;

comment on function public.review_event_payment(uuid, text, text) is
  '後台審核付費活動報名（admin／service_role）：pending_review → confirmed（發分，'
  '經 award_paid_event_bonus，ref_id=registration id）或 rejected（不發分，可重交）。';

revoke all on function public.review_event_payment(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_event_payment(uuid, text, text) to authenticated;

do $$
begin
  begin
    grant execute on function public.review_event_payment(uuid, text, text) to service_role;
  exception when undefined_object then
    raise notice 'service_role 不存在，跳過 grant（本機環境可忽略）';
  end;
end $$;

do $$ begin raise notice 'F OK — review_event_payment'; end $$;


-- ------------------------------------------------------------
-- G. handle_new_user — 把註冊時填的實名資料搬進 profiles
--   原版（schema.sql:42-62）只搬 display_name / avatar_url。
--   這裡只做 create or replace，回傳型別（trigger）與觸發時機一字不改，
--   既有會員不受影響；新建會員則在註冊當下就帶實名資料。
--
--   【為什麼在 SQL 裡再清洗一次】
--   這個 trigger 跑在 auth.users insert 之後，函式內任何 check 違反都會
--   abort 整個註冊 → 使用者看到 500。所以 metadata 一律先正規化：
--   不合法的值降級成 null，絕不 raise。
--
--   phone：去掉空格／連字號／括號後，去掉 +853／853 國碼，
--          必須剛好 8 位數字才採用（澳門手機號）。存 8 位數字，不存國碼
--          —— 與 /api/profile/complete 的寫入口徑一致。
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display   text;
  v_full_name text;
  v_gender    text;
  v_phone     text;
  v_id_last4  text;
begin
  -- 顯示名稱：display_name → full_name → 電郵 @ 前綴
  v_display := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  v_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_full_name is not null
     and (char_length(v_full_name) < 2 or char_length(v_full_name) > 40) then
    v_full_name := null;
  end if;

  v_gender := lower(btrim(coalesce(new.raw_user_meta_data ->> 'gender', '')));
  if v_gender is null or v_gender not in ('male', 'female', 'undisclosed') then
    v_gender := null;
  end if;

  v_id_last4 := regexp_replace(
                  coalesce(new.raw_user_meta_data ->> 'id_last4', ''), '\D', '', 'g');
  if v_id_last4 !~ '^[0-9]{4}$' then
    v_id_last4 := null;
  end if;

  v_phone := regexp_replace(
               coalesce(new.raw_user_meta_data ->> 'phone', ''), '[\s\-()]', '', 'g');
  -- 國碼只在後面剛好還有 8 位數字時才剝掉（lookahead），
  -- 避免把剛好以 853 開頭的 8 位本地號碼誤切成 5 位。
  v_phone := regexp_replace(v_phone, '^\+?853(?=[0-9]{8}$)', '');
  if v_phone !~ '^[0-9]{8}$' then
    v_phone := null;
  end if;

  insert into public.profiles (
    id, display_name, avatar_url, role, full_name, gender, phone, id_last4
  )
  values (
    new.id,
    coalesce(v_display, v_full_name, split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    'member',
    v_full_name,
    v_gender,
    v_phone,
    v_id_last4
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users 新增後建立 profiles：搬 display_name/avatar_url（原行為）'
  '＋ full_name/gender/phone/id_last4（付費活動實名資料，metadata 先清洗，非法值降級為 null）；'
  '任何值都不 raise，不擋註冊。';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

do $$ begin raise notice 'G OK — handle_new_user（含實名資料）'; end $$;


-- ------------------------------------------------------------
-- H.（規格外必要補充：交付需求寫「允許會員重交」，但沒指定實作方式）
--   會員重交付款證明 —— submit_event_payment_proof
--
--   【為什麼不是直接 grant update 給會員】
--   event_registrations 的表層 grant 只有 select/insert/delete
--   （migration-event-registrations.sql:117），RLS 的 update 政策只給管理員
--   （同檔 :111-113）。若為了「重交」而 grant update + 會員 update 政策，
--   會員就能直接把 payment_status 改成 'confirmed' —— 自己給自己過審＋發分。
--   所以重交必須走 security definer 的窄門 RPC：只准改這 5 個欄位，
--   且只准改自己那一列（IDOR 防線）。
--
--   若前端流程最後決定「重交」由管理員代為操作，可整段刪掉，不影響 A–G。
-- ------------------------------------------------------------
create or replace function public.submit_event_payment_proof(
  p_registration_id uuid,
  p_proof_path      text,
  p_amount_cents    integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg  public.event_registrations%rowtype;
  v_uid  uuid := auth.uid();
  v_path text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  if p_registration_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  v_path := nullif(btrim(coalesce(p_proof_path, '')), '');
  if v_path is null or char_length(v_path) > 500 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  if p_amount_cents is not null
     and (p_amount_cents < 0 or p_amount_cents > 10000000) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  select * into v_reg
    from public.event_registrations
   where id = p_registration_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- IDOR：不是自己那一列就當作不存在（不區分 404/403，避免探測他人報名）
  if v_reg.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- 只有「待審」或「已退回」可以（重）交；已通過不可覆蓋
  if v_reg.payment_status not in ('pending_review', 'rejected') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ALREADY_CONFIRMED',
      'payment_status', v_reg.payment_status
    );
  end if;

  update public.event_registrations
     set payment_proof_path   = v_path,
         payment_amount_cents = coalesce(p_amount_cents, payment_amount_cents),
         payment_status       = 'pending_review',
         reviewed_by          = null,
         reviewed_at          = null,
         admin_note           = null
   where id = p_registration_id;

  return jsonb_build_object('ok', true, 'payment_status', 'pending_review');
end;
$$;

comment on function public.submit_event_payment_proof(uuid, text, integer) is
  '會員提交／重交付款截圖（只能改自己的列）：payment_status → pending_review 並清空 reviewed_*，'
  '已 confirmed / not_required 的列拒絕覆蓋；走 definer 以避免開放 update 權限。';

revoke all on function public.submit_event_payment_proof(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.submit_event_payment_proof(uuid, text, integer)
  to authenticated;

do $$ begin raise notice 'H OK — submit_event_payment_proof'; end $$;


-- ------------------------------------------------------------
-- I.（規格外必要補充：交付需求沒提報名那一刻誰來把 payment_status 設成 pending_review）
--   報名時依活動收費自動決定付款狀態
--
--   免費活動（fee_cents = 0）→ 維持 not_required
--   付費活動（fee_cents > 0）→ pending_review（後台審核清單立刻看得到）
--   呼叫端若明確指定非預設值（例如管理員手動補登 confirmed），尊重不覆蓋。
--
--   為什麼用 trigger 而不是改 API：/api/event-registrations 的 insert 只有
--   {event_id, user_id, status}，改 API 要動既有 T-26 契約；而這是純資料層規則。
-- ------------------------------------------------------------
create or replace function public.trg_event_registration_payment_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee integer;
begin
  -- 呼叫端明確指定了就尊重（default 已先套用成 'not_required'，故只認非預設值）
  if new.payment_status is not null and new.payment_status <> 'not_required' then
    return new;
  end if;

  select coalesce(ev.fee_cents, 0) into v_fee
    from public.events ev
   where ev.id = new.event_id;

  if coalesce(v_fee, 0) > 0 then
    new.payment_status := 'pending_review';
  else
    new.payment_status := 'not_required';
  end if;

  return new;
end;
$$;

-- trigger 函式不需要 EXECUTE 權限（由 trigger 內部呼叫），但預設會給 PUBLIC，
-- 照本檔紀律一併收回，避免被直接當普通函式呼叫。
revoke all on function public.trg_event_registration_payment_default()
  from public, anon, authenticated;

drop trigger if exists event_reg_payment_default on public.event_registrations;
create trigger event_reg_payment_default
  before insert on public.event_registrations
  for each row execute function public.trg_event_registration_payment_default();

do $$ begin raise notice 'I OK — event_reg_payment_default trigger'; end $$;


-- 讓 PostgREST 立刻看到新欄位／新函式（可重複執行，無副作用）
notify pgrst, 'reload schema';

do $$
begin
  raise notice '=== migration-paid-events-1.sql 全部完成（A–I）===';
  raise notice '下一步：前端 /events/hyrox 頁需要 series=''hyrox'' 的場次；';
  raise notice '後台審核清單查 event_registrations where payment_status=''pending_review''。';
end $$;


-- =============================================================
-- 執行後驗證（貼進 SQL Editor 逐條跑；-- 開頭是說明）
-- =============================================================
-- -- 1) 欄位都在
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='profiles'
--    and column_name in ('full_name','gender','id_last4');
--
-- -- 2) 函式簽名
-- select p.proname, pg_get_function_arguments(p.oid) as args, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('award_paid_event_bonus','review_event_payment',
--                      'submit_event_payment_proof');
--
-- -- 3) 權限（public/anon 不應有 EXECUTE）
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name in ('award_paid_event_bonus','review_event_payment',
--                         'submit_event_payment_proof')
--  order by routine_name, grantee;
--
-- -- 4) 設定值
-- select key, value from public.app_settings where key='paid_event_bonus';
--
-- -- 5) 非管理員（會員 JWT）呼叫 review_event_payment → 應回 NOT_ADMIN，且不應改到任何列
-- -- select public.review_event_payment('<registration-uuid>', 'confirmed', null);
--
-- -- 6) 重複審核：同一筆 pending_review 連審兩次 → 第二次應回 ALREADY_REVIEWED
-- =============================================================
