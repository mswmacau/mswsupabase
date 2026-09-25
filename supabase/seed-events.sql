-- =============================================================
-- R6 活動模組測試用種子資料（BE-18）
-- Owner：白客｜可重複執行（以固定 id 做 upsert）
--
-- 3 筆活動，刻意涵蓋前台規則的各種情況：
--   E1 已上架・未來單日（含報名連結）        → 前台應出現
--   E2 草稿・未來多日（含名額與報名方式文字）→ 前台不應出現（status='draft'）
--   E3 已上架・已過期單日                    → 前台不應出現（event_date < todayISO()）
--
-- ⚠️ 這是提供給測試／聯調用的示範資料；
--    正式上線前請執行本檔尾端的「清除種子資料」語法移除。
-- =============================================================

insert into public.events (
  id, title, subtitle, body, event_date, end_date, start_time, end_time,
  location, capacity, registration_url, registration_note, cover_path,
  status, sort_order
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'MSW 秋季街健體驗日',
    '新手也能上手的引體上升與雙槓基礎課',
    '由 MSW 教練帶領，從握力、懸垂到離心控制，一步步建立第一個引體上升。\n現場提供粉筆與護掌借用，請自備水與毛巾。',
    (current_date + interval '14 days')::date,
    null,
    '19:30',
    '21:00',
    '澳門黑沙環公園健身區',
    40,
    'https://msw-street-workout.vercel.app/events',
    null,
    null,
    'published',
    0
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'MSW 三日街頭力量營',
    '連續三晚的推力／拉力／核心專項',
    '第一日：雙槓屈臂撐與肩部穩定\n第二日：引體上升與背鏈控制\n第三日：核心、龍旗與人體旗幟入門',
    (current_date + interval '30 days')::date,
    (current_date + interval '32 days')::date,
    '19:00',
    '21:30',
    '澳門祐漢公園街健場',
    24,
    null,
    '請於活動前一週透過 Instagram DM @msw.streetworkout 報名，名額有限。',
    null,
    'draft',
    10
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'MSW 夏季耐力挑戰賽',
    '已舉辦完畢的舊活動，用來驗證前台不會顯示過期活動',
    '本次活動已圓滿結束，感謝所有參加者。',
    (current_date - interval '10 days')::date,
    null,
    '18:30',
    '20:30',
    '澳門水塘跑步徑',
    null,
    'https://msw-street-workout.vercel.app/run',
    null,
    null,
    'published',
    0
  )
on conflict (id) do update
set title             = excluded.title,
    subtitle          = excluded.subtitle,
    body              = excluded.body,
    event_date        = excluded.event_date,
    end_date          = excluded.end_date,
    start_time        = excluded.start_time,
    end_time          = excluded.end_time,
    location          = excluded.location,
    capacity          = excluded.capacity,
    registration_url  = excluded.registration_url,
    registration_note = excluded.registration_note,
    status            = excluded.status,
    sort_order        = excluded.sort_order;

-- =============================================================
-- 驗證用查詢（執行後請看：只有 E1 應出現在前台）
-- =============================================================
-- select id, title, event_date, status,
--        (status = 'published' and event_date >= (now() at time zone 'Asia/Macau')::date) as shows_on_frontend
--   from public.events
--  order by event_date;

-- =============================================================
-- 清除種子資料（正式上線前執行）
-- =============================================================
-- delete from public.events
--  where id in ('11111111-1111-4111-8111-111111111111',
--               '22222222-2222-4222-8222-222222222222',
--               '33333333-3333-4333-8333-333333333333');
