-- =============================================================
-- 站內活動報名：event_registrations 表 + RLS + 第 8 支分析 RPC（T-26）
-- 日期：2026-10-23
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 幂等：create table if not exists / drop policy if exists /
--       create or replace function，可重複執行；不覆蓋既有報名資料
-- =============================================================
--
-- 【用途】
-- (1) event_registrations：會員「站內報名」活動的紀錄表（混合模式——外部報名
--     連結按鈕保留，旁邊加站內報名；events 表本身不加欄位、既有行為不變）。
--     寫入端：POST/DELETE /api/event-registrations（會員端，复刻
--     /api/training/checkins 的檢查鏈）。
-- (2) analytics_event_registrations：計劃 §8.3 的第 8 支分析 RPC（D5
--     「最多人報名活動」排行），供 /admin/analytics 儀表板「活動報名」區
--     （方砚的儀表板照本檔檔頭的逐鍵結構渲染）。
--
-- 【性質】
-- 只新增 event_registrations 一張新表與一支新函式；不改動任何既有表結構、
-- 既有欄位與既有資料（events / profiles / training_* / run_submissions /
-- coupons / point_transactions / app_settings 一律不碰）。
--
-- 【與其他 migration 的關係（如實對账）】
-- - 本檔對應 T-26；page_views 與前 7 支 analytics_* RPC 在
--   supabase/migration-analytics.sql（第二批 T-21/T-23），本檔不重複建立。
-- - migration-analytics.sql 檔尾註釋已宣告：第 8 支 RPC 順延至本檔補上，
--   本檔以 create or replace function 追加（幂等，不影響該檔已執行的部分）。
-- - 建議執行順序：migration-analytics.sql → 本檔（RPC 依賴本檔第 1 節的表）。
--
-- 【私隱紀律】
-- 表只記「誰報了哪場活動、何時」；不記 IP、不記 UA。
-- 會員只能讀／寫自己的報名列（RLS）；管理員可讀全部（活動管理名單）。
--
-- Owner：白客（backend-engineer）
-- =============================================================

-- =============================================================
-- 【第 8 支 RPC 回傳結構（方砚的儀表板「活動報名」區照此渲染）】
-- analytics_event_registrations(p_limit int default 20)
--   → 單列 jsonb 物件；security definer + is_admin() 閘門；
--     p_limit 鉗制 1–100；呼叫方式（管理員 JWT）：
--     supabase.rpc('analytics_event_registrations', { p_limit: 20 })
--     任何鍵在空資料時仍存在（空陣列），不會回傳 null、不會省略鍵。
--   {
--     "events": [{
--       "event_id": "uuid…",            ↑ events.id
--       "event_date": "2026-11-01",     ↑ events.event_date（YYYY-MM-DD 字串）
--       "title": "HYROX 模擬賽",        ↑ events.title
--       "status": "published",          ↑ events.status（draft/published/archived）
--       "registered": 12                ↑ 該活動 status='registered' 的報名列數
--     }, ...]
--       ↑ 全部活動（含 0 人報名的，left join），依報名人數降序、
--         同人數依活動日期降序；取前 p_limit 筆
--   }
--   口徑註：站內報名數（走外部連結報名的無法統計，儀表板需標「站內報名數」，
--   見計劃 R13）。會員取消報名是 DELETE 該列，故 registered 即「目前報名人數」。
-- =============================================================

-- ------------------------------------------------------------
-- 1. event_registrations — 站內報名紀錄（計劃 §7.2 逐欄實作）
--    唯一約束 unique (event_id, user_id)：一人一場只能報一次；
--    重複報名由 Postgres 23505 把關（會員端路由轉中文 400）。
-- ------------------------------------------------------------
create table if not exists public.event_registrations (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'registered'
             check (status in ('registered', 'cancelled')),
  created_at timestamptz not null default now()
);

-- 唯一約束（計劃 §7.2）。同時作為 upsert onConflict 的依據。
alter table public.event_registrations
  drop constraint if exists event_registrations_event_user_key;
alter table public.event_registrations
  add constraint event_registrations_event_user_key unique (event_id, user_id);

-- 索引（計劃 §7.2）：(event_id, status)
-- 用途：每場活動的人數統計（analytics_event_registrations、管理端取數端點）
-- 與會員自己的報名查詢（event_id + user_id 走唯一約束索引）。
create index if not exists event_registrations_event_status_idx
  on public.event_registrations (event_id, status);

