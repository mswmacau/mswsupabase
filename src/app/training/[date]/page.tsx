import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getSessionsByDate,
  isRealISODate,
  shiftISODate,
  type DatedSessionRow,
} from "@/lib/queries";
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
 * 渲染策略：ISR `revalidate = 60`。
 *   不 force-dynamic（這一頁的內容對所有人一樣，沒有理由每次重算），
 *   也不在 build 時枚舉所有日期（那會把未來幾年的空白日都預先產生成靜態頁）。
 *   「我的報名狀態」屬於個人資料，交給 client 元件另外查
 *   （原因見 `_components/DateSessionList.tsx` 開頭說明）。
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
  };
}

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
  const fullDate = formatFullDate(raw);

  if (sessions.length === 0) {
    return {
      title: `${fullDate}｜當日無場次`,
      description: `${fullDate} 目前沒有已排定的定期訓練場次。`,
    };
  }

  const titles = [...new Set(sessions.map((s) => s.class_name ?? s.title))];
  const summary = sessions
    .map((s) => {
      const name = s.class_name ?? s.title;
      const time = timeRange(s.start_time, s.end_time);
      return time ? `${time} ${name}` : name;
    })
    .join("、");

  return {
    title: `${fullDate}｜${titles.join("、")}`,
    description: `${fullDate} 共 ${sessions.length} 場定期訓練：${summary}。看當日場次、教練、地點與名額，直接報名。`,
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
  const views = sessions.map(toView);
  const todayISO = macauTodayISO();
  const isPast = date < todayISO;
  const isToday = date === todayISO;

  const prevDate = shiftISODate(date, -1);
  const nextDate = shiftISODate(date, 1);
  const { main: fullDateMain, week: fullDateWeek } = splitFullDate(date);
  const sessionLabel = `${sessions.length} 場`;

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
                {sessions.length > 0
                  ? `當日共 ${sessionLabel}定期訓練。時間、教練、地點與名額都在下面，可直接報名。`
                  : "當日沒有排定的定期訓練。"}
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
              這一天沒有排定的定期訓練。可以往前後日找找看，或回月曆看整個月的班表。
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
