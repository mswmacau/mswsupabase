/**
 * src/lib/content.ts — 前台內容型別、預設值與驗證
 * （site_content / site_nav / site_contact / site_pages / site_blocks）
 *
 * Owner：白客（backend-engineer）
 * 方硯（前端）只讀：import 型別 / DEFAULT_* / normalize* / coerce*，不要修改本檔。
 *
 * 契約來源：《MSW 管理後台系統補強 — 分析與實施計劃 V2》
 *  - §7.1 app_settings 鍵總表與結構範例
 *  - §8.1 管理端路由契約
 *  - §3.1 F1–F8 護欄（純文字／字數上限／固定條數／白名單）
 *
 * ⚠️ 預設值紀律（T-9 驗收點）：
 *  所有 DEFAULT_* 常數皆為現有硬編碼文案的「逐字轉錄」——標點、空格、換行
 *  （JSX 換行在渲染時會縮成一個空格，已按渲染結果轉錄）一個字都不能改。
 *  來源：src/lib/config.ts（BRAND / ABOUT / DISCIPLINES / NAV_LINKS）、
 *        src/app/page.tsx（FEATURES / Hero / CTA / 跑馬燈）、
 *        各頁 page.tsx 與 LoginForm / SignupForm / RunUploadForm / EventCard
 *        （頁內行號以計劃 §1.2 表為準）。
 *  本檔與 supabase/migration-site-content.sql 的播種值必須逐字一致
 *  （交付說明附一致性比對腳本輸出）。
 *
 * 驗證邏輯只有一份（複製 theme.ts 的既有紀律）：
 *  - 寫入端用 normalize*()：超長／型別錯／白名單外 → 回傳 { ok:false, fields }，
 *    由 Route Handler 組成 400 中文錯誤，DB 不寫；缺鍵 → 落預設值。
 *  - 讀取端用 coerce*()：DB 裡的值可能被手改過或屬舊版，一律 best-effort
 *    回落預設值，任何情況下都不拋例外。
 */

/* =============================================================
 * 型別
 * ============================================================= */

/** 首頁「關於我們」四段（config.ts ABOUT；/about 同源） */
export interface SiteContentAbout {
  eyebrow: string;
  lead: string;
  philosophy: string;
  cta: string;
}

/** 首頁 Hero：兩行大標題、描述、雙版本 CTA 按鈕 */
export interface SiteContentHero {
  title_line1: string;
  title_line2: string;
  desc: string;
  cta_primary_member: string;
  cta_secondary_member: string;
  cta_primary_guest: string;
  cta_secondary_guest: string;
}

/** 三大理由（固定 3 項；編號 01/02/03 由前台依索引產生，不設欄位） */
export interface SiteContentFeature {
  title: string;
  desc: string;
}

/** 六大訓練項目（固定 6 項，config.ts DISCIPLINES） */
export interface SiteContentDiscipline {
  title: string;
  sub: string;
  desc: string;
  icon: string;
}

/** 首頁底部 CTA（雙版本） */
export interface SiteContentCta {
  title_member: string;
  desc_member: string;
  primary_member: string;
  secondary_member: string;
  title_guest: string;
  desc_guest: string;
  primary_guest: string;
  secondary_guest: string;
}

/** site_content：首頁文案 + 關於我們（品牌名稱／標語屬 site_theme，見計劃 §7.1） */
export interface SiteContent {
  about: SiteContentAbout;
  hero: SiteContentHero;
  /** 固定 3 項 */
  features: SiteContentFeature[];
  /** 固定 6 項 */
  disciplines: SiteContentDiscipline[];
  /** 跑馬燈字，固定 6 項 */
  marquee: string[];
  cta: SiteContentCta;
}

/** 導覽選單項目（陣列順序即顯示順序；visible=false 保留在陣列中） */
export interface NavLink {
  href: string;
  label: string;
  visible: boolean;
}

/** site_nav：導覽選單（3–8 項，必含「主頁」，href 走白名單） */
export interface SiteNav {
  links: NavLink[];
}

/** site_contact：頁尾聯絡四欄 + 品牌宣言四行（固定） */
export interface SiteContact {
  location: string;
  email: string;
  instagram: string;
  instagram_url: string;
  /** 固定 4 行（BRAND.intro） */
  intro: string[];
}

/** 登入頁（/login） */
export interface SitePageLogin {
  page_title: string;
  intro: string;
  form_intro: string;
  admin_notice: string;
  email_label: string;
  email_placeholder: string;
  password_label: string;
  password_placeholder: string;
  submit_label: string;
  pending_label: string;
  signup_prompt: string;
  signup_link: string;
  error_message: string;
}

