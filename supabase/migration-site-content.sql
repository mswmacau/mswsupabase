-- =============================================================
-- 網站內容（app_settings 鍵值）：site_content / site_nav / site_contact / site_pages / site_blocks
-- 日期：2026-10-22
-- 執行位置：Supabase Dashboard → SQL Editor → 整段貼上執行
-- 冪等：on conflict (key) do nothing，可重複執行；不覆蓋用戶已修改過的值
-- =============================================================
--
-- 【用途】
-- 前台「網站內容」管理（後台 /admin/content）的五個資料鍵：
--   site_content  首頁文案與關於我們（Hero／三大理由／六大項目／跑馬燈／CTA 雙版本）
--   site_nav      導覽選單（改名／排序／顯隱）
--   site_contact  頁尾聯絡四欄與品牌宣言四行
--   site_pages    9 個前台頁面的標題／說明／CTA／空狀態／表單標籤與 placeholder
--   site_blocks   首頁 8 個區塊的顯隱與排序
--
-- 【性質】
-- 只往 app_settings 鍵值表「新增」這 5 個鍵的預設值（JSONB），
-- 不改動任何既有表結構、既有欄位與既有資料（site_theme 及其餘鍵一律不碰）。
-- RLS 沿用 schema.sql 第 251–257 行既有政策（settings_select_all /
-- settings_admin_write），自動覆蓋新鍵，無需新增政策。
--
-- 【預設值來源（逐字轉錄，一個字都沒改）】
--   src/lib/config.ts（BRAND / ABOUT / DISCIPLINES / NAV_LINKS）
--   src/app/page.tsx（FEATURES / Hero 兩行大標題與描述 / CTA 雙版本 / 跑馬燈）
--   src/app/{login,signup,events,training,run,leaderboard,about,coaches,dashboard}/page.tsx
--   src/app/login/LoginForm.tsx、src/app/signup/SignupForm.tsx
--   src/app/run/RunUploadForm.tsx、src/components/EventCard.tsx
--   （JSX 換行在渲染時會縮成一個空格，已按渲染結果轉錄）
-- 同一份預設值存放於 src/lib/content.ts 的 DEFAULT_* 常數
-- （後台 API「回復原廠」與前台讀取回落都用它），兩邊由一致性腳本逐字比對。
--
-- Owner：白客（backend-engineer）
-- =============================================================

