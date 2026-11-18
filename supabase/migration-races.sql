-- =============================================================
-- 賽事系統資料層（第一階段：賽事外殼 + 報名）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行（一次跑完）
-- 幂等：create table if not exists / drop … if exists / create or replace
--       本檔從頭到尾可重複執行，第二次跑不會報錯，也不會改動既有資料
--       （唯一例外：events.status 的 check 約束會被「放寬後重建」，見 §1.2）
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【這一檔在建什麼】
--   §1  events 追加 6 個欄位（純 additive）＋ 放寬 status 約束（必讀 §1.2）
--   §2  三張新表：race_categories（組別）／race_registrations（人層）／race_entries（人次層）
--   §3  兩個 SECURITY DEFINER 小函式（RLS 閘門用，見 §3 的理由）
--   §4  四個「只出數字」的檢視（公開頁只能讀這些，任何姓名都不在裡面）
--   §5  RLS 逐表政策
--   §6  events 讀取政策的必要補充（不加這條，前台賽事頁永遠是空的）
--   §7  讓 PostgREST 重載 schema
--   §8  執行後驗證（可直接貼上跑的查詢）
--   §9  回滾段（註解形式）
--
-- 【為什麼不重用 event_registrations】
--   supabase/migration-event-registrations.sql 的 event_registrations 有三個死結：
--     1. unique(event_id, user_id) → 一個人一場只能報一筆，但賽事要「雙人 + 接力」多報
--     2. 沒有姓名／電話以外的巴士、住宿欄位 → 後勤需求算不出來
--     3. 9 個付款欄位（payment_amount_cents / reviewed_by / disclaimer_accepted_at …）
--        的語意是「單筆報名一筆付款」，與賽事「一人一筆報名、多筆人次」衝突
--   與其在那張表上做破壞性改造（已經有線上資料），不如另建三張語意乾淨的表。
--
-- 【資料表變更摘要】
--   修改表：events（+6 欄位、+1 索引、status 約束放寬、+1 select 政策）
--   新增表：race_categories / race_registrations / race_entries
--   新增檢視：race_summary / race_day_summary / race_category_summary / race_logistics
--   新增函式：race_event_is_public / race_event_accepting / race_registrations_guard
--             / race_entries_guard
--   既有資料：一列都不改、一列都不刪
--
-- 【與 events 既有 status 值的關係（重要）】
--   events.status 原本只允許 'draft' / 'published' / 'archived'（schema-r6.sql:31-32）。
--   賽事需要 open（報名中）／closed（已截止）／photos（相片釋出）三個狀態。
--   本檔採「放寬約束」而非新增 race_status 欄位，理由：
--     · 前台／後台／RLS 只要看一個欄位，不必維護兩個狀態機的同步
--     · 三個舊值一字不動 → 一般活動（series is null）行為完全不變
--   代價：一般活動的後台下拉選單理論上會看到新的三個值。後台端點有白名單
--   （src/app/api/admin/events/route.ts 只接受舊三值），所以寫不進去，
--   實際上不會被誤用。
--
-- 【四個檢視為什麼是 definer 語意（security_invoker = false）】
--   需求是「公開頁只讀這四個檢視、底表不給 anon」。
--   · 若用 security_invoker = true：檢視以呼叫者（anon）權限執行，
--     anon 必須對 race_registrations / race_entries 有 select，否則
--     permission denied；而「底表不給 anon」是硬要求 → 兩者互斥。
--   · 故採 definer 語意（= Postgres 的預設，也是 owner=postgres 的檢視的行為）：
--     檢視以 owner 權限執行，繞過底表 RLS，只輸出聚合數字。
--   風險與對策：
--     · definer 物件的經典風險是 search_path 注入 → 本檔四個檢視的函式呼叫與
--       資料表全部寫成完整名稱（public.xxx），不依賴 search_path；
--       並加上 security_barrier = true。
--     · 只輸出 count/sum，不含姓名、電話、user_id → 即使被任意讀取，
--       也讀不到任何個資，最壞情況是看到某場賽事的報名人數。
--     · 已 cancelled 的報名一律不計入（見各檢視的 where）。
-- =============================================================


-- ------------------------------------------------------------
-- §1  events：追加欄位（純新增，不動既有列）
-- ------------------------------------------------------------

alter table public.events
  add column if not exists album_url            text,
  add column if not exists album_label          text,
  add column if not exists promo_on_home        boolean not null default false,
  add column if not exists promo_note           text,
  add column if not exists registration_deadline timestamptz,
  add column if not exists logistics_note       text;