/** 註冊頁（/signup） */
export interface SitePageSignup {
  page_title: string;
  intro: string;
  form_intro: string;
  display_name_label: string;
  display_name_placeholder: string;
  email_label: string;
  email_placeholder: string;
  password_label: string;
  password_placeholder: string;
  confirm_label: string;
  confirm_placeholder: string;
  confirm_hint: string;
  submit_label: string;
  pending_label: string;
  verify_note: string;
  rules_note: string;
  login_prompt: string;
  login_link: string;
  error_email: string;
  error_password: string;
  error_confirm: string;
  error_submit: string;
  success_message: string;
}

/** 活動頁（/events，含 EventCard 按鈕與後備文字） */
export interface SitePageEvents {
  page_title: string;
  empty_note: string;
  card_register_label: string;
  card_note_title: string;
  card_note_fallback: string;
}

/** 定期訓練頁（/training） */
export interface SitePageTraining {
  page_title: string;
  open_label: string;
  closed_label: string;
  fact_checkin_label: string;
  slots_label: string;
  intro: string;
  history_header: string;
  empty_history: string;
}

/** 月度跑步挑戰頁（/run，含上傳表單標籤與 placeholder） */
export interface SitePageRun {
  page_title: string;
  step_1: string;
  step_2: string;
  step_3: string;
  step_4: string;
  login_prompt: string;
  login_card_title: string;
  login_button: string;
  signup_button: string;
  upload_hint: string;
  empty_submissions: string;
  km_label: string;
  km_placeholder: string;
  month_label: string;
  screenshot_label: string;
  note_label: string;
  note_placeholder: string;
  submit_label: string;
  pending_label: string;
}

/** 排行榜頁（/leaderboard） */
export interface SitePageLeaderboard {
  page_title: string;
  empty_month: string;
}

/** 關於我們頁（/about；四段內文在 site_content.about，單一來源） */
export interface SitePageAbout {
  page_title: string;
}

/** 教練團隊頁（/coaches；教練資料由 coaches 表驅動） */
export interface SitePageCoaches {
  page_title: string;
  empty_state: string;
}

/** 會員專區（/dashboard） */
export interface SitePageDashboard {
  page_title: string;
  empty_submissions: string;
  empty_points: string;
  empty_checkins: string;
}

/** site_pages：9 個前台頁面的標題／說明／CTA／空狀態／表單標籤 */
export interface SitePages {
  login: SitePageLogin;
  signup: SitePageSignup;
  events: SitePageEvents;
  training: SitePageTraining;
  run: SitePageRun;
  leaderboard: SitePageLeaderboard;
  about: SitePageAbout;
  coaches: SitePageCoaches;
  dashboard: SitePageDashboard;
}

/** 首頁區塊 id 白名單（正好 8 個，不可增刪類型） */
export type BlockId =
  | "hero"
  | "stats"
  | "about"
  | "programs"
  | "reasons"
  | "disciplines"
  | "ranking"
  | "cta";

/** 首頁區塊（visible 顯隱；order 排序，1–8 唯一） */
export interface SiteBlock {
  id: BlockId;
  label: string;
  visible: boolean;
  order: number;
}

/** site_blocks：首頁區塊顯隱與排序 */
export interface SiteBlocks {
  home: SiteBlock[];
}

/* =============================================================
 * 預設值（逐字轉錄現有硬編碼，T-9 截圖比對的基準）
 * ============================================================= */

