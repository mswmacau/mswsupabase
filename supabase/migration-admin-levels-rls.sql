-- =============================================================
-- 兩級管理員：收緊 RLS（堵住「繞過 API 直接打 PostgREST」的越權）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：create or replace / drop policy if exists / create policy
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【§0 為什麼要這一支 —— 實測到的三個越權】
--   模組分級（admin_module_access）只活在應用層（src/lib/admin-guard.ts）。
--   第二級管理員開 devtools 直接打 https://<project>.supabase.co/rest/v1/...
--   就完全繞過 API 守衛，因為**既有的 RLS 只認 is_admin()，不認 admin_level**。
--
--   team-lead 實測（用 role=admin, admin_level=2 的真實 JWT，全部同值回寫、未改任何資料）：
--     · GET   admin_audit_log            → 200，Content-Range 0-452/453（讀到全部 453 筆）❌
--     · PATCH rewards   {同值}           → 200，回整列（可改名稱／points_cost／stock）  ❌
--     · PATCH app_settings {key=points_per_km} → 200，回該列（可改積分參數／主題）    ❌
--     · PATCH admin_audit_log {同值}     → []（0 列，這張表本來就有寫保護）         ✅
--
--   本檔只收緊「L2 不該寫／不該讀」的表，不做全站一刀切。
--
-- 【§1 對照表（盤點自 grep -rn 'from("' src/app/api/admin）】
--
--   表名                  寫入模組          L2 權限   處理
--   ─────────────────────────────────────────────────────────────
--   app_settings          points/theme/content  混存   **收緊（按 key 分模組）**
--   admin_audit_log       （所有模組都寫）      none   **收緊 SELECT**（INSERT 不動）
--   rewards               rewards              read   **收緊寫入**
--   profiles              member/points/...     —     **不動**（已鎖；L1/L2 PATCH 別人皆 0 列）
--   events                events               full   不動
--   event_registrations   events               full   不動
--   event_photos          events               full   不動
--   event_album_links     events               full   不動
--   hyrox_results         events               full   不動
--   race_categories       events               full   不動
--   race_registrations    events               full   不動
--   race_entries          events               full   不動
--   race_summary          events               full   不動
--   training_sessions     schedule             full   不動
--   training_classes      schedule             full   不動
--   training_rules        schedule             full   不動
--   training_months       schedule             full   不動
--   schedule_legend       schedule             full   不動
--   training_checkins     review               full   不動
--   run_submissions       review               full   不動
--   merchants             commerce             full   不動
--   reward_redemptions    commerce             full   不動
--   home_slides           slides               full   不動
--   coaches               coaches              full   不動
--
--   結論：只有 3 張表需要動（app_settings / admin_audit_log / rewards）。
--   其餘屬 full 模組，L2 本來就該有完整權限，不動。
--
-- 【§1.1 app_settings 為什麼要按 key 分，不能一刀切】
--   它同時存三類設定，而三類分屬不同模組、L2 權限不同：
--     · 積分參數（11 個 key，見 point-rules 的 RULE_LIMITS）→ points，L2 = **full**
--     · 主題（site_theme）                                  → theme，  L2 = **none**
--     · 網站內容（6 個 key：site_content / site_nav / site_contact /
--                  site_pages / site_blocks / site_seo）       → content，L2 = **none**
--       （這 6 個 key 出自 site-draft 的 SECTION_SETTINGS_KEY；
--         六支 site-* API 與草稿層都寫這一組）
--   若一刀切把 app_settings 的寫入收緊成「只有 theme=full 才能寫」，
--   第二級的「積分規則」會壞掉（points=full 卻寫不進去）。
--   所以用 app_setting_module(key) 把 key 映射回模組，再查 admin_module_access。
--   未知 key → 回 null → admin_module_access(null) = 'none' → 拒絕（fail closed）。
--   風險：若日後新增 app_settings key 而沒更新映射，**只有第一級能寫那個 key**——
--         這是刻意的保守方向（L1 兜底全開，不會鎖死站主）。
--
-- 【§1.2 admin_audit_log 為什麼只收緊 SELECT，不動 INSERT】
--   src/lib/audit.ts 用「已授權管理員的 session」寫入稽核（policy: audit_admin_insert）。
--   若把 INSERT 也收緊成 audit=full，第二級做任何操作（改活動、審核報名）時
--   寫稽核都會失敗 → 稽核斷鏈，比漏洞更糟。
--   所以：INSERT 保持 is_admin()（任何管理員的操作都要能留痕），
--         SELECT 收緊成 audit=full（L2 看不到操作紀錄）。
-- =============================================================


