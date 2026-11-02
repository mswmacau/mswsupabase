-- =============================================================
-- MSW 街健館 — 積分換領系統 R1（W1／第 2 支）
-- 檔名：migration-points-r1-2-earn.sql
-- 內容：時間邊界函式、credit_points、8 種賺分來源（連登併入登入）、
--       4 支既有函式 create or replace（月達標／簽到審核／跑步審核／）
--       與 admin_run_monthly_settlement
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- 前置條件：必須先執行 migration-points-r1-1-schema.sql
-- 可重跑：全部 create or replace / drop trigger if exists
-- =============================================================
--
-- 【硬性約束（改動前必讀）】
--   1. 以下 4 支既有函式只做 create or replace，簽名與回傳型別「一字不改」：
--        award_monthly_if_qualified(uuid, text)      returns boolean
--        review_run_submission(uuid, boolean, text)  returns jsonb
--        review_checkin(uuid, boolean, text)         returns void
--      簽名一改就要 drop，drop 會連 ACL 與依賴一起斷，後台立刻壞。
--   2. 不改 add_points、不改 is_admin。新的發分一律走 credit_points
--      （add_points 內建 is_admin 閘門，service_role 與 trigger 呼叫不到）。
--   3. 全部函式 security definer + set search_path = public。
--   4. 所有新函式結尾都 revoke from public/anon/authenticated，
--      再按需要 grant；預設 EXECUTE 是給 PUBLIC 的，不 revoke 等於公開。
--
-- 【為什麼需要 credit_points 而不是直接用 add_points】
--   add_points 只允許 is_admin() 呼叫。但註冊獎由 profiles 的 trigger 發、
--   月結算排程以 service_role 跑、簽到與跑步審核在 definer 函式內部呼叫，
--   這三種情境 auth.uid() 可能為 null，is_admin() = false → add_points 會 raise。
--   credit_points 因此不設 admin 閘門，改由「呼叫它的函式」各自把關：
--   會員可直呼的只有 award_daily_login()（無參數，只能為自己加分）。
--
-- 【積分寫入的兩道門】
--   寫 profiles.points 會撞上 profiles_guard_sensitive（非管理員不可改 points）。
--   credit_points 在交易內 set_config('app.points_rpc','on',true) 開旗標，
--   guard 見到旗標才放行 points。旗標 transaction-local，函式結束即失效。
--
-- 【ref_type 固定字串（不准自創）】
--   signup_bonus / daily_login / event_participation / referral / birthday /
--   login_streak / checkin_bonus / monthly_bonus / reward / refund
--   前 8 個是賺分，reward／refund 由 W2 的兌換流程使用。
-- =============================================================


-- ------------------------------------------------------------
-- STEP 1：時間邊界（全模組統一，日＝Asia/Macau 曆日、週＝週一起算）
--   刻意不 hardcode 時區在業務邏輯裡，所有函式都呼叫這兩支。
--   stable（非 immutable）：結果取決於 now()，同一交易內固定。
-- ------------------------------------------------------------
create or replace function public.macau_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone 'Asia/Macau')::date;
$$;

comment on function public.macau_date() is
  '回傳 Asia/Macau 曆日（date）。全模組統一的「日」邊界，stable（同一交易內固定）。';

create or replace function public.macau_week_start()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select date_trunc('week', (now() at time zone 'Asia/Macau')::date)::date;
$$;

comment on function public.macau_week_start() is
  '回傳本週一（Asia/Macau 曆週起點）。週界線＝週一 00:00 至週日 23:59。';

revoke all on function public.macau_date() from public, anon, authenticated;
revoke all on function public.macau_week_start() from public, anon, authenticated;
grant execute on function public.macau_date() to authenticated;
grant execute on function public.macau_week_start() to authenticated;

do $$ begin raise notice 'STEP 1 OK — macau_date / macau_week_start'; end $$;