export const DEFAULT_CONTENT: SiteContent = {
  about: {
    eyebrow: "About / 關於我們",
    lead: "我們是澳門首間以街頭健身（Street Workout）為主題的訓練俱樂部，同時亦是 HYROX官方認證訓練場館。",
    philosophy:
      "我們相信，健身不只是提升體能，更是一種生活態度。透過科學化訓練系統、功能性體能訓練、HYROX專項課程及街頭健身訓練，我們致力協助每一位會員挑戰自身極限，發掘更好的自己。",
    cta: "無論你是健身新手、運動愛好者，還是準備挑戰 HYROX 賽事的運動員，我們都能為你提供專業指導及完善的訓練環境。",
  },
  hero: {
    title_line1: "MSW",
    title_line2: "街健館",
    desc: "用自身的重量，練出澳門最強的街頭力量。每週一晚固定訓練、每月 300 公里跑步挑戰，每一次汗水都換算成積分與專屬優惠券。",
    cta_primary_member: "我的帳戶",
    cta_secondary_member: "上傳跑步紀錄",
    cta_primary_guest: "立即加入會員",
    cta_secondary_guest: "查看活動",
  },
  features: [
    {
      title: "打破時間地區限制",
      desc: "每週固定有教練帶領的團體訓練；跑步任務則不限時間地點，隨時上傳紀錄。",
    },
    {
      title: "贏得專屬優惠券",
      desc: "月度達標即獲電子優惠券，用汗水換來的獎勵，在 MSW 街健館直接兌換。",
    },
    {
      title: "與澳門的街健夥伴一起練",
      desc: "一群人練比一個人練走得遠。排行榜、積分、共同目標，讓訓練不再孤單。",
    },
  ],
  disciplines: [
    {
      title: "街頭健身",
      sub: "Street Workout",
      desc: "引體上升、雙槓屈臂撐、人體旗幟，以自身重量為負荷的全身訓練。",
      icon: "💪",
    },
    {
      title: "引體上升",
      sub: "Pull Up",
      desc: "背闊肌與握力的基礎，從懸垂、離心到爆發式引體的漸進課表。",
      icon: "🏋️",
    },
    {
      title: "雙槓屈臂撐",
      sub: "Dips",
      desc: "胸、三頭與核心的複合動作，建立上半身推力與肩部穩定度。",
      icon: "🤸",
    },
    {
      title: "核心訓練",
      sub: "Core",
      desc: "前側鏈與後側鏈核心，撐體、舉腿到龍旗的階段式訓練。",
      icon: "🧘",
    },
    {
      title: "長跑耐力",
      sub: "Running",
      desc: "每月 300 公里累積挑戰，上傳紀錄、後台確認、達標領優惠券。",
      icon: "🏃",
    },
    {
      title: "體能檢測",
      sub: "Conditioning",
      desc: "定期體能測驗，追蹤你的力量、耐力與爆發力變化曲線。",
      icon: "📈",
    },
  ],
  marquee: ["Street Workout", "街頭健身", "Calisthenics", "澳門 Macau", "Mon 20:00", "300km / Month"],
  cta: {
    title_member: "繼續把汗水換成積分",
    desc_member: "本月里程與積分持續累積中，記得定期上傳跑步紀錄與報名訓練。",
    primary_member: "上傳跑步紀錄",
    secondary_member: "報名訓練場次",
    title_guest: "準備好開始累積了嗎？",
    desc_guest: "註冊只需一分鐘。加入後即可報名訓練、上傳跑步紀錄、追蹤積分與優惠券。",
    primary_guest: "免費註冊會員",
    secondary_guest: "我已有帳號",
  },
};

export const DEFAULT_NAV: SiteNav = {
  links: [
    { href: "/", label: "主頁", visible: true },
    { href: "/events", label: "活動", visible: true },
    { href: "/training", label: "定期訓練", visible: true },
    { href: "/run", label: "月度跑步挑戰", visible: true },
    { href: "/leaderboard", label: "排行榜", visible: true },
    { href: "/about", label: "關於我們", visible: true },
    { href: "/coaches", label: "教練團隊", visible: true },
  ],
};

export const DEFAULT_CONTACT: SiteContact = {
  location: "澳門",
  email: "hello@mswstreetworkout.com",
  instagram: "@msw_street_workout",
  instagram_url: "https://www.instagram.com/msw_street_workout",
  intro: [
    "首間以街頭健身為主題的訓練俱樂部",
    "HYROX 官方認證訓練場館",
    "Street Workout ｜ Calisthenics ｜ 斯巴達 ｜ HYROX",
    "以積極正面態度面對所有困難",
  ],
};

