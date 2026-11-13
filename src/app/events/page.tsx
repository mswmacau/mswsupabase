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
  getHyroxEvents,
  getScheduleMonth,
  getSitePages,
} from "@/lib/queries";
import { CategoryCards } from "./_components/CategoryCards";
import { ScheduleCalendar } from "@/components/schedule/ScheduleCalendar";
import {
  buildMonthDays,
  formatMonthTitle,
  macauTodayISO,
  sortSessionViews,
  type ScheduleCta,
  type ScheduleSessionView,
} from "@/components/schedule/schedule-utils";
import type { HyroxEvent, TrainingSessionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const pages = await getSitePages();
  return { title: pages.events.page_title };
}

/** 跑馬燈：接續首頁語言 */
const MARQUEE_ITEMS = [
  "Events",
  "定期訓練",
  `${RULES.MONTHLY_GOAL_KM}km / Month`,
  "街頭健身",
  "澳門 Macau",
  "Calisthenics",
];

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

/** `?y=2026&m=11` → { year, month }；非法或超出範圍回 null（不 throw） */
function parseYearMonth(
  y: string | string[] | undefined,
  m: string | string[] | undefined
): YearMonth | null {
  const rawY = Array.isArray(y) ? y[0] : y;
  const rawM = Array.isArray(m) ? m[0] : m;
  if (!rawY || !rawM) return null;

  const year = Number(rawY);
  const month = Number(rawM);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (year < 2024 || year > 2100 || month < 1 || month > 12) return null;

  return { year, month };
}

