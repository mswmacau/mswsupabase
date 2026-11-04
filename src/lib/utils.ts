import { RULES } from "./config";

/**
 * 以澳門時間（Asia/Macau，UTC+8，全年無日光節約）計算今天的 YYYY-MM-DD。
 *
 * 為什麼不能直接 new Date().toISOString().slice(0,10)：
 * UTC 換日在澳門晚間 8 點發生，直接用 UTC 會讓澳門晚上 8 點後
 * 「今天」變成明天，活動列表因此提早一天消失（見 SPEC §0.5）。
 * 驗收：UTC 2026-09-30T17:00Z 必須回傳 "2026-10-01"。
 */
const MACAU_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 把某一時刻位移到澳門時區（UTC+8，全年無日光節約）；之後一律用 getUTC* 取值。
 *
 * 為什麼要這樣做：本檔所有日期輸出都可能同時在兩個時區執行——
 * Server Component 在 Vercel（UTC）渲染，Client Component 在瀏覽器
 * （Asia/Macau，UTC+8）hydrate。若用 getFullYear()/getMonth()/getDate()
 * 這些「執行環境本地時區」getter，同一筆時間在兩邊會算出不同日期，
 * 造成會員端日期差一天，並觸發 React hydration mismatch（#418）。
 * 位移後改用 getUTC* 取值，輸出就與執行環境時區完全無關。
 */
function toMacau(d: Date): Date {
  return new Date(d.getTime() + MACAU_OFFSET_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayISO(d: Date = new Date()): string {
  return toMacau(d).toISOString().slice(0, 10);
}


/** 目前月份 key，格式 'YYYY-MM'（以澳門時區為準） */
export function currentMonth(d: Date = new Date()): string {
  const t = toMacau(d);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}`;
}

/** 'YYYY-MM' → '2026 年 9 月' */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

/** 產生最近 n 個月的 key（含本月），由新到舊 */
export function recentMonths(n = 6, from: Date = new Date()): string[] {
  const base = currentMonth(from);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addMonths(base, -i));
  return out;
}

/** 月份加減：純整數運算，不受執行環境時區影響 */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  return `${ny}-${pad2(idx - ny * 12 + 1)}`;
}

/** 該月還剩幾天（用來顯示挑戰倒數，以澳門時區為準） */
export function daysLeftInMonth(d: Date = new Date()): number {
  const t = toMacau(d);
  const last = new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return last - t.getUTCDate();
}

export function formatKm(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

/** 時間戳 → 'YYYY/MM/DD'（以澳門時區為準，不受執行環境時區影響） */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const t = toMacau(d);
  return `${t.getUTCFullYear()}/${pad2(t.getUTCMonth() + 1)}/${pad2(
    t.getUTCDate()
  )}`;
}

/** 時間戳 → 'YYYY/MM/DD HH:mm'（以澳門時區為準，不受執行環境時區影響） */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const t = toMacau(d);
  const date = `${t.getUTCFullYear()}/${pad2(t.getUTCMonth() + 1)}/${pad2(
    t.getUTCDate()
  )}`;
  return `${date} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** 星期一路訓練：下一個（或今天）的星期一 */
export function nextTrainingDate(from: Date = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const diff = (RULES.TRAINING_WEEKDAY - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

export function weekdayLabel(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
}

export const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  pending: {
    label: "待確認",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  approved: {
    label: "已確認",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  rejected: {
    label: "已駁回",
    className: "bg-red-500/15 text-red-300 border-red-500/40",
  },
  active: {
    label: "可使用",
    className: "bg-cobalt/20 text-blue-300 border-cobalt/50",
  },
  used: {
    label: "已使用",
    className: "bg-white/10 text-neutral-400 border-white/20",
  },
  expired: {
    label: "已過期",
    className: "bg-white/10 text-neutral-500 border-white/15",
  },
  open: {
    label: "開放報名",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  closed: {
    label: "已截止",
    className: "bg-white/10 text-neutral-400 border-white/20",
  },
  cancelled: {
    label: "已取消",
    className: "bg-red-500/15 text-red-300 border-red-500/40",
  },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? {
    label: status,
    className: "bg-white/10 text-neutral-300 border-white/20",
  };
}
