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
  coach_name: string | null;
  capacity: number;
  status: "open" | "closed" | "cancelled";
  note: string | null;
  /** 課程 join 後攤平（舊資料可能為 null） */
  class_name: string | null;
  class_color_key: string | null;
  class_category: TrainingCategory | null;
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
  user_id: string;
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