comment on table public.event_registrations is '站內活動報名紀錄（T-26；會員只能讀寫自己的列）';
comment on column public.event_registrations.status is 'registered=已報名；cancelled 保留給管理端軟取消（會員端取消是 DELETE 該列）';

-- ------------------------------------------------------------
-- 2. RLS（計劃 §7.3 草案三條政策逐字實作 + 第四條管理員 update）
--    草案僅有 select / insert / delete 三條；派工單要求「四條」，
--    故補一條 event_reg_admin_update（for update using is_admin()）：
--    不放寬會員任何權限，只讓管理員日後可軟取消（status='cancelled'）。
--    會員端「取消報名」仍走 DELETE（與 /api/training/checkins 同模式）。
--    刻意不給 anon 任何授權。
-- ------------------------------------------------------------
alter table public.event_registrations enable row level security;

drop policy if exists "event_reg_select_own_or_admin" on public.event_registrations;
create policy "event_reg_select_own_or_admin" on public.event_registrations
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "event_reg_insert_own" on public.event_registrations;
create policy "event_reg_insert_own" on public.event_registrations
  for insert with check (auth.uid() = user_id);

drop policy if exists "event_reg_delete_own_or_admin" on public.event_registrations;
create policy "event_reg_delete_own_or_admin" on public.event_registrations
  for delete using (auth.uid() = user_id or public.is_admin());

-- 第四條（計劃草案外的新增，理由見上方註釋）：僅管理員可 update
drop policy if exists "event_reg_admin_update" on public.event_registrations;
create policy "event_reg_admin_update" on public.event_registrations
  for update using (public.is_admin()) with check (public.is_admin());

-- 表層級只授 select / insert / delete（RLS 再按政策收窄）；
-- update 刻意不授（會員不可改自己的報名列；管理員走 RLS 政策）。
grant select, insert, delete on public.event_registrations to authenticated;

-- ------------------------------------------------------------
-- 3. analytics_event_registrations — D5 最多人報名活動（第 8 支 RPC）
--    模式完全复刻 migration-analytics.sql 的 analytics_session_attendance：
--    security definer + set search_path = public + is_admin() 閘門 +
--    revoke anon / grant authenticated；回傳結構見本檔檔頭。
-- ------------------------------------------------------------
create or replace function public.analytics_event_registrations(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
begin
  if not public.is_admin() then
    raise exception '只有管理員可以查看分析數據';
  end if;

  v_limit := coalesce(p_limit, 20);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'p_limit 需為 1–100 的整數（收到 %）', p_limit;
  end if;

  -- 口徑：registered = status='registered' 的列數（會員取消 = DELETE 該列，
  -- 故即「目前報名人數」）。含 0 人報名的活動（left join），依人數降序。
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_id', t.event_id,
          'event_date', t.event_date,
          'title', t.title,
          'status', t.status,
          'registered', t.registered
        ) order by t.registered desc, t.event_date desc
      )
      from (
        select
          ev.id as event_id,
          ev.event_date,
          ev.title,
          ev.status,
          count(r.id) filter (where r.status = 'registered') as registered
        from public.events ev
        left join public.event_registrations r on r.event_id = ev.id
        group by ev.id
        order by registered desc, ev.event_date desc
        limit v_limit
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.analytics_event_registrations(int) from anon;
grant execute on function public.analytics_event_registrations(int) to authenticated;

-- 讓 PostgREST 立刻看到新函式（可重複執行，無副作用；复刻 schema-r6.sql 做法）
notify pgrst, 'reload schema';

-- =============================================================
-- 執行後驗證（T-26 驗收點）
-- =============================================================
-- -- 1) 會員 JWT：insert 自己的報名列 → 成功；重複 insert → 23505 被拒；
-- --    select 只看得到自己的列；delete 只能刪自己的列。
-- -- 2) 會員 A 的 JWT 讀／寫會員 B 的報名列 → 0 列／被拒（RLS）。
-- -- 3) anon key：任何 select／insert 均被拒。
-- -- 4) 管理員 JWT：呼叫 select public.analytics_event_registrations(20)
-- --    應回 jsonb，events 陣列依 registered 降序；非管理員呼叫被 raise 擋下。
-- -- 5) 刪除一場活動（events cascade）→ 其報名列一併消失（on delete cascade）。
-- =============================================================
