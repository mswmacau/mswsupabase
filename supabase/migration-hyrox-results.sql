-- =============================================================
-- HYROX 完賽排行榜 + 活動相簿多連結（資料層）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行（一次跑完）
-- 幂等：create table if not exists / drop … if exists / create or replace
--       / 約束先 drop 再 add / on conflict do nothing
--       本檔從頭到尾可重複執行，第二次跑不會報錯，也不會改動既有資料
-- Owner：白客（backend-engineer）｜方案：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §1.4、§3.2
-- =============================================================
--
-- 【這一檔在建什麼】
--   §1  hyrox_divisions   比賽類別參考表（種子 8 筆，之後加組別＝insert 一筆）
--   §2  hyrox_results     完賽成績提交（pending → approved / rejected）
--   §3  hyrox_results_public  公開榜檢視（只出必要欄位，無 user_id／電話／email）
--   §4  RLS（逐字抄 run_submissions 四條政策，改表名）
--   §5  event_album_links 活動相簿多連結（每場 0–5 筆，外開按鈕用）
--   §6  讓 PostgREST 立刻看到新表／新檢視
--   §7  執行後驗證（可直接貼上跑的查詢）
--   §8  回滾段（註解形式）
--
-- 【與方案 §1.4 草式的一處必要偏離（白客自審發現）】
--   方案草式把「單人類別不得填隊伍欄位」寫成 CHECK 約束，但該 CHECK 內含
--   子查詢（division_code in (select code from hyrox_divisions where …)），
--   Postgres 不允許（會直接報 "cannot use subquery in check constraint"，
--   整支 migration 在 Dashboard 上貼下去就失敗）。
--   改用 BEFORE INSERT OR UPDATE 觸發器（hyrox_results_guard）實現完全相同
--   的語意 —— 與 migration-races.sql 的 race_entries_guard 同一個範式
--   （跨表一致性檢查本來就該用 definer 觸發器，RLS 與 CHECK 都表達不了）。
--
-- 【設計要點（照方案拍板）】
--   · 成績存 finish_seconds integer（排序、比較、防錯都在 DB 層；HH:MM:SS
--     只是顯示格式，server 解析一次）。範圍 60–86399。
--   · 一列＝一隊：單人類別 team_name/teammates 必須空；雙人/四人 team_name
--     必填、teammates 人數＝team_size−1（0–3 人，自由文字，不關聯會員帳號）。
--   · 賽事識別用自由文字 race_name + race_date，不 FK events（廣州/香港站
--     是 HYROX 官方賽事，不是本站 events 的記錄）。
--   · 截圖重用 run-screenshots 私有桶（{uid}/ 前綴），storage 政策零改動。
--   · 公開榜 view 只排除 is_test（方案 §6.2 Q-1 拍板：管理員本人參賽上榜，
--     完賽時間是單次客觀事實；要改回連 role 一起排除，改 view 一行即可）。
--
-- 【資料表變更摘要】
--   新增表：hyrox_divisions / hyrox_results / event_album_links
--   新增檢視：hyrox_results_public
--   新增函式：hyrox_results_guard()（觸發器用）
--   既有表：一個欄位都不改；既有資料：一列都不動
--   storage：零改動（截圖沿用 run-screenshots 私有桶的既有政策）
-- =============================================================


