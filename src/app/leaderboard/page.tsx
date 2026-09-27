import Link from "next/link";
import { ArrowRight, CalendarDays, Medal, Trophy } from "lucide-react";
import {
  getCachedAllTimeLeaderboard,
  getCachedMonthlyLeaderboard,
} from "@/lib/queries";
import { RULES } from "@/lib/config";
import { currentMonth, formatKm, monthLabel, recentMonths } from "@/lib/utils";
import type { LeaderRow } from "@/lib/types";

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

  const [monthly, allTime] = await Promise.all([
    getCachedMonthlyLeaderboard(month, 50),
    getCachedAllTimeLeaderboard(20),
  ]);

  const months = recentMonths(6);
  const topKm = monthly.length ? Number(monthly[0].total_km) : 0;
  const topAllTime = allTime.length ? Number(allTime[0].total_km) : 0;
  const [podium1, podium2, podium3, ...rest] = monthly;

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
                        {formatKm(topKm)}
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

      {/* ============ 月份切換：sticky 層疊 ============ */}
      <div className="sticky top-16 z-30 border-b border-white/10 glass md:top-20">
        <div className="container-msw flex items-center gap-4 overflow-x-auto py-3">
          <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50 sm:flex">
            <CalendarDays size={14} />
            月份
          </span>
          <div className="flex shrink-0 gap-2">
            {months.map((mm) => {
              const active = mm === month;
              return (
                <Link
                  key={mm}
                  href={`/leaderboard?m=${mm}`}
                  aria-current={active ? "page" : undefined}
                  className={`stat-figure inline-flex min-h-11 items-center px-4 text-sm transition ${
                    active
                      ? "slab bg-vital text-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {mm.replace("-", ".")}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* ============ 月度里程榜：前三名 podium + ledger ============ */}
      <section className="container-msw section-pad">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
          <div>
            <span className="eyebrow">Monthly Ranking</span>
            <h2 className="display-xl mt-5">{monthLabel(month)} 里程榜</h2>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
            目標 {RULES.MONTHLY_GOAL_KM} km
          </span>
        </div>

        {monthly.length ? (
          <>
            {/* 前三名：層次化 podium（#1 最高最亮） */}
            <div className="stagger mt-12 grid gap-5 lg:grid-cols-3">
              {[podium1, podium2, podium3]
                .filter((r): r is LeaderRow => Boolean(r))
                .map((r, i) => (
                  <PodiumCard
                    key={r.user_id}
                    row={r}
                    rank={i + 1}
                    goalKm={RULES.MONTHLY_GOAL_KM}
                  />
                ))}
            </div>

            {/* 第 4 名之後：節奏式 ledger 排版 */}
            {rest.length > 0 && (
              <div className="mt-12 overflow-x-auto">
                <table className="ledger min-w-[600px]">
                  <thead>
                    <tr>
                      <th className="w-24">名次</th>
                      <th>會員</th>
                      <th className="w-40">達標進度</th>
                      <th className="w-32 text-right">里程</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((r, i) => (
                      <RankRow
                        key={r.user_id}
                        row={r}
                        rank={i + 4}
                        goalKm={RULES.MONTHLY_GOAL_KM}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="mt-10 border-y border-white/10 px-6 py-16 text-center">
            <Medal size={30} className="mx-auto text-white/40" />
            <p className="mt-4 text-sm text-white/70">
              本月尚無已確認紀錄，成為第一位上榜者！
            </p>
            <Link href="/run" className="btn-base btn-vital btn-slab mt-6">
              上傳跑步紀錄 <ArrowRight size={17} />
            </Link>
          </div>
        )}
      </section>

      {/* ============ 累積總榜：透明層次，與月度榜區分 ============ */}
      <section className="relative border-y border-ink-line bg-ink-soft">
        <div className="noise-overlay" />
        <div className="container-msw section-pad relative">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
            <div>
              <span className="eyebrow">All Time</span>
              <h2 className="display-xl mt-5">累積總榜</h2>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
              總里程 / 積分
            </span>
          </div>

          {allTime.length ? (
            <div className="stagger mt-12 grid gap-px sm:grid-cols-2">
              {allTime.map((r, i) => (
                <div
                  key={r.user_id}
                  className="group row-em flex items-center gap-5 border-b border-white/10 py-5 pr-4 transition-colors duration-500 hover:bg-white/[0.03]"
                >
                  <span className="rank-figure w-14 shrink-0 text-4xl text-white/25 md:text-5xl">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{r.name}</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
                      {r.runs} 次提交 · {r.points} 積分
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="stat-figure text-2xl text-white md:text-3xl">
                      {formatKm(r.total_km)}
                    </div>
                    <div className="text-accent-blue text-[11px] font-semibold uppercase tracking-[0.22em]">
                      km
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-10 border-y border-white/10 px-6 py-16 text-center text-sm text-white/70">
              尚無資料。
            </div>
          )}
        </div>
      </section>

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

/** 前三名：層次化卡片（#1 強調色描邊 + 更高抬升） */
function PodiumCard({
  row,
  rank,
  goalKm,
}: {
  row: LeaderRow;
  rank: number;
  goalKm: number;
}) {
  const pct = goalKm > 0 ? Math.min(100, (row.total_km / goalKm) * 100) : 0;
  const isFirst = rank === 1;
  const accentClass =
    rank === 1
      ? "border-vital/60 bg-vital/[0.06]"
      : rank === 2
        ? "border-white/20 bg-ink/50"
        : "border-white/10 bg-transparent";

  return (
    <article
      className={`group relative overflow-hidden border p-7 z-raise ${accentClass} ${
        isFirst ? "lg:-mt-6" : rank === 3 ? "lg:mt-6" : ""
      }`}
    >
      {/* 巨型名次數字 */}
      <span
        aria-hidden
        className={`rank-figure pointer-events-none absolute -top-5 right-4 text-8xl transition-colors duration-500 md:text-9xl ${
          isFirst ? "text-vital/25" : "text-white/[0.06]"
        }`}
      >
        {String(rank).padStart(2, "0")}
      </span>

      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span
            className={`slab inline-flex items-center gap-1.5 border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
              isFirst
                ? "border-vital/60 bg-vital/15 text-vital-bright"
                : "border-white/15 bg-white/5 text-white/70"
            }`}
          >
            {rank === 1 ? <Trophy size={12} /> : <Medal size={12} />}
            Rank {rank}
          </span>
        </div>

        <h3 className="mt-6 truncate text-xl font-black tracking-tight">
          {row.name}
        </h3>
        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
          {row.runs} 次提交 · {row.points} 積分
        </div>

        <div className="mt-8 flex items-end gap-2">
          <span
            className={`stat-figure text-5xl leading-none md:text-6xl ${
              isFirst ? "text-vital-bright" : "text-white"
            }`}
          >
            {formatKm(row.total_km)}
          </span>
          <span className="text-accent-blue mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em]">
            km
          </span>
        </div>

        {/* 達標進度：細軌 */}
        <div className="mt-6">
          <div className="meter">
            <div className="meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
            <span>進度</span>
            <span className="tnum">{Math.round(pct)}%</span>
          </div>
        </div>
      </div>
    </article>
  );
}

/** 第 4 名之後：ledger 行 */
function RankRow({
  row,
  rank,
  goalKm,
}: {
  row: LeaderRow;
  rank: number;
  goalKm: number;
}) {
  const pct = goalKm > 0 ? Math.min(100, (row.total_km / goalKm) * 100) : 0;

  return (
    <tr className="row-em">
      <td>
        <span className="rank-figure text-2xl text-white/30">
          {String(rank).padStart(2, "0")}
        </span>
      </td>
      <td className="min-w-0">
        <div className="truncate font-semibold">{row.name}</div>
        <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          {row.runs} 次提交 · {row.points} 積分
        </div>
      </td>
      <td>
        <div className="meter max-w-[150px]">
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="tnum mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
          {Math.round(pct)}%
        </div>
      </td>
      <td className="text-right">
        <span className="stat-figure text-xl text-white">
          {formatKm(row.total_km)}
        </span>
        <span className="text-accent-blue ml-1 text-[11px] font-semibold uppercase tracking-[0.22em]">
          km
        </span>
      </td>
    </tr>
  );
}
