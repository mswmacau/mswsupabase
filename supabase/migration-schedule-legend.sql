-- =============================================================
-- 日曆色彩圖例（Migration）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：create table if not exists / DO 區塊補約束 / drop policy if exists /
--       on conflict do nothing，可重複執行，不會覆蓋後台改過的名稱。
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【客戶需求（原話重點）】
-- 「不要週檢視，要用月曆放進手機（現況），如果看不到，上方可以說明顏色所代表的
--   活動，並且後台同步」
--
-- 落地方式：
--   1. 手機日曆格子放不下課名，改顯示顏色短條 → 需要一個「顏色 → 活動類型」的對照。
--   2. 對照表的標籤由客戶在後台自行改（後台 → 月班表 → 顏色圖例），前台即時同步。
--   3. 前台若讀不到這張表（migration 未執行），getScheduleLegend() 回空陣列，
--      前台整段圖例不顯示，日曆照常運作 —— 不會讓 /events 掛掉。
--
-- 【為什麼「一個顏色一列」而不是「一門課一列」】
--   目前 8 門課共用 6 個顏色：amber 同時是 Hyrox (Foundation) / (Power) / (Engine)，
--   而前台日曆畫的是顏色短條。若以課程為單位，amber 會出現三行幾乎相同的說明。
--   因此主鍵是 color_key（顏色），不是 class_id（課程）。
--
-- 【刻意不動的東西】
--   · 不改 training_classes 的 color_key（那是課程自己的色票，仍然保持自由字串）。
--   · 不在這張表存 hex —— 顏色由前端依 color_key 對應，換色只需改前端一處。
-- =============================================================


-- =============================================================
-- 1. 表格
-- =============================================================
create table if not exists public.schedule_legend (
  color_key  text primary key,
  label      text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 約束用 DO 區塊「不存在才加」：
--   create table if not exists 在表已存在時是空操作，不會補約束，
--   而 Postgres 沒有 `add constraint if not exists`，只能查 pg_constraint。
do $$
begin
  -- 只有這 6 個顏色（= training_classes.color_key 目前在用的色票鍵）。
  -- 後台 API 也有一份白名單，這裡是資料庫層的最後一道防線：
  -- 不存在的顏色不該被寫進來，否則圖例會解釋一個畫不出來的顏色。
  if not exists (
    select 1 from pg_constraint
     where conname = 'schedule_legend_color_key_check'
       and conrelid = 'public.schedule_legend'::regclass
  ) then
    alter table public.schedule_legend
      add constraint schedule_legend_color_key_check
      check (color_key in ('blue', 'green', 'amber', 'teal', 'violet', 'orange'));
  end if;

  -- 文案 1–20 字（前後空白不計）。與後台 API 的驗證一致。
  if not exists (
    select 1 from pg_constraint
     where conname = 'schedule_legend_label_len'
       and conrelid = 'public.schedule_legend'::regclass
  ) then
    alter table public.schedule_legend
      add constraint schedule_legend_label_len
      check (char_length(btrim(label)) between 1 and 20);
  end if;

  -- 排序 0–999（與後台 API 的驗證一致），擋掉亂填的巨量值。
  if not exists (
    select 1 from pg_constraint
     where conname = 'schedule_legend_sort_order_range'
       and conrelid = 'public.schedule_legend'::regclass
  ) then
    alter table public.schedule_legend
      add constraint schedule_legend_sort_order_range
      check (sort_order between 0 and 999);
  end if;
end
$$;

comment on table public.schedule_legend is
  '前台 /events 月曆的顏色圖例。一列 = 一種顏色。color_key 對應 training_classes.color_key 的色票鍵，實際 hex 由前端決定；label 供客戶在後台修改，前台即時同步。';

comment on column public.schedule_legend.color_key is
  '色票鍵（blue / green / amber / teal / violet / orange）。不存 hex，換色只改前端。';

comment on column public.schedule_legend.label is
  '前台圖例顯示的文案（1–20 字），客戶可在後台修改。';

comment on column public.schedule_legend.sort_order is
  '圖例在前台由左至右的順序，數字小的排前面（10 / 20 / 30 … 留空隙方便插隊）。';

comment on column public.schedule_legend.is_active is
  'false = 前台不顯示該顏色（歷史場次仍保留顏色，只是圖例不再解釋它）。';


-- =============================================================
-- 2. 種子資料（六種顏色，對應客戶手上的 11 月班表）
-- =============================================================
-- on conflict do nothing：重複執行不會蓋掉客戶在後台改過的名稱。
-- 要還原預設文案請用後台 API 的 action:'reset'（不是重跑本檔）。
insert into public.schedule_legend (color_key, label, sort_order, is_active)
values
  ('blue',   '跑步',       10, true),
  ('green',  '力量',       20, true),
  ('amber',  'HYROX 專項', 30, true),
  ('teal',   '技巧',       40, true),
  ('violet', '內部培訓',   50, true),
  ('orange', '戶外付費',   60, true)
on conflict (color_key) do nothing;


-- =============================================================
-- 3. RLS
-- =============================================================
-- 讀：anon + authenticated（前台 /events 是公開頁，用 anon key 讀）。
--     「只回啟用中的」在查詢端過濾（getScheduleLegend 的 .eq('is_active', true)），
--     不在 policy 分流 —— 後台要看到停用的圖例才能重新啟用。
-- 寫：只有 is_admin()。後台 API 用的是「帶登入 cookie 的 authenticated 角色」，
--     不是 service role，所以這條 `for all` policy 是必要的：
--     少了它，後台的 update 會因 RLS 過濾而靜默影響 0 列（回 200 但沒存到）。
alter table public.schedule_legend enable row level security;

drop policy if exists "legend_select_all" on public.schedule_legend;
create policy "legend_select_all" on public.schedule_legend
  for select using (true);

drop policy if exists "legend_admin_all" on public.schedule_legend;
create policy "legend_admin_all" on public.schedule_legend
  for all using (public.is_admin()) with check (public.is_admin());

-- grants：與 training_classes / training_rules 一致（RLS 之外還有 table 權限）。
grant select on public.schedule_legend to anon, authenticated;
grant insert, update, delete on public.schedule_legend to authenticated;
grant all on public.schedule_legend to service_role;


-- =============================================================
-- 4. 通知 PostgREST 重載 schema cache
-- =============================================================
-- 不做這一步，剛建好的表會在前幾分鐘回「Could not find the table」，
-- 前台圖例與後台 API 都會一直拿到 SCHEMA_OUTDATED。
notify pgrst, 'reload schema';


-- =============================================================
-- 5. 驗證（執行完可貼上這段單獨跑，確認結果）
-- =============================================================
-- -- 5-1 筆數與內容：預期 6 列，sort_order 10/20/30/40/50/60，全部 is_active = true
-- select color_key, label, sort_order, is_active
--   from public.schedule_legend
--  order by sort_order;
--
-- -- 5-2 匿名讀得到（前台 /events 靠這個）
-- begin;
--   set local role anon;
--   select count(*) from public.schedule_legend;   -- 預期 6
-- rollback;
--
-- -- 5-3 白名單約束有效：這句應該失敗（check violation），證明擋得住不存在的顏色
-- --     （驗完不要留資料，失敗的 insert 不會寫入）
-- insert into public.schedule_legend (color_key, label) values ('red', '不該存在');
--
-- -- 5-4 後台改文案（模擬管理員）：改完刷新 /events 就會看到新文案
-- -- update public.schedule_legend set label = '跑步團練', updated_at = now()
-- --  where color_key = 'blue';
-- =============================================================
