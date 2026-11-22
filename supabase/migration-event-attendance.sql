-- =============================================================
-- HYROX 出席點名（資料層）
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行（一次跑完）
-- 幂等：add column if not exists / drop … if exists / create or replace
--       本檔從頭到尾可重複執行，第二次跑不會報錯，也不會改動既有資料
-- Owner：白客（backend-engineer）
-- =============================================================
--
-- 【這一檔在建什麼】
--   §1  event_registrations 追加 2 個欄位：attended_at / attended_by
--   §2  RLS：管理員可 update（確認／補政策）；會員不可改出席欄位（政策 + 觸發器雙層）
--   §3  analytics_hyrox_monthly 擴充：多回 attended（出席數）與 attendance_rate（出席率）
--   §4  讓 PostgREST 重載 schema
--   §5  執行後驗證
--   §6  回滾段（註解形式）
--
-- 【為什麼要做這個】
--   站主目前只知道「誰報名、誰付款」，不知道「誰真的到場」→
--   出席率、no-show、下個月值不值得續辦全部算不出來。
--   點名是唯一能回答這些問題的資料，且只需一個時間戳，成本最低。
--
-- 【口徑定義（前端／CSV／分析頁全部照這套）】
--   attended            = 該月 status='registered' 且 attended_at is not null 的列數
--                         （點名總數，含「未付款但到場」的人）
--   attended_confirmed  = 其中 payment_status='confirmed' 的人數
--                         （已付款且出席；attendance_rate 的分子）
--   出席率              = confirmed = 0 → 0.0
--                         否則 round(100.0 * attended_confirmed / confirmed, 1)
--                         **分母是 confirmed（已付款確認）**，不是報名數——
--                         「報了名但沒付款、也沒來」不該算進出席率分母，
--                         否則付費活動的出席率永遠被未付款者拉低，失去意義。
--                         分子分母同一集合 → 恆在 0–100，不會出現 >100%。
--   no-show    = confirmed − attended_confirmed（可由前端自行相減，不另回鍵）
--
--   【2026-11-22 修正記錄（站主如已貼過舊版，請重跑本檔一次）】
--     舊版：attendance_rate = round(100.0 * attended / greatest(confirmed,1), 1)
--     兩個實測發現的問題（白客在線上以臨時帳號量到）：
--       1. confirmed = 0 但有人點名時 → 分母被 greatest(…,1) 撐成 1
--          → 算出 100.0%（應為 0.0，因為「沒有任何已付款的人」）
--       2. 分子 attended 含「未付款但到場」的人，而分母只算已付款者
--          → 兩個不同集合相除，理論上可算出 >100%
--          例：1 人未付款卻到場、1 人付款沒來 → 1/1 = 100%
--              （語意應是「已付款那位沒來」＝ 0%）
--     現版：
--       · 新增 attended_confirmed =「已付款且出席」的人數（與分母同一集合）
--       · attendance_rate = case when confirmed = 0 then 0.0
--                                else round(100.0 * attended_confirmed / confirmed, 1) end
--         → confirmed=0 固定 0.0；ratio 恆在 0–100
--       · 保留 attended 為「點名總數」（含未付款但到場），兩個數都回，
--         站主看得出「點了幾個人」與「已付款的人裡來了幾個」的分別
--     本次只改函式（create or replace），**不改任何資料**，重跑本檔即生效。
--
--   【v1 的語意取捨】attended_at = null 同時代表「未點名」與「已標記缺席」
--   （撤回點名時兩欄一起清空，資料上分不出來）。團隊決定 v1 **不加第三態**
--   （要再改 DDL，成本不值），因此：
--     · 統計：未點名一律當**未出席**計算（實際意義就是「沒來」）
--     · UI／CSV 文案：一律顯示「未點名」，不寫「未出席」——
--       避免看起來像管理員已經標記過
--   日後若要精確區分，加一個 attendance_marked boolean 或 status 列舉即可。
--
-- 【與 migration-hyrox-analytics.sql 的關係】
--   本檔 §3 是那支函式的**升級版**：簽名完全不變
--   （analytics_hyrox_monthly(p_limit int default 12) returns jsonb），
--   所以前端的 rpc 呼叫不會 404；只是回傳物件多了兩個鍵。
--   用 create or replace，可原地升級；回滾就是重跑舊檔。
--
-- 【⚠️ 未跑本檔時的行為（前端要知道）】
--   · analytics_hyrox_monthly 仍是舊版 → 回傳沒有 attended / attendance_rate 兩個鍵
--     → 前端讀不到就顯示「—」（不要當成 0，0 與「未點名」是兩件事）
--   · PATCH /api/admin/hyrox/registrations/[id]/attendance 回 503 SCHEMA_OUTDATED
--   · 名單 CSV 的「出席」欄顯示「—」（匯出端點會自動退回不含該欄位的查詢）
-- =============================================================


