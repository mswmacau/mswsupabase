-- =============================================================
-- HYROX 往期場次回顧相片：event_photos（＋ events 讀取政策的必要補充）
-- 日期：2026-11-01
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行（一次跑完）
-- 幂等：create table if not exists / drop policy if exists / drop constraint if exists
--       本檔從頭到尾可重複執行，第二次跑不會報錯、也不會改動既有資料
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【用途】
-- /hyrox 是每月一次的付費活動系列頁。已結束（status='archived'）的場次要在前台
-- 呈現「往期場次」並在單場詳情頁 /hyrox/[id] 展示回顧相片。本檔提供：
--   1. event_photos：一個場次可掛多張相片（路徑指向 site-assets 的 events/ 前綴）
--   2. events 的一條「補充」讀取政策：讓 archived 場次對匿名訪客可見（見 §2，必讀）
--
-- 【為什麼需要 §2：不改這條政策，往期回顧功能等於不存在】
-- schema-r6.sql:69-70 的 events select 政策是
--     using (status = 'published' or public.is_admin())
-- 也就是匿名訪客（anon）與會員（authenticated）**只讀得到 published**。
-- 前台查詢一律走不含 cookie 的匿名客戶端（src/lib/queries.ts 的 anonClient），
-- 若不補政策，`series='hyrox' and status='archived'` 的查詢永遠回 0 列。
-- §2 採「新增一條政策」而非替換既有政策：Postgres 的多條 permissive 政策之間是
-- OR 關係，新增只會放寬、不會動到原本那條，回滾時只需 drop 新政策。
-- 只放行 archived，draft 仍然完全不對外可見（草稿不會外洩）。
--
-- 【資料表變更摘要】
--   新增表：public.event_photos（1 張）
--   新增索引：event_photos_event_sort_idx
--   新增/調整政策：event_photos 四條、events 一條（僅新增）
--   既有表結構：一個欄位都沒改
--
-- 【不變的部分】
--   storage bucket site-assets 已是 public，且已有 siteassets_admin_all 政策
--   （for all to authenticated using is_admin()，見 schema-r6.sql:151-155），
--   所以後台 API 可以直接 remove 物件，本檔不需要再動 storage.objects。
-- =============================================================


