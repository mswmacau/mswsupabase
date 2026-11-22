import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getRaceEventsForMonth,
  getSessionsByDate,
  isRealISODate,
  shiftISODate,
  type CalendarRaceRow,
  type DatedSessionRow,
} from "@/lib/queries";
import { anonClient } from "@/lib/supabase/anon";
import {
  WEEKDAY_LABELS,
  isoWeekdayIndex,
  macauTodayISO,
} from "@/components/schedule/schedule-utils";
import { DateSessionList, type DatedSessionView } from "./_components/DateSessionList";

/**
 * 日期頁 `/training/YYYY-MM-DD` —— 「點日期 → 當日頁 → 報名」的中間那一步。
 *
 * 為什麼要有這一頁：
 *   站主原話「點日期不能進去看當日內容」。月曆格在 390 寬只有 ~52px，
 *   手機上連課名都放不下，能放的資訊有限；把「當日全部場次 + 報名」做成
 *   一個真正可分享、可加書籤、可被搜尋引擎索引的網址，月曆才有出口。
 *
 * 路由規則：
 *   - 格式不合法（不是 YYYY-MM-DD、月份 13、日期 32、2 月 30 日）→ `notFound()`
 *   - 合法但當日沒有場次 → **正常渲染**（空狀態 + 前後日導覽 + 回月曆），
 *     刻意不 404：使用者從月曆點進來一個沒有課的日子，看到 404 會以為網站壞了。
 *
 * 當日內容 = 班表堂 ∪ HYROX 付費場 ∪ 賽事（2026-12 修復）：
 *   月曆格連結指向這一頁，但月曆格上有的東西（HYROX／賽事）這裡看不到，
 *   會員點進來只見「當日無場次」——等於月曆給了一個死胡同。所以這頁的
 *   場次清單要把三種都算進去，「當日無場次」只在真的什麼都沒有的日子出現。
 *
 * 渲染策略：ISR `revalidate = 60`。
 *   不 force-dynamic（這一頁的內容對所有人一樣，沒有理由每次重算），
 *   也不在 build 時枚舉所有日期（那會把未來幾年的空白日都預先產生成靜態頁）。
 *   「我的報名狀態」屬於個人資料，交給 client 元件另外查
 *   （原因見 `_components/DateSessionList.tsx` 開頭說明）。
 *   ⚠️ 因此這頁**不能**用讀 cookie 的 createClient()（含
 *   `getHyroxEvents({ includeArchived: true })`——它內部就是用它），
 *   HYROX 查詢改走頁內 anonClient（見 getHyroxEventsForDate）。
 */

export const revalidate = 60;

/** 課程類別中文（DB 的 training_classes.category check 值） */
const CATEGORY_LABEL: Record<string, string> = {
  strength: "力量",
  hyrox: "HYROX",
  running: "跑步",
  skill: "技巧",
  internal: "內部培訓",
  outdoor: "戶外",
};

/** 'YYYY-MM-DD' → { main: '2026 年 11 月 17 日', week: '（週二）' } */
function splitFullDate(iso: string): { main: string; week: string } {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return {
    main: `${year} 年 ${month} 月 ${day} 日`,
    week: `（週${WEEKDAY_LABELS[isoWeekdayIndex(iso)]}）`,
  };
}

/** 'YYYY-MM-DD' → '2026 年 11 月 17 日（週二）' */
function formatFullDate(iso: string): string {
  const { main, week } = splitFullDate(iso);
  return `${main}${week}`;
}

type Params = { date: string };

/** 參數一律先驗格式，非法就 notFound()，不要讓非法字串流進查詢層 */
function parseDateParam(raw: string): string {
  if (!isRealISODate(raw)) notFound();
  return raw;
}

function timeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = start.slice(0, 5);
  if (!end) return s;
  return `${s}–${end.slice(0, 5)}`;
}

function toView(row: DatedSessionRow): DatedSessionView {
  return {
    id: row.id,
    kind: "class",
    title: row.class_name ?? row.title,
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    coachName: row.coach_name,
    location: row.location_override ?? row.location,
    capacity: row.capacity,
    remaining: row.remaining,
    taken: row.taken,
    status: row.status,
    colorKey: row.class_color_key,
    categoryLabel: row.class_category
      ? CATEGORY_LABEL[row.class_category] ?? null
      : null,
    // 班表堂走站內報名（DateSessionList 的 SessionActionArea），不用外部 CTA
    cta: null,
    paid: false,
    feeCents: null,
  };
}

/* =====================================================================
 * 當日的 HYROX 付費場與賽事（2026-11-22 補）
 *
 * 為什麼要在這一頁另外查，而不重用 getHyroxEvents()／月曆的資料：
 *   · 本頁是 ISR（revalidate = 60），getHyroxEvents() 內部用 createClient()
 *     讀 cookie → 會把整頁打成動態渲染，失去快取的好處。
 *   · 所以這裡用 anonClient 直接查，過濾口徑與 /events 月曆保持一致
 *     （HYROX：狀態非 draft；賽事：open/closed/photos，由查詢條件擋）。
 *   · 任何查詢失敗一律回 []（少一列不能讓日頁 500）。
 * ===================================================================== */