comment on column public.events.album_url is '攝影師雲端相簿網址（外部連結，http/https）';
comment on column public.events.album_label is '相簿按鈕文字；空值時前台顯示「睇比賽相片」';
comment on column public.events.promo_on_home is '是否出現在主頁賽事帶（同一時間建議只有 1 場）';
comment on column public.events.promo_note is '主頁帶狀卡的一句話（≤120 字）';
comment on column public.events.registration_deadline is '報名截止時間；null = 不限（仍受 status 管制）';
comment on column public.events.logistics_note is '巴士／住宿／集合的自由文字，可手動編輯（≤2000 字）';

-- §1.1 新欄位的長度／格式護欄（與後台 API 的驗證口徑一致）
--      先 drop 再 add，確保可重複執行。
alter table public.events drop constraint if exists events_race_album_url_fmt;
alter table public.events add constraint events_race_album_url_fmt check (
  album_url is null
  or (length(album_url) <= 500 and album_url ~* '^https?://')
);

alter table public.events drop constraint if exists events_race_album_label_len;
alter table public.events add constraint events_race_album_label_len check (
  album_label is null or length(album_label) <= 20
);

alter table public.events drop constraint if exists events_race_promo_note_len;
alter table public.events add constraint events_race_promo_note_len check (
  promo_note is null or length(promo_note) <= 120
);

alter table public.events drop constraint if exists events_race_logistics_len;
alter table public.events add constraint events_race_logistics_len check (
  logistics_note is null or length(logistics_note) <= 2000
);