-- ------------------------------------------------------------
-- §1  hyrox_divisions — 比賽類別參考表
--
--      為什麼用參考表而不是寫死 CHECK：香港站/來年會有新組別
--      （HYROX 官方會加 Division）。加新組別＝insert 一筆，零改碼。
--      label 是站主原話（方案 §5 凍結文案第 3 條），屬站主提供文案。
-- ------------------------------------------------------------
create table if not exists public.hyrox_divisions (
  code       text primary key,
  label      text not null unique,
  team_size  integer not null default 1 check (team_size between 1 and 4),
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

comment on table public.hyrox_divisions is
  'HYROX 完賽排行榜的比賽類別（參考表）。加新組別＝insert 一筆；停用舊組別＝is_active=false（既有成績不受影響，只影響新提交與榜單顯示）';
comment on column public.hyrox_divisions.code is
  '類別代碼（穩定識別碼，前端以此傳值；改 label 不改 code）';
comment on column public.hyrox_divisions.label is
  '顯示名稱（站主原話，凍結文案 §5 第 3 條）';
comment on column public.hyrox_divisions.team_size is
  '每隊人數：1 單人 / 2 雙人 / 4 四人接力；決定 team_name/teammates 是否必填';
comment on column public.hyrox_divisions.is_active is
  'false = 停用：新提交不收、公開榜不顯示該類別；既有已核可成績保留在表內';

-- 護欄（先 drop 再 add，確保可重複執行；與後台 API 驗證口徑一致）
alter table public.hyrox_divisions drop constraint if exists hyrox_divisions_label_len;
alter table public.hyrox_divisions add constraint hyrox_divisions_label_len
  check (length(btrim(label)) between 1 and 40);

alter table public.hyrox_divisions drop constraint if exists hyrox_divisions_sort_range;
alter table public.hyrox_divisions add constraint hyrox_divisions_sort_range
  check (sort_order between -9999 and 9999);

-- 種子 8 筆（站主原話的類別名；sort_order 留 10 的間隔，方便日後插在中間）
insert into public.hyrox_divisions (code, label, team_size, sort_order, is_active) values
  ('men_open',      '男子單人',      1, 10, true),
  ('men_open_pro',  '男子單人 Pro',  1, 20, true),
  ('women_open',    '女子單人',      1, 30, true),
  ('women_open_pro','女子單人 Pro',  1, 40, true),
  ('men_double',    '男子雙人',      2, 50, true),
  ('women_double',  '女子雙人',      2, 60, true),
  ('mixed_double',  '混合雙人',      2, 70, true),
  ('mixed_relay',   '混合四人',      4, 80, true)
on conflict (code) do nothing;

-- 前台類別 chips 與公開榜的排序依據
create index if not exists idx_hyrox_divisions_sort
  on public.hyrox_divisions (sort_order, code);


-- ------------------------------------------------------------
-- §2  hyrox_results — 完賽成績提交
--      提交列：pending →（管理員核可）approved /（拒絕）rejected
-- ------------------------------------------------------------
create table if not exists public.hyrox_results (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  division_code  text not null references public.hyrox_divisions(code),
  race_name      text not null check (length(btrim(race_name)) between 1 and 80),
  race_date      date not null,
  finish_seconds integer not null check (finish_seconds between 60 and 86399),
  team_name      text check (team_name is null or length(btrim(team_name)) between 1 and 60),
  teammates      jsonb not null default '[]'::jsonb check (jsonb_typeof(teammates) = 'array'),
  image_path     text not null,
  note           text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  admin_note     text,
  reviewed_by    uuid references public.profiles(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.hyrox_results is
  'HYROX 完賽成績提交（會員上傳截圖＋成績，管理員核可後上公開榜）。體驗複製 run_submissions';
comment on column public.hyrox_results.finish_seconds is
  '完賽時間（秒）。HH:MM:SS 只是顯示格式，server 解析一次後只存整數；範圍 60–86399';
comment on column public.hyrox_results.team_name is
  '隊伍名稱。team_size=1 的類別必須 null；team_size>1 必填（觸發器強制）';
comment on column public.hyrox_results.teammates is
  '隊友姓名（自由文字陣列，不關聯會員帳號）。單人類別必須 []；隊伍類別人數＝team_size−1（觸發器強制）';
comment on column public.hyrox_results.image_path is
  'run-screenshots 私有桶內 {uid}/… 路徑（與跑步截圖同一個桶、同一套政策）';
comment on column public.hyrox_results.race_name is
  '賽事名稱（自由文字，站主審核時看）。HYROX 官方賽事不是本站 events，刻意不 FK';
comment on column public.hyrox_results.race_date is
  '比賽日期（YYYY-MM-DD，不可晚於今天——由 API 驗證）';

-- 長度護欄（先 drop 再 add，可重複執行）
alter table public.hyrox_results drop constraint if exists hyrox_results_note_len;
alter table public.hyrox_results add constraint hyrox_results_note_len
  check (note is null or length(note) <= 200);

alter table public.hyrox_results drop constraint if exists hyrox_results_admin_note_len;
alter table public.hyrox_results add constraint hyrox_results_admin_note_len
  check (admin_note is null or length(admin_note) <= 500);

-- 截圖路徑護欄：{uid}/{file} 形狀、擋相對跳脫與反斜線
-- （「必須以本人 uid/ 開頭」由 API 驗，storage 的 RLS 政策是最終防線）
alter table public.hyrox_results drop constraint if exists hyrox_results_image_path_fmt;
alter table public.hyrox_results add constraint hyrox_results_image_path_fmt check (
  length(image_path) between 1 and 500
  and position('..' in image_path) = 0
  and position(chr(92) in image_path) = 0          -- chr(92) = 反斜線，擋 Windows 路徑
  and image_path !~ '^/'
  and image_path ~ '/'
);

-- 一人同一類別同一天只能提交一筆（防手滑重複）。
-- 同隊兩位隊友各自提交同一成績：unique 擋不住（不同 user_id），
-- 由管理端按「類別＋日期＋相近時間」排序人工判重（方案 R-03，v1 不做自動判重）。
alter table public.hyrox_results drop constraint if exists hyrox_results_user_division_date_key;
alter table public.hyrox_results add constraint hyrox_results_user_division_date_key
  unique (user_id, division_code, race_date);

-- 公開榜查詢：類別內時間升冪（部分索引只收 approved，榜再長也不拖慢）
create index if not exists idx_hyrox_results_board
  on public.hyrox_results (division_code, finish_seconds)
  where status = 'approved';

-- 管理端待審清單：status + 建立時間
create index if not exists idx_hyrox_results_status
  on public.hyrox_results (status, created_at);

-- 會員自己的提交清單（unique key 的前綴已覆蓋 user_id，這裡補時間排序的複合）
create index if not exists idx_hyrox_results_user
  on public.hyrox_results (user_id, created_at desc);


-- ------------------------------------------------------------
-- §2.1  hyrox_results_guard — 隊伍欄位與類別的一致性（BEFORE 觸發器）
--
--        為什麼不是 CHECK 約束（方案草式的偏離，理由見檔頭）：
--        「這個類別是單人還是隊伍」存在 hyrox_divisions，CHECK 不可以含
--        子查詢；RLS 的 with check 也表達不了跨表值。definer 觸發器最穩，
--        與 migration-races.sql 的 race_entries_guard 同一個範式。
--
--        語意（與 API 契約 §1.5-① 的驗證完全一致，這裡是最後一道防線，
--        正常流程永遠先被 API 的 400 擋下，不會走到觸發器的 raise）：
--          team_size = 1 → team_name 必須 null、teammates 必須 []
--          team_size > 1 → team_name 必填、teammates 人數 = team_size−1
--                          且每個元素都是 1–40 字的字串
-- ------------------------------------------------------------
create or replace function public.hyrox_results_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_size integer;
begin
  select d.team_size into v_size
    from public.hyrox_divisions d
   where d.code = new.division_code;

  if v_size is null then
    raise exception '找不到這個比賽類別。' using errcode = 'P0001';
  end if;

  if v_size = 1 then
    if new.team_name is not null then
      raise exception '單人類別不可以填隊伍名稱。' using errcode = 'P0001';
    end if;
    if new.teammates is distinct from '[]'::jsonb then
      raise exception '單人類別不可以填隊友。' using errcode = 'P0001';
    end if;
  else
    if new.team_name is null then
      raise exception '這個類別需要填寫隊伍名稱。' using errcode = 'P0001';
    end if;

    -- teammates 的陣列性質已有 CHECK 保證；這裡驗人數與每個元素的形狀
    if jsonb_array_length(new.teammates) <> v_size - 1 then
      raise exception '隊友人數與所選類別不符，請檢查。' using errcode = 'P0001';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(new.teammates) el
       where jsonb_typeof(el) <> 'string'
          or btrim(el #>> '{}') = ''
          or char_length(el #>> '{}') > 40
    ) then
      raise exception '隊友姓名格式錯誤。' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists hyrox_results_guard on public.hyrox_results;
create trigger hyrox_results_guard
  before insert or update on public.hyrox_results
  for each row execute function public.hyrox_results_guard();

-- 觸發器函式照本專案紀律收回 EXECUTE（預設會給 PUBLIC；觸發器內部呼叫不受影響）
revoke all on function public.hyrox_results_guard() from public, anon, authenticated;


-- ------------------------------------------------------------
-- §3  hyrox_results_public — 公開榜檢視（只出必要欄位）
--
--      · 無 user_id、無電話、無 email、無 image_path、無 admin_note
--      · public_code = substr(md5(id),1,8)：與里程榜 public_leaderboard
--        同一個不可逆演算法（migration-leaderboard-no-id.sql），必要時可對账
--      · 只出 approved；排除 is_test（Q-1 拍板：不排除 admin，理由見檔頭）
--      · 停用的類別（is_active=false）不出現在榜上，但既有成績列保留在底表
-- ------------------------------------------------------------
drop view if exists public.hyrox_results_public;

create view public.hyrox_results_public as
select
  r.id,
  d.code         as division_code,
  d.label        as division_label,
  d.team_size,
  r.race_name,
  r.race_date,
  r.finish_seconds,
  r.team_name,
  r.teammates,
  p.display_name,
  substr(md5(p.id::text), 1, 8) as public_code
from public.hyrox_results r
join public.profiles p        on p.id = r.user_id
join public.hyrox_divisions d on d.code = r.division_code
where r.status = 'approved'
  and p.is_test = false
  and d.is_active = true;

comment on view public.hyrox_results_public is
  'HYROX 完賽排行榜公開榜：只出必要欄位，不含 user_id／電話／email／截圖路徑；只出 approved 且排除測試帳號';

-- definer 語意 + security_barrier（理由與 migration-races.sql §4.5 完全相同）：
-- 公開頁只讀這個檢視、底表不給 anon；definer 繞過底表 RLS 是本檢視存在的目的。
-- 用 DO 包起來：security_invoker 是 PG15 的 reloption，舊版會拋錯，吞掉即可
-- （definer 本來就是檢視的預設行為，效果相同）。
do $$
begin
  begin
    execute 'alter view public.hyrox_results_public set (security_invoker = false, security_barrier = true)';
  exception when others then
    raise notice '設定 hyrox_results_public 的 reloption 失敗（PG < 15？）：%，改以預設 definer 行為執行', sqlerrm;
  end;
end $$;

-- 權限：檢視給 anon + authenticated（公開榜）；底表見 §4
revoke all on public.hyrox_results_public from anon, authenticated;
grant select on public.hyrox_results_public to anon, authenticated;


-- ------------------------------------------------------------
-- §4  RLS（逐字抄 run_submissions 四條政策，只改表名 —— schema.sql:822-836）
--
--      語意：
--        select：本人 or admin（會員之間不可互看）
--        insert：本人且 status='pending'（防自我核可）
--        delete：本人且 pending（已審核的不可刪，同 /api/runs DELETE）
--        update：只有 admin（核可/拒絕專用；會員端沒有任何 update 入口）
-- ------------------------------------------------------------
alter table public.hyrox_divisions enable row level security;
alter table public.hyrox_results   enable row level security;

-- §4.1 hyrox_divisions
--      · 讀：全部可讀（含停用類別——後台要能看到停用類別才能重新啟用；
--        與 training_classes 的 classes_select_all 同一個取捨，見
--        migration-training-schedule.sql:58-64）。前台要過濾 is_active。
--      · 寫：admin 全權
revoke all on public.hyrox_divisions from anon;
grant select on public.hyrox_divisions to anon, authenticated;
grant insert, update, delete on public.hyrox_divisions to authenticated;

drop policy if exists "divisions_select_all" on public.hyrox_divisions;
create policy "divisions_select_all" on public.hyrox_divisions
  for select using (true);

drop policy if exists "divisions_admin_all" on public.hyrox_divisions;
create policy "divisions_admin_all" on public.hyrox_divisions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- §4.2 hyrox_results
--      · anon 一律不可讀（公開榜只走 §3 的檢視）
revoke all on public.hyrox_results from anon;
grant select, insert, update, delete on public.hyrox_results to authenticated;

drop policy if exists "results_select_own_or_admin" on public.hyrox_results;
create policy "results_select_own_or_admin" on public.hyrox_results
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "results_insert_own" on public.hyrox_results;
create policy "results_insert_own" on public.hyrox_results
  for insert with check (auth.uid() = user_id and status = 'pending');

drop policy if exists "results_delete_own_pending" on public.hyrox_results;
create policy "results_delete_own_pending" on public.hyrox_results
  for delete using (auth.uid() = user_id and status = 'pending');

drop policy if exists "results_admin_update" on public.hyrox_results;
create policy "results_admin_update" on public.hyrox_results
  for update using (public.is_admin()) with check (public.is_admin());


-- ------------------------------------------------------------
-- §5  event_album_links — 活動相簿多連結（方案 §3.2）
--
--      站主會給「多個攝影師的雲端相簿連結」；events.album_url（單欄，
--      migration-races.sql §1）保持「主相簿」大按鈕，本表是按鈕列。
--      每場上限 5 筆由後台 API 把關（POST /api/admin/events/[id]/album-links）。
-- ------------------------------------------------------------
create table if not exists public.event_album_links (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  url        text not null check (url ~* '^https?://' and length(url) <= 500),
  label      text not null check (length(btrim(label)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.event_album_links is
  '活動相簿多連結（每場 0–5 筆，可命名可排序；前台外開新視窗按鈕，不做 iframe——各雲端相簿服務都擋嵌入）';
comment on column public.event_album_links.label is '按鈕文字，如「攝影師 A」；1–40 字';
comment on column public.event_album_links.sort_order is '顯示順序（升冪）';

-- 護欄（先 drop 再 add，可重複執行；與後台 API 驗證口徑一致）
alter table public.event_album_links drop constraint if exists event_album_links_sort_range;
alter table public.event_album_links add constraint event_album_links_sort_range
  check (sort_order between -9999 and 9999);

create index if not exists idx_event_album_links
  on public.event_album_links (event_id, sort_order);

-- RLS：讀全部（相簿連結非個資，賽事頁已對 archived 開放讀取）；寫只有 admin
alter table public.event_album_links enable row level security;

revoke all on public.event_album_links from anon;
grant select on public.event_album_links to anon, authenticated;
grant insert, update, delete on public.event_album_links to authenticated;

drop policy if exists "album_links_select_all" on public.event_album_links;
create policy "album_links_select_all" on public.event_album_links
  for select using (true);

drop policy if exists "album_links_admin_all" on public.event_album_links;
create policy "album_links_admin_all" on public.event_album_links
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ------------------------------------------------------------
-- §6  讓 PostgREST 立刻看到新表／新檢視（本專案踩過 PGRST202/205 的坑）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- §7  執行後驗證（在 SQL Editor 逐段跑；每段都應該回預期結果）
-- =============================================================
--
-- 7.1 種子 8 筆都在，team_size 正確
--   select code, label, team_size, sort_order, is_active
--     from public.hyrox_divisions order by sort_order;
--   → 8 列：men_open / men_open_pro / women_open / women_open_pro /
--     men_double / women_double / mixed_double / mixed_relay，
--     team_size 分別為 1/1/1/1/2/2/2/4
--
-- 7.2 三張表都存在
--   select to_regclass('public.hyrox_divisions'),
--          to_regclass('public.hyrox_results'),
--          to_regclass('public.event_album_links');
--   → 三個都不是 null
--
-- 7.3 公開榜檢視的欄位（不得出現 user_id / phone / email / image_path / admin_note）
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='hyrox_results_public'
--    order by ordinal_position;
--   → id, division_code, division_label, team_size, race_name, race_date,
--     finish_seconds, team_name, teammates, display_name, public_code（11 欄）
--
-- 7.4 政策清單（逐表核對：divisions 2 條、results 4 條、album_links 2 條）
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname='public'
--      and tablename in ('hyrox_divisions','hyrox_results','event_album_links')
--    order by tablename, policyname;
--
-- 7.5 匿名可讀檢視與 divisions、不可讀底表（用 anon key 直接打 PostgREST）
--   curl "$SUPABASE_URL/rest/v1/hyrox_results_public?select=*&limit=3" \
--        -H "apikey: $ANON_KEY"
--   → 200，回 []（還沒有資料）
--   curl "$SUPABASE_URL/rest/v1/hyrox_results?select=*&limit=3" \
--        -H "apikey: $ANON_KEY"
--   → 401/403（anon 沒有這個表的權限）
--
-- 7.6 會員不可自我核可（RLS with check 會擋）
--   用會員 JWT 直接打 PostgREST：
--   curl -X POST "$SUPABASE_URL/rest/v1/hyrox_results" \
--        -H "apikey: $ANON_KEY" -H "authorization: Bearer $USER_JWT" \
--        -H "content-type: application/json" \
--        -d '{"user_id":"<自己的 uuid>","division_code":"men_open",
--             "race_name":"測試","race_date":"2026-11-01",
--             "finish_seconds":5000,"image_path":"<uid>/x.jpg",
--             "status":"approved"}'
--   → 403（status 必須 pending）
--
-- 7.7 觸發器：單人類別填了隊伍名會被擋
--   同上但 status 改 "pending"、加 "team_name":"測試隊" → 應被觸發器拒絕
--   （錯誤訊息：單人類別不可以填隊伍名稱。）
--
-- 7.8 級聯：刪一筆測試提交，不影響其他資料
--   delete from public.hyrox_results where id = '<測試 uuid>';
-- =============================================================


-- =============================================================
-- §8  回滾段（本檔不執行；要回滾時把下面的註解解開、逐段跑）
--
--     ⚠️ 順序很重要：先拆檢視與政策，再拆表。中途停下會留下半套結構。
--     ⚠️ 回滾會刪掉所有完賽成績資料（含截圖路徑記錄；Storage 內的
--        截圖物件不會被刪，要清請另外處理）。上線後若要回滾，先備份：
--        select * from public.hyrox_results;
--
-- -- 8.1 檢視與其授權
-- drop view if exists public.hyrox_results_public;
--
-- -- 8.2 新表（cascade 會一起帶走政策、觸發器、索引、約束）
-- drop table if exists public.event_album_links;
-- drop table if exists public.hyrox_results;
-- drop table if exists public.hyrox_divisions;
--
-- -- 8.3 觸發器函式（表刪了函式還在，要另外清）
-- drop function if exists public.hyrox_results_guard();
--
-- -- 8.4 讓 PostgREST 重載
-- notify pgrst, 'reload schema';
--
-- 【不需要回滾的部分】
--   storage 的 run-screenshots 桶與政策：本檔一字未動，
--   完賽截圖與跑步截圖共用同一個私有桶，回滾後既有截圖不受影響。
--   events / profiles / event_registrations：本檔零改動。
-- =============================================================
