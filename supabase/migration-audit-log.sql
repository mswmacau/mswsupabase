-- =============================================================
-- 管理員操作日誌：admin_audit_log（T-15）
-- 日期：2026-10-23
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：create table if not exists / drop policy if exists，可重複執行
-- =============================================================
--
-- 【用途】
-- 記錄管理員在後台的重要寫入操作（誰、何時、哪個模組、做了什麼、一句人话摘要），
-- 供後台「操作紀錄」頁依時間倒序顯示最近 100 筆（V1 計劃 O5 / V2 計劃 D6 標準）。
--
-- 【寫入點（T-15 派工範圍，src/lib/audit.ts 的 writeAuditLog）】
-- 內容七路由（POST 成功 → action='save'；DELETE 成功 → action='restore'）：
--   /api/admin/site-content｜site-nav｜site-contact｜site-pages｜site-blocks｜site-seo｜site-settings
-- 草稿發佈（T-16 補充寫入點，超出派工單七路由清單，如實記錄）：
--   /api/admin/site-draft 的 publish → action='publish'
--
-- 【擴充位置（本次範圍克制，刻意不加）】
-- 營運類路由（events / sessions / coupons / review-checkin / review-run）尚未接日誌。
-- 日後補上時只需在各路由的 POST/PATCH/DELETE 成功分支呼叫：
--   writeAuditLog(supabase, user.id, "<module>", "<action>", "<一句中文摘要>")
-- 例如 events 的 PATCH → module='events'、action='update'；
--      review-checkin 的 POST → module='review-checkin'、action='approve'／'reject'。
--
-- 【性質】
-- 只新增 admin_audit_log 一張新表；不改動任何既有表結構、既有欄位與既有資料
-- （profiles / events / app_settings 等一律不碰）。
--
-- 【紀律（V1 計劃 §5.4）】
-- - 僅管理員可讀可寫；刻意不給 anon 任何授權。
-- - append-only：刻意不給 update / delete（RLS 開啟且無對應政策，等於全民不可改刪，
--   service_role 除外）；事後更正只能由技術人員以 SQL 直接處理。
-- - actor_id 用 on delete set null：會員帳號被刪除後，日誌列仍然保留，
--   操作者欄位顯示為 null（前端呈現「已刪除的會員」）。
--
-- Owner：白客（backend-engineer）
-- =============================================================

-- ------------------------------------------------------------
-- 1. 資料表（V1 計劃 §5.3 逐欄實作；長度上限為護欄，見下方註釋）
-- ------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  module     text not null,
  action     text not null,
  summary    text not null,
  created_at timestamptz not null default now()
);

-- 護欄（V1 只規定 not null；此處補長度檢查，防止前端或故障把超長字串寫進來）：
--   module  ≤ 40（如 'site-content' / 'review-checkin'）
--   action  ≤ 20（如 'save' / 'restore' / 'publish' / 'approve'）
--   summary ≤ 500（V1 §5.3 明定）
alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_module_len;
alter table public.admin_audit_log
  add constraint admin_audit_log_module_len check (length(module) between 1 and 40);

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_len;
alter table public.admin_audit_log
  add constraint admin_audit_log_action_len check (length(action) between 1 and 20);

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_summary_len;
alter table public.admin_audit_log
  add constraint admin_audit_log_summary_len check (length(summary) between 1 and 500);

-- ------------------------------------------------------------
-- 2. 索引：後台「操作紀錄」頁的固定查詢是「依時間倒序取最近 100 筆」（O5）
-- ------------------------------------------------------------
create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

comment on table public.admin_audit_log is '管理員操作日誌（T-15；append-only，僅管理員可讀寫）';
comment on column public.admin_audit_log.actor_id is '操作者 profiles(id)；帳號刪除後置 null';
comment on column public.admin_audit_log.module is '模組名（路由名），如 site-content / events';
comment on column public.admin_audit_log.action is '動作，如 save / restore / publish / approve';
comment on column public.admin_audit_log.summary is '一句中文人话摘要，≤500 字';

-- ------------------------------------------------------------
-- 3. RLS（V1 計劃 §5.4 逐字實作）
--    只有管理員能讀、能寫；不給 anon；不給 update / delete。
-- ------------------------------------------------------------
alter table public.admin_audit_log enable row level security;

drop policy if exists "audit_admin_select" on public.admin_audit_log;
create policy "audit_admin_select" on public.admin_audit_log
  for select using (public.is_admin());

drop policy if exists "audit_admin_insert" on public.admin_audit_log;
create policy "audit_admin_insert" on public.admin_audit_log
  for insert with check (public.is_admin());

-- 表層級只授 select + insert（authenticated 經 RLS 再收窄為僅管理員）；
-- 刻意不授 update / delete / anon。
grant select, insert on public.admin_audit_log to authenticated;

-- =============================================================
-- 執行後驗證
-- =============================================================
-- select count(*) from public.admin_audit_log;            -- 0（空表，正常）
-- -- 以 anon key 執行 select／insert 應被拒（0 列或 permission denied）；
-- -- 以會員 JWT 執行 select 應回 0 列（RLS 擋下，不是報錯）；
-- -- 以管理員 JWT 呼叫 insert 一列後再 select 應可見；update／delete 應被拒。
-- -- 後台「操作紀錄」頁（方硯，T-15 前端部分）固定查詢：
-- --   select actor_id, module, action, summary, created_at
-- --     from public.admin_audit_log
-- --    order by created_at desc
-- --    limit 100;
-- =============================================================
