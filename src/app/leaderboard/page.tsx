import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import {
  getCachedAllTimeLeaderboard,
  getCachedMonthlyLeaderboard,
} from "@/lib/queries";
import { RULES } from "@/lib/config";
import { addMonths, currentMonth, formatKm, monthLabel, recentMonths } from "@/lib/utils";
import { CountUp } from "@/components/fx/CountUp";
import { LeaderboardSearch } from "@/components/fx/LeaderboardSearch";

export const metadata = { title: "排行榜" };
export const dynamic = "force-dynamic";

/** 跑馬燈 */
const MARQUEE_ITEMS = [
  "Leaderboard",
  "月度里程榜",
  "累積總榜",
  `${RULES.MONTHLY_GOAL_KM}km / Month`,
  "澳門 Macau",
  "Keep Showing Up",
];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();

  // F-L3：上個月榜單重用同一個 getCachedMonthlyLeaderboard（60 秒 cache），
  // 只係傳唔同嘅 YYYY-MM，唔加新 query function、唔改 DB。
  const prevMonth = addMonths(month, -1);

  const [monthly, allTime, prevMonthly] = await Promise.all([
    getCachedMonthlyLeaderboard(month, 50),
    getCachedAllTimeLeaderboard(20),
    getCachedMonthlyLeaderboard(prevMonth, 50),
  ]);

  /** user_id → 上月名次（1 起） */
  const prevRanks: Record<string, number> = {};
  prevMonthly.forEach((r, i) => {
    prevRanks[r.user_id] = i + 1;
  });

  const months = recentMonths(6);
  const topKm = monthly.length ? Number(monthly[0].total_km) : 0;
  const topAllTime = allTime.length ? Number(allTime[0].total_km) : 0;

  return (
    <>
      {/* ================= HERO：巨型數字主導 ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div
          className="pointer-events-none absolute -right-[16%] -top-[40%] h-[640px] w-[640px] rounded-full blur-[135px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.45,
          }}
        />
        <div className="clip-notch pointer-events-none absolute -bottom-14 -left-24 h-64 w-64 bg-vital/10" />

        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="relative pb-14 pt-28 md:pt-36 lg:pb-16">
            <div className="absolute left-0 top-40 hidden lg:block">
              <span className="vlabel text-white/50">Rankings · Macau</span>
            </div>

            <div className="lg:pl-14">
              <span className="eyebrow">Leaderboard</span>

              <h1 className="mt-6 lg:-ml-[3vw] lg:w-[112%]">
                <span className="display-xl block text-white">排行榜</span>
                <span className="relative mt-1 block">
                  <span
                    aria-hidden
                    className="display-xl text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block"
                  >
                    Rankings
                  </span>
                  <span className="display-xl relative block text-vital-bright">
                    Rankings
                  </span>
                </span>
              </h1>

              <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
                <p className="text-base leading-relaxed text-white/70 lg:col-span-6">
                  月度榜以當月經後台確認的跑步里程排序；總榜則是會員累積的總里程與積分。
                  提交紀錄經後台確認後才會計入排名。
                </p>

                {/* 榜首大數字：整頁的主角 */}
                <div className="lg:col-span-5 lg:col-start-8 lg:border-l lg:border-white/10 lg:pl-8">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                    <Trophy size={14} className="text-vital-bright" />
                    {monthLabel(month)} 榜首里程
                  </div>
                  {monthly.length ? (
                    <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
                      <span className="stat-figure text-6xl leading-none text-vital-bright md:text-7xl">
                        <CountUp value={topKm} />
                      </span>
                      <span className="text-accent-blue mb-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                        km
                      </span>
                    </div>
                  ) : (
                    <div className="mt-4 stat-figure text-6xl leading-none text-white/25 md:text-7xl">
                      0
                    </div>
                  )}
                  <div className="mt-5 h-px w-16 bg-white/20" />
                  <p className="mt-5 text-sm leading-relaxed text-white/65">
                    {monthly.length
                      ? `本月已有 ${monthly.length} 位會員上榜，目標 ${RULES.MONTHLY_GOAL_KM} 公里。`
                      : "本月尚無已確認紀錄，成為第一位上榜者。"}
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
              {[
                {
                  value: String(monthly.length).padStart(2, "0"),
                  unit: "Runners",
                  label: "本月上榜人數",
                  accent: false,
                },
                {
                  value: formatKm(topAllTime),
                  unit: "km",
                  label: "總榜榜首里程",
                  accent: false,
                },
                {
                  value: String(RULES.MONTHLY_GOAL_KM),
                  unit: "km / Month",
                  label: "月度達標目標",
                  accent: true,
                },
              ].map((f) => (
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

      {/* ============ 月份切換（sticky）+ 搜尋會員 + 月度榜 + 累積總榜 ============
           F-L1 / F-L2 / F-L3 全部喺 LeaderboardSearch 入面（client component，照樣 SSR，
           關掉 JS 榜單內容仍然出得到） */}
      <LeaderboardSearch
        months={months}
        activeMonth={month}
        monthLabel={monthLabel(month)}
        monthly={monthly}
        allTime={allTime}
        goalKm={RULES.MONTHLY_GOAL_KM}
        prevRanks={prevRanks}
        prevAvailable={prevMonthly.length > 0}
      />

      {/* ============ 收尾：巨型宣言 ============ */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -bottom-64 -right-20 h-[560px] w-[560px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, var(--color-vital), transparent 68%)",
            opacity: 0.14,
          }}
        />
        <span
          aria-hidden
          className="display-hero text-outline pointer-events-none absolute -bottom-8 left-[-4%] select-none opacity-40"
        >
          MSW
        </span>
        <div className="container-msw section-pad relative">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <span className="eyebrow">Your Turn</span>
              <h2 className="mt-6 text-4xl font-black leading-[0.98] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
                下一個名字，換你上板
              </h2>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/70">
                每月累積 {RULES.MONTHLY_GOAL_KM} 公里、每週固定訓練，積分與里程都看得見。
              </p>
            </div>
            <div className="flex flex-col items-start gap-4 lg:col-span-5 lg:pl-10">
              <Link href="/run" className="btn-base btn-vital btn-slab">
                上傳跑步紀錄 <ArrowRight size={17} />
              </Link>
              <Link href="/training" className="btn-base btn-ghost btn-slab">
                報名訓練場次
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
