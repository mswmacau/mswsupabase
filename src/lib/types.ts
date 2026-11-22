export type Role = "member" | "admin";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type CouponStatus = "active" | "used" | "expired";

/**
 * 性別（migration-paid-events-1.sql A 段 profiles.gender 的 check 值）。
 * DB 允許 null（既有會員尚未填），所以 Profile.gender 也是 optional。
 */
export type Gender = "male" | "female" | "undisclosed";

/**
 * 報名付款狀態（migration-paid-events-1.sql C 段）。
 * not_required 免費活動 / pending_review 待審 / confirmed 已通過 / rejected 已退回（可重交）
 */
export type PaymentStatus =
  | "not_required"
  | "pending_review"
  | "confirmed"
  | "rejected";

/** 活動的三態：draft 與 archived 都不出現在前台，只有 archived 不出現在後台預設列表 */
export type EventStatus = "draft" | "published" | "archived";

export interface Event {
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  event_date: string; // YYYY-MM-DD
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  capacity: number | null;
  registration_url: string | null;
  registration_note: string | null;
  cover_path: string | null;
  status: EventStatus;
  /**
   * 報名費（分）。DB 的 events.fee_cents 本來就有這個欄位（migration-paid-events-1.sql），
   * 只是一般活動的查詢與型別一直沒帶它 —— 前台活動卡要顯示「費用」才補上。
   * optional：一般活動多為 null／0 → 前台顯示「免費」；HYROX 才有實際金額。
   */
  fee_cents?: number | null;
  /**
   * 活動分類（訓練 / 跑步 / 比賽 / 聚會）。
   * F-E2 階段一：只做 UI 準備。DB 尚未建立此欄位，故為 optional，
   * 現有 `.select("*")` 查詢唔使改、唔會影響既有資料。
   */
  category?: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/* =============================================================
 * 付費活動（HYROX）— migration-paid-events-1.sql B/C 段
 * ============================================================= */

/**
 * HYROX 場次。
 *
 * 為什麼不是 `interface HyroxEvent extends Event`：
 *   DB 的 events.event_date 目前仍是 `date not null`（schema-r6.sql），但交付契約
 *   要求後台可建立「日期待定」場次（event_date = null）。若直接 extends 再放寬
 *   event_date 成 `string | null`，TypeScript 會因為「屬性型別必須相容」而報錯
 *   （string | null 不是 string 的子型別）。故用 Omit 換掉該欄位再補回。
 */
export type HyroxEvent = Omit<Event, "event_date"> & {
  /** YYYY-MM-DD；null = 日期待定（需 DB 端把 event_date 改成可為 null 才寫得進去） */
  event_date: string | null;
  /** 系列標籤；HYROX 場次一律 'hyrox'（既有活動為 null） */
  series: string | null;
  /** 報名費（分）。0 = 免費 */
  fee_cents: number;
  /** 收款 QR 圖片的 Storage 路徑（site-assets 內） */
  payment_qr_path: string | null;
  /** 收款電話（純文字） */
  payment_phone: string | null;
  /** 付款說明（純文字） */
  payment_note: string | null;
};

/** 後台列表用：場次 + 統計（註冊數／待審數） */
export type HyroxEventWithCounts = HyroxEvent & {
  /** status='registered' 的報名筆數 */
  registrations_count: number;
  /** status='registered' 且 payment_status='pending_review' 的筆數 */
  pending_count: number;
};

/**
 * 往期場次回顧相片（supabase/migration-hyrox-photos.sql 的 event_photos）。
 *
 * 一個場次可掛多張相片。path 是 site-assets bucket 內的相對路徑
 * （events/ 前綴），前端要顯示時請用 publicAssetUrl(path)（src/lib/assets.ts:22）
 * 組公開網址，不要自己拼字串。
 */
export interface EventPhoto {
  id: string;
  event_id: string;
  /** site-assets 內的相對路徑，如 events/202611/1730-ab12cd.jpg */
  path: string;
  /** 相片說明（選填） */
  caption: string | null;
  /** 顯示順序（升冪） */
  sort_order: number;
}

/**
 * 後台 API（/api/admin/hyrox/photos）回傳給管理頁的相片列：
 * EventPhoto 加上可直接放進 <img src> 的公開網址（publicAssetUrl 的結果，
 * 未設定 Supabase 時為 null）。
 */
export type EventPhotoWithUrl = EventPhoto & { url: string | null };

/**
 * 往期場次（getHyroxPastEvents）：已結束、要在 /hyrox「往期場次」區塊
 * 連到詳情頁的場次，附上相片數。
 *
 * photo_count 一定會是數字（沒有相片時為 0，不是 undefined、也不是省略該 key），
 * 前端可以直接判斷 `photo_count > 0`。
 * HyroxPastEvent 是 HyroxEvent 的超集，所以既有吃 HyroxEvent[] 的地方也能用。
 */
export type HyroxPastEvent = HyroxEvent & { photo_count: number };

/** 報名狀態（event_registrations.status） */
export type RegistrationStatus = "registered" | "cancelled";

/** 報名表三題（自由文字；空白時存 null） */
export interface HyroxAnswers {
  group_pref: string | null;
  weekly_freq: string | null;
  longest_run: string | null;
}

/** 會員自己的 HYROX 報名（含付款狀態與審核備註，給 /dashboard 顯示） */
export interface HyroxRegistration extends HyroxAnswers {
  id: string;
  event_id: string;
  user_id: string;
  status: RegistrationStatus;
  payment_status: PaymentStatus;
  payment_proof_path: string | null;
  payment_amount_cents: number | null;
  disclaimer_accepted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
  created_at: string;
  /** 關聯場次（getMyHyroxRegistrations 一併取回，減少一次往返） */
  event?: HyroxEvent | null;
  /** 付款截圖的 signed URL（後台名單用；會員端不回） */
  proof_url?: string | null;
}

/** 後台報名名單的一列（契約見 GET /api/admin/hyrox/registrations） */
export interface HyroxAdminRegistrationRow {
  registration_id: string;
  display_name: string | null;
  full_name: string | null;
  gender: Gender | null;
  phone: string | null;
  id_last4: string | null;
  group_pref: string | null;
  weekly_freq: string | null;
  longest_run: string | null;
  payment_status: PaymentStatus;
  /** 會員自填金額（分）；契約外加欄位，見交付說明「建議契約調整」 */
  payment_amount_cents: number | null;
  admin_note: string | null;
  created_at: string;
  /** 付款截圖 signed URL（1 小時）；無截圖為 null */
  proof_url: string | null;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: Role;
  points: number;
  total_km: number;
  created_at: string;
  /**
   * 實名資料（migration-paid-events-1.sql A 段新增）。
   * 全部 optional：DB 允許 null（既有會員未補資料），且仍有查詢是
   * `.select("id, display_name, avatar_url")` 這種部分欄位，標成 optional
   * 才不會逼那些地方一起改。前端要顯示時請用 `profile.full_name ?? ""`。
   */
  full_name?: string | null;
  gender?: Gender | null;
  /** 身分證件號後四位（只存後四位，用途：活動報名及保險登記） */
  id_last4?: string | null;
  /**
   * 測試帳號旗標（migration-profile-test-flag.sql）。
   * true = 不計入公開排行榜（public_leaderboard / monthly_leaderboard）與站統計。
   * optional：部分查詢只 select 少量欄位，且舊環境可能還沒有這一欄。
   */
  is_test?: boolean;
}

export interface TrainingSession {
  id: string;
  session_date: string;
  title: string;
  location: string;
  starts_at: string | null;
  ends_at: string | null;
  capacity: number;
  note: string | null;
  status: "open" | "closed" | "cancelled";
  created_at: string;
  /**
   * 班表場次的開始／結束時刻（migration-training-schedule.sql 之後才有）。
   *
   * Postgres time 型別，PostgREST 回傳帶秒（例如 "19:00:00"），顯示前要 slice(0,5)。
   * 標成 optional 的原因：本型別被 `select("*")` 與部分欄位查詢共用，
   * 舊資料（class_id 為 null 的場次）也可能沒有值；補上才不用在元件裡 any。
   */
  start_time?: string | null;
  end_time?: string | null;
}

/* ── 定期訓練班表（migration-training-schedule.sql）───────────────────
 * 命名注意：既有的 `TrainingSession` 代表「一場訓練場次」且被 checkins、
 * 後台場次頁多處引用（grep 結果：types.ts:193、types.ts:214、queries.ts 多處），
 * 因此這裡新增的場次列型別刻意命名為 `TrainingSessionRow`，不改舊型別，
 * 避免一次改動牽連前台頁面（本次範圍只到後端）。
 * ─────────────────────────────────────────────────────────────────── */

/** 日曆上的 8 類課程分類（與 training_classes.category 的 check 一致） */
export type TrainingCategory =
  | "strength"
  | "hyrox"
  | "running"
  | "skill"
  | "internal"
  | "outdoor";

/** 課程定義 */
export interface TrainingClass {
  id: string;
  slug: string;
  name: string;
  category: TrainingCategory;
  /** 色票鍵（blue / green / amber / teal / violet / orange…），前端自行對色 */
  color_key: string | null;
  duration_min: number | null;
  capacity: number | null;
  coach_name: string | null;
  location: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

/** 週期規則（每週固定） */
export interface TrainingRule {
  id: string;
  class_id: string;
  /** 1=星期一 … 7=星期日（ISO-8601，與 Postgres isodow 一致） */
  weekday: number;
  /** 'HH:MM:SS'（time 型別，PostgREST 回傳帶秒） */
  start_time: string;
  end_time: string;
  location: string | null;
  coach_name: string | null;
  capacity: number | null;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  created_at: string;
  /** 後台列表用（join training_classes.name） */
  class_name?: string | null;
}

/**
 * 月曆用的場次列（training_sessions + 課程 join 後攤平）。
 * 刻意與既有 `TrainingSession` 分開：舊型別沒有 class_id / start_time / coach_name。
 */
export interface TrainingSessionRow {
  id: string;
  session_date: string;
  /** 'HH:MM:SS'，舊資料（class_id 為 null）可能為 null */
  start_time: string | null;
  end_time: string | null;
  class_id: string | null;
  title: string;
  location: string;
  /**
   * 管理員在「這一場」特別改過的場地；null = 沿用課程／場次預設的 location。
   * 顯示時一律 `location_override ?? location`，不要只顯示 location。
   */
  location_override: string | null;
  coach_name: string | null;
  capacity: number;
  status: "open" | "closed" | "cancelled";
  note: string | null;
  /** 課程 join 後攤平（舊資料可能為 null） */
  class_name: string | null;
  class_color_key: string | null;
  class_category: TrainingCategory | null;
}

/**
 * 首頁「下一場定期訓練」／頁尾徽章要的欄位（getNextSession 的回傳形狀）。
 *
 * 刻意不用 TrainingSessionRow：那一個是「某月全部場次」的完整列（含顏色、
 * 狀態、名額），首頁只要一支卡片需要的最小集合，少搬一堆用不到的欄位。
 */
export interface NextSessionInfo {
  id: string;
  session_date: string;
  /** 'HH:MM:SS'；舊資料可能為 null */
  start_time: string | null;
  end_time: string | null;
  title: string;
  /** 課程名稱（join training_classes）；舊資料為 null，顯示時退回 title */
  class_name: string | null;
  coach_name: string | null;
  /** 已套用 location_override ?? location */
  location: string;
}

/* ── 日曆色彩圖例（migration-schedule-legend.sql）──────────────────────
 * 客戶原話：「如果看不到，上方可以說明顏色所代表的活動，並且後台同步」
 * 前台日曆格子太窄放不下課名，改用顏色短條表示，圖例負責解釋顏色。
 * 標籤（label）由後台編輯，前台只讀。
 * ─────────────────────────────────────────────────────────────────── */

/** 前台日曆的色彩圖例（只含啟用中的，已依 sort_order 排序） */
export interface ScheduleLegendItem {
  /** 對應 training_classes.color_key 的色票鍵（blue / green / …），不是 hex */
  color_key: string;
  /** 後台可編輯的顯示名稱，1–20 字 */
  label: string;
  sort_order: number;
}

/* ── 月份發布（migration-training-months.sql）─────────────────────────
 * 班表的發布單位是「月」，不是「場次」也不是「課程」。
 * 客戶原話：「到 12 月 1 日自動上架 12 月、同步下架 11 月」——
 * 所以每月一列，帶一個狀態與一個生效時間，可見性在「讀取時」比較 now()。
 * ─────────────────────────────────────────────────────────────────── */

/** 'draft' 只有管理員看得到；'published' 到達生效時間後所有人可見 */
export type TrainingMonthStatus = "draft" | "published";

export interface TrainingMonth {
  year: number;
  month: number;
  status: TrainingMonthStatus;
  /**
   * 生效時間（timestamptz）。
   * `null` 代表「該月 1 日 00:00（Asia/Macau）」——由 is_month_visible() 補算，
   * 前端不需要自己拼時間。
   */
  publish_at: string | null;
  /** 該月場次數（後台月份列表用；前台查詢通常不帶） */
  sessions_count?: number;
}

export interface TrainingCheckin {
  id: string;
  session_id: string;
  user_id: string;
  status: ReviewStatus;
  admin_note: string | null;
  confirmed_by: string | null;
  created_at: string;
  session?: TrainingSession;
  profile?: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
}

export interface RunSubmission {
  id: string;
  user_id: string;
  km: number;
  period_month: string;
  image_path: string;
  note: string | null;
  status: ReviewStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  profile?: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
  image_url?: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  user_id: string;
  title: string;
  description: string | null;
  month_awarded: string | null;
  status: CouponStatus;
  expires_at: string | null;
  redeemed_at: string | null;
  created_at: string;
}

export interface PointTransaction {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
}

export interface MonthlyStat {
  user_id: string;
  period_month: string;
  total_km: number;
  runs: number;
}

export interface LeaderRow {
  /**
   * P1-A：排行榜公開代號 = `substr(md5(profiles.id::text), 1, 8)`。
   * 不是會員的 auth UUID，不可逆推；同一會員跨月份穩定，
   * 只用來比對「名次上升／下降」，刻意不寫進任何 DOM 屬性。
   * 定義見 supabase/migration-leaderboard-no-id.sql。
   */
  public_code: string;
  name: string;
  total_km: number;
  runs: number;
  points: number;
}

export interface SiteStats {
  members: number;
  total_km: number;
  total_runs: number;
  total_sessions: number;
}

/* =============================================================
 * 賽事系統（HYROX 賽事外殼 + 報名）
 * 資料來源：supabase/migration-races.sql
 *   events（series='race'，加 6 個新欄位）｜race_categories
 *   ｜race_registrations｜race_entries｜4 個只出數字的檢視
 * ============================================================= */

/**
 * 賽事狀態（events.status）。
 *
 * 【為什麼不是 EventStatus】events.status 原有的 check 約束只允許
 * ('draft','published','archived')；migration-races.sql §1 以「放寬約束」的方式
 * 併入賽事生命週期值 ('open','closed','photos')，既有三個值一字未動，
 * 所以一般活動（series is null）的行為完全不變。
 * 'published' 保留在 union 內，是因為 DB 端真的可能存在（人工改成 published 的列），
 * 型別要反映資料庫的真實值域，不能假裝它不存在。
 */
export type RaceStatus = "draft" | "open" | "closed" | "photos" | "archived" | "published";

/** 賽事組別（race_categories）— 每場賽事的每日組別，可自訂，不寫死 */
export interface RaceCategory {
  id: string;
  event_id: string;
  /** 比賽日 YYYY-MM-DD（多日賽事每天可有不同組別） */
  day: string;
  /** 組別名稱，如 Men Open / Mixed Doubles / Relay */
  name: string;
  /** 每組人數（1 = 個人賽，2 = 雙人，4 = 接力…），1–8 */
  team_size: number;
  /** 報名費（分）。0 = 免費 */
  fee_cents: number;
  sort_order: number;
  created_at: string;
}

/** 賽事報名狀態（race_registrations.status） */
export type RaceRegistrationStatus = "submitted" | "confirmed" | "needs_info" | "cancelled";

/**
 * 賽事付款狀態（race_registrations.payment_status）。
 * 與 HyroxPaymentStatus（not_required / pending_review / confirmed / rejected）
 * 是兩套獨立語意：賽事這裡用 pending / approved / rejected。
 */
export type RacePaymentStatus = "not_required" | "pending" | "approved" | "rejected";

/** 賽事（events 列，series='race'）— 只列賽事頁需要的欄位 */
export interface RaceEvent {
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  /** 開始日 YYYY-MM-DD */
  event_date: string;
  /** 結束日 YYYY-MM-DD；多日賽事才會有值 */
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  capacity: number | null;
  registration_url: string | null;
  registration_note: string | null;
  cover_path: string | null;
  status: RaceStatus;
  series: string | null;
  sort_order: number;
  fee_cents: number | null;
  /** 攝影師雲端相簿網址（外部連結） */
  album_url: string | null;
  /** 相簿按鈕文字；空值時前台顯示「睇比賽相片」 */
  album_label: string | null;
  /** 是否出現在主頁賽事帶 */
  promo_on_home: boolean;
  /** 主頁帶狀卡的一句話 */
  promo_note: string | null;
  /** 報名截止時間（timestamptz） */
  registration_deadline: string | null;
  /** 巴士／住宿／集合的自由文字（可手動編輯） */
  logistics_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 人層報名（race_registrations）— 一個人一筆，巴士／住宿掛在這裡。
 *
 * 【為什麼不重用 event_registrations】見 migration-races.sql 檔頭：
 * unique(event_id,user_id) 會擋死一人多報（雙人＋接力）、沒有姓名／巴士／住宿欄，
 * 且 9 個付款欄位的語意與賽事需求衝突。
 */
export interface RaceRegistration {
  id: string;
  event_id: string;
  user_id: string;
  /** 本人自己填的姓名 */
  full_name: string;
  phone: string;
  /** HYROX 分組需要；null = 未提供 */
  gender: "male" | "female" | null;
  needs_bus: boolean;
  bus_seats: number;
  needs_lodging: boolean;
  lodging_people: number;
  lodging_nights: number;
  /** 付款截圖的私有桶路徑（run-screenshots） */
  payment_proof_path: string | null;
  payment_status: RacePaymentStatus;
  status: RaceRegistrationStatus;
  member_note: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

/** 人次層報名（race_entries）— 這個人跑哪一日哪一組，可多筆 */
export interface RaceEntry {
  id: string;
  registration_id: string;
  category_id: string;
  /** 雙人／接力的隊友名（本人填）；個人賽為 null */
  teammate_names: string | null;
}

/** 賽事彙總（檢視 race_summary）— 只出數字，不含任何姓名 */
export interface RaceSummaryRow {
  event_id: string;
  registrations: number;
  entries: number;
  bus_seats: number;
  lodging_people: number;
  lodging_nights: number;
}

/** 賽事 × 日期彙總（檢視 race_day_summary） */
export interface RaceDaySummaryRow {
  event_id: string;
  day: string;
  registrations: number;
  entries: number;
}

/** 賽事 × 日期 × 組別彙總（檢視 race_category_summary） */
export interface RaceCategorySummaryRow {
  event_id: string;
  day: string;
  category_id: string;
  name: string;
  registrations: number;
  entries: number;
}

/** 賽事後勤彙總（檢視 race_logistics）— 給後台訂車訂房用 */
export interface RaceLogisticsRow {
  event_id: string;
  bus_people: number;
  bus_seats: number;
  lodging_people: number;
  lodging_nights: number;
}

/**
 * 後台名單列（GET /api/admin/races/[id]/registrations）。
 * 這是全站唯一會出現「姓名」的賽事端點，只有管理員讀得到。
 */
export interface RaceAdminRegistrationRow extends RaceRegistration {
  /** 付款截圖的 signed URL（1 小時；後台專用，會員端不回） */
  proof_url: string | null;
  /** 這個人報名的組別（人次層展開） */
  entries: Array<{
    id: string;
    category_id: string;
    category_name: string | null;
    day: string | null;
    teammate_names: string | null;
  }>;
}

/** 賽事報名的組別（會員端顯示用，已攤平 race_categories 的關鍵欄位） */
export interface MyRaceEntry {
  id: string;
  category_id: string;
  teammate_names: string | null;
  category: {
    id: string;
    name: string;
    day: string;
    team_size: number;
    fee_cents: number;
  } | null;
}

/** 會員自己的賽事報名（getMyRaceRegistrations）；含姓名電話，只回本人 */
export interface MyRaceRegistration extends RaceRegistration {
  entries: MyRaceEntry[];
}

/* =============================================================
 * HYROX 完賽排行榜（migration-hyrox-results.sql）
 *
 * 資料層：hyrox_divisions（類別參考表）／hyrox_results（提交列）／
 *         hyrox_results_public（公開榜檢視，只有必要欄位）
 * ============================================================= */

/**
 * 比賽類別（hyrox_divisions 一列）。
 * 只回 is_active 的（停用類別不出現在前台；後台要管理停用類別時
 * 另走 admin 端點，查詢層刻意過濾）。
 */
export interface HyroxDivision {
  code: string;
  label: string;
  /** 每隊人數：1 單人 / 2 雙人 / 4 四人；決定隊伍欄位是否必填 */
  team_size: number;
  sort_order: number;
  is_active: boolean;
}

/**
 * 公開榜一列（hyrox_results_public 檢視）。
 * 這是匿名訪客看得到的全部欄位——沒有 user_id／電話／email／截圖路徑
 * （migration §3 的欄位白名單，程式端不可再撈底表補欄位）。
 */
export interface HyroxResultBoardRow {
  id: string;
  division_code: string;
  division_label: string;
  team_size: number;
  race_name: string;
  race_date: string;
  /** 完賽秒數（顯示時前端格式化為 HH:MM:SS） */
  finish_seconds: number;
  team_name: string | null;
  /** 隊友姓名（自由文字，由提交者填；單人類別為 []） */
  teammates: string[];
  display_name: string | null;
  /** 不可逆公開代號（與里程榜同一演算法，非 user_id） */
  public_code: string;
}

/** 會員自己的完賽提交一列（getMyHyroxResults；含審核備註，只回本人） */
export interface MyHyroxResultRow {
  id: string;
  division_code: string;
  division_label: string;
  race_name: string;
  race_date: string;
  finish_seconds: number;
  team_name: string | null;
  teammates: string[];
  note: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
}

/**
 * 後台名單一列（GET /api/admin/hyrox/results）。
 * 這是全站唯一會出現「提交者姓名」的完賽榜端點，只有管理員讀得到。
 */
export interface HyroxAdminResultRow {
  id: string;
  display_name: string | null;
  division_code: string;
  division_label: string;
  race_name: string;
  race_date: string;
  finish_seconds: number;
  /** server 格式化好的 HH:MM:SS，前端不再算 */
  finish_label: string;
  team_name: string | null;
  teammates: string[];
  note: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
  /** 完賽截圖的 signed URL（私有桶，1 小時；後台專用） */
  proof_url: string | null;
}
