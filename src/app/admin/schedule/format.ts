/**
 * src/app/admin/schedule/format.ts — 月班表頁的日期／時間／顏色小工具
 *
 * 全部以「澳門牆上時間」為準（Asia/Macau 固定 UTC+8，無夏令時間）。
 * 為什麼不重用 src/lib/utils.ts 的 formatDate / weekdayLabel：
 *   · 本頁要的是日曆表的 `11/02` 這種短格式，不是 `2026/11/02`；
 *   · weekdayLabel 走 `new Date('2026-11-02').getDay()`，在 UTC-x 的執行環境會
 *     差一天（UTC 午夜在當地還是前一天）。這裡改用 Date.UTC + getUTCDay，
 *     與執行環境時區無關。
 * utils.ts 不在本次可改範圍，所以在本地目錄另寫一份最小實作。
 */

const MACAU_TZ = "Asia/Macau";
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 現在時間（毫秒）。
 * 為什麼包成函式：admin/schedule/page.tsx 是 server component，
 * 在 render 內直接寫 `Date.now()` 會觸發 react-hooks/purity（Cannot call impure
 * function during render）。包一層之後呼叫端只是「呼叫一個函式」，
 * 語義上仍然是「這次請求當下的時間」，配合 `dynamic = 'force-dynamic'` 每次請求都新鮮。
 */
export function nowMillis(): number {
  return Date.now();
}

/** 澳門當下的年月（不可用伺服器 UTC 日期，月初／月末會差一個月） */
export function currentMacauMonth(): { year: number; month: number } {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: MACAU_TZ,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [y, m] = text.split("-");
  return { year: Number(y), month: Number(m) };
}

/** 年月加減 n 個月（可能超出 2024–2100，呼叫端自行判斷） */
export function shiftMonth(
  base: { year: number; month: number },
  delta: number
): { year: number; month: number } {
  const index = base.year * 12 + (base.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 該月 1 號的 YYYY-MM-DD */
export function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

/** 'YYYY-MM-DD' → '11/02' */
export function monthDayLabel(date: string): string {
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${parts[1]}/${parts[2]}`;
}

/** 'YYYY-MM-DD' → '週一'（與執行環境時區無關） */
export function weekdayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `週${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}

/** 日期分組標頭：11/02（週一） */
export function dateGroupLabel(date: string): string {
  return `${monthDayLabel(date)}（${weekdayLabel(date)}）`;
}

/**
 * ISO 時間戳 → 澳門時間的 'M/D'。
 * publish_at / effective_at 都是 UTC ISO 字串，直接用 slice(0,10) 會差 8 小時，
 * 月初的 00:00 +08 會被顯示成上個月最後一天。
 */
export function macauMonthDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MACAU_TZ,
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return month && day ? `${month}/${day}` : "—";
}

/** 時刻 'HH:MM:SS' → 'HH:MM'；null → '—' */
export function shortTime(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 5);
}

/** 時段顯示：19:00–20:30；缺一邊就退化成單邊或 '—' */
export function timeRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const s = start ? start.slice(0, 5) : "";
  const e = end ? end.slice(0, 5) : "";
  if (s && e) return `${s}–${e}`;
  return s || e || "—";
}

/** 'HH:MM' + 分鐘 → 'HH:MM'（跨日夾在 23:59，本頁不支援跨日場次） */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;

  let total = h * 60 + m + minutes;
  if (total >= 24 * 60) total = 24 * 60 - 1;
  if (total < 0) total = 0;

  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** 課程顏色（class_color_key）→ 左側 4px 色條的 class */
const CLASS_COLOR_BAR: Record<string, string> = {
  blue: "bg-blue-400",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  teal: "bg-teal-400",
  violet: "bg-violet-400",
  orange: "bg-orange-400",
};

export function colorBarClass(colorKey: string | null | undefined): string {
  if (!colorKey) return "bg-white/30";
  return CLASS_COLOR_BAR[colorKey] ?? "bg-white/30";
}
