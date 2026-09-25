import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  Coins,
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

  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw">
        <div className="max-w-2xl">
          <span className="eyebrow">My Account</span>
          <h1 className="section-title mt-4">
            你好，{profile.display_name ?? "會員"}
          </h1>
        </div>

        {/* 會員卡 */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="relative overflow-hidden rounded-2xl border border-ink-line bg-gradient-to-br from-cobalt/35 via-ink-soft to-ink-soft p-7 md:p-8">
            <div className="hero-grid absolute inset-0 opacity-30" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-vital text-xl font-black">
                  {(profile.display_name ?? "M").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="text-xl font-bold">
                    {profile.display_name ?? "MSW 會員"}
                  </div>
                  <div className="text-xs text-white/45">
                    加入於 {formatDate(profile.created_at)}
                  </div>
                </div>
                {profile.role === "admin" && (
                  <Link
                    href="/admin"
                    className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs font-semibold"
                  >
                    管理員 · 進入後台
                  </Link>
                )}
              </div>

              <div className="mt-8 grid grid-cols-3 gap-4">
                <Metric
                  icon={<Coins size={15} />}
                  label="積分"
                  value={String(profile.points)}
                />
                <Metric
                  icon={<Route size={15} />}
                  label="總里程"
                  value={`${formatKm(profile.total_km)} km`}
                />
                <Metric
                  icon={<Ticket size={15} />}
                  label="可用優惠券"
                  value={String(activeCoupons)}
                />
              </div>
            </div>
          </div>

          {/* 本月進度 */}
          <div className="card-dark p-7 md:p-8">
            <div className="text-xs uppercase tracking-[0.18em] text-white/45">
              {monthLabel(month)} 跑步進度
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-black text-blue-300">
                {formatKm(monthKm.km)}
              </span>
              <span className="text-sm font-semibold text-white/45">
                / {RULES.MONTHLY_GOAL_KM} km
              </span>
            </div>

            <div className="mt-5">
              <ProgressBar
                value={monthKm.km}
                max={RULES.MONTHLY_GOAL_KM}
                hint={`${Math.round((monthKm.km / RULES.MONTHLY_GOAL_KM) * 100)}%`}
              />
            </div>

            <p className="mt-4 text-xs leading-relaxed text-white/45">
              {monthKm.km >= RULES.MONTHLY_GOAL_KM
                ? "已達標！月底結算後會自動發放優惠券。"
                : `還差 ${formatKm(RULES.MONTHLY_GOAL_KM - monthKm.km)} 公里達標。`}
              {monthKm.pendingKm > 0 && (
                <span className="ml-1 text-amber-300">
                  另有 {formatKm(monthKm.pendingKm)} km 待後台確認。
                </span>
              )}
            </p>

            <Link href="/run" className="btn-base btn-vital mt-6 w-full text-sm">
              上傳跑步紀錄 <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {/* 快速連結 */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
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

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {/* 最近提交 */}
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">最近的跑步提交</h2>
              <Link
                href="/run"
                className="text-sm font-semibold text-blue-300 hover:text-blue-200"
              >
                全部
              </Link>
            </div>
            <div className="mt-5">
              <RunSubmissionList
                items={submissions}
                emptyText="還沒有提交紀錄，去 /run 上傳第一次吧。"
              />
            </div>
          </div>

          <div className="space-y-8">
            {/* 積分明細 */}
            <div>
              <h2 className="text-xl font-bold">積分明細</h2>
              <div className="mt-5">
                {points.length ? (
                  <ul className="divide-y divide-ink-line rounded-xl border border-ink-line">
                    {points.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm">{p.reason}</div>
                          <div className="text-xs text-white/40">
                            {formatDate(p.created_at)}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-sm font-bold ${
                            p.delta >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {p.delta >= 0 ? "+" : ""}
                          {p.delta}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/45">
                    尚無積分紀錄。
                  </div>
                )}
              </div>
            </div>

            {/* 訓練紀錄 */}
            <div>
              <h2 className="text-xl font-bold">近期訓練紀錄</h2>
              <div className="mt-5">
                {checkins.length ? (
                  <ul className="divide-y divide-ink-line rounded-xl border border-ink-line">
                    {checkins.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <div>
                          <div className="text-sm">
                            {c.session?.session_date ?? "—"} ·{" "}
                            {c.session?.title ?? ""}
                          </div>
                          <div className="text-xs text-white/40">
                            {formatDate(c.created_at)}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-semibold ${
                            c.status === "approved"
                              ? "text-emerald-400"
                              : c.status === "rejected"
                                ? "text-red-400"
                                : "text-amber-400"
                          }`}
                        >
                          {c.status === "approved"
                            ? `已確認 +${RULES.CHECKIN_POINTS}`
                            : c.status === "rejected"
                              ? "已駁回"
                              : "待確認"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/45">
                    尚無訓練紀錄。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-1.5 text-xs text-white/45">
        {icon} {label}
      </div>
      <div className="mt-1.5 text-xl font-black">{value}</div>
    </div>
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
      className="card-dark flex items-center gap-4 p-5 transition hover:border-cobalt/50"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-vital">
        {icon}
      </span>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-xs text-white/45">{desc}</div>
      </div>
      <ArrowRight size={16} className="ml-auto text-white/30" />
    </Link>
  );
}