export const DEFAULT_PAGES: SitePages = {
  login: {
    page_title: "會員登入",
    intro: "登入後可報名定期訓練、上傳跑步紀錄與查看積分排行。 里程與簽到都由後台確認後才入帳，讓每一次累積都算得清楚。",
    form_intro: "使用電郵與密碼登入會員帳戶。",
    admin_notice: "管理員入口：請用管理員帳號登入，成功後會直接進入後台管理。",
    email_label: "電郵",
    email_placeholder: "you@example.com",
    password_label: "密碼",
    password_placeholder: "••••••••",
    submit_label: "登入",
    pending_label: "登入中…",
    signup_prompt: "還沒有帳號？",
    signup_link: "立即註冊",
    error_message: "登入失敗。",
  },
  signup: {
    page_title: "註冊會員",
    intro: "免費加入 MSW 街健館。每週一定期訓練、每月 300 公里跑步挑戰， 里程與簽到都由後台確認後入帳，讓訓練變成看得見的累積。",
    form_intro: "填寫電郵與密碼即可建立帳號，無需審核。",
    display_name_label: "顯示名稱（排行榜上顯示）",
    display_name_placeholder: "例如：阿健",
    email_label: "電郵",
    email_placeholder: "you@example.com",
    password_label: "密碼（至少 6 個字元）",
    password_placeholder: "••••••••",
    confirm_label: "確認密碼（請再輸入一次）",
    confirm_placeholder: "••••••••",
    confirm_hint: "請再次輸入相同密碼，兩次不一致時無法提交。",
    submit_label: "建立帳號",
    pending_label: "註冊中…",
    verify_note: "送出後註冊即時完成，不需要收取驗證信——直接以上述電郵與密碼登入即可。",
    rules_note: "註冊即表示同意 MSW 街健館的活動規則：跑步里程須經後台確認後始計入積分， 偽造紀錄將被取消資格。完成月度 300km 可獲優惠券。",
    login_prompt: "已有帳號？",
    login_link: "會員登入",
    error_email: "請輸入有效的電郵地址。",
    error_password: "密碼至少需要 6 個字元。",
    error_confirm: "兩次輸入的密碼不一致，請重新輸入。",
    error_submit: "註冊失敗。",
    success_message: "註冊成功！請到電郵信箱點擊驗證連結完成啟用，之後即可登入。",
  },
  events: {
    page_title: "活動總覽",
    empty_note: "目前尚未發佈特別活動，以下為常設的兩條主線。",
    card_register_label: "報名 / 詳情",
    card_note_title: "報名方式",
    card_note_fallback: "詳情請洽官方 Instagram",
  },
  training: {
    page_title: "定期訓練",
    open_label: "開放報名",
    closed_label: "已截止",
    fact_checkin_label: "簽到一次入帳",
    slots_label: "場可報名",
    intro: "報名後於現場簽到，後台確認即入帳積分。適合任何程度，教練會依程度分組調整強度。",
    history_header: "簽到時間",
    empty_history: "尚無訓練紀錄，報名一場試試看。",
  },
  run: {
    page_title: "月度跑步挑戰",
    step_1: "完成跑步後，在 app（Strava / Nike Run Club / 咕咚等）截圖顯示距離的畫面。",
    step_2: "上傳截圖並填寫本次公里數，選擇要計入的月份。",
    step_3: "管理員核對截圖與數字，確認後里程與積分才會入帳。",
    step_4: "當月累積達 300 公里，月底由後台統一發放優惠券。",
    login_prompt: "登入後才能上傳跑步紀錄並累積里程與積分。",
    login_card_title: "請先登入會員",
    login_button: "會員登入",
    signup_button: "註冊新帳號",
    upload_hint: "同一個月可多次上傳，系統會自動累加。",
    empty_submissions: "尚未提交任何跑步紀錄，現在就上傳第一次吧！",
    km_label: "跑步公里數（km）",
    km_placeholder: "例如 10.5",
    month_label: "計入月份",
    screenshot_label: "跑步紀錄截圖",
    note_label: "備註（選填）",
    note_placeholder: "例如：黑沙環海濱長廊晨跑",
    submit_label: "提交紀錄",
    pending_label: "上傳中…",
  },
  leaderboard: {
    page_title: "排行榜",
    empty_month: "本月尚無已確認紀錄，成為第一位上榜者。",
  },
  about: {
    page_title: "關於我們",
  },
  coaches: {
    page_title: "教練團隊",
    empty_state: "教練團隊資料即將公佈，敬請期待。",
  },
  dashboard: {
    page_title: "我的帳戶",
    empty_submissions: "還沒有提交紀錄，去 /run 上傳第一次吧。",
    empty_points: "尚無積分紀錄。",
    empty_checkins: "尚無訓練紀錄。",
  },
};

/** 首頁區塊預設：全部 visible=true、現行順序（計劃 §7.1 範例） */
export const DEFAULT_BLOCKS: SiteBlocks = {
  home: [
    { id: "hero", label: "首頁大圖（Hero）", visible: true, order: 1 },
    { id: "stats", label: "累積數據", visible: true, order: 2 },
    { id: "about", label: "關於我們", visible: true, order: 3 },
    { id: "programs", label: "兩大核心活動", visible: true, order: 4 },
    { id: "reasons", label: "三大理由", visible: true, order: 5 },
    { id: "disciplines", label: "各類訓練項目", visible: true, order: 6 },
    { id: "ranking", label: "本月排行榜", visible: true, order: 7 },
    { id: "cta", label: "底部號召", visible: true, order: 8 },
  ],
};

/* =============================================================
 * 白名單
 * ============================================================= */

/** 導覽選單允許的連結（= 現行 NAV_LINKS 的 7 個路由；要加新頁面屬技術工作） */
export const NAV_HREFS: readonly string[] = [
  "/",
  "/events",
  "/training",
  "/run",
  "/leaderboard",
  "/about",
  "/coaches",
];

/** site_pages 的 9 個頁面鍵 */
export const PAGE_KEYS: readonly string[] = [
  "login",
  "signup",
  "events",
  "training",
  "run",
  "leaderboard",
  "about",
  "coaches",
  "dashboard",
];

/** 首頁區塊 id 白名單（順序即預設順序） */
export const BLOCK_IDS: readonly BlockId[] = [
  "hero",
  "stats",
  "about",
  "programs",
  "reasons",
  "disciplines",
  "ranking",
  "cta",
];

/* =============================================================
 * 驗證共用工具
 * ============================================================= */

