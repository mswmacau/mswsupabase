import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { RULES } from "@/lib/config";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getAvailableMonths,
  getCachedPublishedEvents,
  getHyroxEvents,
  getMyEventRegistrations,
  getClassNamesByColor,
  getRaceCalendarMonths,
  getRaceEventsForMonth,
  getScheduleLegend,
  getScheduleMonth,
  getSitePages,
  shiftISODate,
  type CalendarRaceRow,
} from "@/lib/queries";
import { EventCard } from "@/components/EventCard";
import { CategoryCards } from "./_components/CategoryCards";
import { ScheduleCalendar } from "@/components/schedule/ScheduleCalendar";
import {
  buildMonthDays,
  formatMonthTitle,
  macauTodayISO,
  sessionPhase,
  sortSessionViews,
  type ScheduleCta,
  type ScheduleSessionView,
  type ScheduleStatus,
} from "@/components/schedule/schedule-utils";
import type { HyroxEvent, TrainingSessionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const pages = await getSitePages();
  return { title: pages.events.page_title };
}

/** Hero 大數字三聯 */
const HERO_FACTS = [
  { value: "03", unit: "Programs", label: "三條參與路線", accent: false },
  {
    value: String(RULES.MONTHLY_GOAL_KM),
    unit: "km / Month",
    label: "月度跑步目標",
    accent: true,
  },
  {
    value: `+${RULES.MONTHLY_BONUS_POINTS}`,
    unit: "Bonus",
    label: "達標額外獎分",
    accent: false,
  },
];

/**
 * Hero 大數字三聯。
 *
 * 站主 P1「日曆很難找」：手機 390 首屏完全看不到日期格（第一格 y=1461，
 * 視窗只有 844）。三聯在手機是 grid-cols-1 三層疊、吃掉 422px，是 hero
 * 最肥的一塊，而且它講的是「三條路線／月目標／獎分」，跟日曆的關聯
 * 沒有強到必須擋在日曆前面。
 *
 * 站主後續同意「桌面也比照辦理」：三聯**全斷點只渲染一份，位置固定在
 * 日曆之後**（見 #schedule 之後的呼叫點）。桌面 1440 原本第一格日期格
 * 落在 y=1128，視窗只有 900，搬走後才進得了首屏。
 *
 * 注意：不要再放回 hero，也不要再加第二份用 `hidden lg:block` 互斥——
 * 兩份寫法在無障礙樹上是安全的，但 DOM 裡就是兩份，維護時很容易改到
 * 其中一份而漏掉另一份。
 */
