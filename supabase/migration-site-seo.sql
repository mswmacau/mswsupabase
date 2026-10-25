-- =============================================================
-- SEO metadata（app_settings 鍵值）：site_seo
-- 日期：2026-10-23
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：on conflict (key) do nothing，可重複執行；不覆蓋用戶已修改過的值
-- =============================================================
--
-- 【用途】
-- 全站 SEO metadata（標題／描述／OG 圖）的預設值，供 layout.tsx 的
-- generateMetadata 讀取（前台掛載由方硯負責，T-12 前端部分；本檔只提供
-- 資料層，後台編輯入口為 /api/admin/site-seo，T-12 後端部分）。
--
-- 【性質】
-- 只往 app_settings 鍵值表「新增」site_seo 一個鍵的預設值（JSONB），
-- 不改動任何既有表結構、既有欄位與既有資料（site_theme 及其餘鍵一律不碰）。
-- RLS 沿用 schema.sql 第 251–257 行既有政策（settings_select_all /
-- settings_admin_write），自動覆蓋新鍵，無需新增政策。
--
-- 【預設值來源（逐字轉錄，一個字都沒改）】
--   src/app/layout.tsx 第 13–25 行：
--     SITE_DESCRIPTION（第 16–17 行）、OG_TITLE（第 19 行）、OG_IMAGE（第 20–25 行）
--   注意：metadataBase 用的 NEXT_PUBLIC_SITE_URL 與 title.template
--   （'%s | MSW 街健館'）屬環境設定與框架行為，不進 site_seo——
--   本鍵只存「可編輯的三值」：title / description / og_image。
-- 同一份預設值存放於 src/lib/seo.ts 的 DEFAULT_SEO
-- （後台 API「回復原廠」與前台讀取回落都用它），兩邊由一致性腳本逐字比對。
--
-- Owner：白客（backend-engineer）
-- =============================================================

insert into public.app_settings (key, value) values
  ('site_seo', '{
  "title": "MSW 街健館 | Macau Street Workout",
  "description": "MSW 街健館是澳門街頭健身社群平台。每週定期訓練、每月 300 公里跑步挑戰、積分與優惠券獎勵，讓訓練變成看得見的累積。",
  "og_image": {
    "url": "/og-image.png",
    "width": 1200,
    "height": 630,
    "alt": "MSW 街健館 — 用自身的重量，練出澳門最強的街頭力量"
  }
}'::jsonb)
on conflict (key) do nothing;

-- =============================================================
-- 執行後驗證
-- =============================================================
-- select key, jsonb_pretty(value)
-- from public.app_settings
-- where key = 'site_seo';
--   → 應剛好 1 列，type 為 object；再執行一次本檔不會報錯，
--     且用戶已在後台修改過的值不會被覆蓋（on conflict do nothing）。
--
-- 前台快取：後台「網站內容」頁的 SEO 分區按儲存／回復原廠時，
-- API 會呼叫 revalidateTag（tag 常數 SITE_SEO_TAG 見 src/lib/queries.ts），
-- 最遲 60 秒生效。

-- =============================================================
-- 還原方式（若需要完整移除）
-- =============================================================
-- 注意：這會刪除用戶在後台改過的 SEO 設定，無法復原，請先確認。
--
-- delete from public.app_settings
-- where key = 'site_seo';