-- ------------------------------------------------------------
-- §1  event_registrations：追加出席欄位（純新增，不動既有列）
-- ------------------------------------------------------------
alter table public.event_registrations
  add column if not exists attended_at timestamptz,
  add column if not exists attended_by uuid references public.profiles(id) on delete set null;

comment on column public.event_registrations.attended_at is
  '實際到場點名時間。null = 未點名（v1 不區分「未點名」與「已標記缺席」，'
  '統計上一律當未出席計算；UI/CSV 對 null 一律顯示「未點名」）';
comment on column public.event_registrations.attended_by is
  '點名的管理員 id（誰標的）；管理員帳號被刪除時設 null，不連累報名紀錄';

-- 常用查詢：某場次已點名／未點名的人數
-- （partial index 只收已點名的列，未點名時幾乎不佔空間）
create index if not exists idx_event_reg_attended
  on public.event_registrations (event_id, attended_at)
  where attended_at is not null;


-- ------------------------------------------------------------
-- §2  RLS：管理員可 update；會員不可改出席欄位（雙層防護）
--
--     第一層（政策）：只有 is_admin() 的 update 政策存在 → 會員的 update 被擋。
--       注意：**不能** revoke update from authenticated ——
--       管理員本身也是 authenticated 角色，revoke 會連管理員一起鎖死。
--       表級 grant 保留給 authenticated，行級由 policy 收窄到 admin。
--
--     第二層（觸發器）：即使日後有人加了寬鬆的 update 政策，
--       非管理員寫 attended_at / attended_by 也會被還原成原值
--       （與 profiles 的 guard_profile_sensitive_fields 同一模式）。
--       只 guard 這兩個新欄位，不碰既有欄位的任何行為。
-- ------------------------------------------------------------
grant update on public.event_registrations to authenticated;

drop policy if exists "event_reg_admin_update" on public.event_registrations;
create policy "event_reg_admin_update" on public.event_registrations
  for update using (public.is_admin()) with check (public.is_admin());

create or replace function public.event_registrations_guard_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 管理員（含 service_role 走 RPC）放行
  if public.is_admin() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- 非管理員：出席欄位一律還原成原值（不 raise，避免把整列鎖死；
  -- 會員端本來就沒有 update 入口，這裡只是縱深防禦）
  new.attended_at := old.attended_at;
  new.attended_by := old.attended_by;
  return new;
end $$;

comment on function public.event_registrations_guard_attendance() is
  'event_registrations 出席欄位護欄：非管理員寫 attended_at / attended_by 一律還原成原值';

drop trigger if exists event_reg_guard_attendance on public.event_registrations;
create trigger event_reg_guard_attendance
  before update on public.event_registrations
  for each row execute function public.event_registrations_guard_attendance();

-- 觸發器函式照本專案紀律收回 EXECUTE（預設會給 PUBLIC）
revoke all on function public.event_registrations_guard_attendance() from public, anon, authenticated;

-- §2.1 政策清點：若線上存在「非管理員」的 update 政策就印 notice 提醒
--      （不自動刪除不明政策——可能是站主刻意加的；這裡只提示）
do $$
declare
  v_bad text;
begin
  select string_agg(policyname, '、')
    into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'event_registrations'
     and cmd = 'UPDATE'
     and policyname <> 'event_reg_admin_update';

  if v_bad is not null then
    raise notice '⚠️ event_registrations 另有 UPDATE 政策：%（本檔未改動它們；若其中有放行會員的，請人工確認）', v_bad;
  else
    raise notice 'RLS OK — event_registrations 的 UPDATE 政策只有 event_reg_admin_update';
  end if;
end $$;