function HeroFacts({ className = "" }: { className?: string }) {
  return (
    <div className={`relative z-10 ${className}`}>
      <div className="container-msw">
        <div className="grid grid-cols-1 divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {HERO_FACTS.map((f) => (
            <div key={f.label} className="py-8 sm:px-8 sm:first:pl-0">
              <div className="flex items-start gap-2">
                <span
                  className={`stat-figure text-5xl leading-none md:text-6xl ${
                    f.accent ? "text-vital-bright" : "text-white"
                  }`}
                >
                  {f.value}
                </span>
                <span className="text-accent-blue mt-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                  {f.unit}
                </span>
              </div>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                {f.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 參加流程：改時間軸軌道，號碼用超大數字 */
const STEPS = [
  { n: "01", t: "註冊會員", d: "用電郵註冊，一分鐘完成。" },
  { n: "02", t: "報名訓練 / 上傳紀錄", d: "選擇日曆上的場次報名，或上傳跑步截圖。" },
  { n: "03", t: "後台確認", d: "管理員核對簽到與截圖，確認後入帳。" },
  { n: "04", t: "累積領獎", d: "積分與里程累積，達標領取優惠券。" },
];

type YearMonth = { year: number; month: number };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

function monthKeyOf(ym: YearMonth): string {
  return `${ym.year}-${pad2(ym.month)}`;
}

function monthHref(ym: YearMonth): string {
  return `/events?y=${ym.year}&m=${ym.month}`;
}

/** 月份查詢參數：`?y=2026&m=11`（或等價的 `?month=2026-11`） */
type MonthParams = {
  y?: string | string[];
  m?: string | string[];
  month?: string | string[];
};

/**
 * `?y=2026&m=11` 或 `?month=2026-11` → { year, month }；
 * 非法或超出範圍回 null（不 throw）。
 *
 * 兩種寫法都吃：稽核時用 `?month=2026-12` 手動改網址完全沒反應，
 * 因為舊版只讀 y/m。舊連結（y/m）仍優先，新寫法只當別名。
 */
function parseYearMonth(params: MonthParams): YearMonth | null {
  const pick = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const rawMonth = pick(params.month);
  const alias =
    rawMonth && /^\d{4}-\d{1,2}$/.test(rawMonth) ? rawMonth : null;

  const rawY = alias ? alias.slice(0, 4) : pick(params.y);
  const rawM = alias ? alias.slice(5) : pick(params.m);
  if (!rawY || !rawM) return null;

  const year = Number(rawY);
  const month = Number(rawM);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (year < 2024 || year > 2100 || month < 1 || month > 12) return null;

  return { year, month };
}

/** 班表堂 → 日曆/面板要的形狀 */
function sessionToView(
  row: TrainingSessionRow,
  todayISO: string
): ScheduleSessionView {
  const cancelled = row.status === "cancelled";
  // 已過的場次不改寫成「可報名」：CTA 換成介紹頁，徽章由面板依 phase 顯示「已結束」
  const past = sessionPhase(row.session_date, todayISO) === "past";
  return {
    id: row.id,
    kind: "class",
    // class_name 是 join 出來的課程名；舊資料（class_id 為 null）退回場次標題
    title: row.class_name ?? row.title,
    date: row.session_date,
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    colorKey: row.class_color_key,
    coachName: row.coach_name,
    // 管理員在這一場特別指定過場地就用它，否則沿用場次／課程的預設場地
    location: row.location_override ?? row.location,
    capacity: row.capacity,
    status: row.status,
    paid: false,
    feeCents: null,
    cta: cancelled
      ? null
      : past
        ? { label: "查看定期訓練介紹", href: "/training" }
        : { label: "查看定期訓練", href: "/training" },
  };
}

/**
 * HYROX 付費場次 → 日曆/面板要的形狀。
 *
 * CTA 分三種，因為 /hyrox/register 目前只認「下一個 upcoming 場次」、
 * 不讀 `?event=`（那是 HYROX 模組的既有行為，本次不動 /hyrox）：
 *   已過期  → 看場次詳情 /hyrox/[id]
 *   未登入  → /login?next=/hyrox/register?event=<id>（登入後回到報名頁）
 *   已登入  → /hyrox/register?event=<id>
 */
function hyroxToView(
  event: HyroxEvent,
  todayISO: string,
  isLoggedIn: boolean
): ScheduleSessionView {
  const date = event.event_date ?? "";
  const isPast = date !== "" && date < todayISO;
  const registerHref = `/hyrox/register?event=${event.id}`;

  let cta: ScheduleCta | null;
  if (isPast) {
    // 已結束的付費場：不給報名 CTA，改成回顧頁（該頁自己會寫「已結束」）
    cta = { label: "查看活動回顧", href: `/hyrox/${event.id}` };
  } else if (isLoggedIn) {
    cta = { label: "立即報名", href: registerHref };
  } else {
    cta = {
      label: "登入後報名",
      href: `/login?next=${encodeURIComponent(registerHref)}`,
    };
  }

  return {
    id: event.id,
    kind: "hyrox",
    title: event.title,
    date,
    startTime: event.start_time ? event.start_time.slice(0, 5) : null,
    endTime: event.end_time ? event.end_time.slice(0, 5) : null,
    colorKey: null,
    coachName: null,
    location: event.location ?? null,
    capacity: event.capacity ?? null,
    status: "open",
    paid: true,
    feeCents: event.fee_cents ?? null,
    cta,
  };
}

/**
 * 賽事（`events.series='race'`）→ 日曆要的形狀。
 *
 * 站主原話：「即將喺 11 月 20 至 22 日舉行嘅廣州 HYROX 比賽，亦請你擺落日曆度，
 * 只係冇得報名而已。」→ 只顯示、不報名。
 *
 * 【多日賽事每一天各產生一筆】11/20–11/22 的賽事要在三個格子都出現
 * （站主說「擺落日曆度」，只標第一天會讓人以為 21、22 號沒事）。
 * 三筆的 `id` 相同（都是賽事 id），所以日曆的 React key 一定要帶上 `date`
 * ——見 ScheduleCalendar 的 `${kind}-${id}-${date}`。
 *
 * 【CTA 只有兩種，都不導向報名】
 *   已結束（以**最後一天**判斷）→ 「查看賽事回顧」
 *   未結束                    → 「查看賽事」
 * 兩者都連到 `/races/<id>`，要不要報名由賽事頁自己決定，月曆不給報名按鈕。
 * 用「最後一天」而不是當天判斷，是為了讓三天賽事在賽期中不會出現
 * 「第一天回顧、第三天查看賽事」這種自相矛盾的畫面。
 *
 * 【status】`open` → "open"；`closed` / `photos` → "closed"
 * （photos = 已結束有相片，月曆上的「報名已截止」語意正確）。
 * draft / archived 根本不會進來：查詢與 RLS 兩層都擋掉了。
 *
 * 【paid 一律 false】`paid` 的語意是「HYROX 付費場」，會影響
 * 「需付費」徽章與橙色的付費統計；賽事不是付費場，不能混進去。
 */
function raceToViews(
  event: CalendarRaceRow,
  todayISO: string
): ScheduleSessionView[] {
  const start = event.event_date;
  if (!start) return [];

  // end_date 早於 event_date（或等於）都視為單日賽事，不讓髒資料把日期倒著展開
  const end = event.end_date && event.end_date > start ? event.end_date : start;
  const ended = end < todayISO;

  const cta: ScheduleCta = ended
    ? { label: "查看賽事回顧", href: `/races/${event.id}` }
    : { label: "查看賽事", href: `/races/${event.id}` };

  const status: ScheduleStatus = event.status === "open" ? "open" : "closed";

  const views: ScheduleSessionView[] = [];
  let cursor = start;
  // 上限 60 天：end_date 若被打成 2099 年，也不至於把整個月曆灌爆
  for (let i = 0; i < 60; i += 1) {
    views.push({
      id: event.id,
      kind: "race",
      title: event.title,
      date: cursor,
      startTime: event.start_time ? event.start_time.slice(0, 5) : null,
      endTime: event.end_time ? event.end_time.slice(0, 5) : null,
      colorKey: null,
      coachName: null,
      location: event.location ?? null,
      capacity: null,
      status,
      paid: false,
      feeCents: event.fee_cents ?? null,
      cta,
    });
    if (cursor >= end) break;
    cursor = shiftISODate(cursor, 1);
  }

  return views;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<MonthParams>;
}) {
  const params = await searchParams;

  const [
    months,
    raceMonths,
    hyroxAll,
    profile,
    legend,
    upcomingEvents,
    classesByColor,
  ] = await Promise.all([
    // 已發布且已到生效時間的「班表」月份（語意不變：training_months 仍是唯一真相）
    getAvailableMonths(),
    // 有賽事（series='race'）的月份。任務 3 的關鍵：12 月班表未發布、
    // 但 12/05 有賽事時，切換器必須有 12 月可點，否則永遠切不到。
    getRaceCalendarMonths(),
    // 前台要看到「已結束（archived）」的付費場次，否則 11/11 那場在日曆上會消失。
    // includeArchived 會回 draft —— draft 一律在下面過濾掉，不能外洩。
    getHyroxEvents({ includeArchived: true }),
    getCurrentProfile(),
    // 顏色圖例（後台可編輯）。表未建時回 [] → 圖例整段不顯示，日曆照常。
    getScheduleLegend(),
    // 已發布、未過期的一般活動（已排除 HYROX）。空陣列 → 「近期活動」整段不渲染。
    getCachedPublishedEvents(),
    // 色票鍵 → 課程名：圖例文字以課程名為準（通稱「跑步／力量」看不出是哪一堂）
    getClassNamesByColor(),
  ]);

  // 會員已報名的 activity id（未登入不查）。查詢失敗回 [] → 全部顯示「站內報名」。
  const registeredIds = profile
    ? new Set(await getMyEventRegistrations(profile.id))
    : new Set<string>();

  const todayISO = macauTodayISO();
  const today: YearMonth = {
    year: Number(todayISO.slice(0, 4)),
    month: Number(todayISO.slice(5, 7)),
  };

  /**
   * 月份切換器可達的月份 = 已發布班表的月份 ∪ 有賽事的月份 ∪ 有已上架
   * HYROX 場次的月份。
   *
   * 三者**不合併成一個陣列取代 months**：`months` 代表「班表已發布」，
   * 那個語意仍被下面的 todayPublished / pastMonths / 「本月班表尚未公布」判斷使用。
   * 這裡只是另外算一份「使用者切得到的月份」。
   *
   * 【HYROX 月份】資料重用上面已取好的 `hyroxAll`（includeArchived，含
   * archived），不加新查詢。draft 一律排除；`event_date = null`（日期待定）
   * 的場次貢獻不了月份，也排除。
   */
  const availableMonths: YearMonth[] = (() => {
    const byKey = new Map<string, YearMonth>();
    const add = (year: number, month: number) => {
      if (!Number.isInteger(year) || !Number.isInteger(month)) return;
      if (month < 1 || month > 12 || year < 2024 || year > 2100) return;
      const ym: YearMonth = { year, month };
      byKey.set(monthKeyOf(ym), ym);
    };
    for (const m of months) {
      add(m.year, m.month);
    }
    for (const m of raceMonths) {
      add(m.year, m.month);
    }
    for (const e of hyroxAll) {
      if (e.status === "draft" || !e.event_date) continue;
      add(
        Number(e.event_date.slice(0, 4)),
        Number(e.event_date.slice(5, 7))
      );
    }
    return [...byKey.values()].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month
    );
  })();

  // availableMonths 已升冪，最後一個就是最新可看月份
  const latest =
    availableMonths.length > 0
      ? availableMonths[availableMonths.length - 1]
      : null;

  const requested = parseYearMonth(params);
  const requestedAvailable =
    requested && availableMonths.some((m) => sameMonth(m, requested))
      ? requested
      : null;

  const todayPublished = months.some((m) => sameMonth(m, today));
  const todayHasRace = raceMonths.some((m) => sameMonth(m, today));
  // 當月是否有已上架（非 draft）HYROX 場次：資料重用 hyroxAll，不加新查詢
  const todayHasHyrox = hyroxAll.some(
    (e) =>
      e.status !== "draft" &&
      e.event_date !== null &&
      e.event_date.slice(0, 7) === monthKeyOf(today)
  );

  /**
   * 顯示月份：?y/?m（可達即可）→ 當月（有班表 **或** 有賽事 **或** 有
   * HYROX 場次）→ 最新可看月份 → 無。
   *
   * 舊版是「當月必須已發布班表才顯示」，於是 12 月有賽事／HYROX 場時，
   * 使用者連進 /events 都看不到（當月未發布 → 直接掉到降級卡）。
   */
  const display: YearMonth | null =
    requestedAvailable ??
    (todayPublished || todayHasRace || todayHasHyrox ? today : null) ??
    (latest ? { year: latest.year, month: latest.month } : null);

  const monthData = display
    ? await Promise.all([
        getScheduleMonth(display.year, display.month),
        getRaceEventsForMonth(display.year, display.month),
      ])
    : null;
  const schedule = monthData ? monthData[0] : null;
  const raceRows: CalendarRaceRow[] = monthData ? monthData[1] : [];

  const displayKey = display ? monthKeyOf(display) : null;
  const hyroxInMonth = displayKey
    ? hyroxAll.filter(
        (e) =>
          e.status !== "draft" &&
          e.event_date !== null &&
          e.event_date.slice(0, 7) === displayKey
      )
    : [];

  const isLoggedIn = Boolean(profile);

  const sessionViews: ScheduleSessionView[] = (schedule?.sessions ?? []).map(
    (row) => sessionToView(row, todayISO)
  );
  // HYROX 付費場：無條件鋪成日曆。舊門檻「班表未發布就不鋪」已無意義——
  // availableMonths 現在包含只有 HYROX 場次的月份，那種月份班表必然未發布，
  // 若沿用舊門檻，使用者切得進去卻看到降級卡，等於白做。hyroxInMonth
  // 本身已過濾 draft 與月份，直接鋪即可。
  const hyroxViews: ScheduleSessionView[] = hyroxInMonth.map((e) =>
    hyroxToView(e, todayISO, isLoggedIn)
  );
  // 賽事：不受「班表是否發布」影響，一律鋪上去（任務 1 + 任務 3）
  const raceViews: ScheduleSessionView[] = raceRows.flatMap((e) =>
    raceToViews(e, todayISO)
  );

  const allViews = sortSessionViews([...sessionViews, ...hyroxViews, ...raceViews]);

  /**
   * 畫月曆的條件：該月有已發布班表，**或**至少有賽事，**或**至少有 HYROX 場次。
   * 三者都沒有 → 維持原本的「本月班表尚未公布」降級卡。
   */
  const hasCalendar = Boolean(
    display && (schedule || raceViews.length > 0 || hyroxViews.length > 0)
  );

  /**
   * 該月的「內容字」：有班表 → 空字（「共 N 場」）；否則依內容組成決定——
   * 只有賽事 → 「賽事」（沿用既有字眼，race-only 月份不回歸）；
   * 含 HYROX 場次（無論有無賽事）→ 「活動」（戶外 HYROX 是付費訓練場，
   * 不是比賽，寫「賽事」會說謊）。
   * 用在切換器下的場次計數、月份標題後綴與「目前顯示」橫幅。
   */
  const contentWord = schedule
    ? ""
    : hyroxViews.length > 0
      ? "活動"
      : "賽事";

  const days =
    display && hasCalendar
      ? buildMonthDays({
          year: display.year,
          month: display.month,
          sessions: allViews,
          todayISO,
        })
      : [];

  /**
   * 本月格內實際看得到的場次數。
   * 不能用 `allViews.length`：跨月賽事（11/30–12/2）在 12 月那份資料裡
   * 也包含 11/30，直接算長度會把不屬於本月的那一天算進來。
   */
  const inMonthCount = days.reduce(
    (n, day) => n + (day.inMonth ? day.sessions.length : 0),
    0
  );

  // 月份切換：在「可達月份」之間走（含只有賽事的月份）
  const displayIndex = display
    ? availableMonths.findIndex((m) => sameMonth(m, display))
    : -1;
  const prevMonth =
    displayIndex > 0
      ? {
          year: availableMonths[displayIndex - 1].year,
          month: availableMonths[displayIndex - 1].month,
        }
      : null;
  const nextMonth =
    displayIndex >= 0 && displayIndex < availableMonths.length - 1
      ? {
          year: availableMonths[displayIndex + 1].year,
          month: availableMonths[displayIndex + 1].month,
        }
      : null;

  // 往期：已發布班表但不是目前顯示月份的，新的排前面。
  // 刻意仍以 months（班表）為準：這一區的標題寫「往期班表」，
  // 塞進只有賽事的月份會變成「2026 年 12 月班表」而其實沒有班表。
  const pastMonths = months
    .filter((m) => !display || !sameMonth(m, display))
    .sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));

  const totalCount = hasCalendar ? inMonthCount : 0;

  // 2026-11 站主要求刪掉 hero 右欄，連帶移除原本只給右欄用的 nextUp 查詢。
  // 若之後要恢復「下一場」顯示，從 days（已按日期有序）取第一個不早於
  // todayISO、且 status !== "cancelled" 的場次即可；不要改用 allViews——
  // allViews 只按「當天的時間」排序，跨日期沒有保證。

  return (
    <>
      {/* ================= HERO：宣言式排版 ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div
          className="pointer-events-none absolute -right-[20%] -top-[38%] h-[660px] w-[660px] rounded-full blur-[135px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.45,
          }}
        />
        <div className="clip-notch-br pointer-events-none absolute -bottom-14 -left-24 h-64 w-64 bg-vital/10" />

        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          {/* 三聯全斷點搬到日曆之後，hero 桌面高度由 792 降到 592：
              三聯本身佔 152px，另外把上留白 md:pt-36→md:pt-28（-32px）、
              桌面下留白 lg:pb-16→lg:pb-12（-16px），才讓 1440×900 首屏
              進得了日曆第一行。手機 pb-8／pt-20 完全沒動。
              2026-11 第二輪：md:pt-28→md:pt-20（再 -32px），讓 1440×900
              首屏露出的不是「日期格頂端 11px」而是真正看得到日期數字。
              2026-11 第三輪（站主）：hero 右欄「Next Session」整塊刪除——日曆
              就在正下方、已逐格列出所有場次，右欄是重複資訊，還把日曆推到
              要下拉才看到。右欄一併帶走 grid wrapper，hero 只剩 eyebrow + h1。
              下留白同步收窄：pb-8→pb-6、lg:pb-12→lg:pb-6。pt-20 不動。 */}
          <div className="relative pb-6 pt-20 md:pt-20 lg:pb-6">
            <div className="lg:pl-14">
              <span className="eyebrow">Events</span>

              <h1 className="display-xl mt-6 lg:-ml-[3vw] lg:w-[112%]">
                <span className="block text-white">活動總覽</span>
                <span className="relative mt-1 block">
                  <span
                    aria-hidden
                    data-dup="Overview"
                    className="text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block before:content-[attr(data-dup)]"
                  />
                  <span className="relative block text-vital-bright">
                    Overview
                  </span>
                </span>
              </h1>

              {/* 2026-11 站主要求：hero 右欄（Next Session 大數字＋說明）已整塊刪除。
                  日曆就在正下方，本來就逐格列出所有場次與報名方式，右欄是重複，
                  而且會把日曆往下推。連同 grid wrapper 一起移除，hero 只剩
                  eyebrow + h1，日曆往上收。 */}
            </div>
          </div>
        </div>

        {/* 三聯已全斷點搬到日曆之後（唯一一份），hero 內不再有。 */}
      </section>

      {/* ================= 1. 當月班表日曆（第一段內容：站主反映原本排在第三段＝很難找） ================= */}
      <section
        id="schedule"
        className="relative border-y border-ink-line bg-ink-soft"
      >
        <div className="noise-overlay" />
        {/* 上留白：hero 已經有 pb 與 border-b 收邊，日曆是這一頁的主角，
            不需要再隔一整個 section 節奏才開始。手機 pt-10；桌面 24px
            （原本取 --space-section 的一半＝40px，再收 16px）——站主要求
            1440×900 首屏看得到日曆「日期數字」而不只是格子頂端，
            這裡是最不傷版面的一塊餘裕。 */}
        <div className="container-msw section-pad relative pt-10 lg:pt-6">
          {/* 站主要求取消「班表日曆」這組大標／kicker 字眼：
              上方「2026 年 11 月」月份切換器本身已經說明這是什麼，
              再放一個 h2 只是重複。原本 h2 撐出的垂直間距改由 section-pad
              與下方切換器的 mt-6 承擔，刻意不留空標題元素（空 h2 會被
              螢幕閱讀器念出來，也讓 outline 多一層沒有內容的節點）。 */}
          <p className="max-w-xl text-sm leading-relaxed text-white/65">
            週一起算。手機與桌面都是整月月曆，點日期看當日場次、教練、場地與報名方式。
          </p>

          {/* 月份切換：只能走「已發布且已生效」的月份（getAvailableMonths）。
              不可切時渲染 disabled 的 <button>，不要用 <span>——span 看起來像按鈕
              但不在 Tab 順序、點不動，會被正確地判定成壞掉的控制項。 */}
          <div
            role="group"
            aria-label="切換班表月份"
            className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-white/10 py-3 lg:mt-6"
          >
            {prevMonth ? (
              <Link
                href={monthHref(prevMonth)}
                scroll={false}
                className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 border border-white/15 px-4 text-xs font-semibold text-white/75 transition hover:border-white/40 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vital-bright"
              >
                <ChevronLeft size={14} /> 上一月
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="沒有更早的已發布月份"
                className="inline-flex min-h-11 shrink-0 cursor-not-allowed items-center gap-1 border border-white/10 px-4 text-xs font-semibold text-white/25"
              >
                <ChevronLeft size={14} /> 上一月
              </button>
            )}

            <div className="min-w-0 flex-1 text-center" aria-live="polite">
              <div className="truncate text-sm font-black tracking-tight text-white">
                {display ? formatMonthTitle(display.year, display.month) : "尚未上架"}
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                {!display
                  ? "待館方公布"
                  : hasCalendar
                    ? `共 ${totalCount} 場${contentWord}`
                    : "本月班表尚未公布"}
              </div>
            </div>

            {nextMonth ? (
              <Link
                href={monthHref(nextMonth)}
                scroll={false}
                className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 border border-white/15 px-4 text-xs font-semibold text-white/75 transition hover:border-white/40 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vital-bright"
              >
                下一月 <ChevronRight size={14} />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="下一個月班表尚未發布"
                className="inline-flex min-h-11 shrink-0 cursor-not-allowed items-center gap-1 border border-white/10 px-4 text-xs font-semibold text-white/25"
              >
                下一月 <ChevronRight size={14} />
              </button>
            )}
          </div>

          {/* 使用者明確要求了一個未發布的月份（例如 ?m=12）：講清楚，不要默默換月 */}
          {requested && !requestedAvailable && (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-amber-500/60 bg-amber-500/[0.07] px-4 py-2.5 text-sm text-white/75">
              <span className="font-semibold text-white">
                {formatMonthTitle(requested.year, requested.month)}班表尚未公布
              </span>
              <span className="text-white/55">
                {display
                  ? "以下顯示目前已上架的最近月份。"
                  : "目前還沒有任何已上架的月份。"}
              </span>
            </div>
          )}

          {/* 當顯示的不是本月時，明講現在看的是哪一個月 */}
          {display && !sameMonth(display, today) && (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-vital bg-vital/[0.07] px-4 py-2.5 text-sm text-white/75">
              <span className="font-semibold text-white">
                目前顯示 {formatMonthTitle(display.year, display.month)}
                {schedule ? "班表" : contentWord}
              </span>
              {todayPublished || todayHasRace || todayHasHyrox ? (
                <Link
                  href={monthHref(today)}
                  scroll={false}
                  className="text-accent-blue underline decoration-white/30 underline-offset-4"
                >
                  回到本月
                </Link>
              ) : (
                <span className="text-white/55">
                  {formatMonthTitle(today.year, today.month)}班表尚未公布
                </span>
              )}
            </div>
          )}

          {/* 該月班表未發布、但有賽事或 HYROX 場次 → 月曆照畫，但要講清楚
              「這裡沒有課程」，不然使用者會以為課程被取消了。 */}
          {display && !schedule && (raceViews.length > 0 || hyroxViews.length > 0) && (
            <div
              className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 px-4 py-2.5 text-sm text-white/75"
              style={{
                borderColor: "rgba(217,70,239,0.65)",
                backgroundColor: "rgba(217,70,239,0.07)",
              }}
            >
              <span className="font-semibold text-white">
                {formatMonthTitle(display.year, display.month)}班表尚未公布
              </span>
              <span className="text-white/55">
                以下只顯示已排定的{contentWord}，課程班表待館方公布。
              </span>
            </div>
          )}

          {display && hasCalendar ? (
            <div className="mt-3">
              <ScheduleCalendar
                // 換月時重掛載：選中的場次與當日清單不該跨月沿用
                key={displayKey ?? "schedule"}
                year={display.year}
                month={display.month}
                days={days}
                legend={legend}
                classesByColor={classesByColor}
                todayISO={todayISO}
                // 該月沒有班表時，標題後綴依內容組成（賽事／活動）才不會說謊
                headingSuffix={schedule ? "班表" : contentWord}
              />
            </div>
          ) : (
            <div className="mt-6 border border-white/10 bg-ink/50 p-6 md:p-8">
              <div className="flex items-start gap-4">
                <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center border border-white/15 bg-white/5 text-white/60">
                  <CalendarDays size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-black tracking-tight text-white">
                    本月班表尚未公布
                  </h3>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65">
                    班表由館方逐月建立、逐月上架，公布後會直接出現在這個日曆。
                    想先了解訓練內容與節奏，可以先看定期訓練頁。
                  </p>
                  {months.length === 0 && (
                    <p className="mt-2 text-xs leading-relaxed text-white/45">
                      目前還沒有任何已上架的月份。
                    </p>
                  )}
                  <Link
                    href="/training"
                    className="btn-base btn-ghost btn-slab mt-5"
                  >
                    先看定期訓練介紹 <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 大數字三聯：全斷點唯一一份，位置固定在日曆之後。
          上方接 #schedule（它自己有 border-y border-ink-line），下方接
          「三種參與方式」，所以這裡只需要一條底線收邊，不要再加 border-t
          ——加了會和 #schedule 的底線疊成雙線。 */}
      <HeroFacts className="border-b border-ink-line" />

      {/* ================= 2. 三張分類卡（常駐，無活動時也顯示） ================= */}
      <section className="container-msw section-pad">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
          <div>
            <span className="eyebrow">Categories</span>
            <h2 className="display-xl mt-5">三種參與方式</h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-white/65">
            每週固定練、每月一次的付費挑戰、自己安排的里程累積——三條路都算數，
            選一條先開始就對了。
          </p>
        </div>

        <div className="mt-10">
          <CategoryCards />
        </div>
      </section>

      {/* ================= 3. 近期活動（已發布的一般活動） =================
          修復「管理員發布了但會員看不到」的斷裂：/admin/events 發布的一般活動
          從這裡才真的有前台出口。HYROX 已在上面分類卡與 /hyrox 承接，故查詢端
          就排除 series='hyrox'（見 getCachedPublishedEvents）。
          空狀態刻意整段不渲染：留一個「暫無活動」的空盒子比沒有更難看。 */}
      {upcomingEvents.length > 0 && (
        <section className="container-msw pb-16">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
            <div>
              <span className="eyebrow">Upcoming</span>
              <h2 className="display-xl mt-5">近期活動</h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-white/65">
              已開放報名
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingEvents.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                isLoggedIn={isLoggedIn}
                registered={registeredIds.has(ev.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ================= 4. 往期班表 ================= */}
      {pastMonths.length > 0 && (
        <section className="container-msw pb-4 pt-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-xl font-black tracking-tight text-white md:text-2xl">
              往期班表
            </h2>
            <p className="text-xs text-white/45">
              已上架的歷史月份，點進去可以看當時的堂次安排。
            </p>
          </div>

          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pastMonths.map((m) => {
              const ym: YearMonth = { year: m.year, month: m.month };
              return (
                <li key={monthKeyOf(ym)}>
                  <Link
                    href={monthHref(ym)}
                    scroll={false}
                    className="group flex items-center justify-between gap-3 border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/75 transition hover:border-white/25 hover:bg-white/[0.05] hover:text-white"
                  >
                    <span className="min-w-0 truncate">
                      {formatMonthTitle(ym.year, ym.month)}班表
                    </span>
                    <ArrowRight
                      size={15}
                      className="shrink-0 text-white/40 transition-transform duration-500 group-hover:translate-x-1 group-hover:text-white"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ================= 參加流程 ================= */}
      <section className="relative mt-16 border-y border-ink-line bg-ink-soft">
        <div className="noise-overlay" />
        <div className="container-msw section-pad relative">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h2 className="display-xl mt-5">參加流程</h2>
            </div>
          </div>

          <div className="relative mt-12">
            <div className="pointer-events-none absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-white/20 to-transparent md:block" />
            <div className="stagger grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  className="group relative border border-white/10 bg-ink/40 p-6 z-raise"
                >
                  <div className="flex items-center gap-3">
                    <span className="rank-figure text-5xl text-white/30 transition-colors duration-500 group-hover:text-vital-bright md:text-6xl">
                      {s.n}
                    </span>
                    <span className="h-1.5 w-1.5 rotate-45 bg-vital-bright" />
                  </div>
                  <h3 className="mt-5 font-black tracking-tight">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">
                    {s.d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ 收尾 CTA：巨型宣言 + 單側光暈 ============ */}
      <section className="relative overflow-hidden border-t border-ink-line">
        <div className="grid-lines absolute inset-0" />
        <div
          className="pointer-events-none absolute -bottom-72 -right-24 h-[620px] w-[620px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, var(--color-vital), transparent 68%)",
            opacity: 0.16,
          }}
        />
        <span
          aria-hidden
          className="display-hero text-outline pointer-events-none absolute -bottom-6 left-[-4%] select-none opacity-40"
        >
          MSW
        </span>

        <div className="container-msw section-pad relative">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <h2 className="mt-6 text-5xl font-black leading-[0.95] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
                {profile ? "繼續把汗水換成積分" : "現在就開始累積"}
              </h2>
              <p className="mt-7 max-w-xl text-base leading-relaxed text-white/70">
                {profile
                  ? "本月里程與積分持續累積中，記得定期上傳跑步紀錄與報名訓練。"
                  : "註冊只需一分鐘。加入後即可報名訓練、上傳跑步紀錄、追蹤積分與優惠券。"}
              </p>
            </div>

            <div className="flex flex-col items-start gap-4 lg:col-span-4 lg:pt-20">
              {profile ? (
                <>
                  <Link href="/run" className="btn-base btn-vital btn-slab">
                    上傳跑步紀錄 <ArrowRight size={18} />
                  </Link>
                  <Link
                    href="/training"
                    className="btn-base btn-ghost btn-slab"
                  >
                    報名訓練場次
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/signup" className="btn-base btn-vital btn-slab">
                    免費註冊會員 <ArrowRight size={18} />
                  </Link>
                  <Link href="/login" className="btn-base btn-ghost btn-slab">
                    我已有帳號
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
