-- =============================================================
-- MSW R6：活動管理 + 網站主題 + 公開素材 bucket
-- 可重複執行（idempotent）
-- Owner：白客（backend-engineer）｜契約來源：SPEC-R6.md §1.1
--
-- 套用方式：
--   (a) Supabase 後台 SQL Editor 整段貼上執行
--   (b) curl -X POST "https://api.supabase.com/v1/projects/<your-project-ref>/database/query" \
--         -H "Authorization: Bearer <PAT>" -H "Content-Type: application/json" \
--         -d @<(jq -Rs '{query:.}' supabase/schema-r6.sql)
-- =============================================================

-- ------------------------------------------------------------
-- 1. events — 後台可管理的活動（含封面圖片）
-- ------------------------------------------------------------
create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(title) between 1 and 120),
  subtitle           text check (subtitle is null or length(subtitle) <= 200),
  body               text check (body is null or length(body) <= 5000),
  event_date         date not null,
  end_date           date,
  start_time         text check (start_time is null or length(start_time) <= 20),
  end_time           text check (end_time is null or length(end_time) <= 20),
  location           text check (location is null or length(location) <= 120),
  capacity           integer check (capacity is null or capacity between 1 and 99999),
  registration_url   text check (registration_url is null or length(registration_url) <= 500),
  registration_note  text check (registration_note is null or length(registration_note) <= 300),
  cover_path         text check (cover_path is null
                       or cover_path ~ '^events/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg|jpeg|png|webp)$'),
  status             text not null default 'draft'
                       check (status in ('draft', 'published', 'archived')),
  sort_order         integer not null default 0,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint events_end_date_check check (end_date is null or end_date >= event_date)
);

create index if not exists idx_events_published
  on public.events (event_date, sort_order desc, id)
  where status = 'published';

create index if not exists idx_events_admin
  on public.events (created_at desc);

-- updated_at 自動維護
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

alter table public.events enable row level security;

grant select                         on public.events to anon, authenticated;
grant insert, update, delete         on public.events to authenticated;

drop policy if exists "events_select_published_or_admin" on public.events;
create policy "events_select_published_or_admin" on public.events
  for select using (status = 'published' or public.is_admin());

drop policy if exists "events_admin_all" on public.events;
create policy "events_admin_all" on public.events
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2. app_settings：網站主題（單列 key='site_theme'，JSONB）
--    取捨見 §1.5
-- ------------------------------------------------------------
insert into public.app_settings (key, value)
values (
  'site_theme',
  '{
     "brand_name": "MSW 街健館",
     "brand_name_en": "Macau Street Workout",
     "tagline_zh": "用自身的重量，練出澳門最強的街頭力量",
     "tagline_en": "",
     "logo_path": null,
     "hero_bg_path": null,
     "color_ink": "#0F0F0F",
     "color_ink_soft": "#161616",
     "color_ink_line": "#262626",
     "color_paper": "#F5F5F7",
     "color_cobalt": "#0047AB",
     "color_cobalt_bright": "#0057FF",
     "color_vital": "#E3001B",
     "color_vital_bright": "#FF2D2D",
     "color_white": "#FFFFFF",
     "font_preset": "classic",
     "font_stack_custom": null,
     "radius_card": 16,
     "radius_btn": 9999,
     "radius_field": 12,
     "container_max": 1200,
     "space_section": 80,
     "hero_overlay_opacity": 0.55
   }'::jsonb
)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. monthly_leaderboard：把「月度統計 + 排行榜暱稱」合成一次查詢
--    （原本 getMonthlyLeaderboard 要 2 次來回，見 §4.4）
--    security_invoker = false → 匿名訪客可讀（與既有 public_leaderboard 一致）
--    註：即使本檔 §5 收回 anon 對 monthly_running_stats 的直接讀取權，
--        本 view 以擁有者（postgres）權限執行，匿名仍可正常讀取。
-- ------------------------------------------------------------
drop view if exists public.monthly_leaderboard cascade;
create view public.monthly_leaderboard
with (security_invoker = false) as
select
  s.user_id,
  s.period_month,
  s.total_km,
  s.runs,
  p.display_name,
  p.avatar_url,
  p.points
from public.monthly_running_stats s
join public.public_leaderboard p on p.id = s.user_id;

grant select on public.monthly_leaderboard to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Storage：site-assets（公開讀取 bucket）
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

-- 若 bucket 已存在卻是私有，強制改為公開（幂等）
update storage.buckets
   set public = true
 where id = 'site-assets' and public is not true;

drop policy if exists "siteassets_select_public" on storage.objects;
create policy "siteassets_select_public" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-assets');

drop policy if exists "siteassets_admin_all" on storage.objects;
create policy "siteassets_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'site-assets' and public.is_admin())
  with check (bucket_id = 'site-assets' and public.is_admin());

-- =============================================================
-- 5. 安全性強化（對應 SECURITY-AUDIT.md 的 High / Medium）
--    白客 R6 追加；同樣可重複執行。
--    每一項的對應：高 #4、高 #5、中 #8、中 #10、中 #11、低 #12
-- =============================================================

