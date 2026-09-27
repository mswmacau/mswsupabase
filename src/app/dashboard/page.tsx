import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  Route,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getUserCheckins,
  getUserCoupons,
  getUserMonthKm,
  getUserPoints,
  getUserSubmissions,
} from "@/lib/queries";
import { ProgressBar } from "@/components/ProgressBar";
import { RunSubmissionList } from "@/components/RunSubmissionList";
import { RULES } from "@/lib/config";
import { currentMonth, formatDate, formatKm, monthLabel } from "@/lib/utils";

export const metadata = { title: "我的帳戶" };
export const dynamic = "force-dynamic";

/** 斜切角尺寸 */
const CUT_SM = { "--cut": "8px" } as CSSProperties;
const CUT_MD = { "--cut": "22px" } as CSSProperties;

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/dashboard");

  const month = currentMonth();
  const [monthKm, submissions, coupons, checkins, points] = await Promise.all([
    getUserMonthKm(profile.id, month),
    getUserSubmissions(profile.id, 5),
    getUserCoupons(profile.id),
    getUserCheckins(profile.id, 5),
    getUserPoints(profile.id, 10),
  ]);

  const activeCoupons = coupons.filter((c) => c.status === "active").length;
  const goal = RULES.MONTHLY_GOAL_KM;

  return (
    <section className="relative overflow-hidden pb-20 pt-24 md:pt-28">
      {/* 單側光暈（只在右上，刻意不對稱） */}
      <div
        className="pointer-events-none absolute -right-[15%] -top-[25%] h-[520px] w-[520px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 72%, transparent), transparent 66%)",
          opacity: 0.32,
        }}
      />
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        {/* ===== 標題：宣言式大字 ===== */}
        <div className="flex gap-6">
          <span className="vlabel hidden shrink-0 text-white/40 lg:block">
            My Account
          </span>
          <div className="min-w-0 flex-1">
            <span className="eyebrow">Member Dashboard</span>
            <h1 className="display-xl mt-6 break-words">
              <span className="block text-white">你好，</span>
              <span className="mt-1 block break-words text-vital-bright">
                {profile.display_name ?? "會員"}
              </span>
            </h1>
          </div>
        </div>

        {/* ===== 不對稱 Bento：積分／里程用超大數字主導 ===== */}
        <div className="mt-10 grid gap-4 lg:grid-cols-12">
          {/* 會員卡：積分超大數字（跨 2 列 2 行） */}
          <div
            style={CUT_MD}
            className="clip-notch-br relative overflow-hidden border border-[var(--line-fine)] bg-gradient-to-br from-cobalt/30 via-ink-soft to-ink-soft p-7 md:p-8 lg:col-span-5 lg:row-span-2"
          >
            <div className="hero-grid absolute inset-0 opacity-30" />
            <div className="noise-overlay" />

            <div className="relative flex h-full flex-col">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    style={CUT_SM}
                    className="clip-notch flex h-12 w-12 flex-none items-center justify-center bg-vital text-lg font-black"
                  >
                    {(profile.display_name ?? "M").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-lg font-bold">
                      {profile.display_name ?? "MSW 會員"}
                    </div>
                    <div className="text-xs text-white/60">
                      加入於 {formatDate(profile.created_at)}
                    </div>
                  </div>
                </div>

                {profile.role === "admin" && (
                  <Link
                    href="/admin"
                    className="slab flex-none border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold transition hover:border-white/50"
                  >
                    管理員 · 進入後台
                  </Link>
                )}
              </div>

              <div className="mt-auto pt-12">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">
                  總積分
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-3">
                  <span className="stat-figure text-6xl text-white md:text-7xl">
                    {profile.points}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-vital-bright">
                    pts
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--line-fine)] pt-4">
                  <div>
                    <div className="stat-figure text-2xl text-white">
                      {formatKm(profile.total_km)}
                      <span className="ml-1 font-sans text-[11px] font-medium text-white/55">
                        km
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/50">
                      累積里程
                    </div>
                  </div>
                  <div>
                    <div className="stat-figure text-2xl text-white">
                      {activeCoupons}
                      <span className="ml-1 font-sans text-[11px] font-medium text-white/55">
                        張
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/50">
                      可用優惠券
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 總里程 */}
          <div className="clip-notch card-dark z-raise flex flex-col justify-between p-6 lg:col-span-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <Route size={14} /> Total Distance
            </div>
            <div className="mt-8">
              <div className="stat-figure text-5xl text-accent-blue">
                {formatKm(profile.total_km)}
                <span className="ml-1 font-sans text-sm font-semibold text-white/55">
                  km
                </span>
              </div>
              <div className="mt-2 text-xs text-white/60">
                每公里 +{RULES.POINTS_PER_KM} 積分，後台確認後入帳
              </div>
            </div>
          </div>

          {/* 優惠券 */}
          <Link
            href="/dashboard/coupons"
            className="clip-notch card-dark z-raise flex flex-col justify-between p-6 transition hover:border-vital/50 lg:col-span-3"
          >
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <Ticket size={14} /> Coupons
            </div>
            <div className="mt-8">
              <div className="stat-figure text-5xl text-vital-bright">
                {activeCoupons}
                <span className="ml-1 font-sans text-sm font-semibold text-white/55">
                  / {coupons.length}
                </span>
              </div>
              <div className="mt-2 inline-flex items-center gap-1 text-xs text-white/60">
                查看券碼 <ArrowRight size={13} />
              </div>
            </div>
          </Link>

          {/* 本月進度 */}
          <div className="clip-notch-br card-dark z-raise p-6 lg:col-span-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">
                  {monthLabel(month)} 跑步進度
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className="stat-figure text-4xl text-accent-blue md:text-5xl">
                    {formatKm(monthKm.km)}
                  </span>
                  <span className="text-sm font-semibold text-white/55">
                    / {goal} km
                  </span>
                </div>
              </div>
              <span className="stat-figure flex-none text-2xl text-white">
                {Math.round((monthKm.km / goal) * 100)}
                <span className="ml-0.5 font-sans text-xs font-semibold text-white/55">
                  %
                </span>
              </span>
            </div>

            <div className="mt-5">
              <ProgressBar value={monthKm.km} max={goal} />
            </div>

            <p className="mt-4 text-xs leading-relaxed text-white/60">
              {monthKm.km >= goal
                ? "已達標！月底結算後會自動發放優惠券。"
                : `還差 ${formatKm(goal - monthKm.km)} 公里達標。`}
              {monthKm.pendingKm > 0 && (
                <span className="ml-1 text-amber-300">
                  另有 {formatKm(monthKm.pendingKm)} km 待後台確認。
                </span>
              )}
            </p>

            <Link
              href="/run"
              className="btn-base btn-vital btn-slab mt-6 min-h-11 w-full text-sm"
            >
              上傳跑步紀錄 <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {/* 快速連結 */}
        <div className="stagger mt-4 grid gap-4 sm:grid-cols-3">
          <QuickLink
            href="/training"
            icon={<CalendarDays size={18} />}
            title="定期訓練"
            desc="報名週一場次"
          />
          <QuickLink
            href="/dashboard/coupons"
            icon={<Ticket size={18} />}
            title="我的優惠券"
            desc={`${coupons.length} 張`}
          />
          <QuickLink
            href="/leaderboard"
            icon={<TrendingUp size={18} />}
            title="排行榜"
            desc="查看目前名次"
          />
        </div>

        {/* ===== 紀錄區：節奏式排版 ===== */}
        <div className="mt-12 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <span className="eyebrow">Recent Submissions</span>
                <h2 className="mt-3 text-xl font-black tracking-tight">
                  最近的跑步提交
                </h2>
              </div>
              <Link
                href="/run"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-blue transition hover:text-white"
              >
                全部 <ArrowRight size={15} />
              </Link>
            </div>
            <div className="mt-5">
              <RunSubmissionList
                items={submissions}
                emptyText="還沒有提交紀錄，去 /run 上傳第一次吧。"
              />
            </div>
          </div>

          <div className="lg:col-span-5">
            <span className="eyebrow">Points Ledger</span>
            <h2 className="mt-3 text-xl font-black tracking-tight">積分明細</h2>
            <div className="mt-5">
              {points.length ? (
                <div className="overflow-x-auto">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>項目</th>
                        <th className="text-right">積分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="truncate text-sm">{p.reason}</div>
                            <div className="mt-0.5 text-xs text-white/55">
                              {formatDate(p.created_at)}
                            </div>
                          </td>
                          <td className="text-right">
                            <span
                              className={`stat-figure text-base ${
                                p.delta >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {p.delta >= 0 ? "+" : ""}
                              {p.delta}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="slab border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/70">
                  尚無積分紀錄。
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-12">
            <span className="eyebrow">Training Log</span>
            <h2 className="mt-3 text-xl font-black tracking-tight">
              近期訓練紀錄
            </h2>
            <div className="mt-5">
              {checkins.length ? (
                <div className="overflow-x-auto">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>場次</th>
                        <th>簽到時間</th>
                        <th className="text-right">狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkins.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <div className="text-sm">
                              {c.session?.session_date ?? "—"}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-white/55">
                              {c.session?.title ?? ""}
                            </div>
                          </td>
                          <td className="text-xs text-white/60">
                            {formatDate(c.created_at)}
                          </td>
                          <td className="text-right">
                            <span
                              className={`slab inline-flex items-center border px-2.5 py-1 text-xs font-semibold ${
                                c.status === "approved"
                                  ? "border-emerald-500/40 text-emerald-300"
                                  : c.status === "rejected"
                                    ? "border-red-500/40 text-red-300"
                                    : "border-amber-500/40 text-amber-300"
                              }`}
                            >
                              {c.status === "approved"
                                ? `已確認 +${RULES.CHECKIN_POINTS}`
                                : c.status === "rejected"
                                  ? "已駁回"
                                  : "待確認"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="slab border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/70">
                  尚無訓練紀錄。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="slab z-raise flex items-center gap-4 border border-[var(--line-fine)] bg-white/[0.03] p-5"
    >
      <span className="clip-slab flex h-10 w-10 flex-none items-center justify-center bg-vital/15 text-vital-bright">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="truncate text-xs text-white/60">{desc}</div>
      </div>
      <ArrowRight size={16} className="ml-auto flex-none text-white/50" />
    </Link>
  );
}