type HyroxDayRow = {
  id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  fee_cents: number | null;
  status: string;
};

const getHyroxEventsForDate = cache(
  async (date: string): Promise<HyroxDayRow[]> => {
    const supabase = anonClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("events")
      .select("id,title,start_time,end_time,location,fee_cents,status")
      // 與 /events 月曆同口徑：published（現行）＋ archived（往期回顧）
      .eq("series", "hyrox")
      .eq("event_date", date)
      .in("status", ["published", "archived"])
      .order("start_time", { ascending: true });
    if (error || !data) return [];
    return data as unknown as HyroxDayRow[];
  }
);

const getRacesForDate = cache(
  async (date: string): Promise<CalendarRaceRow[]> => {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const rows = await getRaceEventsForMonth(year, month);
    return rows.filter((r) => {
      const lastDay =
        r.end_date && r.end_date > r.event_date ? r.end_date : r.event_date;
      // 多日賽事：每一天都算「當日有賽事」
      return r.event_date <= date && date <= lastDay;
    });
  }
);

/** HYROX 付費場 → 日頁列。CTA 照月曆詳情面板：已結束看回顧、未結束去報名 */
function hyroxDayToView(row: HyroxDayRow, isPast: boolean): DatedSessionView {
  const finished = isPast || row.status === "archived";
  const registerHref = `/hyrox/register?event=${row.id}`;
  return {
    id: row.id,
    kind: "hyrox",
    title: row.title,
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    coachName: null,
    location: row.location,
    capacity: null,
    remaining: null,
    taken: null,
    status: finished ? "closed" : "open",
    colorKey: null,
    categoryLabel: null,
    cta: finished
      ? { label: "查看活動回顧", href: `/hyrox/${row.id}` }
      : {
          // 本頁不讀 cookie，不知道是否已登入 → 一律先導去登入，
          // 登入頁會把人送回 /hyrox/register?event=…（既有行為）
          label: "登入後報名",
          href: `/login?next=${encodeURIComponent(registerHref)}`,
        },
    paid: true,
    feeCents: row.fee_cents,
  };
}

/** 賽事 → 日頁列（只展示不報名，報名入口在賽事頁） */
function raceDayToView(row: CalendarRaceRow, isPast: boolean): DatedSessionView {
  const finished =
    isPast || row.status === "closed" || row.status === "photos";
  return {
    id: row.id,
    kind: "race",
    title: row.title,
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    coachName: null,
    location: row.location,
    capacity: null,
    remaining: null,
    taken: null,
    status: finished ? "closed" : "open",
    colorKey: null,
    categoryLabel: "賽事",
    cta: {
      label: finished ? "查看賽事回顧" : "查看賽事",
      href: `/races/${row.id}`,
    },
    paid: false,
    feeCents: row.fee_cents,
  };
}

/** 當日「非班表堂」的活動（HYROX＋賽事），同一請求內只查一次 */
const getExtraViewsForDate = cache(
  async (date: string): Promise<DatedSessionView[]> => {
    const todayISO = macauTodayISO();
    const isPast = date < todayISO;
    const [hyroxRows, raceRows] = await Promise.all([
      getHyroxEventsForDate(date),
      getRacesForDate(date),
    ]);
    return [
      ...hyroxRows.map((r) => hyroxDayToView(r, isPast)),
      ...raceRows.map((r) => raceDayToView(r, isPast)),
    ];
  }
);