type FieldErrors = Record<string, string>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 文字欄位：
 *  - 缺鍵 / null → 落 base（預設值），不算錯
 *  - 空字串（留空）→ 落 base（計劃 §6.1 F5「留空回落預設」）
 *  - 非字串 → 欄位錯誤 + 落 base
 *  - 超過 maxLen → 欄位錯誤 + 落 base
 *  - 其餘 → 去前後空白後採用
 */
function textValue(
  raw: unknown,
  base: string,
  key: string,
  maxLen: number,
  fields: FieldErrors
): string {
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== "string") {
    fields[key] = "內容格式錯誤，請輸入文字。";
    return base;
  }
  const trimmed = raw.trim();
  if (trimmed === "") return base;
  if (trimmed.length > maxLen) {
    fields[key] = `請填 ${maxLen} 字以內。`;
    return base;
  }
  return trimmed;
}

/** 純字串群組（如 about / hero / cta） */
function normalizeGroup<T extends object>(
  raw: unknown,
  base: T,
  path: string,
  maxLens: Record<string, number>,
  fields: FieldErrors
): T {
  if (raw !== undefined && raw !== null && !isRecord(raw)) {
    fields[path] = "內容格式錯誤。";
    return { ...base };
  }
  const src: Record<string, unknown> = isRecord(raw) ? raw : {};
  const baseRec = base as Record<string, string>;
  const out: Record<string, string> = {};
  for (const key of Object.keys(baseRec)) {
    out[key] = textValue(src[key], baseRec[key], `${path}.${key}`, maxLens[key] ?? 120, fields);
  }
  return out as unknown as T;
}

/** 固定條數的物件陣列（features / disciplines） */
function normalizeFixedRecords<T extends object>(
  raw: unknown,
  base: T[],
  path: string,
  count: number,
  maxLens: Record<string, number>,
  fields: FieldErrors,
  countMessage: string
): T[] {
  if (raw === undefined || raw === null) return base.map((item) => ({ ...item }));
  if (!Array.isArray(raw) || raw.length !== count) {
    fields[path] = countMessage;
    return base.map((item) => ({ ...item }));
  }
  return raw.map((item, i) => {
    if (!isRecord(item)) fields[`${path}.${i}`] = "內容格式錯誤。";
    const src: Record<string, unknown> = isRecord(item) ? item : {};
    const baseRec = base[i] as Record<string, string>;
    const out: Record<string, string> = {};
    for (const key of Object.keys(baseRec)) {
      out[key] = textValue(src[key], baseRec[key], `${path}.${i}.${key}`, maxLens[key] ?? 120, fields);
    }
    return out as unknown as T;
  });
}

/** 固定條數的字串陣列（跑馬燈 / 品牌宣言） */
function normalizeFixedStrings(
  raw: unknown,
  base: string[],
  path: string,
  count: number,
  maxLen: number,
  fields: FieldErrors,
  countMessage: string
): string[] {
  if (raw === undefined || raw === null) return [...base];
  if (!Array.isArray(raw) || raw.length !== count) {
    fields[path] = countMessage;
    return [...base];
  }
  return raw.map((v, i) => textValue(v, base[i], `${path}.${i}`, maxLen, fields));
}

/* =============================================================
 * site_content
 * ============================================================= */

const CONTENT_ABOUT_MAXLEN: Record<string, number> = {
  eyebrow: 40,
  lead: 200,
  philosophy: 400,
  cta: 300,
};

const CONTENT_HERO_MAXLEN: Record<string, number> = {
  title_line1: 40,
  title_line2: 40,
  desc: 300,
  cta_primary_member: 40,
  cta_secondary_member: 40,
  cta_primary_guest: 40,
  cta_secondary_guest: 40,
};

const CONTENT_CTA_MAXLEN: Record<string, number> = {
  title_member: 60,
  desc_member: 300,
  primary_member: 40,
  secondary_member: 40,
  title_guest: 60,
  desc_guest: 300,
  primary_guest: 40,
  secondary_guest: 40,
};

const CONTENT_FEATURE_MAXLEN: Record<string, number> = { title: 60, desc: 140 };
const CONTENT_DISCIPLINE_MAXLEN: Record<string, number> = {
  title: 20,
  sub: 40,
  desc: 140,
  icon: 8,
};

function normalizeContentInternal(
  input: unknown,
  base: SiteContent
): { content: SiteContent; fields: FieldErrors } {
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const fields: FieldErrors = {};

  return {
    content: {
      about: normalizeGroup(src.about, base.about, "about", CONTENT_ABOUT_MAXLEN, fields),
      hero: normalizeGroup(src.hero, base.hero, "hero", CONTENT_HERO_MAXLEN, fields),
      features: normalizeFixedRecords(
        src.features,
        base.features,
        "features",
        3,
        CONTENT_FEATURE_MAXLEN,
        fields,
        "三大理由必須剛好 3 項。"
      ),
      disciplines: normalizeFixedRecords(
        src.disciplines,
        base.disciplines,
        "disciplines",
        6,
        CONTENT_DISCIPLINE_MAXLEN,
        fields,
        "訓練項目必須剛好 6 項。"
      ),
      marquee: normalizeFixedStrings(
        src.marquee,
        base.marquee,
        "marquee",
        6,
        40,
        fields,
        "跑馬燈必須剛好 6 項。"
      ),
      cta: normalizeGroup(src.cta, base.cta, "cta", CONTENT_CTA_MAXLEN, fields),
    },
    fields,
  };
}

