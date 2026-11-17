-- ============================================================
-- 頁尾電郵改為 mswmacau2026@gmail.com
-- ------------------------------------------------------------
-- 為什麼需要這支 SQL：
--   頁尾顯示的電郵**不是**讀 `src/lib/config.ts` 或 `src/lib/content.ts` 的常數，
--   而是讀 DB：`getSiteContact()` → `app_settings.key = 'site_contact'` 的 jsonb。
--   所以只改程式碼不會讓頁尾變；必須同步更新這一列。
--   （程式碼那兩處常數是 DB 沒值／沙箱無 Supabase 時的 fallback，也一併改了，
--     確保「有沒有連 DB」看到的都是同一個電郵。）
--
-- 結構（migration-site-content.sql 第 179 行附近的播種）：
--   app_settings.value = {
--     "location": "澳門",
--     "email": "hello@mswstreetworkout.com",
--     "instagram": "@msw_street_workout",
--     "instagram_url": "https://www.instagram.com/msw_street_workout",
--     "intro": [ … 4 句品牌宣言 … ]
--   }
--   只換 email 這一個鍵，其他鍵原封不動（jsonb_set 只覆蓋指定路徑）。
--
-- 冪等：可重複執行（重複跑結果一樣）。
-- ⚠️ 本檔**尚未執行**，需要站主或工程師在 Supabase SQL Editor 手動跑一次。
-- ============================================================

update public.app_settings
set value = jsonb_set(value, '{email}', '"mswmacau2026@gmail.com"'::jsonb, true)
where key = 'site_contact';

-- ------------------------------------------------------------
-- 驗證：應回 mswmacau2026@gmail.com，且其餘鍵（location / instagram /
-- instagram_url / intro）都還在
-- ------------------------------------------------------------
-- select key,
--        value->>'email'         as email,
--        value->>'location'      as location,
--        value->>'instagram'     as instagram,
--        jsonb_array_length(value->'intro') as intro_count
--   from public.app_settings
--  where key = 'site_contact';

-- ------------------------------------------------------------
-- 回滾
-- ------------------------------------------------------------
-- update public.app_settings
--    set value = jsonb_set(value, '{email}', '"hello@mswstreetworkout.com"'::jsonb, true)
--  where key = 'site_contact';
