-- =============================================================
-- 首頁圖片輪播：public.home_slides
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行（一次跑完）
-- 幂等：create table if not exists / drop constraint if exists /
--       drop policy if exists / drop trigger if exists / create or replace function
--       本檔從頭到尾可重複執行，第二次跑不會報錯、也不會改動既有資料
-- =============================================================
--
-- 【用途】
-- 首頁 hero 下方要多一段形象圖輪播。圖檔上傳到既有的公開 bucket site-assets
-- （路徑前綴 home/，由後台 src/app/admin/slides/SlidesManager.tsx 直傳），
-- 本表只存中繼資料：圖片路徑、替代文字、可選的站內連結、排序、啟停與排程時間。
--
-- 【為什麼 select 政策要把排程條件寫進 using】
-- 前台讀取走不含 cookie 的匿名客戶端（src/lib/supabase/anon.ts），也就是 anon 角色，
-- 受 RLS 限制。若 select 政策只寫 is_active，後台的 starts_at / ends_at 就等於
-- 只對管理員有效、對訪客無效——「排程上架」會變成假的。
-- 把「啟用中 AND 在排程期間內」寫進 using，資料庫就是唯一事實來源：
--   1. 前台不需要（也不應該）再自己用 JS 過濾時間，避免時區／快取造成不一致；
--   2. 即使日後有別的讀取端（RPC、外部工具），條件也一樣生效。
--
-- 【為什麼寫入是「另加一條」admin policy，而不是改上面那條】
-- Postgres 的多條 permissive 政策之間是 OR 關係。上面那條 select 政策只放行
-- 「啟用中且在排程內」的列，管理員若只有它，後台清單就會看不到停用中／已排程
-- 下架的列——那正是管理員最需要看到的東西。
-- 因此另加一條 for all to authenticated using (public.is_admin())：
--   · 對 authenticated 角色，讀取時與上面的 select 政策 OR，管理員看得到全部；
--   · 寫入（insert/update/delete）則完全依賴這條的 using + with check；
--   · 一般會員（authenticated 但非 admin）is_admin() = false，一條都不過。
--
-- 【上限為什麼是 30（客戶需求是 10–20）】
-- 客戶要 10–20 張，這裡留餘裕設硬上限 30：足夠應付「換季期間先傳新的、
-- 舊的還沒下架」的過渡期，又不會讓首頁載入無限膨脹。
-- 上限用 AFTER INSERT ... FOR EACH STATEMENT 的 trigger 實作，理由見 §3。
--
-- 【資料表變更摘要】
--   新增表：public.home_slides（1 張）
--   新增索引：home_slides_active_sort_idx
--   新增政策：home_slides 兩條
--   新增函式／觸發器：home_slides_enforce_cap / home_slides_cap
--   既有表結構：一個欄位都沒改
-- =============================================================


-- ------------------------------------------------------------
-- 1. 表結構
--    path 是 site-assets bucket 內的相對路徑（不是完整網址），
--    形如 home/1730000000000-ab12cd.jpg。
--    前台一律用 publicAssetUrl(path)（src/lib/assets.ts:22）組公開網址。
-- ------------------------------------------------------------
create table if not exists public.home_slides (
  id         uuid primary key default gen_random_uuid(),
  path       text not null,
  alt        text not null,
  link_url   text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  starts_at  timestamptz,
  ends_at    timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.home_slides is '首頁圖片輪播（path 指向 site-assets 的 home/ 前綴；anon 只讀得到啟用中且在排程期間內的列，只有管理員可寫）';
comment on column public.home_slides.path is 'site-assets bucket 內的相對路徑，如 home/1730000000000-ab12cd.jpg';
comment on column public.home_slides.alt is '圖片的替代文字（無障礙必填，1–120 字）';
comment on column public.home_slides.link_url is '點整張圖要去的站內路徑（可空；只准以單一 / 開頭，禁止 // 開頭的外部連結）';
comment on column public.home_slides.sort_order is '顯示順序（升冪；後台 reorder 以索引 × 10 重寫）';
comment on column public.home_slides.is_active is '是否啟用（停用的列前台看不到，後台看得到）';
comment on column public.home_slides.starts_at is '排程上架時間（可空＝立即生效）';
comment on column public.home_slides.ends_at is '排程下架時間（可空＝不自動下架）';


-- ------------------------------------------------------------
-- 2. 護欄：與後台 API 的驗證口徑對齊
--    （src/app/api/admin/slides/route.ts）。
--    先 drop 再 add，確保本檔可重複執行。
-- ------------------------------------------------------------
alter table public.home_slides
  drop constraint if exists home_slides_alt_len;
alter table public.home_slides
  add constraint home_slides_alt_len check (
    length(alt) between 1 and 120
  );

alter table public.home_slides
  drop constraint if exists home_slides_path_fmt;
alter table public.home_slides
  add constraint home_slides_path_fmt check (
    length(path) between 1 and 300
    and path like 'home/%'
    and position('..' in path) = 0
    and position(chr(92) in path) = 0           -- chr(92) = 反斜線，擋 Windows 路徑與跳脫
  );

alter table public.home_slides
  drop constraint if exists home_slides_link_url_fmt;
alter table public.home_slides
  add constraint home_slides_link_url_fmt check (
    link_url is null
    or (link_url like '/%' and length(link_url) <= 300)
  );

alter table public.home_slides
  drop constraint if exists home_slides_sort_range;
alter table public.home_slides
  add constraint home_slides_sort_range check (sort_order between -9999 and 9999);

-- 排程一致性：有頭有尾時，下架必須在上架之後
alter table public.home_slides
  drop constraint if exists home_slides_schedule_order;
alter table public.home_slides
  add constraint home_slides_schedule_order check (
    starts_at is null or ends_at is null or starts_at < ends_at
  );

-- 索引：前台查詢口徑是「啟用中、依 sort_order」
create index if not exists home_slides_active_sort_idx
  on public.home_slides (is_active, sort_order);


-- ------------------------------------------------------------
-- 3. 上限保護：最多 30 筆
--
--    【為什麼用 after insert for each statement，而不是 before each row】
--    BEFORE INSERT 的觸發器在同一句 bulk insert 內執行時，count(*) 用的是
--    該語句開始時的快照，看不到「同一句裡先前插入的列」。也就是說
--    `insert ... select` 一次塞 100 筆，每一列的 trigger 都會算出
--    「目前還不到 30 筆」而放行——上限形同虛設。
--    AFTER INSERT FOR EACH STATEMENT 在整句執行完後才檢查，看到的 count
--    已含這句新增的全部列；超過就 raise，該語句（連同整筆交易）回滾。
--
--    security definer + set search_path 的目的：讓 count 不受呼叫者 RLS 影響，
--    算的是全表真實列數（否則管理員以外的角色可能算出偏小的數字）。
--    本函式只做 count 與 raise，不讀寫任何資料。
--
--    errcode 23514 = check_violation（刻意不用 P0001：本專案的
--    src/lib/api.ts 會把「P0001 + 找不到／不存在」對映成 404，用 P0001
--    有誤判風險）。後台 API 另有「已達 30 筆回 409」的前置檢查，
--    這個 trigger 是最後一道防線。
-- ------------------------------------------------------------
create or replace function public.home_slides_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.home_slides) > 30 then
    raise exception '首頁輪播最多 30 張，請先刪除不需要的圖片。'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists home_slides_cap on public.home_slides;
