/**
 * src/app/admin/events/race-types.ts — 賽事後台（?tab=races）的共用型別與格式化
 *
 * Owner：方砚（frontend-engineer）
 *
 * 【為什麼要獨立一支】
 * 列表（RacesAdmin）、三段式表單（RaceForm）、名單（RaceRoster）三個元件
 * 由不同人同時開發。狀態文案、日期／費用格式、props 契約集中在這裡，
 * 三邊就不會出現「列表寫草稿、表單寫未上架」這種同一件事兩種講法。
 *
 * 【這裡只放型別與純函式】
 * 不 import 任何 server-only 模組（supabase／next/headers），
 * 這樣 client component 與 server 資料層都能安全 import。
 */

import { formatDate, weekdayLabelOfDate } from "@/lib/utils";

/* =============================================================
 * 狀態
 * ============================================================= */

/** 後台可寫入的賽事狀態（與 api/admin/races/_shared.ts 的 WRITABLE_RACE_STATUSES 一致） */
export type RaceStatusValue = "draft" | "open" | "closed" | "photos" | "archived";

/**
 * 狀態徽章文案。
 * 刻意不用「已上架／已下架」那組（那是一般活動 的 draft/published 語意），
 * 賽事的語意是「有冇在收報名」，所以 draft=草稿、open=報名中。
 */
export const RACE_STATUS_META: Record<
  RaceStatusValue,
  { label: string; cls: string }