-- ------------------------------------------------------------
-- 1. event_photos — 場次回顧相片
--    path 是 site-assets bucket 內的相對路徑（不是完整網址），
--    形如 events/202611/1730-ab12cd.jpg（與 src/lib/upload.ts 的 kind='event' 一致）。
--    前台一律用 publicAssetUrl(path)（src/lib/assets.ts:22）組公開網址。
-- ------------------------------------------------------------
create table if not exists public.event_photos (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  path       text not null,
  caption    text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.event_photos is 'HYROX 往期場次回顧相片（path 指向 site-assets 的 events/ 前綴；anon 可讀，只有管理員可寫）';
comment on column public.event_photos.path is 'site-assets bucket 內的相對路徑，如 events/202611/1730-ab12cd.jpg';
comment on column public.event_photos.caption is '相片說明（選填，≤300 字）';
comment on column public.event_photos.sort_order is '顯示順序（升冪；新增時由 API 取現有最大值 +10）';

-- 護欄：與後台 API 的驗證口徑對齊（src/app/api/admin/hyrox/photos/route.ts）。
-- 先 drop 再 add，確保本檔可重複執行。
alter table public.event_photos
  drop constraint if exists event_photos_path_fmt;
alter table public.event_photos
  add constraint event_photos_path_fmt check (
    length(path) between 1 and 300
    and path like 'events/%'
    and position('..' in path) = 0
    and position(chr(92) in path) = 0          -- chr(92) = 反斜線，擋 Windows 路徑與跳脫
  );

alter table public.event_photos
  drop constraint if exists event_photos_caption_len;
alter table public.event_photos
  add constraint event_photos_caption_len check (
    caption is null or length(caption) <= 300
  );

alter table public.event_photos
  drop constraint if exists event_photos_sort_range;
alter table public.event_photos
  add constraint event_photos_sort_range check (sort_order between -9999 and 9999);

-- 索引：查詢口徑一律是「某場次、依 sort_order」
create index if not exists event_photos_event_sort_idx
  on public.event_photos (event_id, sort_order);

-- ------------------------------------------------------------
-- 2. RLS：相片公開可讀，只有管理員可寫
--    （相片本來就是公開展示內容，select 給 anon 不會多露任何東西；
--      insert/update/delete 一律要 public.is_admin()）
-- ------------------------------------------------------------
alter table public.event_photos enable row level security;

drop policy if exists "event_photos_select_public" on public.event_photos;
create policy "event_photos_select_public" on public.event_photos
  for select to anon, authenticated
  using (true);

drop policy if exists "event_photos_admin_insert" on public.event_photos;
create policy "event_photos_admin_insert" on public.event_photos
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "event_photos_admin_update" on public.event_photos;
create policy "event_photos_admin_update" on public.event_photos
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "event_photos_admin_delete" on public.event_photos;
create policy "event_photos_admin_delete" on public.event_photos
  for delete to authenticated
  using (public.is_admin());

grant select on public.event_photos to anon, authenticated;
grant insert, update, delete on public.event_photos to authenticated;


-- ------------------------------------------------------------
-- 3. events 讀取政策補充（本次必需，理由見檔頭）
--
--    這裡是「新增」一條 permissive 政策，不是替換：
--    Postgres 的多條 permissive 政策之間是 OR，所以效果等同
--      using (status in ('published','archived') or public.is_admin())
--    但原本的 events_select_published_or_admin 一字未動，
--    要回滾只需 drop policy "events_select_archived_public" on public.events;
-- ------------------------------------------------------------
drop policy if exists "events_select_archived_public" on public.events;
create policy "events_select_archived_public" on public.events
  for select to anon, authenticated
  using (status = 'archived');


-- 讓 PostgREST 立刻看到新表（本專案踩過 PGRST202 的坑；可重複執行，無副作用）
notify pgrst, 'reload schema';


-- =============================================================
-- 執行後驗證（建議在 SQL Editor 逐段跑，或於後台／前台肉眼確認）
-- =============================================================
-- 1) 表與索引都在：
--      select to_regclass('public.event_photos');            -- 應回 event_photos
--      select indexname from pg_indexes
--       where tablename = 'event_photos';                     -- 應有 event_photos_event_sort_idx
--
-- 2) 政策清單：
--      select policyname, cmd, roles from pg_policies
--       where schemaname = 'public'
--         and tablename in ('event_photos','events')
--       order by tablename, policyname;
--      → event_photos 應有 select_public / admin_insert / admin_update / admin_delete
--      → events 除了原本的 select_published_or_admin、admin_all，還要有 select_archived_public
--
-- 3) 匿名可讀 archived、讀不到 draft（用 anon key 或 PostgREST 直接打）：
--      curl "$SUPABASE_URL/rest/v1/events?series=eq.hyrox&status=eq.archived&select=id,title" \
--           -H "apikey: $ANON_KEY"
--      → 應回陣列（至少包含你之後設為 archived 的測試場次）
--      curl "$SUPABASE_URL/rest/v1/events?status=eq.draft&select=id" -H "apikey: $ANON_KEY"
--      → 應回 []（draft 仍然不可見）
--
-- 4) 相片：匿名可讀、不可寫
--      curl "$SUPABASE_URL/rest/v1/event_photos?select=*" -H "apikey: $ANON_KEY"
--      → 200，回目前相片列（初始為 []）
--      curl -X POST "$SUPABASE_URL/rest/v1/event_photos" \
--           -H "apikey: $ANON_KEY" -H "content-type: application/json" \
--           -d '{"event_id":"<任一場次 uuid>","path":"events/202611/x.jpg"}'
--      → 應被 RLS 拒絕（401/403），不會寫入
--
-- 5) 管理員（後台登入後）：
--      GET  /api/admin/hyrox/photos?event_id=<uuid>       → 200 { ok:true, photos:[] }
--      POST /api/admin/hyrox/photos {"action":"add",...}   → 201 { ok:true, photo:{...} }
--
-- 6) 刪場次時相片一併消失（on delete cascade）：
--      delete from public.events where id = '<測試場次 uuid>';
--      select count(*) from public.event_photos where event_id = '<同一 uuid>';  -- 應回 0
-- =============================================================