create trigger home_slides_cap
  after insert on public.home_slides
  for each statement
  execute function public.home_slides_enforce_cap();


-- ------------------------------------------------------------
-- 4. RLS
--    · anon / authenticated：只讀得到「啟用中且在排程期間內」的列
--    · 管理員：另加一條 for all，看得到全部、也可寫入
-- ------------------------------------------------------------
alter table public.home_slides enable row level security;

drop policy if exists "home_slides_select_active" on public.home_slides;
create policy "home_slides_select_active" on public.home_slides
  for select to anon, authenticated
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

drop policy if exists "home_slides_admin_all" on public.home_slides;
create policy "home_slides_admin_all" on public.home_slides
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.home_slides to anon, authenticated;
grant insert, update, delete on public.home_slides to authenticated;

-- 註：bucket site-assets 已是 public，且已有 siteassets_admin_all 政策
--     （for all to authenticated using is_admin()，見 schema-r6.sql:151-155），
--     所以後台 API 可以直接 upload / remove 物件，本檔不需要再動 storage.objects。


-- 讓 PostgREST 立刻看到新表（本專案踩過 PGRST202 的坑；可重複執行，無副作用）
notify pgrst, 'reload schema';


-- =============================================================
-- 執行後驗證（建議在 SQL Editor 逐段跑，或於後台／前台肉眼確認）
-- =============================================================
-- 1) 表、索引都在：
--      select to_regclass('public.home_slides');                 -- 應回 home_slides
--      select indexname from pg_indexes
--       where tablename = 'home_slides';                          -- 應有 home_slides_active_sort_idx
--
-- 2) 約束清單（應有 alt_len / path_fmt / link_url_fmt / sort_range / schedule_order）：
--      select conname from pg_constraint
--       where conrelid = 'public.home_slides'::regclass and contype = 'c'
--       order by conname;
--
-- 3) 政策與觸發器：
--      select policyname, cmd, roles from pg_policies
--       where schemaname = 'public' and tablename = 'home_slides'
--       order by policyname;
--      → 應有 home_slides_select_active（SELECT, {anon,authenticated}）
--        與 home_slides_admin_all（ALL, {authenticated}）
--      select tgname from pg_trigger
--       where tgrelid = 'public.home_slides'::regclass and not tgisinternal;
--      → 應有 home_slides_cap
--
-- 4) 匿名可讀「啟用中」的列、讀不到停用的列（用 anon key 直接打 PostgREST）：
--      curl "$SUPABASE_URL/rest/v1/home_slides?select=id,alt,is_active" -H "apikey: $ANON_KEY"
--      → 200；初始應為 []（還沒有資料）
--    （後台灌入資料後）停用其中一張，同一條 curl 應看不到那一張。
--
-- 5) 匿名不可寫（應被 RLS 拒絕，401/403，不會寫入）：
--      curl -X POST "$SUPABASE_URL/rest/v1/home_slides" \
--           -H "apikey: $ANON_KEY" -H "content-type: application/json" \
--           -d '{"path":"home/x.jpg","alt":"測試"}'
--
-- 6) 上限保護（手動灌 31 筆，最後一句應報錯並整句回滾）：
--      insert into public.home_slides (path, alt, sort_order)
--      select 'home/t' || g || '.jpg', '測試' || g, g
--        from generate_series(1, 31) g;
--      → ERROR: 首頁輪播最多 30 張，請先刪除不需要的圖片。
--      select count(*) from public.home_slides;                   -- 應仍是驗證前的數量
--
-- 7) 後台 API（登入管理員後）：
--      GET  /api/admin/slides                       → 200 { ok:true, slides:[] }
--      POST /api/admin/slides {"action":"create","path":"home/x.jpg","alt":"測試"} → 201
--
-- 8) 清理測試資料：
--      delete from public.home_slides where path like 'home/t%';
-- =============================================================