-- §1.2 放寬 status 約束（新增 open / closed / photos 三個賽事狀態）
--
--     為什麼用 DO 區塊掃描而不是「drop constraint events_status_check」：
--     內聯 check 的約束名由 Postgres 自動產生，若這張表在 Dashboard 上手動
--     調整過，名字可能不是 events_status_check；直接 drop 會 miss，
--     然後 add 一條新的 → 兩條並存 → 'open' 永遠寫不進去（AND 關係）。
--     這裡把所有「只約束 status、且與 end_date 無關」的 check 一併移除，再重建。
--     可重複執行：第二次跑時前一輪建的那條也會被掃到並重建，結果一致。
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.events'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~ '\mstatus\M'
       and pg_get_constraintdef(oid) !~ 'end_date'
  loop
    execute format('alter table public.events drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.events
  add constraint events_status_check
  check (status in ('draft', 'published', 'archived', 'open', 'closed', 'photos'));

-- §1.3 賽事常用查詢的索引
--      主頁賽事帶（promo_on_home = true 且 status in (open, closed) 且 end_date >= today）
create index if not exists idx_events_race_promo
  on public.events (event_date)
  where series = 'race' and promo_on_home;

-- 賽事列表／詳情（series='race' 一律先篩 series 再篩 status）
create index if not exists idx_events_race_status
  on public.events (status, event_date)
  where series = 'race';


-- ------------------------------------------------------------
-- §2  三張新表
-- ------------------------------------------------------------

-- §2.1 race_categories — 每場賽事的組別，可自訂，不寫死
--      多日賽事：day 讓 11/20、11/21、11/22 各自掛不同組別。
create table if not exists public.race_categories (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  day        date not null,
  name       text not null,
  team_size  integer not null default 1,
  fee_cents  integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.race_categories is '賽事組別（每場賽事、每一天可有不同組別，不寫死）';
comment on column public.race_categories.day is '比賽日；必須落在該賽事的 event_date～coalesce(end_date,event_date) 之間（由 API 驗證）';
comment on column public.race_categories.team_size is '每組人數：1 個人賽 / 2 雙人 / 4 接力…（1–8）';

alter table public.race_categories drop constraint if exists race_categories_name_len;
alter table public.race_categories add constraint race_categories_name_len
  check (length(btrim(name)) between 1 and 60);

alter table public.race_categories drop constraint if exists race_categories_team_size_range;
alter table public.race_categories add constraint race_categories_team_size_range
  check (team_size between 1 and 8);

alter table public.race_categories drop constraint if exists race_categories_fee_range;
alter table public.race_categories add constraint race_categories_fee_range
  check (fee_cents between 0 and 10000000);

alter table public.race_categories drop constraint if exists race_categories_sort_range;
alter table public.race_categories add constraint race_categories_sort_range
  check (sort_order between -9999 and 9999);

-- 同一天不可以有同名組別（後台 API 撞到 23505 時回 409）
alter table public.race_categories drop constraint if exists race_categories_event_day_name_key;
alter table public.race_categories add constraint race_categories_event_day_name_key
  unique (event_id, day, name);

create index if not exists idx_race_categories_event_day
  on public.race_categories (event_id, day, sort_order);


-- §2.2 race_registrations — 人層：一個人一筆，巴士／住宿掛這裡
create table if not exists public.race_registrations (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  full_name            text not null,
  phone                text not null,
  gender               text,
  needs_bus            boolean not null default false,
  bus_seats            integer not null default 0,
  needs_lodging        boolean not null default false,
  lodging_people       integer not null default 0,
  lodging_nights       integer not null default 0,
  payment_proof_path   text,
  payment_status       text not null default 'not_required',
  status               text not null default 'submitted',
  member_note          text,
  admin_note           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.race_registrations is '賽事報名（人層）：一個人一場一筆，巴士／住宿需求掛在這裡；進哪一組在 race_entries';
comment on column public.race_registrations.payment_status is 'not_required 免費 / pending 待審 / approved 已核准 / rejected 已退回；會員不可自行改（見 §5.2 與觸發器）';
comment on column public.race_registrations.status is 'submitted 已提交 / confirmed 已確認 / needs_info 需補資料 / cancelled 已取消';

alter table public.race_registrations drop constraint if exists race_registrations_full_name_len;
alter table public.race_registrations add constraint race_registrations_full_name_len
  check (length(btrim(full_name)) between 1 and 60);

alter table public.race_registrations drop constraint if exists race_registrations_phone_len;
alter table public.race_registrations add constraint race_registrations_phone_len
  check (length(btrim(phone)) between 5 and 30);

-- HYROX 分組需要性別；允許 null（既有會員資料未必有），由前台表單要求填寫
alter table public.race_registrations drop constraint if exists race_registrations_gender_check;
alter table public.race_registrations add constraint race_registrations_gender_check
  check (gender is null or gender in ('male', 'female'));

alter table public.race_registrations drop constraint if exists race_registrations_bus_seats_range;
alter table public.race_registrations add constraint race_registrations_bus_seats_range
  check (bus_seats between 0 and 20);

alter table public.race_registrations drop constraint if exists race_registrations_lodging_people_range;
alter table public.race_registrations add constraint race_registrations_lodging_people_range
  check (lodging_people between 0 and 20);

alter table public.race_registrations drop constraint if exists race_registrations_lodging_nights_range;
alter table public.race_registrations add constraint race_registrations_lodging_nights_range
  check (lodging_nights between 0 and 30);

alter table public.race_registrations drop constraint if exists race_registrations_payment_status_check;
alter table public.race_registrations add constraint race_registrations_payment_status_check
  check (payment_status in ('not_required', 'pending', 'approved', 'rejected'));

alter table public.race_registrations drop constraint if exists race_registrations_status_check;
alter table public.race_registrations add constraint race_registrations_status_check
  check (status in ('submitted', 'confirmed', 'needs_info', 'cancelled'));

alter table public.race_registrations drop constraint if exists race_registrations_member_note_len;
alter table public.race_registrations add constraint race_registrations_member_note_len
  check (member_note is null or length(member_note) <= 1000);

alter table public.race_registrations drop constraint if exists race_registrations_admin_note_len;
alter table public.race_registrations add constraint race_registrations_admin_note_len
  check (admin_note is null or length(admin_note) <= 1000);

-- 付款截圖路徑：與 run-screenshots 私有桶的 `{uid}/{file}` 形狀對齊，
-- 並擋掉相對跳脫與 Windows 路徑（chr(92) = 反斜線）
alter table public.race_registrations drop constraint if exists race_registrations_proof_path_fmt;
alter table public.race_registrations add constraint race_registrations_proof_path_fmt
  check (
    payment_proof_path is null
    or (
      length(payment_proof_path) between 1 and 500
      and position('..' in payment_proof_path) = 0
      and position(chr(92) in payment_proof_path) = 0
      and payment_proof_path !~ '^/'
    )
  );

-- 一個人一場一筆（多組別走 race_entries，不受此限制）
alter table public.race_registrations drop constraint if exists race_registrations_event_user_key;
alter table public.race_registrations add constraint race_registrations_event_user_key
  unique (event_id, user_id);

create index if not exists idx_race_registrations_event_status
  on public.race_registrations (event_id, status);

create index if not exists idx_race_registrations_user
  on public.race_registrations (user_id, created_at desc);

-- updated_at 自動維護（重用既有函式 public.touch_updated_at()，schema-r6.sql:48-56）
drop trigger if exists race_registrations_touch_updated_at on public.race_registrations;
create trigger race_registrations_touch_updated_at
  before update on public.race_registrations
  for each row execute function public.touch_updated_at();


-- §2.3 race_entries — 人次層：這個人跑哪一日哪一組，可多筆
create table if not exists public.race_entries (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.race_registrations(id) on delete cascade,
  category_id     uuid not null references public.race_categories(id) on delete cascade,
  teammate_names  text
);

comment on table public.race_entries is '賽事人次層：一筆報名可跑多個組別；隊友名由本人填';

alter table public.race_entries drop constraint if exists race_entries_teammates_len;
alter table public.race_entries add constraint race_entries_teammates_len
  check (teammate_names is null or length(teammate_names) <= 200);

alter table public.race_entries drop constraint if exists race_entries_reg_cat_key;
alter table public.race_entries add constraint race_entries_reg_cat_key
  unique (registration_id, category_id);

create index if not exists idx_race_entries_registration
  on public.race_entries (registration_id);

create index if not exists idx_race_entries_category
  on public.race_entries (category_id);


-- ------------------------------------------------------------
-- §3  兩個 RLS 閘門用的 SECURITY DEFINER 函式
--
--     為什麼要函式：政策（policy）裡的子查詢是用「呼叫者的權限」跑的，
--     也就是說 `exists (select 1 from public.events …)` 會再被 events 的 RLS
--     過濾一次。若直接寫子查詢，會員能不能報名就會意外取決於 events 的
--     匿名讀取政策（那條政策是給前台列表用的，語意不同）。
--     用 stable + security definer 的小函式把判斷固定下來，行為可預期、
--     也讓政策表示式短到能一眼看完。
-- ------------------------------------------------------------

/** 賽事是否對外可見（報名中／已截止／相片釋出） */
create or replace function public.race_event_is_public(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.events e
     where e.id = p_event_id
       and e.series = 'race'
       and e.status in ('open', 'closed', 'photos')
  );
$$;

/** 賽事是否仍在收報名（status='open' 且未過 registration_deadline） */
create or replace function public.race_event_accepting(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.events e
     where e.id = p_event_id
       and e.series = 'race'
       and e.status = 'open'
       and (e.registration_deadline is null or now() <= e.registration_deadline)
  );
$$;

-- 政策表示式會以呼叫者身分呼叫這兩個函式 → 必須有 execute 權限
grant execute on function public.race_event_is_public(uuid) to anon, authenticated;
grant execute on function public.race_event_accepting(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- §4  四個只出數字的檢視（公開頁只讀這些，不得含任何姓名）
--
--     語意定義：
--       registrations = 去重後的人數（race_registrations 列數）
--       entries       = 人次（race_entries 列數）
--       cancelled     = 一律不計入
--     「有賽事但 0 人報名」也要出一列（前台要顯示 0 而不是空白），
--     所以 race_summary 以 events 為主表 left join。
-- ------------------------------------------------------------

-- §4.1 race_summary — 每場賽事一列
drop view if exists public.race_summary;
create view public.race_summary as
select
  e.id                                                   as event_id,
  coalesce(r.registrations, 0)::int                       as registrations,
  coalesce(t.entries, 0)::int                             as entries,
  coalesce(r.bus_seats, 0)::int                           as bus_seats,
  coalesce(r.lodging_people, 0)::int                      as lodging_people,
  coalesce(r.lodging_nights, 0)::int                      as lodging_nights
from public.events e
left join (
  select
    rr.event_id,
    count(*)                                                         as registrations,
    sum(case when rr.needs_bus then rr.bus_seats else 0 end)         as bus_seats,
    sum(case when rr.needs_lodging then rr.lodging_people else 0 end) as lodging_people,
    sum(case when rr.needs_lodging then rr.lodging_nights else 0 end) as lodging_nights
  from public.race_registrations rr
  where rr.status <> 'cancelled'
  group by rr.event_id
) r on r.event_id = e.id
left join (
  select
    rr.event_id,
    count(*) as entries
  from public.race_entries en
  join public.race_registrations rr on rr.id = en.registration_id
  where rr.status <> 'cancelled'
  group by rr.event_id
) t on t.event_id = e.id
where e.series = 'race';

comment on view public.race_summary is '賽事彙總（只出數字，不含姓名）：人數、人次、巴士座位、住宿人數、住宿晚數';

-- §4.2 race_day_summary — 賽事 × 日期
drop view if exists public.race_day_summary;
create view public.race_day_summary as
select
  c.event_id                                                     as event_id,
  c.day                                                          as day,
  count(distinct r.id) filter (where r.status <> 'cancelled')::int as registrations,
  count(en.id) filter (where r.status <> 'cancelled')::int         as entries
from public.race_categories c
left join public.race_entries en on en.category_id = c.id
left join public.race_registrations r on r.id = en.registration_id
group by c.event_id, c.day;

comment on view public.race_day_summary is '賽事 × 日期彙總（只出數字）';

-- §4.3 race_category_summary — 賽事 × 日期 × 組別
drop view if exists public.race_category_summary;
create view public.race_category_summary as
select
  c.event_id                                                     as event_id,
  c.day                                                          as day,
  c.id                                                           as category_id,
  c.name                                                         as name,
  count(distinct r.id) filter (where r.status <> 'cancelled')::int as registrations,
  count(en.id) filter (where r.status <> 'cancelled')::int         as entries
from public.race_categories c
left join public.race_entries en on en.category_id = c.id
left join public.race_registrations r on r.id = en.registration_id
group by c.event_id, c.day, c.id, c.name;

comment on view public.race_category_summary is '賽事 × 日期 × 組別彙總（只出數字）';

-- §4.4 race_logistics — 賽事後勤（給後台訂車訂房用）
drop view if exists public.race_logistics;
create view public.race_logistics as
select
  rr.event_id                                                                       as event_id,
  count(*) filter (where rr.needs_bus)::int                                          as bus_people,
  coalesce(sum(case when rr.needs_bus then rr.bus_seats else 0 end), 0)::int         as bus_seats,
  coalesce(sum(case when rr.needs_lodging then rr.lodging_people else 0 end), 0)::int as lodging_people,
  coalesce(sum(case when rr.needs_lodging then rr.lodging_nights else 0 end), 0)::int as lodging_nights
from public.race_registrations rr
where rr.status <> 'cancelled'
group by rr.event_id;

comment on view public.race_logistics is '賽事後勤彙總（需巴士人數／座位、需住宿人數／晚數），不含姓名';

-- §4.5 明確標示 definer 語意 + security_barrier（理由見檔頭）
--
--     為什麼用 DO 區塊包起來：security_invoker 這個 reloption 是 PG15 才有的。
--     Supabase 的專案都是 15 以上，正常會成功；若在較舊的 Postgres 上執行，
--     這幾行會拋 "unrecognized parameter"，我們吞掉並印出 notice ——
--     因為「definer 語意」本來就是檢視的預設行為，效果完全相同。
do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'race_summary', 'race_day_summary', 'race_category_summary', 'race_logistics'
  ]
  loop
    begin
      execute format(
        'alter view public.%I set (security_invoker = false, security_barrier = true)',
        v_view
      );
    exception when others then
      raise notice '設定 % 的 reloption 失敗（PG < 15？）：%，改以預設 definer 行為執行', v_view, sqlerrm;
    end;
  end loop;
end $$;

-- §4.6 權限：只把「這四個檢視」的 select 給 anon / authenticated；底表不給 anon
revoke all on public.race_summary          from anon, authenticated;
revoke all on public.race_day_summary      from anon, authenticated;
revoke all on public.race_category_summary from anon, authenticated;
revoke all on public.race_logistics        from anon, authenticated;

grant select on public.race_summary          to anon, authenticated;
grant select on public.race_day_summary      to anon, authenticated;
grant select on public.race_category_summary to anon, authenticated;
grant select on public.race_logistics        to anon, authenticated;


-- ------------------------------------------------------------
-- §5  RLS：逐表政策
-- ------------------------------------------------------------

-- §5.1 race_categories
--      · anon / authenticated：只能讀「公開賽事」（series='race' 且 status in open/closed/photos）
--      · admin：全權
alter table public.race_categories enable row level security;

revoke all on public.race_categories from anon;
grant select on public.race_categories to anon, authenticated;
grant insert, update, delete on public.race_categories to authenticated;

drop policy if exists "race_categories_select_public" on public.race_categories;
create policy "race_categories_select_public" on public.race_categories
  for select to anon, authenticated
  using (public.race_event_is_public(event_id));

drop policy if exists "race_categories_admin_all" on public.race_categories;
create policy "race_categories_admin_all" on public.race_categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- §5.2 race_registrations
--      · select：本人 or admin（會員之間不可互看）
--      · insert：user_id = auth.uid() 且賽事仍在收報名
--      · update：本人且賽事仍開放（改完把 status 打回 submitted 由 API 做）
--      · delete：本人且賽事仍開放
--      · admin：全權（多條 permissive 政策之間是 OR，admin 那條會放行）
alter table public.race_registrations enable row level security;

revoke all on public.race_registrations from anon;
grant select, insert, update, delete on public.race_registrations to authenticated;

drop policy if exists "race_registrations_select_own_or_admin" on public.race_registrations;
create policy "race_registrations_select_own_or_admin" on public.race_registrations
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "race_registrations_insert_own" on public.race_registrations;
create policy "race_registrations_insert_own" on public.race_registrations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status in ('submitted', 'cancelled')
    and payment_status in ('not_required', 'pending')
    and public.race_event_accepting(event_id)
  );

drop policy if exists "race_registrations_update_own" on public.race_registrations;
create policy "race_registrations_update_own" on public.race_registrations
  for update to authenticated
  using (user_id = auth.uid() and public.race_event_accepting(event_id))
  with check (
    user_id = auth.uid()
    and status in ('submitted', 'cancelled')
  );

drop policy if exists "race_registrations_delete_own" on public.race_registrations;
create policy "race_registrations_delete_own" on public.race_registrations
  for delete to authenticated
  using (user_id = auth.uid() and public.race_event_accepting(event_id));

drop policy if exists "race_registrations_admin_all" on public.race_registrations;
create policy "race_registrations_admin_all" on public.race_registrations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- §5.2.1 會員不能自己把 status 改成 confirmed / payment_status 改成 approved
--
--       能「乾淨表達」的部分放在 with check（上面 update 政策）：
--         非 admin 只能寫 status in ('submitted','cancelled')
--       → 會員無法自我確認；這條擋得住，不需要觸發器。
--
--       不能乾淨表達的部分改用 BEFORE UPDATE 觸發器「強制覆寫」：
--       payment_status。若也寫進 with check（只允許 not_required/pending），
--       後果是「付款已核准的列整筆不可編輯」——會員連改巴士座位都會 403，
--       而且錯誤訊息還說不出原因。改成觸發器把新值默默還原成舊值，
--       語意精確（付款狀態只有管理員／系統能改），也不會鎖死整列。
--
--       另外 event_id / user_id 必須不可變（RLS 的 with check 看不到 OLD 值，
--       表達不了「不許搬家」），也一併在此擋。
create or replace function public.race_registrations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 報名歸屬不可變更：避免「把自己的報名改掛到別場賽事／別人名下」
  if new.event_id is distinct from old.event_id then
    raise exception '報名所屬賽事不可更改。' using errcode = 'P0001';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception '報名人不可以更改。' using errcode = 'P0001';
  end if;

  -- 以下兩條只約束「非管理員」；管理員走 race_registrations_admin_all 政策，
  -- 但觸發器對管理員同樣會執行，所以要先判斷身分。
  if not public.is_admin() then
    -- 付款狀態是對帳欄位：會員寫什麼都還原成原值
    new.payment_status := old.payment_status;

    -- 縱深防禦：即使 RLS 被誤關，會員也不能把自己改成已確認
    if new.status not in ('submitted', 'cancelled') then
      raise exception '報名狀態只能由管理員變更。' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists race_registrations_guard on public.race_registrations;
create trigger race_registrations_guard
  before update on public.race_registrations
  for each row execute function public.race_registrations_guard();


-- §5.3 race_entries
--      · 一律透過 join 到 registration 判斷 owner（RLS 子查詢在
--        race_registrations 上會再套用它的 select 政策，會員只看得到自己的列，
--        所以 `r.user_id = auth.uid()` 這個條件對會員是有效且充分的）
--      · admin：全權
alter table public.race_entries enable row level security;

revoke all on public.race_entries from anon;
grant select, insert, update, delete on public.race_entries to authenticated;

drop policy if exists "race_entries_select_own_or_admin" on public.race_entries;
create policy "race_entries_select_own_or_admin" on public.race_entries
  for select to authenticated
  using (
    exists (
      select 1 from public.race_registrations r
       where r.id = race_entries.registration_id
         and (r.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "race_entries_insert_own" on public.race_entries;
create policy "race_entries_insert_own" on public.race_entries
  for insert to authenticated
  with check (
    exists (
      select 1 from public.race_registrations r
       where r.id = race_entries.registration_id
         and r.user_id = auth.uid()
         and public.race_event_accepting(r.event_id)
    )
  );

drop policy if exists "race_entries_update_own" on public.race_entries;
create policy "race_entries_update_own" on public.race_entries
  for update to authenticated
  using (
    exists (
      select 1 from public.race_registrations r
       where r.id = race_entries.registration_id
         and r.user_id = auth.uid()
         and public.race_event_accepting(r.event_id)
    )
  )
  with check (
    exists (
      select 1 from public.race_registrations r
       where r.id = race_entries.registration_id
         and r.user_id = auth.uid()
         and public.race_event_accepting(r.event_id)
    )
  );

drop policy if exists "race_entries_delete_own" on public.race_entries;
create policy "race_entries_delete_own" on public.race_entries
  for delete to authenticated
  using (
    exists (
      select 1 from public.race_registrations r
       where r.id = race_entries.registration_id
         and r.user_id = auth.uid()
         and public.race_event_accepting(r.event_id)
    )
  );

drop policy if exists "race_entries_admin_all" on public.race_entries;
create policy "race_entries_admin_all" on public.race_entries
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- §5.3.1 完整性：組別必須屬於同一場賽事
--        RLS 表達不了「跨表值相等」的檢查（而且 race_categories 自身有 RLS，
--        子查詢結果會隨呼叫者變動），用 definer 觸發器最穩。
create or replace function public.race_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg_event uuid;
  v_cat_event uuid;
begin
  select r.event_id into v_reg_event
    from public.race_registrations r
   where r.id = new.registration_id;

  select c.event_id into v_cat_event
    from public.race_categories c
   where c.id = new.category_id;

  if v_reg_event is null then
    raise exception '找不到對應的報名。' using errcode = 'P0001';
  end if;
  if v_cat_event is null then
    raise exception '找不到對應的組別。' using errcode = 'P0001';
  end if;
  if v_reg_event <> v_cat_event then
    raise exception '這個組別不屬於同一場賽事。' using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists race_entries_guard on public.race_entries;
create trigger race_entries_guard
  before insert or update on public.race_entries
  for each row execute function public.race_entries_guard();


-- ------------------------------------------------------------
-- §6  events：賽事對外可見性（必要補充，不是可選項）
--
--     schema-r6.sql:68-70 的 events select 政策是
--         using (status = 'published' or public.is_admin())
--     而賽事列的 status 是 open / closed / photos → 匿名訪客一列都看不到，
--     前台賽事頁與主頁賽事帶會永遠空白。
--
--     這裡採「新增一條 permissive 政策」而非替換（同 migration-hyrox-photos.sql
--     §3 的做法）：多條 permissive 政策之間是 OR，原政策一字未動，
--     回滾只要 drop 這一條。draft / archived 仍然完全不對外可見。
-- ------------------------------------------------------------
drop policy if exists "events_select_race_public" on public.events;
create policy "events_select_race_public" on public.events
  for select to anon, authenticated
  using (series = 'race' and status in ('open', 'closed', 'photos'));


-- ------------------------------------------------------------
-- §7  讓 PostgREST 立刻看到新表／新檢視（本專案踩過 PGRST202/205 的坑）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- §8  執行後驗證（在 SQL Editor 逐段跑；每段都應該回預期結果）
-- =============================================================
--
-- 8.1 欄位都在
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='events'
--      and column_name in ('album_url','album_label','promo_on_home',
--                          'promo_note','registration_deadline','logistics_note');
--   → 應回 6 列
--
-- 8.2 status 約束只剩一條且包含新值
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.events'::regclass and contype='c';
--   → events_status_check 應為 CHECK (status = ANY (ARRAY['draft','published',
--     'archived','open','closed','photos']))，而且不應出現第二條只含舊三值的
--
-- 8.3 三張表與索引
--   select to_regclass('public.race_categories'),
--          to_regclass('public.race_registrations'),
--          to_regclass('public.race_entries');
--   → 三個都不是 null
--   select indexname from pg_indexes
--    where schemaname='public' and tablename like 'race\_%'
--    order by tablename, indexname;
--
-- 8.4 四個檢視都存在，且都不含姓名欄位
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('race_summary','race_day_summary',
--                         'race_category_summary','race_logistics')
--    order by table_name, ordinal_position;
--   → 四張都要有欄位；且不應出現 full_name / phone / teammate_names / user_id
--
-- 8.5 政策清單（逐表核對：race_categories 2 條、race_registrations 5 條、
--     race_entries 5 條，共 12 條；events 至少 3 條）
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname='public'
--      and tablename in ('race_categories','race_registrations','race_entries','events')
--    order by tablename, policyname;
--   → events 應為 events_select_published_or_admin、events_admin_all、
--     events_select_race_public（若跑過 migration-hyrox-photos.sql，另有
--     events_select_archived_public）
--
-- 8.6 匿名可讀檢視、不可讀底表（用 anon key 直接打 PostgREST）
--   curl "$SUPABASE_URL/rest/v1/race_summary?select=*" -H "apikey: $ANON_KEY"
--   → 200，回 JSON 陣列（没有資料時是 []）
--   curl "$SUPABASE_URL/rest/v1/race_registrations?select=*" -H "apikey: $ANON_KEY"
--   → 401/403（anon 沒有這個表的 select 權限）
--
-- 8.7 會員之間不可互看（用兩個不同會員的 token）
--   curl "$SUPABASE_URL/rest/v1/race_registrations?select=user_id" \
--        -H "apikey: $ANON_KEY" -H "authorization: Bearer $USER_A_JWT"
--   → 只回 A 自己的列
--
-- 8.8 會員不能自我確認（RLS with check 會擋）
--   curl -X PATCH "$SUPABASE_URL/rest/v1/race_registrations?id=eq.<自己那筆>" \
--        -H "apikey: $ANON_KEY" -H "authorization: Bearer $USER_A_JWT" \
--        -H "content-type: application/json" -d '{"status":"confirmed"}'
--   → 403（new row violates row-level security policy）
--   curl -X PATCH ".../race_registrations?id=eq.<自己那筆>" … -d '{"payment_status":"approved"}'
--   → 200 但 payment_status 仍是原值（觸發器強制覆寫）
--
-- 8.9 級聯：刪測試賽事，子資料一併消失
--   delete from public.events where id = '<測試賽事 uuid>';
--   select count(*) from public.race_registrations where event_id = '<同一 uuid>';  -- 0
--   select count(*) from public.race_entries en
--     join public.race_registrations r on r.id = en.registration_id
--    where r.event_id = '<同一 uuid>';  -- 0
-- =============================================================


-- =============================================================
-- §9  回滾段（本檔不執行；要回滾時把下面的註解解開、逐段跑）
--
--     ⚠️ 順序很重要：先拆政策與檢視，再拆表，最後才把 events 的欄位與
--        status 約束還原。中途停下來會留下半套結構。
--     ⚠️ 回滾會連帶刪掉所有賽事報名資料（含付款截圖路徑）。
--        上線後若要回滾，先把 race_registrations 匯出備份。
--
-- -- 9.1 檢視
-- drop view if exists public.race_logistics;
-- drop view if exists public.race_category_summary;
-- drop view if exists public.race_day_summary;
-- drop view if exists public.race_summary;
--
-- -- 9.2 events 的補充政策
-- drop policy if exists "events_select_race_public" on public.events;
--
-- -- 9.3 新表（cascade 會一起帶走政策、觸發器、索引）
-- drop table if exists public.race_entries;
-- drop table if exists public.race_registrations;
-- drop table if exists public.race_categories;
--
-- -- 9.4 觸發器函式與 RLS 閘門函式
-- drop function if exists public.race_entries_guard();
-- drop function if exists public.race_registrations_guard();
-- drop function if exists public.race_event_accepting(uuid);
-- drop function if exists public.race_event_is_public(uuid);
--
-- -- 9.5 events 的索引
-- drop index if exists public.idx_events_race_promo;
-- drop index if exists public.idx_events_race_status;
--
-- -- 9.6 events 的 status 約束還原成原本三值
-- --     ⚠️ 若線上還有 status in ('open','closed','photos') 的賽事列，
-- --        這一步會失敗（既有資料違反新約束）。先把那些列改成 published/archived：
-- --        update public.events set status='archived'
-- --         where series='race' and status in ('open','closed','photos');
-- --     alter table public.events drop constraint if exists events_status_check;
-- --     alter table public.events
-- --       add constraint events_status_check
-- --       check (status in ('draft','published','archived'));
--
-- -- 9.7 events 的新欄位與其護欄
-- --     alter table public.events drop constraint if exists events_race_album_url_fmt;
-- --     alter table public.events drop constraint if exists events_race_album_label_len;
-- --     alter table public.events drop constraint if exists events_race_promo_note_len;
-- --     alter table public.events drop constraint if exists events_race_logistics_len;
-- --     alter table public.events
-- --       drop column if exists album_url,
-- --       drop column if exists album_label,
-- --       drop column if exists promo_on_home,
-- --       drop column if exists promo_note,
-- --       drop column if exists registration_deadline,
-- --       drop column if exists logistics_note;
--
-- -- 9.8 讓 PostgREST 重載
-- notify pgrst, 'reload schema';
--
-- 【不需要回滾的部分】
--   storage bucket run-screenshots 與其政策（schema.sql:860-883）本檔一字未動，
--   賽事的付款截圖沿用同一個私有桶，回滾後既有截圖不受影響。
-- =============================================================