export type ContentNormalizeResult =
  | { ok: true; content: SiteContent }
  | { ok: false; fields: FieldErrors };

/** 寫入端：任一欄位不合法 → { ok:false, fields }（Route Handler 轉 400，DB 不寫） */
export function normalizeContent(
  input: unknown,
  base: SiteContent = DEFAULT_CONTENT
): ContentNormalizeResult {
  const { content, fields } = normalizeContentInternal(input, base);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, content };
}

/** 讀取端：DB 髒值 best-effort 回落預設，永不拋錯 */
export function coerceContent(
  input: unknown,
  base: SiteContent = DEFAULT_CONTENT
): SiteContent {
  return normalizeContentInternal(input, base).content;
}

/* =============================================================
 * site_nav
 * ============================================================= */

const NAV_LABEL_MAXLEN = 20;

function cloneNav(nav: SiteNav): SiteNav {
  return { links: nav.links.map((l) => ({ ...l })) };
}

function normalizeNavInternal(
  input: unknown,
  base: SiteNav
): { nav: SiteNav; fields: FieldErrors; structural: boolean } {
  const fields: FieldErrors = {};
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const raw = src.links;

  if (raw === undefined || raw === null) {
    return { nav: cloneNav(base), fields, structural: false };
  }
  if (!Array.isArray(raw)) {
    fields.links = "選單資料格式錯誤。";
    return { nav: cloneNav(base), fields, structural: true };
  }
  if (raw.length < 3 || raw.length > 8) {
    fields.links = "選單項目請維持 3–8 項。";
    return { nav: cloneNav(base), fields, structural: true };
  }

  let structural = false;
  const seen = new Set<string>();
  let hasHome = false;

  const links: NavLink[] = raw.map((item, i) => {
    const key = `links.${i}`;
    if (!isRecord(item)) {
      fields[key] = "選單項目格式錯誤。";
      structural = true;
    }
    const rec: Record<string, unknown> = isRecord(item) ? item : {};

    // href：白名單 + 不可重複
    let href: string;
    const rawHref = rec.href;
    if (typeof rawHref !== "string" || !NAV_HREFS.includes(rawHref)) {
      fields[`${key}.href`] = "此連結不在允許的清單，請選擇現有頁面。";
      structural = true;
      href = base.links[i]?.href ?? "/";
    } else {
      href = rawHref;
    }
    if (seen.has(href)) {
      fields[`${key}.href`] = "選單連結重複。";
      structural = true;
    }
    seen.add(href);
    if (href === "/") hasHome = true;

    // label：必填 1–20 字
    let label: string;
    const rawLabel = rec.label;
    if (typeof rawLabel !== "string") {
      fields[`${key}.label`] = "選單名稱請填 1–20 字。";
      label = base.links[i]?.label ?? "";
    } else {
      label = rawLabel.trim();
      if (label.length < 1 || label.length > NAV_LABEL_MAXLEN) {
        fields[`${key}.label`] = "選單名稱請填 1–20 字。";
        label = base.links[i]?.label ?? "";
      }
    }

    // visible：缺鍵落預設（預設 true）
    let visible: boolean;
    const rawVisible = rec.visible;
    if (rawVisible === undefined || rawVisible === null) {
      visible = base.links[i]?.visible ?? true;
    } else if (typeof rawVisible !== "boolean") {
      fields[`${key}.visible`] = "請選擇是否顯示。";
      visible = base.links[i]?.visible ?? true;
    } else {
      visible = rawVisible;
    }

    return { href, label, visible };
  });

  if (!hasHome) {
    fields.links = "選單必須包含「主頁」。";
    structural = true;
  }

  return { nav: { links }, fields, structural };
}

export type NavNormalizeResult =
  | { ok: true; nav: SiteNav }
  | { ok: false; fields: FieldErrors };

export function normalizeNav(input: unknown, base: SiteNav = DEFAULT_NAV): NavNormalizeResult {
  const { nav, fields } = normalizeNavInternal(input, base);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, nav };
}

/** 讀取端：結構性錯誤（數量／白名單／重複／缺主頁）→ 整套回落預設 */
export function coerceNav(input: unknown, base: SiteNav = DEFAULT_NAV): SiteNav {
  const { nav, structural } = normalizeNavInternal(input, base);
  return structural ? cloneNav(base) : nav;
}

/* =============================================================
 * site_contact
 * ============================================================= */

