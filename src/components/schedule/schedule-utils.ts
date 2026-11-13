/**
 * 班表日曆的型別與純函式。
 *
 * 為什麼放在 `components/schedule/` 而不是 `src/lib/`：
 *   本次改動的檔案邊界只到 `src/app/events/**` 與 `src/components/schedule/**`，
 *   另一位工程師同時在改 `src/lib/queries.ts` / `src/lib/types.ts`（後台 /admin/schedule），
 *   所以格式化與日期計算全部留在這個目錄，不新增 `src/lib/*` 共用檔。
 *
 * 這個檔案同時被 Server Component（page.tsx）與 Client Component（日曆）import，
 * 因此**不可**加 "use client"，也不可 import 任何只在瀏覽器可用的東西。
 *
 * 時區：全站以 Asia/Macau 為準。伺服器（Vercel）跑 UTC，
 * 所以「今天」一律用 Intl 指定時區算，不接受 `new Date().getDate()` 這種本地時區寫法。
 * 日期運算則統一用 Date.UTC + getUTC*，避免機器時區影響加減天數。
 */

export type ScheduleKind = "class" | "hyrox";
export type ScheduleStatus = "open" | "closed" | "cancelled";

/** 面板上的行動呼籲（由 Server Component 決定，Client 只負責畫） */
export interface ScheduleCta {
  label: string;
  href: string;
}

/** 日曆上的一場（班表堂或 HYROX 付費場次），已攤平成前端要的形狀 */
export interface ScheduleSessionView {
  id: string;
  kind: ScheduleKind;
  /** 課程名（班表堂：class_name ?? title） */
  title: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM'，舊資料可能沒有 */
  startTime: string | null;
  endTime: string | null;
  /** blue / green / amber / teal / violet / orange …，未知回灰 */
  colorKey: string | null;
  coachName: string | null;
  location: string | null;
  capacity: number | null;
  status: ScheduleStatus;
  /** HYROX 付費場次 = true */
  paid: boolean;
  feeCents: number | null;
  /** 無 CTA（例如已取消）＝ null */
  cta: ScheduleCta | null;
}

export interface ScheduleDay {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 非本月的前後補格 = false（不顯示外月場次） */
  inMonth: boolean;
  isToday: boolean;
  sessions: ScheduleSessionView[];
}

const MACAU_TZ = "Asia/Macau";

/** 星期一開始的星期代號（0 = 週一） */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date.UTC 組出來的日期 → 'YYYY-MM-DD'（不經本地時區） */
function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 澳門時區的今天，'YYYY-MM-DD'。伺服器在 UTC 也不會差一天。 */
export function macauTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MACAU_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const pick = (type: "year" | "month" | "day") =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** 'YYYY-MM-DD' → 0 = 週一 … 6 = 週日（ISO-8601 順序，與資料庫的 isodow 一致） */
export function isoWeekdayIndex(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 0;
  return (d.getUTCDay() + 6) % 7;
}

/** 時間欄位排序鍵：沒有時間的排最後，不要因此把場次排到最前面被誤讀成凌晨 */
function timeKey(t: string | null): string {
  return t ?? "99:99";
}

/**
 * 同日場次排序：時間升冪 → 同時間付費場次優先（視覺上更顯眼）→ 名稱。
 */
export function sortSessionViews(
  list: ScheduleSessionView[]
): ScheduleSessionView[] {
  return [...list].sort((a, b) => {
    const at = timeKey(a.startTime);
    const bt = timeKey(b.startTime);
    if (at !== bt) return at < bt ? -1 : 1;
    if (a.paid !== b.paid) return a.paid ? -1 : 1;
    return a.title.localeCompare(b.title, "zh-Hant");
  });
}

/**
 * 產生整個月的日曆格：週一起始、7 欄、前後補齊成 7 的倍數。
 * 補格（inMonth=false）一律不掛場次 —— 外月的堂屬於外月，混進來會讓
 * 「本月共 N 堂」與實際看到的 pill 數量對不上。
 */
export function buildMonthDays(args: {
  year: number;
  month: number;
  sessions: ScheduleSessionView[];
  todayISO: string;
}): ScheduleDay[] {
  const { year, month, sessions, todayISO } = args;

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = isoWeekdayIndex(toISODate(firstOfMonth));
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const byDate = new Map<string, ScheduleSessionView[]>();
  for (const session of sessions) {
    const bucket = byDate.get(session.date);
    if (bucket) bucket.push(session);
    else byDate.set(session.date, [session]);
  }

  const days: ScheduleDay[] = [];
  for (let i = 0; i < totalCells; i += 1) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    const date = toISODate(d);
    const inMonth =
      d.getUTCFullYear() === year && d.getUTCMonth() === month - 1;
    days.push({
      date,
      inMonth,
      isToday: inMonth && date === todayISO,
      sessions: inMonth ? sortSessionViews(byDate.get(date) ?? []) : [],
    });
  }

  return days;
}

/** 切成每 7 天一週（手機週檢視用） */
export function chunkWeeks(days: ScheduleDay[]): ScheduleDay[][] {
  const weeks: ScheduleDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

/** '2026 年 11 月' */
export function formatMonthTitle(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

/** '11 月 2 日' */
export function formatDayShort(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (!Number.isFinite(month) || !Number.isFinite(day)) return iso;
  return `${month} 月 ${day} 日`;
}

/** '11 月 2 日（星期一）' */
export function formatDayLong(iso: string): string {
  const weekday = WEEKDAY_LABELS[isoWeekdayIndex(iso)];
  return `${formatDayShort(iso)}（星期${weekday}）`;
}

/** 一週的標題：'11 月 2 日 – 11 月 8 日'；跨月也讀得懂 */
export function formatWeekRange(week: ScheduleDay[]): string {
  if (week.length === 0) return "";
  const head = week[0];
  const tail = week[week.length - 1];
  return `${formatDayShort(head.date)} – ${formatDayShort(tail.date)}`;
}

/**
 * 課程色票鍵 → hex。
 * 資料庫的 `training_classes.color_key` 是自由字串，所以認不得的一律回灰，
 * 不要 throw、也不要在 UI 上出現 undefined。
 */
const COLOR_HEX: Record<string, string> = {
  blue: "#4f7cff",
  green: "#34d399",
  amber: "#fbbf24",
  orange: "#fb923c",
  teal: "#2dd4bf",
  violet: "#a78bfa",
  purple: "#a78bfa",
  red: "#fb7185",
  rose: "#fb7185",
  pink: "#fb7185",
  gray: "#9ca3af",
  grey: "#9ca3af",
};

export const NEUTRAL_HEX = "#9ca3af";

export function colorHex(key: string | null): string {
  if (!key) return NEUTRAL_HEX;
  return COLOR_HEX[key.trim().toLowerCase()] ?? NEUTRAL_HEX;
}

/** 付費場次固定用橙，刻意不吃 class_color_key —— 讓「要付錢」這件事一眼看得出來 */
export const PAID_HEX = "#fb923c";

/** 場次狀態 → 面板徽章文字 */
export function statusText(status: ScheduleStatus): string {
  if (status === "cancelled") return "已取消";
  if (status === "closed") return "已滿";
  return "可報名";
}