-- ------------------------------------------------------------
-- 5.1（高 #4）收回「僅供 security-definer 函式內部呼叫」的執行權
--     這三支函式的前端／API 皆無直接呼叫（已 grep 確認），
--     其餘 caller 都是 security definer，函式體以 postgres 身分執行，
--     因此收回影響不到任何正常功能。
--     註：public.is_admin() 刻意「不」收回 —— 它被 13 條 RLS policy 的
--         USING 表達式參照（含 events / profiles / app_settings），
--         收回後 admin 在後台查詢某些資料時可能觸發 permission denied，
--         而洩漏風險極低（只回傳呼叫者自己的 admin 布林值），故維持放行。
--
--     ⚠️ 實測發現（重要）：Supabase default privileges 把 EXECUTE 也授予 PUBLIC，
--        只寫 `revoke ... from anon, authenticated` **實際無效** —— ACL 裡仍留
--        `=X/postgres`（PUBLIC），anon 照樣呼叫得到（實測回 200 而且是真資料）。
--        必須同時從 PUBLIC 收回才生效，詳見 SECURITY-R6.md 高 #4。
-- ------------------------------------------------------------
revoke all on function public.award_monthly_if_qualified(uuid, text) from public;
revoke all on function public.setting_num(text, numeric)            from public;
revoke all on function public.gen_coupon_code(text)                 from public;
revoke all on function public.award_monthly_if_qualified(uuid, text) from anon, authenticated;
revoke all on function public.setting_num(text, numeric)            from anon, authenticated;
revoke all on function public.gen_coupon_code(text)                 from anon, authenticated;

-- ------------------------------------------------------------
-- 5.2（高 #5）Storage bucket 加上檔案大小與 MIME 白名單
--     程式碼層的檢查繼續保留當第二道防線。
--     site-assets 只接受圖片輸出類型（canvas 壓縮結果為 png/jpeg/webp）。
-- ------------------------------------------------------------
update storage.buckets
   set file_size_limit    = 10485760,                                  -- 10MB
       allowed_mime_types = array['image/png','image/jpeg','image/webp','image/heic']
 where id = 'run-screenshots';

update storage.buckets
   set file_size_limit    = 10485760,                                  -- 10MB
       allowed_mime_types = array['image/png','image/jpeg','image/webp']
 where id = 'site-assets';

-- ------------------------------------------------------------
-- 5.3（中 #8）收回匿名對 monthly_running_stats 的直接讀取
--     原本此 view 以擁有者權限執行、完全繞過 run_submissions 的 RLS，
--     任何訪客都能讀出全體會員 user_id 與逐月里程（審計 T3 實測）。
--     僅收回 anon：後台「月度名單」用管理者 JWT（authenticated），
--     getMonthOverview() 需要直讀此 view，故保留 authenticated。
--     → 匿名仍可透過 §3 的 monthly_leaderboard 讀到排行榜所需的聚合欄位。
-- ------------------------------------------------------------
revoke select on public.monthly_running_stats from anon;

-- ------------------------------------------------------------
-- 5.4（中 #10）profiles INSERT 防護
--     guard_profile_sensitive_fields 只掛 BEFORE UPDATE，沒有 INSERT 對應機制；
--     一旦日後出現「auth 使用者存在但 profile 不存在」的狀態，
--     該使用者就能自行 INSERT 並指定 role='admin'。
-- ------------------------------------------------------------
create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- handle_new_user trigger 等後端路徑 auth.uid() 為 null，直接放行
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    new.role     := 'member';
    new.points   := 0;
    new.total_km := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_insert();

-- ------------------------------------------------------------
-- 5.5（中 #11）管理員操作稽核：優惠券核銷者
--     原本 coupons.redeemed_at 有記錄但沒有「誰核銷的」，
--     發生爭議時無法追溯。
--
--     【R6 驗收 P1-1 修正】原本本函式 returns void，
--     UPDATE 命中 0 列（代碼不存在／已被核銷）時函式照樣正常返回，
--     API 端只看 error 有無 → 對客人回報「已核銷」的**假成功**。
--     現在改為 returns table(result text, …) 明確回傳結果碼：
--       'ok'          → 核銷成功
--       'not_found'   → 查無此券（API 回 404 NOT_FOUND）
--       'already_used'→ 已核銷／非 active（API 回 409 CONFLICT）
--     重複核銷一律拒絕，且**不覆寫原本的 redeemed_at**。
--     注意：CREATE OR REPLACE 不能改回傳型別，故先 DROP 再 CREATE。
-- ------------------------------------------------------------
alter table public.coupons
  add column if not exists redeemed_by uuid references public.profiles(id) on delete set null;

drop function if exists public.redeem_coupon(text);

create function public.redeem_coupon(p_code text)
returns table (
  result       text,
  coupon_id    uuid,
  coupon_title text,
  member_name  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row  public.coupons%rowtype;
  v_n    integer;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以核銷優惠券';
  end if;

  -- 空代碼：一律視為查無此券，不寫入任何資料
  if v_code = '' then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 大小寫不敏感比對（會員出示的券碼為大寫，避免手誤大小寫造成查無）
  select c.* into v_row
    from public.coupons c
   where upper(c.code) = v_code
   limit 1;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 已核銷／已失效：拒絕，保留原本的 redeemed_at 供稽核
  if v_row.status <> 'active' then
    return query
      select 'already_used'::text,
             v_row.id,
             v_row.title,
             (select p.display_name from public.profiles p where p.id = v_row.user_id);
    return;
  end if;

  update public.coupons
     set status      = 'used',
         redeemed_at = now(),
         redeemed_by = auth.uid()
   where id = v_row.id
     and status = 'active';   -- 併發保護：期間若被他人核銷則不算成功

  get diagnostics v_n = row_count;

  if v_n = 0 then
    return query
      select 'already_used'::text,
             v_row.id,
             v_row.title,
             (select p.display_name from public.profiles p where p.id = v_row.user_id);
    return;
  end if;

  return query
    select 'ok'::text,
           v_row.id,
           v_row.title,
           (select p.display_name from public.profiles p where p.id = v_row.user_id);
end;
$$;

-- 讓 PostgREST 立刻看到新的回傳型別（可重複執行，無副作用）
notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 5.6（低 #12）補齊 gen_coupon_code 的 search_path
-- ------------------------------------------------------------
alter function public.gen_coupon_code(text) set search_path = public;
