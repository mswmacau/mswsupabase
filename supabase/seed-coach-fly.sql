-- =============================================================
-- 教練測試資料：FLY哥
-- 日期：2026-10-26
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上
-- 冪等：同名的 FLY哥 已存在時不會重複建立
-- =============================================================

insert into public.coaches (name, specialty, bio, photo_path, sort_order, is_visible)
select 'FLY哥', null, null, null, 0, true
where not exists (
  select 1 from public.coaches where name = 'FLY哥'
);

-- 驗證：前台 /coaches 應立即出現一張「FLY哥」卡片
--（相片未上載會顯示「相片待上載」、簡介未填會顯示「教練簡介即將更新。」）
select id, name, specialty, bio, sort_order, is_visible, created_at
from public.coaches
order by sort_order, created_at;