const CONTACT_MAXLEN: Record<string, number> = {
  location: 40,
  email: 120,
  instagram: 60,
  instagram_url: 200,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//;

function normalizeContactInternal(
  input: unknown,
  base: SiteContact
): { contact: SiteContact; fields: FieldErrors } {
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const fields: FieldErrors = {};

  const location = textValue(src.location, base.location, "location", CONTACT_MAXLEN.location, fields);

  let email = textValue(src.email, base.email, "email", CONTACT_MAXLEN.email, fields);
  if (typeof src.email === "string" && src.email.trim() !== "" && !EMAIL_RE.test(email)) {
    fields.email = "請填有效的電郵地址。";
    email = base.email;
  }

  const instagram = textValue(src.instagram, base.instagram, "instagram", CONTACT_MAXLEN.instagram, fields);

  let instagramUrl = textValue(src.instagram_url, base.instagram_url, "instagram_url", CONTACT_MAXLEN.instagram_url, fields);
  if (typeof src.instagram_url === "string" && src.instagram_url.trim() !== "" && !URL_RE.test(instagramUrl)) {
    fields.instagram_url = "請填以 https:// 開頭的連結。";
    instagramUrl = base.instagram_url;
  }

  const intro = normalizeFixedStrings(
    src.intro,
    base.intro,
    "intro",
    4,
    120,
    fields,
    "品牌宣言必須剛好 4 行。"
  );

  return { contact: { location, email, instagram, instagram_url: instagramUrl, intro }, fields };
}

export type ContactNormalizeResult =
  | { ok: true; contact: SiteContact }
  | { ok: false; fields: FieldErrors };

export function normalizeContact(
  input: unknown,
  base: SiteContact = DEFAULT_CONTACT
): ContactNormalizeResult {
  const { contact, fields } = normalizeContactInternal(input, base);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, contact };
}

export function coerceContact(
  input: unknown,
  base: SiteContact = DEFAULT_CONTACT
): SiteContact {
  return normalizeContactInternal(input, base).contact;
}

/* =============================================================
 * site_pages
 * ============================================================= */

/** 各頁欄位字數上限：未列表者走 _pageFieldMaxLen 的預設規則 */
const PAGE_FIELD_MAXLEN: Record<string, number> = {
  page_title: 40,
  intro: 300,
  form_intro: 200,
  admin_notice: 200,
  verify_note: 300,
  rules_note: 300,
  step_1: 160,
  step_2: 160,
  step_3: 160,
  step_4: 160,
  login_prompt: 120,
  signup_prompt: 60,
  login_card_title: 40,
  upload_hint: 120,
  confirm_hint: 120,
  success_message: 200,
  pending_label: 20,
};

function pageFieldMaxLen(field: string): number {
  if (field in PAGE_FIELD_MAXLEN) return PAGE_FIELD_MAXLEN[field];
  if (field.endsWith("_label")) return 40;
  if (field.endsWith("_placeholder")) return 60;
  if (field.endsWith("_link") || field.endsWith("_button")) return 40;
  return 120;
}

type PageKey = keyof SitePages;

function normalizePagesInternal(
  input: unknown,
  base: SitePages
): { pages: SitePages; fields: FieldErrors } {
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const fields: FieldErrors = {};

  // 未知頁面鍵 → 拒絕（全量覆寫語意，多出來的鍵是客戶端 bug）
  for (const key of Object.keys(src)) {
    if (!PAGE_KEYS.includes(key)) {
      fields[key] = "未知的頁面。";
    }
  }

  const pages: Record<string, unknown> = {};
  for (const key of PAGE_KEYS as PageKey[]) {
    const pageKey = key as string;
    const raw = src[pageKey];
    const basePage = base[key] as unknown as Record<string, string>;
    if (raw !== undefined && raw !== null && !isRecord(raw)) {
      fields[pageKey] = "內容格式錯誤。";
      pages[key] = { ...base[key] };
      continue;
    }
    const rec: Record<string, unknown> = isRecord(raw) ? raw : {};
    const out: Record<string, string> = {};
    for (const field of Object.keys(basePage)) {
      out[field] = textValue(
        rec[field],
        basePage[field],
        `${pageKey}.${field}`,
        pageFieldMaxLen(field),
        fields
      );
    }
    pages[key] = out;
  }

  return { pages: pages as unknown as SitePages, fields };
}

export type PagesNormalizeResult =
  | { ok: true; pages: SitePages }
  | { ok: false; fields: FieldErrors };

export function normalizePages(
  input: unknown,
  base: SitePages = DEFAULT_PAGES
): PagesNormalizeResult {
  const { pages, fields } = normalizePagesInternal(input, base);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, pages };
}

export function coercePages(input: unknown, base: SitePages = DEFAULT_PAGES): SitePages {
  return normalizePagesInternal(input, base).pages;
}

/* =============================================================
 * site_blocks
 * ============================================================= */