-- ------------------------------------------------------------
-- §3  analytics_hyrox_monthly：擴充 attended / attended_confirmed / attendance_rate
--
--     簽名不變（p_limit int default 12 → jsonb），前端 rpc 呼叫不會壞。
--     除了既有的 month/registrations/confirmed/confirm_rate/revenue_cents/
--     returning_members/returning_rate，多回：
--       attended        = 該月已點名（attended_at not null）的列數
--       attendance_rate = 100.0 * attended / greatest(confirmed, 1)，一位小數
--     空資料時 months = []，所有鍵仍在（isRpcRow 相容）。
-- ------------------------------------------------------------
create or replace function public.analytics_hyrox_monthly(p_limit int default 12)
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

  v_limit := coalesce(p_limit, 12);
  if v_limit < 1 or v_limit > 36 then
    raise exception 'p_limit 需為 1–36 的整數（收到 %）', p_limit;
  end if;

  return jsonb_build_object(
    'months', coalesce((
      -- 第 1 層：每月的報名／確認／出席／收入，與該月最早場次日（回頭窗口的錨點）
      with monthly as (
        select
          to_char(e.event_date, 'YYYY-MM')                              as month,
          min(e.event_date)                                             as month_first_day,
          count(*)::int                                                 as registrations,
          count(*) filter (where r.payment_status = 'confirmed')::int   as confirmed,
          count(*) filter (where r.attended_at is not null)::int        as attended,
          -- 已付款且出席：與 confirmed 同一集合，attendance_rate 的分子
          -- （2026-11-22 修正：原本用 attended 當分子，含未付款者，
          --   會算出 >100% 或「沒有人付款卻 100%」的荒謬值）
          count(*) filter (
            where r.payment_status = 'confirmed' and r.attended_at is not null
          )::int                                                        as attended_confirmed,
          coalesce(
            sum(r.payment_amount_cents) filter (where r.payment_status = 'confirmed'),
            0
          )::int                                                        as revenue_cents
        from public.events e
        join public.event_registrations r on r.event_id = e.id
        where e.series = 'hyrox'
          and e.status in ('published','archived','open','closed','photos')
          and r.status = 'registered'
        group by 1
      ),
      -- 第 2 層：回頭會員數（returning_rate 也要用它，所以先算好）
      with_returning as (
        select
          m.*,
          (
            select count(distinct r2.user_id)::int
              from public.event_registrations r2
              join public.events e2 on e2.id = r2.event_id
             where e2.series = 'hyrox'
               and r2.status = 'registered'
               -- 回頭窗口：[該月最早場次日 − 12 個月, 該月最早場次日)
               and e2.event_date >= (m.month_first_day - interval '12 months')
               and e2.event_date <   m.month_first_day
               -- 只數「該月真的有報名」的會員（窗口外的歷史報名不算回頭）
               and r2.user_id in (
                 select r3.user_id
                   from public.event_registrations r3
                   join public.events e3 on e3.id = r3.event_id
                  where e3.series = 'hyrox'
                    and r3.status = 'registered'
                    and to_char(e3.event_date, 'YYYY-MM') = m.month
               )
          ) as returning_members
        from monthly m
      )
      select jsonb_agg(
        jsonb_build_object(
          'month',             wr.month,
          'registrations',     wr.registrations,
          'confirmed',         wr.confirmed,
          'confirm_rate',      round(100.0 * wr.confirmed / greatest(wr.registrations, 1), 1),
          'revenue_cents',     wr.revenue_cents,
          'returning_members', wr.returning_members,
          'returning_rate',    round(100.0 * wr.returning_members / greatest(wr.registrations, 1), 1),
          'attended',          wr.attended,
          -- 已付款且出席的人數（與 confirmed 同一集合）
          'attended_confirmed', wr.attended_confirmed,
          -- confirmed = 0 → 固定 0.0（沒有任何已付款的人，出席率無意義）；
          -- 否則分子分母同一集合，恆在 0–100（不會出現 >100%）
          'attendance_rate',   case
                                 when wr.confirmed = 0 then 0.0
                                 else round(100.0 * wr.attended_confirmed / wr.confirmed, 1)
                               end
        ) order by wr.month desc
      )
      from (
        select month, registrations, confirmed, attended, attended_confirmed,
               revenue_cents, returning_members
          from with_returning
         order by month desc
         limit v_limit
      ) wr
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.analytics_hyrox_monthly(int) is
  'HYROX 月度彙總（管理員限定）：報名數／確認數／確認率／收入分／回頭會員數與率／'
  '出席數（attended＝點名總數）／已付款且出席數（attended_confirmed）／出席率。'
  '出席率＝attended_confirmed / confirmed（同一集合，恆 0–100；confirmed=0 時固定 0.0）；'
  '未點名（attended_at is null）一律當未出席計算（實際意義＝沒來）；空資料回 {months:[]}';

revoke all on function public.analytics_hyrox_monthly(int) from public, anon;
grant execute on function public.analytics_hyrox_monthly(int) to authenticated;


-- ------------------------------------------------------------
-- §4  讓 PostgREST 立刻看到新欄位／新函式（本專案踩過 PGRST204/205 的坑）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- §5  執行後驗證（在 SQL Editor 逐段跑；每段都應該回預期結果）
-- =============================================================
--
-- 5.1 兩個欄位都在
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='event_registrations'
--      and column_name in ('attended_at','attended_by');
--   → 應回 2 列
--
-- 5.2 索引在
--   select indexname from pg_indexes
--    where schemaname='public' and tablename='event_registrations'
--      and indexname='idx_event_reg_attended';
--   → 應回 1 列
--
-- 5.3 UPDATE 政策只有一條且是 admin-only
--   select policyname, cmd, qual, with_check from pg_policies
--    where schemaname='public' and tablename='event_registrations'
--    order by cmd, policyname;
--   → UPDATE 只應有 event_reg_admin_update，qual 與 with_check 都是 is_admin()
--
-- 5.4 觸發器在
--   select tgname from pg_trigger
--    where tgrelid='public.event_registrations'::regclass and not tgisinternal;
--   → 應包含 event_reg_guard_attendance
--
-- 5.5 分析函式回傳新鍵（空資料也要有 months）
--   select public.analytics_hyrox_monthly(12);
--   → {"months":[...]}；有資料的月份列應含 attended / attended_confirmed / attendance_rate
--
-- 5.6 出席率口徑自檢（2026-11-22 修正後的驗收查詢）
--   把每個月的兩個數字並排看，確認三件事：
--     (a) confirmed = 0 的月份 → attendance_rate 必須是 0.0（不是 100.0）
--     (b) attendance_rate 恆在 0–100（不可能 >100）
--     (c) attended ≥ attended_confirmed（點名總數不會少於「已付款且出席」）
--
--   select
--     m->>'month'                                     as month,
--     (m->>'registrations')::int                      as registrations,
--     (m->>'confirmed')::int                          as confirmed,
--     (m->>'attended')::int                           as attended,
--     (m->>'attended_confirmed')::int                 as attended_confirmed,
--     (m->>'attendance_rate')::numeric                as attendance_rate
--     from jsonb_array_elements(
--            (public.analytics_hyrox_monthly(12)) -> 'months'
--          ) m
--    order by 1 desc;
--   → 預期：無 confirmed 的月份 attendance_rate = 0.0；
--           所有列 attendance_rate between 0 and 100；
--           attended >= attended_confirmed
--
--
-- 5.7 會員改不到出席欄位（用會員 JWT 直接打 PostgREST）
--   curl -X PATCH "$SUPABASE_URL/rest/v1/event_registrations?id=eq.<自己那筆>" \
--        -H "apikey: $ANON_KEY" -H "authorization: Bearer $USER_JWT" \
--        -H "content-type: application/json" -d '{"attended_at":"2026-12-16T10:00:00Z"}'
--   → 403（new row violates row-level security policy；無會員 UPDATE 政策）
--   → 即使政策被誤開，觸發器也會把 attended_at 還原成 null（回應 200 但值不變）
-- =============================================================


-- =============================================================
-- §6  回滾段（本檔不執行；要回滾時把下面的註解解開、逐段跑）
--
--     ⚠️ 回滾會丟掉所有點名記錄（attended_at / attended_by）。
--        上線後若要回滾，先把這兩欄匯出備份：
--        select id, attended_at, attended_by from public.event_registrations
--         where attended_at is not null;
--
-- -- 6.1 分析函式還原成沒有 attended 的舊版
-- --     （重跑 supabase/migration-hyrox-analytics.sql 即可，它用 create or replace）
--
-- -- 6.2 觸發器與政策
-- -- drop trigger if exists event_reg_guard_attendance on public.event_registrations;
-- -- drop function if exists public.event_registrations_guard_attendance();
-- -- drop policy if exists "event_reg_admin_update" on public.event_registrations;
-- --   ↑ 注意：這條政策是 migration-event-registrations.sql 原本就有的，
-- --     回滾本檔時**不應該**刪它（管理員日後仍需要 update 能力）。
--
-- -- 6.3 欄位與索引
-- -- drop index if exists public.idx_event_reg_attended;
-- -- alter table public.event_registrations
-- --   drop column if exists attended_at,
-- --   drop column if exists attended_by;
--
-- -- 6.4 讓 PostgREST 重載
-- notify pgrst, 'reload schema';
-- =============================================================
