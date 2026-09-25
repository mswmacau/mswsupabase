/** MSW 街健館 — 站點與商業規則設定（全部集中在這裡，改數值不用動頁面） */

export const BRAND = {
  name: "MSW 街健館",
  nameEn: "Macau Street Workout",
  tagline: "用自身的重量，練出澳門最強的街頭力量",
  description:
    "MSW 街健館是澳門街頭健身社群平台。每週定期訓練、每月 300 公里跑步挑戰、積分與優惠券獎勵，讓訓練變成看得見的累積。",
  location: "澳門",
  email: "hello@mswstreetworkout.com",
  instagram: "@msw.streetworkout",
} as const;

/** 積分與獎勵規則（預設方案） */
export const RULES = {
  /** 訓練簽到一次 */
  CHECKIN_POINTS: 10,
  /** 每 1 公里（後台確認後） */
  POINTS_PER_KM: 1,
  /** 月度達標額外獎勵 */
  MONTHLY_BONUS_POINTS: 200,
  /** 月度目標公里數 */
  MONTHLY_GOAL_KM: 300,
  /** 單次提交上限（防誤填，與 DB check 約束一致） */
  MAX_KM_PER_SUBMISSION: 200,
  /** 訓練時間 */
  TRAINING_WEEKDAY: 1, // 星期一
  TRAINING_TIME: "20:00 – 21:00",
  /**
   * 使用者在瀏覽器選的「原檔」上限（僅前端提示用，檔案不會經過伺服器）。
   * 改名自 MAX_UPLOAD_MB（8）：改走瀏覽器直傳後不再受 Vercel 4.5MB 限制。
   */
  MAX_UPLOAD_SOURCE_MB: 12,
  /** canvas 壓縮後的目標上限（1.2MB），壓縮流程的重試基準 */
  MAX_UPLOAD_BYTES: 1_200_000,
  ALLOWED_IMAGE_TYPES: ["image/png", "image/jpeg", "image/webp", "image/heic"],
} as const;

/** 訓練項目（首頁「各類訓練」區塊，對應 run2gather 的活動分類網格） */
export const DISCIPLINES = [
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
] as const;

export const NAV_LINKS = [
  { href: "/events", label: "活動" },
  { href: "/training", label: "定期訓練" },
  { href: "/run", label: "月度跑步挑戰" },
  { href: "/leaderboard", label: "排行榜" },
] as const;
