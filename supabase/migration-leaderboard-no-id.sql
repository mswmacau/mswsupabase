-- =============================================================
-- P1-A 安全修補：排行榜不再外洩會員 auth UUID
-- 檔名：migration-leaderboard-no-id.sql
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上 → Run
-- 前置條件：已執行 schema.sql / schema-r6.sql / migration-admin-separation.sql
-- 幂等：drop view if exists + create view；不改任何 table、不改任何資料
-- Owner：白客（backend-engineer）
--
-- ⚠️⚠️⚠️ 【2026-11-14 已被取代，正常情況請不要跑這支】⚠️⚠️⚠️
--   本檔的兩張 view 定義「沒有」 `and is_test = false` 這段測試帳號過濾。
--   測試帳號需求上線後，排行榜 view 的正本已改為：
--       supabase/migration-profile-test-flag.sql
--   若你重跑了本檔（例如為了修 UUID 外洩），排行榜會回到「含測試帳號」的狀態。
--   補救方式：接著再跑一次 supabase/migration-profile-test-flag.sql
--   （它冪等，會把 is_test 過濾與旗標欄位重新裝回正確狀態）。
--   本檔保留原文是為了讓「當初修了什麼」可回溯，不是拿來重跑的。
-- =============================================================
--
-- 【修的是什麼（已實測重現）】
--   匿名訪客抓 /leaderboard 的 HTML，可以撈到 6 個會員的 auth UUID：
--     alltime-detail-416705a7-9306-44a6-875e-58194bcf49eb
--     alltime-detail-9776a096-2908-488a-9696-61913fc7508e
--     …共 6 個
--   （實測方式：curl 本機 production build 的 /leaderboard，grep UUID 正則）
--
--   根因有兩層：
--     1. public_leaderboard 這張 view select 了 id（= auth.users.id）
--     2. monthly_leaderboard 這張 view select 了 user_id（同一個值）
--   前端把 id 當成 DOM id 與 React key 用，於是識別碼直接寫進 HTML。
--
--   為什麼嚴重：UUID 是永久識別碼，不會因為換暱稱而變。
--   而且本專案 Storage 的路徑慣例是 '<uid>/xxx.png'
--   （見 migration-security-fix-p0.sql 對 payment_proof_path 的檢查），
--   所以公開 UUID 等於同時公開私有物件的路徑骨架。
--   RLS 擋得住「讀資料本體」，擋不住「識別碼本身」的外流。
--
-- 【本檔做什麼】
--   1. public_leaderboard：移除 id，改成 public_code = substr(md5(id::text), 1, 8)
--   2. monthly_leaderboard：移除 user_id，改成同一個 public_code；
--      並改為直接 join public.profiles
--      （原本靠 public_leaderboard.id 做 join，那個欄位已經不存在了）
--   3. 兩張 view 都保留 where role = 'member'（管理員不上榜）
--   4. 收尾 notify pgrst reload schema
--
-- 【public_code 為什麼安全】
--   · md5 只有前 8 碼（32 bits），UUID 有 122 bits 隨機性 → 不可逆推
--   · 不可逆，但同一會員跨月份穩定 → 前端還算得出「名次上升／下降」
--   · 目前榜上 6 人，32 bits 空間撞號機率約 6²/2³³ ≈ 4e-9，可忽略；
--     即使碰撞也只影響前端的名次比對顯示，不影響任何資料存取
--   · 它不是 Storage 路徑的任何一段，也不是任何資料表的 key
--
-- 【刻意不動的東西】
--   · 不動 profiles / run_submissions / monthly_running_stats / site_stats
--   · 不動任何 RLS 政策
--   · 不動任何一筆資料
--   · 排行榜的顯示欄位（暱稱／頭像／積分／里程）與排序完全不變
--
-- 【前端配套（同一次修補的另一半）】
--   src/lib/queries.ts 不再 select id，改 select public_code；
--   前端 DOM id 改成「排名序號 + 顯示名稱摘要」，連 public_code 都不進 DOM。
--   兩邊必須一起上，單獨上任何一邊都會讓榜單空掉。
-- =============================================================


