import Link from "next/link";
import { Medal, Trophy } from "lucide-react";
import {
  getAllTimeLeaderboard,
  getMonthlyLeaderboard,
} from "@/lib/queries";
import { RULES } from "@/lib/config";
import { currentMonth, formatKm, monthLabel, recentMonths } from "@/lib/utils";

export const metadata = { title: "排行榜" };
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();

  const [monthly, allTime] = await Promise.all([
    getMonthlyLeaderboard(month, 50),
    getAllTimeLeaderboard(20),
  ]);

  const months = recentMonths(6);

  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw">
        <div className="max-w-2xl">
          <span className="eyebrow">Leaderboard</span>
          <h1 className="section-title mt-4">排行榜</h1>
          <p className="mt-4 leading-relaxed text-white/60">
            月度榜以當月經後台確認的跑步里程排序；總榜則是會員累積的總里程與積分。
          </p>
        </div>

        {/* 月份切換 */}
        <div className="mt-8 flex flex-wrap gap-2">
          {months.map((mm) => (
            <Link
              key={mm}
              href={`/leaderboard?m=${mm}`}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
                mm === month
                  ? "border-vital bg-vital text-white"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              {monthLabel(mm)}
            </Link>
          ))}
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          {/* 月度 */}
          <div className="card-dark overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-ink-line px-6 py-5">
              <Trophy size={19} className="text-vital" />
              <h2 className="font-bold">{monthLabel(month)} 里程榜</h2>
              <span className="ml-auto text-xs text-white/40">
                目標 {RULES.MONTHLY_GOAL_KM} km
              </span>
            </div>

            {monthly.length ? (
              <ol className="divide-y divide-ink-line">
                {monthly.map((r, i) => (
                  <li key={r.user_id} className="flex items-center gap-4 px-6 py-4">
                    <RankBadge rank={i + 1} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{r.name}</div>
                      <div className="text-xs text-white/45">
                        {r.runs} 次提交 · {r.points} 積分
                      </div>
                      {RULES.MONTHLY_GOAL_KM > 0 && (
                        <div className="mt-1.5 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cobalt to-vital"
                            style={{
                              width: `${Math.min(100, (r.total_km / RULES.MONTHLY_GOAL_KM) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-blue-300">
                        {formatKm(r.total_km)}
                      </div>
                      <div className="text-[11px] text-white/40">km</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="px-6 py-14 text-center text-sm text-white/45">
                本月尚無已確認紀錄。
              </div>
            )}
          </div>

          {/* 總榜 */}
          <div className="card-dark overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-ink-line px-6 py-5">
              <Medal size={19} className="text-cobalt-bright" />
              <h2 className="font-bold">累積總榜</h2>
              <span className="ml-auto text-xs text-white/40">總里程 / 積分</span>
            </div>

            {allTime.length ? (
              <ol className="divide-y divide-ink-line">
                {allTime.map((r, i) => (
                  <li key={r.user_id} className="flex items-center gap-4 px-6 py-4">
                    <RankBadge rank={i + 1} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{r.name}</div>
                      <div className="text-xs text-white/45">{r.points} 積分</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{formatKm(r.total_km)}</div>
                      <div className="text-[11px] text-white/40">km</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="px-6 py-14 text-center text-sm text-white/45">
                尚無資料。
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const style =
    rank === 1
      ? "bg-vital text-white"
      : rank === 2
        ? "bg-white/20 text-white"
        : rank === 3
          ? "bg-amber-700/70 text-white"
          : "bg-white/5 text-white/50";
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black ${style}`}
    >
      {rank}
    </span>
  );
}