-- ------------------------------------------------------------
-- STEP 2：credit_points — 唯一的積分寫入通道
--   刻意「無 is_admin 閘門」：由呼叫端負責授權（見檔頭說明）。
--   同步做兩件事，同一交易：
--     ① update profiles.points（旗標放行 guard）
--     ② insert point_transactions（正／負皆可；負數回傳由 W2 退款用）
--   p_delta = 0 直接返回（不寫 0 分紀錄，避免污染 ledger）。
--   greatest(...,0) 與 add_points 行為一致，餘額不會變負。
-- ------------------------------------------------------------
create or replace function public.credit_points(
  p_user_id  uuid,
  p_delta    integer,
  p_reason   text,
  p_ref_type text,
  p_ref_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_user_id is null then
    raise exception 'credit_points: p_user_id 不可為 null';
  end if;
  if p_delta is null then
    raise exception 'credit_points: p_delta 不可為 null';
  end if;
  if p_delta = 0 then
    return;
  end if;

  -- 交易內放行 profiles.points（guard_profile_sensitive_fields 讀這個旗標）
  perform set_config('app.points_rpc', 'on', true);

  update public.profiles
     set points = greatest(points + p_delta, 0)
   where id = p_user_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'credit_points: 找不到會員 %', p_user_id;
  end if;

  insert into public.point_transactions (user_id, delta, reason, ref_type, ref_id)
  values (p_user_id, p_delta, coalesce(p_reason, ''), p_ref_type, p_ref_id);

  -- 主動收旗標（交易結束本來就會失效，這裡明示意圖）
  perform set_config('app.points_rpc', 'off', true);
end;
$$;

comment on function public.credit_points(uuid, integer, text, text, uuid) is
  '內部積分寫入通道（無 admin 閘門，僅供 definer 函式／trigger 呼叫）：'
  'set_config(app.points_rpc) 放行 guard 後 update profiles.points 並寫 point_transactions。';

revoke all on function public.credit_points(uuid, integer, text, text, uuid)
  from public, anon, authenticated;

do $$ begin raise notice 'STEP 2 OK — credit_points'; end $$;


-- ------------------------------------------------------------
-- STEP 3：註冊開戶 +200
--   award_signup_bonus 為「內部函式」，另用 trigger 在 profiles 新增時觸發。
--   使用 after insert on profiles（不是 auth.users），因為分數寫在 profiles；
--   會員由 handle_new_user() 建立 profile 後即發分。
--   trigger 內任何錯誤都吞掉只 raise warning —— 發分失敗不可擋住註冊。
-- ------------------------------------------------------------
create or replace function public.award_signup_bonus(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer := public.setting_num('signup_bonus', 200)::int;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  if exists (
    select 1 from public.point_transactions t
     where t.user_id = p_user_id and t.ref_type = 'signup_bonus'
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end if;

  begin
    perform public.credit_points(
      p_user_id, v_points, '註冊開戶獎勵', 'signup_bonus', p_user_id
    );
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end;

  return jsonb_build_object('ok', true, 'points', v_points);
end;
$$;

comment on function public.award_signup_bonus(uuid) is
  '註冊獎（內部／trigger 用）：ref_type=signup_bonus、ref_id=本人 id，每人僅一次；金額讀 app_settings.signup_bonus。';

create or replace function public.trg_profile_signup_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.award_signup_bonus(new.id);
  exception when others then
    -- 註冊流程優先：發分失敗只記警告，不 rollback 會員建立
    raise warning '註冊獎發放失敗（profile %）：%', new.id, sqlerrm;
  end;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'on_profile_signup_bonus'
       and tgrelid = 'public.profiles'::regclass
       and not tgisinternal
  ) then
    create trigger on_profile_signup_bonus
      after insert on public.profiles
      for each row execute function public.trg_profile_signup_bonus();
    raise notice 'STEP 3 OK — trigger on_profile_signup_bonus 已建立';
  else
    raise notice 'STEP 3 OK — trigger on_profile_signup_bonus 已存在（略過）';
  end if;
end;
$$;

revoke all on function public.award_signup_bonus(uuid) from public, anon, authenticated;
revoke all on function public.trg_profile_signup_bonus() from public, anon, authenticated;

do $$ begin raise notice 'STEP 3 OK — 註冊獎 +200（trigger）'; end $$;


-- ------------------------------------------------------------
-- STEP 4：每日登入 +10（連登每滿 streak_days 天再 +streak_bonus）
--   · 不收參數，只認 auth.uid() —— 會員直呼也只能替自己加分
--   · 日界線用 macau_date()；靠 uq_point_tx_per_day 索引與前置查詢雙重防重
--   · 連登天數 = 從今天往回數「連續有 daily_login 紀錄」的天數
--   · 回傳：{ok, skipped?, points, base, streak_days, streak_bonus, date}
-- ------------------------------------------------------------
create or replace function public.award_daily_login()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid    := auth.uid();
  v_today        date    := public.macau_date();
  v_base         integer := public.setting_num('daily_login_points', 10)::int;
  v_streak_bonus integer := public.setting_num('streak_bonus', 30)::int;
  v_streak_days  integer := greatest(public.setting_num('streak_days', 7)::int, 1);
  v_streak       integer := 0;
  v_bonus        integer := 0;
  v_i            integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NO_AUTH');
  end if;

  -- 今天已領過
  if exists (
    select 1 from public.point_transactions t
     where t.user_id = v_uid
       and t.ref_type = 'daily_login'
       and (t.created_at at time zone 'Asia/Macau')::date = v_today
  ) then
    return jsonb_build_object(
      'ok', true, 'skipped', true, 'reason', 'DUPLICATE_DAY', 'date', v_today
    );
  end if;

  -- 併發保護：兩個請求同時進來時，唯一索引會擋掉第二筆
  begin
    perform public.credit_points(v_uid, v_base, '每日登入', 'daily_login', null);
  exception when unique_violation then
    return jsonb_build_object(
      'ok', true, 'skipped', true, 'reason', 'DUPLICATE_DAY', 'date', v_today
    );
  end;

  -- 連續天數（含今天）；上限 400 天避免異常資料造成長迴圈
  while v_i < 400 loop
    if exists (
      select 1 from public.point_transactions t
       where t.user_id = v_uid
         and t.ref_type = 'daily_login'
         and (t.created_at at time zone 'Asia/Macau')::date = v_today - v_i
    ) then
      v_streak := v_streak + 1;
      v_i := v_i + 1;
    else
      exit;
    end if;
  end loop;

  -- 每滿 streak_days 的倍數發一次（第 7、14、21… 天）
  if v_streak > 0 and v_streak % v_streak_days = 0 then
    begin
      perform public.credit_points(
        v_uid,
        v_streak_bonus,
        '連續登入 ' || v_streak || ' 天獎勵',
        'login_streak',
        null
      );
      v_bonus := v_streak_bonus;
    exception when unique_violation then
      v_bonus := 0;  -- 同日重入，已發過
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'points', v_base + v_bonus,
    'base', v_base,
    'streak_days', v_streak,
    'streak_bonus', v_bonus,
    'date', v_today
  );
end;
$$;

comment on function public.award_daily_login() is
  '每日登入（會員可直呼，只認 auth.uid()）：每日一次，讀 daily_login_points；'
  '連登滿 streak_days 倍數時另發 login_streak（讀 streak_bonus）。回傳 {ok,skipped?,points,...}。';

revoke all on function public.award_daily_login() from public, anon, authenticated;
grant execute on function public.award_daily_login() to authenticated;

do $$ begin raise notice 'STEP 4 OK — award_daily_login（含連登）'; end $$;


-- ------------------------------------------------------------
-- STEP 5：活動出席 +50
--   授權：is_admin() 或 auth.role()='service_role'
--     → 用 auth.role() 而非「auth.uid() is null」，因為前者是 JWT 宣告，
--       無法被一般會員偽造成 service_role；後者只是「沒有登入」。
--   防重：ref_id = p_ref（簽到確認流程傳 checkin id；手動補發可傳活動 id）
--   內部呼叫來源：review_checkin()
-- ------------------------------------------------------------
create or replace function public.award_event_participation(p_user_id uuid, p_ref uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer := public.setting_num('event_bonus', 50)::int;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_user_id is null or p_ref is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
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
    perform public.credit_points(
      p_user_id, v_points, '活動出席獎勵', 'event_participation', p_ref
    );
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end;

  return jsonb_build_object('ok', true, 'points', v_points);
end;
$$;

comment on function public.award_event_participation(uuid, uuid) is
  '活動出席獎（admin／service_role）：ref_id=p_ref 防重，金額讀 event_bonus；'
  '由 review_checkin 在簽到確認時自動呼叫（p_ref = training_checkins.id）。';

revoke all on function public.award_event_participation(uuid, uuid)
  from public, anon, authenticated;

do $$ begin raise notice 'STEP 5 OK — award_event_participation'; end $$;


-- ------------------------------------------------------------
-- STEP 6：運動打卡 +20（週上限 5 次）
--   授權：admin／service_role（防刷分：必須經管理員審批）
--   防重：ref_id = p_ref（submission id）
--   週上限：本週（Asia/Macau 曆週，週一 00:00 起）已發筆數 >= checkin_weekly_cap 即跳過
-- ------------------------------------------------------------
create or replace function public.award_checkin_bonus(p_user_id uuid, p_ref uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer := public.setting_num('checkin_bonus', 20)::int;
  v_cap    integer := greatest(public.setting_num('checkin_weekly_cap', 5)::int, 0);
  v_week   date    := public.macau_week_start();
  v_used   integer := 0;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_user_id is null or p_ref is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  if exists (
    select 1 from public.point_transactions t
     where t.user_id = p_user_id
       and t.ref_type = 'checkin_bonus'
       and t.ref_id = p_ref
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end if;

  select count(*) into v_used
    from public.point_transactions t
   where t.user_id = p_user_id
     and t.ref_type = 'checkin_bonus'
     and (t.created_at at time zone 'Asia/Macau')::date between v_week and v_week + 6;

  if v_cap = 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'WEEKLY_CAP');
  end if;

  if v_used >= v_cap then
    return jsonb_build_object(
      'ok', true, 'skipped', true, 'reason', 'WEEKLY_CAP',
      'used', v_used, 'cap', v_cap
    );
  end if;

  begin
    perform public.credit_points(
      p_user_id, v_points, '運動打卡獎勵', 'checkin_bonus', p_ref
    );
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end;

  return jsonb_build_object(
    'ok', true, 'points', v_points, 'used', v_used + 1, 'cap', v_cap
  );
end;
$$;

comment on function public.award_checkin_bonus(uuid, uuid) is
  '運動打卡獎（admin／service_role）：ref_id=p_ref 防重，週上限讀 checkin_weekly_cap，金額讀 checkin_bonus；'
  '由 review_run_submission 在審批通過時自動呼叫（p_ref = run_submissions.id）。';

revoke all on function public.award_checkin_bonus(uuid, uuid)
  from public, anon, authenticated;

do $$ begin raise notice 'STEP 6 OK — award_checkin_bonus'; end $$;


-- ------------------------------------------------------------
-- STEP 7：邀請 +50（月上限 5 人）／生日 +100（每年一次）
--   兩支都限 admin／service_role，R1 只做管理員手動補發。
--   邀請防重：ref_type='referral'、ref_id=被邀請人 id（同一人被邀只算一次）
--   生日防重：以 Asia/Macau 年份判斷同一年不重發（索引只擋同日）
-- ------------------------------------------------------------
create or replace function public.award_referral(p_referrer uuid, p_new_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer := public.setting_num('referral_bonus', 50)::int;
  v_cap    integer := greatest(public.setting_num('referral_monthly_cap', 5)::int, 0);
  v_used   integer := 0;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_referrer is null or p_new_user is null or p_referrer = p_new_user then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  if exists (
    select 1 from public.point_transactions t
     where t.user_id = p_referrer
       and t.ref_type = 'referral'
       and t.ref_id = p_new_user
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end if;

  select count(*) into v_used
    from public.point_transactions t
   where t.user_id = p_referrer
     and t.ref_type = 'referral'
     and date_trunc('month', (t.created_at at time zone 'Asia/Macau'))::date
         = date_trunc('month', public.macau_date())::date;

  if v_cap = 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'MONTHLY_CAP');
  end if;

  if v_used >= v_cap then
    return jsonb_build_object(
      'ok', true, 'skipped', true, 'reason', 'MONTHLY_CAP',
      'used', v_used, 'cap', v_cap
    );
  end if;

  begin
    perform public.credit_points(
      p_referrer, v_points, '邀請好友獎勵', 'referral', p_new_user
    );
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end;

  return jsonb_build_object(
    'ok', true, 'points', v_points, 'used', v_used + 1, 'cap', v_cap
  );
end;
$$;

comment on function public.award_referral(uuid, uuid) is
  '邀請獎（admin／service_role）：ref_id=被邀請人 id 防重；月上限讀 referral_monthly_cap，'
  '金額讀 referral_bonus。R1 只做管理員手動補發。';

create or replace function public.award_birthday(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer := public.setting_num('birthday_bonus', 100)::int;
  v_year   integer := date_part('year', now() at time zone 'Asia/Macau')::int;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  end if;

  -- 同一年（Asia/Macau）已發過
  if exists (
    select 1 from public.point_transactions t
     where t.user_id = p_user_id
       and t.ref_type = 'birthday'
       and date_part('year', t.created_at at time zone 'Asia/Macau')::int = v_year
  ) then
    return jsonb_build_object(
      'ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED_YEAR', 'year', v_year
    );
  end if;

  begin
    perform public.credit_points(
      p_user_id, v_points, v_year || ' 年生日禮', 'birthday', p_user_id
    );
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ALREADY_AWARDED');
  end;

  return jsonb_build_object('ok', true, 'points', v_points, 'year', v_year);
end;
$$;

comment on function public.award_birthday(uuid) is
  '生日禮（admin／service_role）：同一 Asia/Macau 年份只發一次，金額讀 birthday_bonus。'
  'R1 無 profiles.birthday 欄位，只做管理員手動補發；R2 再自動化。';

revoke all on function public.award_referral(uuid, uuid) from public, anon, authenticated;
revoke all on function public.award_birthday(uuid) from public, anon, authenticated;

do $$ begin raise notice 'STEP 7 OK — award_referral / award_birthday'; end $$;


-- ------------------------------------------------------------
-- STEP 8：award_monthly_if_qualified（create or replace，簽名與 boolean 不變）
--   變更點只有兩處：
--     ① 金額改讀 monthly_points_bonus（預設 1000）
--        舊 key monthly_bonus_points=200 保留給舊優惠券機制，不再被本函式使用
--     ② 發分改走 credit_points（原本 add_points 在 service_role 下會 raise）
--   其餘（達標門檻 monthly_goal_km、發券、同月只發一次）完全照舊。
--   授權：admin 或 service_role 或無 JWT（pg_cron 以 postgres 執行）。
-- ------------------------------------------------------------
create or replace function public.award_monthly_if_qualified(p_user_id uuid, p_month text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(10, 2);
  v_goal  numeric := public.setting_num('monthly_goal_km', 300);
  v_bonus integer := public.setting_num('monthly_points_bonus', 1000)::int;
begin
  -- 已登入但不是管理員 → 直接拒絕；無 JWT（service_role／pg_cron）放行
  if auth.uid() is not null
     and not public.is_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;

  select coalesce(sum(km), 0) into v_total
    from public.run_submissions
   where user_id = p_user_id and period_month = p_month and status = 'approved';

  if v_total < v_goal then
    return false;
  end if;

  -- 該月已發過就不再發（沿用 coupons.month_awarded 作冪等鍵）
  if exists (
    select 1 from public.coupons
     where user_id = p_user_id and month_awarded = p_month
  ) then
    return false;
  end if;

  perform public.credit_points(
    p_user_id,
    v_bonus,
    '月度任務達成獎勵（' || p_month || ' 滿 ' || v_goal || 'km）',
    'monthly_bonus',
    null
  );

  insert into public.coupons (code, user_id, title, description, month_awarded, expires_at)
  values (
    public.gen_coupon_code(p_month),
    p_user_id,
    '月度 ' || v_goal || 'km 達成優惠券',
    '恭喜完成 ' || p_month || ' 月度 ' || v_goal
      || ' 公里挑戰，可於 MSW 街健館兌換指定優惠。',
    p_month,
    (date_trunc('month', (p_month || '-01')::date) + interval '3 months')::date
  );

  return true;
end;
$$;

comment on function public.award_monthly_if_qualified(uuid, text) is
  '月度達標（簽名與 boolean 不變）：門檻讀 monthly_goal_km、獎金讀 monthly_points_bonus（預設 1000）；'
  '發分改走 credit_points 以便 service_role 呼叫；同月以 coupons.month_awarded 冪等。';

revoke all on function public.award_monthly_if_qualified(uuid, text)
  from public, anon, authenticated;

do $$ begin raise notice 'STEP 8 OK — award_monthly_if_qualified 改讀 monthly_points_bonus'; end $$;


-- ------------------------------------------------------------
-- STEP 9：review_checkin（create or replace，回傳型別必須是 void）
--   原有：批准 → training_checkins.status='approved' + 簽到分（points_per_checkin，預設 10）
--   新增：同一交易內再發活動獎（event_participation，ref_id = checkin id）
--   兩筆是「獨立 ledger」，互不取代（D-02 定案）。
--   注意：活動獎若被跳過（已發過／上限），簽到分照發，不 raise。
-- ------------------------------------------------------------
create or replace function public.review_checkin(
  p_checkin_id uuid,
  p_approve    boolean,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.training_checkins%rowtype;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以確認簽到';
  end if;

  select * into v_c from public.training_checkins where id = p_checkin_id for update;
  if not found then
    raise exception '找不到該簽到紀錄';
  end if;
  if v_c.status <> 'pending' then
    raise exception '該簽到已確認過';
  end if;

  if p_approve then
    update public.training_checkins
       set status = 'approved', admin_note = p_admin_note, confirmed_by = auth.uid()
     where id = p_checkin_id;

    -- ① 簽到分（原有行為，金額 points_per_checkin）
    perform public.add_points(
      v_c.user_id,
      public.setting_num('points_per_checkin', 10)::int,
      '定期訓練簽到',
      'checkin',
      v_c.id
    );

    -- ② 活動出席獎（R1 新增，獨立 ledger；ref_id = checkin id 防同一次簽到重發）
    perform public.award_event_participation(v_c.user_id, v_c.id);
  else
    update public.training_checkins
       set status = 'rejected', admin_note = p_admin_note, confirmed_by = auth.uid()
     where id = p_checkin_id;
  end if;
end;
$$;

comment on function public.review_checkin(uuid, boolean, text) is
  '後台確認訓練簽到（管理員）：批准時發簽到分（points_per_checkin）並另發活動出席獎'
  '（event_participation，ref_id=checkin id，金額 event_bonus）。回傳 void（不可改）。';

revoke all on function public.review_checkin(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_checkin(uuid, boolean, text) to authenticated;

do $$ begin raise notice 'STEP 9 OK — review_checkin（+10 與 +50 並存）'; end $$;


-- ------------------------------------------------------------
-- STEP 10：review_run_submission（create or replace，維持 jsonb，只加 key）
--   原有：批准 → 里程分（points_per_km）＋ total_km 累加 ＋ 月達標檢查
--   新增：同一交易內再發打卡獎（checkin_bonus，ref_id = submission id，週上限 5）
--   回傳新增 key：checkin_award（被跳過時為 skipped 的 jsonb）
-- ------------------------------------------------------------
create or replace function public.review_run_submission(
  p_submission_id uuid,
  p_approve       boolean,
  p_admin_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub      public.run_submissions%rowtype;
  v_awarded  boolean := false;
  v_checkin  jsonb;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以審核提交';
  end if;

  select * into v_sub from public.run_submissions where id = p_submission_id for update;
  if not found then
    raise exception '找不到該提交';
  end if;
  if v_sub.status <> 'pending' then
    raise exception '該提交已審核過';
  end if;

  if p_approve then
    update public.run_submissions
       set status = 'approved',
           admin_note = p_admin_note,
           reviewed_by = auth.uid(),
           reviewed_at = now()
     where id = p_submission_id;

    update public.profiles
       set total_km = total_km + v_sub.km
     where id = v_sub.user_id;

    -- 每公里積分（可在後台 app_settings 調整）
    perform public.add_points(
      v_sub.user_id,
      round(v_sub.km * public.setting_num('points_per_km', 1))::int,
      '跑步里程 ' || v_sub.km || ' km（' || v_sub.period_month || '）',
      'run',
      v_sub.id
    );

    -- 運動打卡獎（R1 新增，獨立 ledger；週上限 checkin_weekly_cap）
    v_checkin := public.award_checkin_bonus(v_sub.user_id, v_sub.id);

    select public.award_monthly_if_qualified(v_sub.user_id, v_sub.period_month) into v_awarded;
  else
    update public.run_submissions
       set status = 'rejected',
           admin_note = p_admin_note,
           reviewed_by = auth.uid(),
           reviewed_at = now()
     where id = p_submission_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'monthly_awarded', v_awarded,
    'checkin_award', coalesce(v_checkin, '{}'::jsonb)
  );
end;
$$;

comment on function public.review_run_submission(uuid, boolean, text) is
  '後台審核跑步提交（管理員）：批准時發里程分（points_per_km）、累加 total_km、'
  '發打卡獎（checkin_bonus，ref_id=submission id，週上限）並檢查月達標；回傳 jsonb（新增 checkin_award）。';

revoke all on function public.review_run_submission(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_run_submission(uuid, boolean, text) to authenticated;

do $$ begin raise notice 'STEP 10 OK — review_run_submission（含打卡獎）'; end $$;


-- ------------------------------------------------------------
-- STEP 11：admin_run_monthly_settlement — 月結算（管理員手動觸發）
--   · p_month 省略 → 用本月（Asia/Macau 的 YYYY-MM）
--   · 冪等：award_monthly_if_qualified 以 coupons.month_awarded 判重，
--           同月重跑天然回 0 筆
--   · 掃描對象：monthly_running_stats 有該月 approved 紀錄的會員（不論達標）
--   · 回傳：{ok, month, scanned, awarded}
-- ------------------------------------------------------------
create or replace function public.admin_run_monthly_settlement(p_month text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month   text := coalesce(
                       nullif(btrim(coalesce(p_month, '')), ''),
                       to_char(public.macau_date(), 'YYYY-MM')
                     );
  v_scanned integer := 0;
  v_awarded integer := 0;
  r         record;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  if v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_MONTH', 'month', v_month);
  end if;

  for r in
    select distinct s.user_id
      from public.monthly_running_stats s
     where s.period_month = v_month
  loop
    v_scanned := v_scanned + 1;
    if public.award_monthly_if_qualified(r.user_id, v_month) then
      v_awarded := v_awarded + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'month', v_month,
    'scanned', v_scanned,
    'awarded', v_awarded
  );
end;
$$;

comment on function public.admin_run_monthly_settlement(text) is
  '月結算（管理員限定，R1 手動觸發）：對指定月份（預設本月）掃描有跑步紀錄的會員，'
  '逐個呼叫 award_monthly_if_qualified；同月重跑回 awarded=0。回傳 {ok,month,scanned,awarded}。';

revoke all on function public.admin_run_monthly_settlement(text)
  from public, anon, authenticated;
grant execute on function public.admin_run_monthly_settlement(text) to authenticated;

do $$ begin raise notice 'STEP 11 OK — admin_run_monthly_settlement'; end $$;


-- ------------------------------------------------------------
-- STEP 12：ACL 總表（這裡再跑一次是「防手滑」的第二道，
--   即使上面某段被略過，權限狀態仍然正確）
--   預設 EXECUTE 給 PUBLIC → 必須明確 revoke，否則 anon 也叫得動。
-- ------------------------------------------------------------
revoke all on function public.macau_date() from public;
revoke all on function public.macau_week_start() from public;
revoke all on function public.credit_points(uuid, integer, text, text, uuid) from public;
revoke all on function public.award_signup_bonus(uuid) from public;
revoke all on function public.trg_profile_signup_bonus() from public;
revoke all on function public.award_event_participation(uuid, uuid) from public;
revoke all on function public.award_checkin_bonus(uuid, uuid) from public;
revoke all on function public.award_referral(uuid, uuid) from public;
revoke all on function public.award_birthday(uuid) from public;
revoke all on function public.award_monthly_if_qualified(uuid, text) from public;

revoke all on function public.macau_date() from anon;
revoke all on function public.macau_week_start() from anon;
revoke all on function public.credit_points(uuid, integer, text, text, uuid) from anon;
revoke all on function public.award_signup_bonus(uuid) from anon;
revoke all on function public.award_event_participation(uuid, uuid) from anon;
revoke all on function public.award_checkin_bonus(uuid, uuid) from anon;
revoke all on function public.award_referral(uuid, uuid) from anon;
revoke all on function public.award_birthday(uuid) from anon;
revoke all on function public.award_monthly_if_qualified(uuid, text) from anon;
revoke all on function public.award_daily_login() from anon;
revoke all on function public.admin_run_monthly_settlement(text) from anon;

-- 會員只可直呼這三支（其餘靠 definer 內部呼叫，owner 權限不受影響）
grant execute on function public.award_daily_login() to authenticated;
grant execute on function public.admin_run_monthly_settlement(text) to authenticated;
grant execute on function public.macau_date() to authenticated;
grant execute on function public.macau_week_start() to authenticated;

do $$ begin raise notice 'STEP 12 OK — ACL（revoke public/anon，grant 只給必要者）'; end $$;


-- =============================================================
-- 執行後驗證（在 SQL Editor 逐段執行；預期結果寫在 → 後面）
-- =============================================================
-- ① 函式都在，且 SECURITY DEFINER 生效（→ prosecdef 全 true）
-- select proname, prosecdef, pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('macau_date','macau_week_start','credit_points','award_signup_bonus',
--                    'award_daily_login','award_event_participation','award_checkin_bonus',
--                    'award_referral','award_birthday','award_monthly_if_qualified',
--                    'review_checkin','review_run_submission','admin_run_monthly_settlement')
--  order by proname;
--
-- ② 4 支既有函式簽名未變（→ 0 列；有任何一列代表多出多載，後台會壞）
-- select proname, pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('award_monthly_if_qualified','review_checkin','review_run_submission')
--  group by proname, args
-- having count(*) > 1;
--
-- ③ review_checkin 仍回傳 void（→ rettype = void）
-- select proname, pg_get_function_result(oid) as ret
--   from pg_proc
--  where pronamespace = 'public'::regnamespace and proname = 'review_checkin';
--
-- ④ 權限：anon 全 false、authenticated 只有預期的幾支為 true
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute')          as anon_can,
--        has_function_privilege('authenticated', p.oid, 'execute') as auth_can
--   from pg_proc p
--  where p.pronamespace = 'public'::regnamespace
--    and p.proname in ('credit_points','award_daily_login','award_event_participation',
--                      'award_checkin_bonus','award_referral','award_birthday',
--                      'award_signup_bonus','admin_run_monthly_settlement')
--  order by p.proname;
--   → anon_can 全 false；auth_can 只有 award_daily_login / admin_run_monthly_settlement 為 true
--
-- ⑤ 註冊獎 trigger 在（→ 1 列 on_profile_signup_bonus）
-- select tgname from pg_trigger
--  where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
-- ⑥ 設定值可被函式讀到（→ 1000）
-- select public.setting_num('monthly_points_bonus', 1000);
--
-- ⑦ 時間函式（→ 今天的澳門日期、本週一）
-- select public.macau_date(), public.macau_week_start();
--
-- ⑧ 端到端（用管理員 JWT 從網站／API 呼叫，SQL Editor 沒有 JWT 會回 NOT_ADMIN）
--    select public.award_daily_login();                 -- 第一次 {ok:true,points:10}，第二次 skipped
--    select public.award_birthday('<uuid>');            -- 同年再打 skipped
--    select public.admin_run_monthly_settlement();      -- 同月再打 awarded=0
-- =============================================================