-- ------------------------------------------------------------
-- 1. site_content — 首頁文案 + 關於我們（F1）
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('site_content', '{
  "about": {
    "eyebrow": "About / 關於我們",
    "lead": "我們是澳門首間以街頭健身（Street Workout）為主題的訓練俱樂部，同時亦是 HYROX官方認證訓練場館。",
    "philosophy": "我們相信，健身不只是提升體能，更是一種生活態度。透過科學化訓練系統、功能性體能訓練、HYROX專項課程及街頭健身訓練，我們致力協助每一位會員挑戰自身極限，發掘更好的自己。",
    "cta": "無論你是健身新手、運動愛好者，還是準備挑戰 HYROX 賽事的運動員，我們都能為你提供專業指導及完善的訓練環境。"
  },
  "hero": {
    "title_line1": "MSW",
    "title_line2": "街健館",
    "desc": "用自身的重量，練出澳門最強的街頭力量。每週一晚固定訓練、每月 300 公里跑步挑戰，每一次汗水都換算成積分與專屬優惠券。",
    "cta_primary_member": "我的帳戶",
    "cta_secondary_member": "上傳跑步紀錄",
    "cta_primary_guest": "立即加入會員",
    "cta_secondary_guest": "查看活動"
  },
  "features": [
    {
      "title": "打破時間地區限制",
      "desc": "每週固定有教練帶領的團體訓練；跑步任務則不限時間地點，隨時上傳紀錄。"
    },
    {
      "title": "贏得專屬優惠券",
      "desc": "月度達標即獲電子優惠券，用汗水換來的獎勵，在 MSW 街健館直接兌換。"
    },
    {
      "title": "與澳門的街健夥伴一起練",
      "desc": "一群人練比一個人練走得遠。排行榜、積分、共同目標，讓訓練不再孤單。"
    }
  ],
  "disciplines": [
    {
      "title": "街頭健身",
      "sub": "Street Workout",
      "desc": "引體上升、雙槓屈臂撐、人體旗幟，以自身重量為負荷的全身訓練。",
      "icon": "💪"
    },
    {
      "title": "引體上升",
      "sub": "Pull Up",
      "desc": "背闊肌與握力的基礎，從懸垂、離心到爆發式引體的漸進課表。",
      "icon": "🏋️"
    },
    {
      "title": "雙槓屈臂撐",
      "sub": "Dips",
      "desc": "胸、三頭與核心的複合動作，建立上半身推力與肩部穩定度。",
      "icon": "🤸"
    },
    {
      "title": "核心訓練",
      "sub": "Core",
      "desc": "前側鏈與後側鏈核心，撐體、舉腿到龍旗的階段式訓練。",
      "icon": "🧘"
    },
    {
      "title": "長跑耐力",
      "sub": "Running",
      "desc": "每月 300 公里累積挑戰，上傳紀錄、後台確認、達標領優惠券。",
      "icon": "🏃"
    },
    {
      "title": "體能檢測",
      "sub": "Conditioning",
      "desc": "定期體能測驗，追蹤你的力量、耐力與爆發力變化曲線。",
      "icon": "📈"
    }
  ],
  "marquee": [
    "Street Workout",
    "街頭健身",
    "Calisthenics",
    "澳門 Macau",
    "Mon 20:00",
    "300km / Month"
  ],
  "cta": {
    "title_member": "繼續把汗水換成積分",
    "desc_member": "本月里程與積分持續累積中，記得定期上傳跑步紀錄與報名訓練。",
    "primary_member": "上傳跑步紀錄",
    "secondary_member": "報名訓練場次",
    "title_guest": "準備好開始累積了嗎？",
    "desc_guest": "註冊只需一分鐘。加入後即可報名訓練、上傳跑步紀錄、追蹤積分與優惠券。",
    "primary_guest": "免費註冊會員",
    "secondary_guest": "我已有帳號"
  }
}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2. site_nav — 導覽選單（F2：3–8 項、必含「主頁」、href 白名單）
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('site_nav', '{
  "links": [
    {
      "href": "/",
      "label": "主頁",
      "visible": true
    },
    {
      "href": "/events",
      "label": "活動",
      "visible": true
    },
    {
      "href": "/training",
      "label": "定期訓練",
      "visible": true
    },
    {
      "href": "/run",
      "label": "月度跑步挑戰",
      "visible": true
    },
    {
      "href": "/leaderboard",
      "label": "排行榜",
      "visible": true
    },
    {
      "href": "/about",
      "label": "關於我們",
      "visible": true
    },
    {
      "href": "/coaches",
      "label": "教練團隊",
      "visible": true
    }
  ]
}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. site_contact — 頁尾聯絡與品牌宣言（F3）
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('site_contact', '{
  "location": "澳門",
  "email": "hello@mswstreetworkout.com",
  "instagram": "@msw_street_workout",
  "instagram_url": "https://www.instagram.com/msw_street_workout",
  "intro": [
    "首間以街頭健身為主題的訓練俱樂部",
    "HYROX 官方認證訓練場館",
    "Street Workout ｜ Calisthenics ｜ 斯巴達 ｜ HYROX",
    "以積極正面態度面對所有困難"
  ]
}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 4. site_pages — 9 個前台頁面的標題／說明／CTA／空狀態／表單標籤（F5–F8）
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('site_pages', '{
  "login": {
    "page_title": "會員登入",
    "intro": "登入後可報名定期訓練、上傳跑步紀錄與查看積分排行。 里程與簽到都由後台確認後才入帳，讓每一次累積都算得清楚。",
    "form_intro": "使用電郵與密碼登入會員帳戶。",
    "admin_notice": "管理員入口：請用管理員帳號登入，成功後會直接進入後台管理。",
    "email_label": "電郵",
    "email_placeholder": "you@example.com",
    "password_label": "密碼",
    "password_placeholder": "••••••••",
    "submit_label": "登入",
    "pending_label": "登入中…",
    "signup_prompt": "還沒有帳號？",
    "signup_link": "立即註冊",
    "error_message": "登入失敗。"
  },
  "signup": {
    "page_title": "註冊會員",
    "intro": "免費加入 MSW 街健館。每週一定期訓練、每月 300 公里跑步挑戰， 里程與簽到都由後台確認後入帳，讓訓練變成看得見的累積。",
    "form_intro": "填寫電郵與密碼即可建立帳號，無需審核。",
    "display_name_label": "顯示名稱（排行榜上顯示）",
    "display_name_placeholder": "例如：阿健",
    "email_label": "電郵",
    "email_placeholder": "you@example.com",
    "password_label": "密碼（至少 6 個字元）",
    "password_placeholder": "••••••••",
    "confirm_label": "確認密碼（請再輸入一次）",
    "confirm_placeholder": "••••••••",
    "confirm_hint": "請再次輸入相同密碼，兩次不一致時無法提交。",
    "submit_label": "建立帳號",
    "pending_label": "註冊中…",
    "verify_note": "送出後註冊即時完成，不需要收取驗證信——直接以上述電郵與密碼登入即可。",
    "rules_note": "註冊即表示同意 MSW 街健館的活動規則：跑步里程須經後台確認後始計入積分， 偽造紀錄將被取消資格。完成月度 300km 可獲優惠券。",
    "login_prompt": "已有帳號？",
    "login_link": "會員登入",
    "error_email": "請輸入有效的電郵地址。",
    "error_password": "密碼至少需要 6 個字元。",
    "error_confirm": "兩次輸入的密碼不一致，請重新輸入。",
    "error_submit": "註冊失敗。",
    "success_message": "註冊成功！請到電郵信箱點擊驗證連結完成啟用，之後即可登入。"
  },
  "events": {
    "page_title": "活動總覽",
    "empty_note": "目前尚未發佈特別活動，以下為常設的兩條主線。",
    "card_register_label": "報名 / 詳情",
    "card_note_title": "報名方式",
    "card_note_fallback": "詳情請洽官方 Instagram"
  },
  "training": {
    "page_title": "定期訓練",
    "open_label": "開放報名",
    "closed_label": "已截止",
    "fact_checkin_label": "簽到一次入帳",
    "slots_label": "場可報名",
    "intro": "報名後於現場簽到，後台確認即入帳積分。適合任何程度，教練會依程度分組調整強度。",
    "history_header": "簽到時間",
    "empty_history": "尚無訓練紀錄，報名一場試試看。"
  },
  "run": {
    "page_title": "月度跑步挑戰",
    "step_1": "完成跑步後，在 app（Strava / Nike Run Club / 咕咚等）截圖顯示距離的畫面。",
    "step_2": "上傳截圖並填寫本次公里數，選擇要計入的月份。",
    "step_3": "管理員核對截圖與數字，確認後里程與積分才會入帳。",
    "step_4": "當月累積達 300 公里，月底由後台統一發放優惠券。",
    "login_prompt": "登入後才能上傳跑步紀錄並累積里程與積分。",
    "login_card_title": "請先登入會員",
    "login_button": "會員登入",
    "signup_button": "註冊新帳號",
    "upload_hint": "同一個月可多次上傳，系統會自動累加。",
    "empty_submissions": "尚未提交任何跑步紀錄，現在就上傳第一次吧！",
    "km_label": "跑步公里數（km）",
    "km_placeholder": "例如 10.5",
    "month_label": "計入月份",
    "screenshot_label": "跑步紀錄截圖",
    "note_label": "備註（選填）",
    "note_placeholder": "例如：黑沙環海濱長廊晨跑",
    "submit_label": "提交紀錄",
    "pending_label": "上傳中…"
  },
  "leaderboard": {
    "page_title": "排行榜",
    "empty_month": "本月尚無已確認紀錄，成為第一位上榜者。"
  },
  "about": {
    "page_title": "關於我們"
  },
  "coaches": {
    "page_title": "教練團隊",
    "empty_state": "教練團隊資料即將公佈，敬請期待。"
  },
  "dashboard": {
    "page_title": "我的帳戶",
    "empty_submissions": "還沒有提交紀錄，去 /run 上傳第一次吧。",
    "empty_points": "尚無積分紀錄。",
    "empty_checkins": "尚無訓練紀錄。"
  }
}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 5. site_blocks — 首頁 8 個區塊的顯隱與排序（F10：全部 visible=true、現行順序）
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('site_blocks', '{
  "home": [
    {
      "id": "hero",
      "label": "首頁大圖（Hero）",
      "visible": true,
      "order": 1
    },
    {
      "id": "stats",
      "label": "累積數據",
      "visible": true,
      "order": 2
    },
    {
      "id": "about",
      "label": "關於我們",
      "visible": true,
      "order": 3
    },
    {
      "id": "programs",
      "label": "兩大核心活動",
      "visible": true,
      "order": 4
    },
    {
      "id": "reasons",
      "label": "三大理由",
      "visible": true,
      "order": 5
    },
    {
      "id": "disciplines",
      "label": "各類訓練項目",
      "visible": true,
      "order": 6
    },
    {
      "id": "ranking",
      "label": "本月排行榜",
      "visible": true,
      "order": 7
    },
    {
      "id": "cta",
      "label": "底部號召",
      "visible": true,
      "order": 8
    }
  ]
}'::jsonb)
on conflict (key) do nothing;

-- =============================================================
-- 執行後驗證
-- =============================================================
-- select key, jsonb_typeof(value) as type, jsonb_pretty(value)
-- from public.app_settings
-- where key in ('site_content', 'site_nav', 'site_contact', 'site_pages', 'site_blocks')
-- order by key;
--   → 應剛好 5 列，type 皆為 object；再執行一次本檔不會報錯，
--     且用戶已在後台修改過的值不會被覆蓋（on conflict do nothing）。
--
-- 前台快取：後台「網站內容」頁按儲存／回復原廠時，API 會呼叫
-- revalidateTag（tag 常數見 src/lib/queries.ts），最遲 60 秒生效。

-- =============================================================
-- 還原方式（若需要完整移除）
-- =============================================================
-- 注意：這會刪除用戶在後台改過的所有網站內容，無法復原，請先確認。
--
-- delete from public.app_settings
-- where key in ('site_content', 'site_nav', 'site_contact', 'site_pages', 'site_blocks');
