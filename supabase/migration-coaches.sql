-- =============================================================
-- 教練資料（coaches）
-- 日期：2026-09-29
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 冪等：可重複執行，不會重複建立
-- =============================================================
--
-- 【用途】
-- 站主要上載教練相片並填寫教練資料（姓名、專長、簡介等），
-- 於前台「教練介紹」頁（/coaches）展示。
--
-- 【這是本次唯一的新增資料表】
-- 教練資料是新東西，沒有既有地方可存，因此必須新增 table。
-- 只新增 coaches 一個表與其 RLS 政策，不改動任何既有 table。
--
-- =============================================================

-- ------------------------------------------------------------
-- 1. 資料表
-- ------------------------------------------------------------
create table if not exists public.coaches (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  specialty   text,
  bio         text,
  photo_path  text,
  sort_order  integer     not null default 0,
  is_visible  boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- 排序與顯示的常用查詢組合
create index if not exists coaches_sort_order_idx
  on public.coaches (sort_order, created_at);

comment on table public.coaches is '教練資料（前台 /coaches 展示，後台 /admin/coaches 管理）';
comment on column public.coaches.sort_order is '數字小者在前';
comment on column public.coaches.is_visible is 'false 時前台不顯示';
comment on column public.coaches.photo_path is 'site-assets bucket 內的路徑，由 AssetUploader 上傳後取得';


-- ------------------------------------------------------------
-- 2. RLS（列級安全）
--    匿名可讀「已顯示」的教練；只有管理員能增改刪
-- ------------------------------------------------------------
alter table public.coaches enable row level security;

drop policy if exists coaches_select_public on public.coaches;
create policy coaches_select_public
  on public.coaches
  for select
  to anon, authenticated
  using (is_visible = true);

drop policy if exists coaches_admin_all on public.coaches;
create policy coaches_admin_all
  on public.coaches
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );


-- ------------------------------------------------------------
-- 3. 教練相片：沿用既有 site-assets bucket
--    （與活動封面、Logo、Hero 同一個 bucket，不另建）
--    若你的 site-assets 尚未開放到 authenticated 上傳，
--    請確認 Storage Policies 已允許管理員上傳。
--    建議路徑規則：coaches/<uuid>.<ext>
-- ------------------------------------------------------------


-- =============================================================
-- 執行後驗證
-- =============================================================
-- select * from public.coaches order by sort_order, created_at;
--   → 初期應為空（0 列），代表建表成功
--
-- 新增一筆測試資料（可選）：
-- insert into public.coaches (name, specialty, bio, sort_order, is_visible)
-- values ('測試教練', 'Street Workout', '這是一筆測試資料，可於後台刪除。', 0, true);


-- =============================================================
-- 還原方式（若需要完整移除）
-- =============================================================
-- 注意：這會刪除所有教練資料，無法復原，請先確認。
--
-- drop policy if exists coaches_admin_all on public.coaches;
-- drop policy if exists coaches_select_public on public.coaches;
-- drop index if exists public.coaches_sort_order_idx;
-- drop table if exists public.coaches;