-- ------------------------------------------------------------
-- 1. 先移除相依 view
--    monthly_leaderboard 的定義相依 public_leaderboard，必須先 drop。
--    這裡刻意「不用 cascade」：cascade 會把沒預期到的相依物件一起砍掉，
--    而 drop 失敗（有相依）比靜默砍掉安全得多。
-- ------------------------------------------------------------
drop view if exists public.monthly_leaderboard;
drop view if exists public.public_leaderboard;


-- ------------------------------------------------------------
-- 2. 累積總榜
--    欄位與 migration-admin-separation.sql 版本一致，只把 id 換成 public_code。
--    security_invoker = false → 以 view 擁有者權限讀取，
--    匿名訪客才看得到榜（profiles 本身的 RLS 仍然擋住直讀）。
-- ------------------------------------------------------------
create view public.public_leaderboard
with (security_invoker = false) as
select
  substr(md5(id::text), 1, 8) as public_code,
  display_name,
  avatar_url,
  points,
  total_km
from public.profiles
where role = 'member';

comment on view public.public_leaderboard is
  '對外累積總榜：只含 role=member。public_code = substr(md5(profiles.id::text),1,8)，'
  '不可逆推 auth UUID；本 view 刻意不暴露 id。';

grant select on public.public_leaderboard to anon, authenticated;


-- ------------------------------------------------------------
-- 3. 月度里程榜
--    原本是 join public_leaderboard p on p.id = s.user_id；
--    p.id 已移除，改為直接 join profiles 並自行過濾 role。
--    （不可改回 join public_leaderboard：那裡已經沒有可比對的 uid 了）
-- ------------------------------------------------------------
create view public.monthly_leaderboard
with (security_invoker = false) as
select
  substr(md5(s.user_id::text), 1, 8) as public_code,
  s.period_month,
  s.total_km,
  s.runs,
  p.display_name,
  p.avatar_url,
  p.points
from public.monthly_running_stats s
join public.profiles p on p.id = s.user_id
where p.role = 'member';

comment on view public.monthly_leaderboard is
  '對外月度里程榜：只含 role=member。public_code 與 public_leaderboard 同一個算法，'
  '所以同一會員在兩張榜上的代號一致。刻意不暴露 user_id。';

grant select on public.monthly_leaderboard to anon, authenticated;


-- ------------------------------------------------------------
-- 4. 收尾：讓 PostgREST 立刻看到新的 view 欄位
--    （不 notify 的話，API 會有一小段時間還回舊欄位，前端會拿到 400）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- 執行後驗證（貼進 SQL Editor 逐條跑）
-- =============================================================
-- -- 1) 欄位清單：必須沒有 id / user_id，必須有 public_code
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name in ('public_leaderboard', 'monthly_leaderboard')
--  order by table_name, ordinal_position;
-- -- 預期 public_leaderboard：public_code, display_name, avatar_url, points, total_km
-- -- 預期 monthly_leaderboard：public_code, period_month, total_km, runs, display_name, avatar_url, points
--
-- -- 2) 列數不變（修補前實測 6 列）
-- select count(*) from public.public_leaderboard;
-- -- 預期 6
--
-- -- 3) 代號不可逆且不重複
-- select public_code, display_name, total_km
--   from public.public_leaderboard order by total_km desc;
-- -- 預期 6 個互不相同的 8 碼小寫 hex；nokia 應對應 22.00km
--
-- -- 4) 以匿名身分確認真的讀不到 UUID（RLS 部分照舊）
-- begin;
--   set local role anon;
--   select * from public.public_leaderboard limit 1;
--   select * from public.monthly_leaderboard limit 1;
-- rollback;
-- =============================================================