/**
 * 分享與 SEO：標題帶日期與課程名，描述帶場次摘要。
 * 這裡刻意再查一次 `getSessionsByDate()` —— 同一個請求內 unstable_cache 會命中，
 * 不會多打一次資料庫。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { date: raw } = await params;
  if (!isRealISODate(raw)) {
    return { title: "找不到這一天" };
  }

  const sessions = await getSessionsByDate(raw);
  const extra = await getExtraViewsForDate(raw);
  const fullDate = formatFullDate(raw);

  if (sessions.length === 0 && extra.length === 0) {
    return {
      title: `${fullDate}｜當日無場次`,
      description: `${fullDate} 目前沒有已排定的活動。`,
    };
  }

  // 班表堂、HYROX 付費場、賽事都算「當日活動」——標題要把三種名字都帶上
  const titles = [
    ...new Set([
      ...sessions.map((s) => s.class_name ?? s.title),
      ...extra.map((e) => e.title),
    ]),
  ];
  const summary = [
    ...sessions.map((s) => {
      const name = s.class_name ?? s.title;
      const time = timeRange(s.start_time, s.end_time);
      return time ? `${time} ${name}` : name;
    }),
    ...extra.map((e) =>
      e.startTime ? `${e.startTime} ${e.title}` : e.title
    ),
  ].join("、");

  return {
    title: `${fullDate}｜${titles.join("、")}`,
    description: `${fullDate} 共 ${sessions.length + extra.length} 場活動：${summary}。`,
  };
}

export default async function TrainingDatePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { date: raw } = await params;
  const date = parseDateParam(raw);

  const sessions = await getSessionsByDate(date);
  const extra = await getExtraViewsForDate(date);
  // 三種合併後按開始時間排序（沒有時間的排最後）；同時間維持班表堂優先
  const views = [...sessions.map(toView), ...extra].sort((a, b) =>
    (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99")
  );
  const classCount = sessions.length;
  const hasNonClass = extra.length > 0;
  const todayISO = macauTodayISO();
  const isPast = date < todayISO;
  const isToday = date === todayISO;

  const prevDate = shiftISODate(date, -1);
  const nextDate = shiftISODate(date, 1);
  const { main: fullDateMain, week: fullDateWeek } = splitFullDate(date);
  const sessionLabel = `${views.length} 場`;

  return (
    <div className="relative">
      {/* ================= 抬頭：日期本身就是標題 ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div className="grid-lines absolute inset-0" />
        <div
          className="pointer-events-none absolute -right-[18%] -top-[46%] h-[520px] w-[520px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.35,
          }}
        />

        <div className="container-msw relative z-10 pt-24 pb-10 md:pt-32 md:pb-12">
          {/* 回月曆：手機在最上面，先給出口再給內容 */}
          <Link
            href="/events"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-white"
          >
            <ChevronLeft size={16} aria-hidden />
            回月曆
          </Link>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* 390 實測：`text-3xl` 會把「（週二）」斷成「（週 / 二）」，
                    所以基準字級收到 26px，並把週幾包成 nowrap 讓它整段換行。 */}
                <h1 className="text-[26px] font-black leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl md:text-5xl">
                  {fullDateMain}
                  <span className="whitespace-nowrap">{fullDateWeek}</span>
                </h1>
                {isToday && (
                  <span className="border border-vital/60 bg-vital/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-vital-bright">
                    今天
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-white/65">
                {views.length === 0
                  ? "當日沒有排定的活動。"
                  : hasNonClass
                    ? // 有 HYROX／賽事時不能寫「定期訓練都不收費／可直接報名」那類假話
                      `當日共 ${sessionLabel}活動。時間、地點與名額都在下面。`
                    : `當日共 ${sessionLabel}定期訓練。時間、教練、地點與名額都在下面，可直接報名。`}
              </p>
            </div>

            {/* 前後日導覽：兩個都是 44px 高，箭頭在手機上也按得到 */}
            <nav
              aria-label="切換日期"
              className="flex w-full items-center gap-2 sm:w-auto"
            >
              <Link
                href={`/training/${prevDate}`}
                rel="prev"
                aria-label={`前一日 ${formatFullDate(prevDate)}`}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 border border-white/15 px-3 text-xs font-semibold text-white/75 transition hover:border-white/40 hover:bg-white/[0.06] hover:text-white sm:flex-none sm:px-4"
              >
                <ChevronLeft size={14} aria-hidden />
                前一日
              </Link>
              <Link
                href={`/training/${nextDate}`}
                rel="next"
                aria-label={`後一日 ${formatFullDate(nextDate)}`}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 border border-white/15 px-3 text-xs font-semibold text-white/75 transition hover:border-white/40 hover:bg-white/[0.06] hover:text-white sm:flex-none sm:px-4"
              >
                後一日
                <ChevronRight size={14} aria-hidden />
              </Link>
            </nav>
          </div>
        </div>
      </section>

      {/* ================= 當日場次 ================= */}
      <section className="container-msw pb-16 pt-8 md:pt-10">
        {views.length > 0 ? (
          <DateSessionList date={date} sessions={views} isPast={isPast} />
        ) : (
          /* 空狀態：不 404，也不留白盒子 —— 明確說明 + 兩條出路 */
          <div className="border border-dashed border-white/15 bg-white/[0.02] px-6 py-14 text-center">
            <CalendarDays size={30} className="mx-auto text-white/35" aria-hidden />
            <h2 className="mt-4 text-lg font-black tracking-tight text-white">
              當日無場次
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/65">
              這一天沒有排定的活動。可以往前後日找找看，或回月曆看整個月的班表。
            </p>
            <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link
                href={`/training/${prevDate}`}
                className="btn-base btn-ghost btn-slab min-h-11"
              >
                <ChevronLeft size={16} aria-hidden /> 看前一日
              </Link>
              <Link
                href={`/training/${nextDate}`}
                className="btn-base btn-ghost btn-slab min-h-11"
              >
                看後一日 <ChevronRight size={16} aria-hidden />
              </Link>
              <Link
                href="/events"
                className="btn-base btn-vital btn-slab min-h-11"
              >
                回月曆 <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * 讓 ISR 的失效 tag 與其他班表頁一致：`getSessionsByDate()` 內部用的是
 * `TRAINING_SCHEDULE_TAG`，後台寫入時 revalidateTag 一次就整組失效。
 * 這裡不另外宣告快取規則，避免出現兩套會走鐘的失效路徑。
 */
export const dynamicParams = true;