/** 班表堂 → 日曆/面板要的形狀 */
function sessionToView(row: TrainingSessionRow): ScheduleSessionView {
  const cancelled = row.status === "cancelled";
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
    location: row.location,
    capacity: row.capacity,
    status: row.status,
    paid: false,
    feeCents: null,
    cta: cancelled ? null : { label: "查看定期訓練", href: "/training" },
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
    cta = { label: "查看活動詳情", href: `/hyrox/${event.id}` };
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

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string | string[]; m?: string | string[] }>;
}) {
  const params = await searchParams;

  const [months, hyroxAll, profile] = await Promise.all([
    getAvailableMonths(),
    // 前台要看到「已結束（archived）」的付費場次，否則 11/11 那場在日曆上會消失。
    // includeArchived 會回 draft —— draft 一律在下面過濾掉，不能外洩。
    getHyroxEvents({ includeArchived: true }),
    getCurrentProfile(),
  ]);

  const todayISO = macauTodayISO();
  const today: YearMonth = {
    year: Number(todayISO.slice(0, 4)),
    month: Number(todayISO.slice(5, 7)),
  };

  // getAvailableMonths() 回升冪，最後一個就是最新已發布月份
  const latest = months.length > 0 ? months[months.length - 1] : null;

  const requested = parseYearMonth(params.y, params.m);
  const requestedAvailable =
    requested && months.some((m) => sameMonth(m, requested)) ? requested : null;

  const todayPublished = months.some((m) => sameMonth(m, today));

  /** 顯示月份：?y/?m（且該月已發布）→ 當月（若已發布）→ 最新已發布月份 → 無 */
  const display: YearMonth | null =
    requestedAvailable ??
    (todayPublished ? today : null) ??
    (latest ? { year: latest.year, month: latest.month } : null);

  const schedule = display
    ? await getScheduleMonth(display.year, display.month)
    : null;

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
    sessionToView
  );
  const hyroxViews: ScheduleSessionView[] = hyroxInMonth.map((e) =>
    hyroxToView(e, todayISO, isLoggedIn)
  );
  // 只有該月班表已發布時才畫日曆；未發布＝整月都還不該露出，
  // 此時連 HYROX 場次也不單獨鋪成日曆，改走「本月班表尚未公布」的降級卡。
  const allViews = schedule ? sortSessionViews([...sessionViews, ...hyroxViews]) : [];
  const days =
    display && schedule
      ? buildMonthDays({
          year: display.year,
          month: display.month,
          sessions: allViews,
          todayISO,
        })
      : [];

  // 月份切換：只在「已發布且已生效」的月份之間走，未來未發布的月份切不到
  const displayIndex = display
    ? months.findIndex((m) => sameMonth(m, display))
    : -1;
  const prevMonth =
    displayIndex > 0
      ? { year: months[displayIndex - 1].year, month: months[displayIndex - 1].month }
      : null;
  const nextMonth =
    displayIndex >= 0 && displayIndex < months.length - 1
      ? {
          year: months[displayIndex + 1].year,
          month: months[displayIndex + 1].month,
        }
      : null;

  // 往期：已發布但不是目前顯示月份的，新的排前面
  const pastMonths = months
    .filter((m) => !display || !sameMonth(m, display))
    .sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));

  const totalCount = schedule ? allViews.length : 0;

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
          <div className="relative pb-14 pt-28 md:pt-36 lg:pb-16">
            <div className="absolute left-0 top-40 hidden lg:block">
              <span className="vlabel text-white/50">Programs · Macau</span>
            </div>

            <div className="lg:pl-14">
              <span className="eyebrow">Events</span>

              <h1 className="mt-6 lg:-ml-[3vw] lg:w-[112%]">
                <span className="display-xl block text-white">活動總覽</span>
                <span className="relative mt-1 block">
                  <span
                    aria-hidden
                    className="display-xl text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block"
                  >
                    Overview
                  </span>
                  <span className="display-xl relative block text-vital-bright">
                    Overview
                  </span>
                </span>
              </h1>

              <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
                <p className="text-base leading-relaxed text-white/70 lg:col-span-6">
                  三條路線、一份月曆。HYROX 付費場次、每週定期訓練、月度跑步累積
                  —— 想練的、想報的、想累積的，都在這一頁排好時間。
                </p>

                <div className="lg:col-span-5 lg:col-start-8 lg:border-l lg:border-white/10 lg:pl-8">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                    班表日曆
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
                    <span className="stat-figure text-5xl leading-none text-white md:text-6xl">
                      {display
                        ? `${display.year}.${pad2(display.month)}`
                        : "—"}
                    </span>
                    <span className="text-accent-blue mb-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                      {display && sameMonth(display, today)
                        ? "Current Month"
                        : "Latest Published"}
                    </span>
                  </div>
                  <div className="mt-5 h-px w-16 bg-white/20" />
                  <p className="mt-5 text-sm leading-relaxed text-white/65">
                    {schedule
                      ? `本月共 ${totalCount} 個場次已上架${
                          hyroxViews.length > 0
                            ? `，其中 ${hyroxViews.length} 場為付費 HYROX`
                            : ""
                        }。點日曆上的場次看詳情。`
                      : "本月班表尚未公布。班表由館方逐月建立與上架，公布後會出現在下方日曆。"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 大數字三聯 */}
        <div className="relative z-10 border-t border-white/10">
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

        {/* 跑馬燈 */}
        <div className="relative z-10 border-y border-white/10 py-3">
          <div className="marquee" aria-hidden>
            <div className="marquee-track">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex shrink-0 items-center">
                  {MARQUEE_ITEMS.map((w) => (
                    <span
                      key={`${copy}-${w}`}
                      className="flex items-center whitespace-nowrap px-6 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/55"
                    >
                      {w}
                      <span className="ml-6 inline-block h-1 w-1 rotate-45 bg-vital-bright" />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= 1. 三張分類卡（常駐，無活動時也顯示） ================= */}
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

      {/* ================= 2. 當月班表日曆 ================= */}
      <section
        id="schedule"
        className="relative border-y border-ink-line bg-ink-soft"
      >
        <div className="noise-overlay" />
        <div className="container-msw section-pad relative">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <span className="eyebrow">Schedule</span>
              <h2 className="display-xl mt-5">班表日曆</h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-white/65">
              週一起算。手機看一週、桌面看整月，點任一場次看教練、場地與報名方式。
            </p>
          </div>

          {/* 月份切換：只能走「已發布且已生效」的月份 */}
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-white/10 py-3">
            {prevMonth ? (
              <Link
                href={monthHref(prevMonth)}
                scroll={false}
                className="inline-flex min-h-9 items-center gap-1 border border-white/15 px-3 text-xs font-semibold text-white/75 transition hover:border-white/40 hover:text-white"
              >
                <ChevronLeft size={14} /> 上一月
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex min-h-9 items-center gap-1 border border-white/10 px-3 text-xs font-semibold text-white/25"
              >
                <ChevronLeft size={14} /> 上一月
              </span>
            )}

            <div className="min-w-0 flex-1 text-center">
              <div className="truncate text-sm font-black tracking-tight text-white">
                {display ? formatMonthTitle(display.year, display.month) : "尚未上架"}
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                {!display
                  ? "待館方公布"
                  : schedule
                    ? `共 ${totalCount} 場`
                    : "本月班表尚未公布"}
              </div>
            </div>

            {nextMonth ? (
              <Link
                href={monthHref(nextMonth)}
                scroll={false}
                className="inline-flex min-h-9 items-center gap-1 border border-white/15 px-3 text-xs font-semibold text-white/75 transition hover:border-white/40 hover:text-white"
              >
                下一月 <ChevronRight size={14} />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex min-h-9 items-center gap-1 border border-white/10 px-3 text-xs font-semibold text-white/25"
              >
                下一月 <ChevronRight size={14} />
              </span>
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
                目前顯示 {formatMonthTitle(display.year, display.month)}班表
              </span>
              {todayPublished ? (
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

          {display && schedule ? (
            <div className="mt-6">
              <ScheduleCalendar
                // 換月時重掛載：手機週檢視與選中的場次不該跨月沿用
                key={displayKey ?? "schedule"}
                year={display.year}
                month={display.month}
                days={days}
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

      {/* ================= 3. 往期班表 ================= */}
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