const BLOCK_LABEL_MAXLEN = 20;
const BLOCK_MIN_VISIBLE = 3;

function cloneBlocks(blocks: SiteBlocks): SiteBlocks {
  return { home: blocks.home.map((b) => ({ ...b })) };
}

function normalizeBlocksInternal(
  input: unknown,
  base: SiteBlocks
): { blocks: SiteBlocks; fields: FieldErrors } {
  const fields: FieldErrors = {};
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const raw = src.home;

  if (raw === undefined || raw === null) {
    return { blocks: cloneBlocks(base), fields };
  }
  if (!Array.isArray(raw)) {
    fields.home = "首頁區塊資料格式錯誤。";
    return { blocks: cloneBlocks(base), fields };
  }

  const defaultById = new Map(base.home.map((b) => [b.id, b]));
  const parsed: SiteBlock[] = [];

  raw.forEach((item, i) => {
    const key = `home.${i}`;
    const rec: Record<string, unknown> = isRecord(item) ? item : {};
    if (!isRecord(item)) fields[key] = "區塊資料格式錯誤。";

    // id：白名單（正好那 8 個）
    const rawId = rec.id;
    if (typeof rawId !== "string" || !BLOCK_IDS.includes(rawId as BlockId)) {
      fields[`${key}.id`] = "區塊編號不在白名單。";
      return;
    }
    const id = rawId as BlockId;

    // label：缺鍵／留落落該區塊預設 label
    const rawLabel = rec.label;
    let label = defaultById.get(id)?.label ?? "";
    if (typeof rawLabel === "string") {
      const trimmed = rawLabel.trim();
      if (trimmed !== "") {
        if (trimmed.length > BLOCK_LABEL_MAXLEN) {
          fields[`${key}.label`] = `區塊名稱請填 ${BLOCK_LABEL_MAXLEN} 字以內。`;
        } else {
          label = trimmed;
        }
      }
    } else if (rawLabel !== undefined && rawLabel !== null) {
      fields[`${key}.label`] = "區塊名稱格式錯誤，請輸入文字。";
    }

    // visible：缺鍵落預設
    let visible = defaultById.get(id)?.visible ?? true;
    const rawVisible = rec.visible;
    if (rawVisible !== undefined && rawVisible !== null) {
      if (typeof rawVisible === "boolean") {
        visible = rawVisible;
      } else {
        fields[`${key}.visible`] = "請選擇是否顯示。";
      }
    }

    // order：整數 1–8，缺鍵落預設
    let order = defaultById.get(id)?.order ?? i + 1;
    const rawOrder = rec.order;
    if (rawOrder !== undefined && rawOrder !== null) {
      const n = typeof rawOrder === "number" ? rawOrder : Number(rawOrder);
      if (!Number.isInteger(n) || n < 1 || n > BLOCK_IDS.length) {
        fields[`${key}.order`] = `排序請填 1–${BLOCK_IDS.length} 的整數。`;
      } else {
        order = n;
      }
    }

    parsed.push({ id, label, visible, order });
  });

  // 數量：必須剛好 8 個（白名單去重後）
  const uniqueIds = new Set(parsed.map((b) => b.id));
  if (parsed.length !== BLOCK_IDS.length || uniqueIds.size !== BLOCK_IDS.length) {
    fields.home = `首頁必須剛好 ${BLOCK_IDS.length} 個區塊，且編號不可重複。`;
    return { blocks: cloneBlocks(base), fields };
  }

  // 可見區塊數 ≥ 3
  const visibleCount = parsed.filter((b) => b.visible).length;
  if (visibleCount < BLOCK_MIN_VISIBLE) {
    fields.home = `至少需要 ${BLOCK_MIN_VISIBLE} 個區塊保持顯示。`;
    return { blocks: cloneBlocks(base), fields };
  }

  // order 唯一
  const orders = parsed.map((b) => b.order);
  if (new Set(orders).size !== orders.length) {
    fields.home = "區塊排序不可重複。";
    return { blocks: cloneBlocks(base), fields };
  }

  return { blocks: { home: parsed }, fields };
}

export type BlocksNormalizeResult =
  | { ok: true; blocks: SiteBlocks }
  | { ok: false; fields: FieldErrors };

export function normalizeBlocks(
  input: unknown,
  base: SiteBlocks = DEFAULT_BLOCKS
): BlocksNormalizeResult {
  const { blocks, fields } = normalizeBlocksInternal(input, base);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, blocks };
}

/** 讀取端：任何髒值 → 整套回落預設（前台永遠拿得到完整 8 區塊） */
export function coerceBlocks(
  input: unknown,
  base: SiteBlocks = DEFAULT_BLOCKS
): SiteBlocks {
  const { blocks, fields } = normalizeBlocksInternal(input, base);
  return Object.keys(fields).length > 0 ? cloneBlocks(base) : blocks;
}