> = {
  draft: {
    label: "草稿",
    cls: "border-white/25 bg-white/10 text-white/70",
  },
  open: {
    label: "報名中",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  closed: {
    label: "已截止",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  },
  photos: {
    label: "相片模式",
    cls: "border-cobalt/40 bg-cobalt/15 text-blue-200",
  },
  archived: {
    label: "已下架",
    cls: "border-red-500/40 bg-red-500/15 text-red-300",
  },
};

/** 表單下拉的順序（照賽事生命週期排，不是照字母） */
export const RACE_STATUS_OPTIONS: { value: RaceStatusValue; label: string }[] = [
  { value: "draft", label: "草稿（不公開，只有你看得到）" },
  { value: "open", label: "報名中（前台開放報名）" },
  { value: "closed", label: "已截止（前台顯示但不再收報名）" },
  { value: "photos", label: "相片模式（收報名結束，改為展示相簿）" },
  { value: "archived", label: "已下架（前台看不到）" },
];

/** 契約外的狀態值（例如舊資料的 published）一律當草稿顯示，不讓徽章空白 */
export function toRaceStatus(value: string | null | undefined): RaceStatusValue {
  switch (value) {
    case "open":
    case "closed":
    case "photos":
    case "archived":
      return value;
    default:
      return "draft";
  }
}

/* =============================================================
 * 資料形狀（server 資料層產出、client 元件消費）
 * ============================================================= */

export interface AdminRaceCategory {
  id: string;
  event_id: string;
  /** YYYY-MM-DD */
  day: string;
  name: string;
  /** 每組人數 1–8 */
  team_size: number;
  /** 報名費（分） */
  fee_cents: number;
  sort_order: number;
}

/** 名單彙總的數字（來源：race_summary + race_logistics 檢視） */
export interface RaceSummaryNumbers {
  /** 報名人數（去重） */
  registrations: number;
  /** 總人次（每人可報多組） */
  entries: number;
  /** 需要巴士的人數 */
  bus_people: number;
  /** 需要巴士的座位數 */
  bus_seats: number;
  /** 需要住宿的人數 */
  lodging_people: number;
  /** 需要住宿的晚數 */
  lodging_nights: number;
}

/** 日期 × 組別的人數／人次（來源：race_category_summary 檢視，含 0 人的組別） */
export interface RaceCategoryCount {
  category_id: string;
  day: string;
  name: string;
  registrations: number;
  entries: number;
}

export interface AdminRace {
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  /** YYYY-MM-DD */
  event_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  capacity: number | null;
  registration_url: string | null;
  registration_note: string | null;
  cover_path: string | null;
  /** DB 原值（可能含契約外的 published）；顯示前一律走 toRaceStatus() */
  status: string;
  sort_order: number;
  fee_cents: number | null;
  album_url: string | null;
  album_label: string | null;
  promo_on_home: boolean;
  promo_note: string | null;
  registration_deadline: string | null;
  logistics_note: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** 該賽事全部組別（依 day、sort_order 排好） */
  categories: AdminRaceCategory[];
  /** 彙總數字；檢視讀不到時為 null（UI 顯示「—」而不是 0） */
  summary: RaceSummaryNumbers | null;
  /** 日期 × 組別明細；檢視讀不到時為空陣列 */
  categoryCounts: RaceCategoryCount[];
}

/* =============================================================
 * 元件 props 契約（三支元件跨人開發，先把介面釘住）
 * ============================================================= */

/** 列表 + 三個子視圖的宿主 */
export interface RacesAdminProps {
  races: AdminRace[];
  /**
   * 彙總檢視是否讀得到（migration-races.sql §4 是否已執行）。
   * false 時列表的「已報 N 人」整塊隱藏，並顯示一行可執行 SQL 的提示，
   * 不要顯示 0——0 會被誤讀成「真的沒有人報名」。
   */
  summaryAvailable: boolean;
}

/** 三段式賽事表單 */
export interface RaceFormProps {
  /** create：新增（存檔後才拿得到 event_id，才能編輯組別） */
  mode: "create" | "edit";
  /** edit 時必填；create 時為 null */
  race: AdminRace | null;
  /** 關閉表單（已儲存或取消） */
  onClose: () => void;
  /** 存檔成功：父層負責顯示訊息 + router.refresh() */
  onSaved: (message: string) => void;
}

/** 名單與彙總 */
export interface RaceRosterProps {
  race: AdminRace;
  onClose: () => void;
  /** 審核成功後通知父層刷新列表人數 */
  onReviewed: (message: string) => void;
}

/* =============================================================
 * 格式化（列表／表單／名單共用，避免三邊各寫一份）
 * ============================================================= */

/** 2026/11/20 — 沿用全站慣例（src/lib/utils.ts:79） */
export function raceDate(value: string | null): string {
  return value ? formatDate(value) : "—";
}

/**
 * 日期範圍：2026/11/20 – 11/22
 * 單日賽事只回一個日期；跨月／跨年才把年月補齊（避免「11/30 – 12/01」看不出年份）。
 */
export function raceDateRange(start: string, end: string | null): string {
  const s = raceDate(start);
  if (!end || end === start) return s;
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${s} – ${end.slice(8, 10)}` : `${s} – ${raceDate(end)}`;
}

/** 11/20 · 週五（組別分組標題用；星期用 UTC 計算，不受執行環境時區影響） */
export function raceDayLabel(day: string): string {
  const md = `${day.slice(5, 7)}/${day.slice(8, 10)}`;
  const wd = weekdayLabelOfDate(day);
  return wd ? `${md} · 週${wd}` : md;
}

/** 報名費：0 或空 → 「免費」；單位沿用前台寫法（MOP） */
export function raceFeeLabel(cents: number | null | undefined): string {
  const n = Number(cents ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "免費";
  return `MOP ${(n / 100).toLocaleString("en-US")}`;
}

/** 每組人數的短說明：1 → 個人賽、2 → 雙人、4 → 接力 */
export function teamSizeLabel(teamSize: number): string {
  const n = Number(teamSize ?? 1);
  if (n <= 1) return "個人";
  if (n === 2) return "雙人";
  if (n === 4) return "接力 4 人";
  return `${n} 人一組`;
}

/** 報名截止時間：null → 不限（前台仍受 status 管制） */
export function deadlineLabel(value: string | null): string {
  if (!value) return "不限";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "不限";
  return new Intl.DateTimeFormat("zh-Hant", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/* =============================================================
 * 表單 ↔ API 的欄位換算
 * ============================================================= */

/**
 * datetime-local 的值（例：2026-11-10T23:59）→ API 接受的 ISO 字串。
 * 空白 → null（＝不限）。日期解析失敗 → null，讓伺服器端的白名單再擋一次。
 */
export function deadlineInputToApi(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** API 的 timestamptz → datetime-local 的值（以澳門時區為準，與顯示一致） */
export function deadlineApiToInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** 相簿網址驗證（前端先擋一次，伺服器端 _shared.takeText 也會再擋） */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}