-- ------------------------------------------------------------
-- §2.1  key → 模組 映射（app_settings 用）
--       純函式、無副作用、無 security definer（不需要）
-- ------------------------------------------------------------
create or replace function public.app_setting_module(p_key text)
returns text
language sql
immutable
as $$
  select case
    -- 積分參數：與 src/app/api/admin/point-rules/route.ts 的 RULE_LIMITS 逐字對應
    when p_key in (
      'signup_bonus',
      'daily_login_points',
      'event_bonus',
      'referral_bonus',
      'referral_monthly_cap',
      'birthday_bonus',
      'streak_bonus',
      'streak_days',
      'checkin_bonus',
      'checkin_weekly_cap',
      'monthly_points_bonus'
    ) then 'points'
    -- 外觀設定（src/app/api/admin/site-settings/route.ts: SITE_THEME_KEY）
    when p_key = 'site_theme' then 'theme'
    -- 網站內容 6 個分區（src/app/api/admin/site-draft/route.ts 的 SECTION_SETTINGS_KEY）
    --   content/nav/contact/pages/blocks/seo 各自對應一個 key，
    --   六支 API（site-content/site-nav/site-contact/site-pages/site-blocks/site-seo）
    --   與草稿層 site-draft 都寫這一組
    when p_key in (
      'site_content',
      'site_nav',
      'site_contact',
      'site_pages',
      'site_blocks',
      'site_seo'
    ) then 'content'
    -- 未知 key：回 null → 呼叫端 admin_module_access(null) = 'none' → 拒絕
    else null
  end;
$$;

comment on function public.app_setting_module(text) is
  'app_settings 的 key 屬於哪個後台模組（points/theme/content）；未知 key 回 null '
  '（呼叫端會得到 none，fail closed）。與 point-rules 的 RULE_LIMITS、'
  'site-settings 的 SITE_THEME_KEY、site-content 的 SITE_CONTENT_KEY 逐字對應。';

revoke all on function public.app_setting_module(text) from public, anon;
grant execute on function public.app_setting_module(text) to authenticated;


-- ------------------------------------------------------------
-- §2.2  app_settings：寫入按 key 分模組
--
--       L1（is_super_admin）→ 全開（兜底，不會鎖死站主）
--       L2 → 只有落在「該模組 = full」的 key 能寫
--          · 11 個積分 key  → points=full  → 可寫 ✓
--          · site_theme     → theme=none   → 拒 ✗
--          · site_content   → content=none → 拒 ✗
--          · 未知 key       → null → none  → 拒 ✗
--
--       SELECT 不動（既有 settings_select_all / settings_select_admin 保持原樣：
--       前台要讀主題與積分參數）。
-- ------------------------------------------------------------
drop policy if exists "settings_admin_write" on public.app_settings;
create policy "settings_admin_write" on public.app_settings
  for all to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_admin()
      and public.admin_module_access(public.app_setting_module(key)) = 'full'
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_admin()
      and public.admin_module_access(public.app_setting_module(key)) = 'full'
    )
  );


-- ------------------------------------------------------------
-- §2.3  rewards：L2 是 read → 只收寫入，讀保持
--
--       既有的 rewards_select_active 是 `status='active' or is_admin()`：
--       L2 是 admin → 仍可讀全部（read 權限包含讀）✓ 不動它。
--       rewards_admin_all（for all using is_admin()）是漏洞源 → 拆成三條寫入 policy。
-- ------------------------------------------------------------
drop policy if exists "rewards_admin_all" on public.rewards;

drop policy if exists "rewards_admin_insert" on public.rewards;
create policy "rewards_admin_insert" on public.rewards
  for insert to authenticated
  with check (
    public.is_admin()
    and public.admin_module_access('rewards') = 'full'
  );

drop policy if exists "rewards_admin_update" on public.rewards;
create policy "rewards_admin_update" on public.rewards
  for update to authenticated
  using (
    public.is_admin()
    and public.admin_module_access('rewards') = 'full'
  )
  with check (
    public.is_admin()
    and public.admin_module_access('rewards') = 'full'
  );

drop policy if exists "rewards_admin_delete" on public.rewards;
create policy "rewards_admin_delete" on public.rewards
  for delete to authenticated
  using (
    public.is_admin()
    and public.admin_module_access('rewards') = 'full'
  );


-- ------------------------------------------------------------
-- §2.4  admin_audit_log：L2 是 none → 讀也不行；INSERT 不動
-- ------------------------------------------------------------
drop policy if exists "audit_admin_select" on public.admin_audit_log;
create policy "audit_admin_select" on public.admin_audit_log
  for select to authenticated
  using (
    public.is_admin()
    and public.admin_module_access('audit') = 'full'
  );

-- audit_admin_insert 刻意保留原樣（is_admin()）：任何管理員的操作都要能留痕，
-- 收緊它會讓第二級的每個操作都寫不進稽核，反而造成稽核斷鏈。


-- ------------------------------------------------------------
-- §2.5  讓 PostgREST 重載（policy 變更不需要，但新函式需要）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- §3 執行後驗證（在 Dashboard SQL Editor 逐段跑）
-- =============================================================
--
-- 3.1 三張表的 policy 現況（貼完應看到新 policy 名）
--   select tablename, policyname, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('app_settings', 'rewards', 'admin_audit_log')
--    order by tablename, cmd, policyname;
--
--   預期：
--     app_settings      settings_admin_write        ALL    含 is_super_admin() 與 app_setting_module
--     admin_audit_log   audit_admin_select          SELECT 含 admin_module_access('audit')
--     admin_audit_log   audit_admin_insert          INSERT 只有 is_admin()（未被收緊）
--     rewards           rewards_admin_insert        INSERT 含 admin_module_access('rewards')
--     rewards           rewards_admin_update        UPDATE 同上
--     rewards           rewards_admin_delete        DELETE 同上
--     rewards           rewards_select_active       SELECT status='active' or is_admin()
--
-- 3.2 key 映射自檢
--   select public.app_setting_module('signup_bonus');    -- → points
--   select public.app_setting_module('site_theme');      -- → theme
--   select public.app_setting_module('site_content');    -- → content
--   select public.app_setting_module('不存在的key');      -- → null
--
-- 3.3 三種身分的實際結果（**在網站上用真實 JWT 打 REST，不入 SQL Editor**）
--   -- 第一級（應全部成功）
--   PATCH /rest/v1/app_settings?key=eq.site_theme   {同值}   → 200
--   PATCH /rest/v1/rewards?id=eq.<id>               {同值}   → 200
--   GET   /rest/v1/admin_audit_log?select=id&limit=1        → 200
--
--   -- 第二級（應全部失敗／空陣列）
--   PATCH /rest/v1/app_settings?key=eq.site_theme   {同值}   → [] 或 403
--   PATCH /rest/v1/app_settings?key=eq.signup_bonus {同值}   → 200（points=full）✓ 預期成功
--   PATCH /rest/v1/rewards?id=eq.<id>               {同值}   → [] 或 403
--   GET   /rest/v1/admin_audit_log?select=id&limit=1        → [] 或 403
--   GET   /rest/v1/rewards?select=id&limit=1                 → 200（read 仍可讀）
--
--   -- 普通會員（應維持原狀）
--   GET /rest/v1/rewards?select=id&status=eq.active          → 200（前台目錄）
--   GET /rest/v1/app_settings?select=key                     → 200（前台要讀主題）
--
-- 3.4 迴歸重點（一定要看，否則可能弄壞站主日常操作）
--   · 第一級改「積分規則」→ 應成功（app_settings 的 11 個 key 走 points=full）
--   · 第一級改「外觀設定」→ 應成功（is_super_admin 兜底）
--   · 第一級改「網站內容」→ 應成功
--   · 第一級發券／改禮品       → 應成功
--   · 第二級改「積分規則」→ 應**成功**（points=full，這是刻意的）
--   · 第二級做任何操作後，稽核仍要寫得進去（INSERT 沒收緊）
-- =============================================================


-- =============================================================
-- §4 回滾段（本檔不執行；要回滾時把下面的註解解開、逐段跑）
--
--     ⚠️ 回滾會讓第二級重新可以繞過 API 直接改 rewards / app_settings、
--        讀 admin_audit_log —— 即回到修補前的狀態。
--
-- -- 4.1 app_settings 還原成 for all using is_admin()
-- drop policy if exists "settings_admin_write" on public.app_settings;
-- create policy "settings_admin_write" on public.app_settings
--   for all using (public.is_admin()) with check (public.is_admin());
--
-- -- 4.2 rewards 還原成 for all using is_admin()
-- drop policy if exists "rewards_admin_insert" on public.rewards;
-- drop policy if exists "rewards_admin_update" on public.rewards;
-- drop policy if exists "rewards_admin_delete" on public.rewards;
-- create policy "rewards_admin_all" on public.rewards
--   for all to authenticated using (public.is_admin()) with check (public.is_admin());
--
-- -- 4.3 admin_audit_log 的 SELECT 還原（INSERT 從未改動，不必還原）
-- drop policy if exists "audit_admin_select" on public.admin_audit_log;
-- create policy "audit_admin_select" on public.admin_audit_log
--   for select to authenticated using (public.is_admin());
--
-- -- 4.4 映射函式（可留可刪；留著無害）
-- drop function if exists public.app_setting_module(text);
--
-- -- 4.5 讓 PostgREST 重載
-- notify pgrst, 'reload schema';
-- =============================================================
