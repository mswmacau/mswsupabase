import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Info,
  Lock,
  Trophy,
} from "lucide-react";
import { RunUploadForm } from "./RunUploadForm";
import { RunSubmissionList } from "@/components/RunSubmissionList";
import { ProgressBar } from "@/components/ProgressBar";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getUserMonthKm, getUserSubmissions } from "@/lib/queries";
import { RULES } from "@/lib/config";
import { currentMonth, daysLeftInMonth, formatKm, monthLabel } from "@/lib/utils";

export const metadata = { title: "月度跑步挑戰" };
export const dynamic = "force-dynamic";

export default async function RunPage() {
  const profile = await getCurrentProfile();
  const month = currentMonth();

  const monthData = profile
    ? await getUserMonthKm(profile.id, month)
    : { km: 0, runs: 0, pendingKm: 0 };
  const submissions = profile ? await getUserSubmissions(profile.id, 30) : [];

  const goal = RULES.MONTHLY_GOAL_KM;
  const remaining = Math.max(0, goal - monthData.km);
  const pct = Math.round((monthData.km / goal) * 100);

  /** 上傳流程：節奏式排版（01–04），不使用小卡片堆砌 */
  const STEPS = [
    "完成跑步後，在 app（Strava / Nike Run Club / 咕咚等）截圖顯示距離的畫面。",
    "上傳截圖並填寫本次公里數，選擇要計入的月份。",
    "管理員核對截圖與數字，確認後里程與積分才會入帳。",
    `當月累積達 ${goal} 公里，月底由後台統一發放優惠券。`,
  ];

  return (
    <>
      {/* ================= HERO：宣言式排版 + 單側光暈 ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div
          className="pointer-events-none absolute -right-[18%] -top-[42%] h-[600px] w-[600px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.4,
          }}
        />
        <div className="clip-notch pointer-events-none absolute -bottom-12 -left-24 h-64 w-64 bg-vital/10" />

        {/* 手工質感：細網格 + 噪點 */}
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="flex gap-6 pb-12 pt-28 md:pt-36 lg:pb-14">
            <span className="vlabel hidden shrink-0 text-white/40 lg:block">
              {goal} km / month
            </span>

            <div className="min-w-0 flex-1">
              <span className="eyebrow">Monthly Running Challenge</span>

              <h1 className="display-xl mt-6">
                <span className="block text-white">月度</span>
                <span className="mt-1 block">
                  <span className="text-outline">跑步</span>
                  <span className="text-vital-bright">挑戰</span>
                </span>
              </h1>

              <p className="mt-8 max-w-2xl text-base leading-relaxed text-white/70">
                上傳跑步 app 截圖並填寫公里數，後台人工確認後計入累積。當月滿{" "}
                <span className="font-semibold text-vital-bright">{goal} 公里</span>
                即完成任務，可獲得專屬電子優惠券。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section-pad">
        <div className="container-msw">
          {/* 進度 + 規則：不對稱分欄 */}
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="clip-notch-br card-dark z-raise p-7 md:p-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/55">
                    {monthLabel(month)} 累積里程
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="stat-figure text-5xl text-accent-blue md:text-6xl">
                      {formatKm(monthData.km)}
                    </span>
                    <span className="text-lg font-semibold text-white/60">
                      / {goal} km
                    </span>
                  </div>
                </div>
                <div className="text-right text-sm text-white/75">
                  <div className="stat-figure text-sm">
                    {daysLeftInMonth()}{" "}
                    <span className="font-sans text-xs font-medium text-white/55">
                      天 · 本月剩餘
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs text-white/60">
                    已確認 {monthData.runs} 次提交
                    {monthData.pendingKm > 0 && (
                      <span className="ml-1 text-amber-300">
                        · 待確認 {formatKm(monthData.pendingKm)} km
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <ProgressBar
                  value={monthData.km}
                  max={goal}
                  label={
                    remaining > 0
                      ? `還差 ${formatKm(remaining)} 公里達標`
                      : "已達標，等待月底結算發券"
                  }
                  hint={`${pct}%`}
                />
              </div>

              <div className="stagger mt-7 grid gap-3 sm:grid-cols-3">
                <RuleChip
                  icon={<Trophy size={16} />}
                  title={`+${RULES.MONTHLY_BONUS_POINTS} 分`}
                  desc="月度達標獎勵"
                />
                <RuleChip
                  icon={<CheckCircle2 size={16} />}
                  title={`+${RULES.POINTS_PER_KM} 分/km`}
                  desc="每公里積分"
                />
                <RuleChip
                  icon={<CalendarClock size={16} />}
                  title="月底結算"
                  desc="發放電子優惠券"
                />
              </div>
            </div>

            {/* 規則說明：節奏式排版 */}
            <div className="clip-notch card-dark z-raise p-7 md:p-8">
              <span className="eyebrow eyebrow-cobalt">How It Works</span>
              <ol className="mt-5">
                {STEPS.map((s, i) => (
                  <li
                    key={i}
                    className="flex gap-4 border-b border-[var(--line-fine)] py-3 last:border-b-0"
                  >
                    <span className="stat-figure flex-none text-sm text-vital-bright">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 text-sm leading-relaxed text-white/75">
                      {s}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="slab mt-6 flex items-start gap-2.5 border border-cobalt/40 bg-cobalt/10 px-4 py-3 text-xs leading-relaxed text-blue-200">
                <Info size={16} className="mt-0.5 shrink-0" />
                <span>
                  單次提交上限 {RULES.MAX_KM_PER_SUBMISSION} 公里，圖片上限{" "}
                  {RULES.MAX_UPLOAD_SOURCE_MB}MB。里程須為本人實際完成，偽造紀錄將取消資格。
                </span>
              </div>
            </div>
          </div>

          {/* 上傳區 + 提交紀錄 */}
          <div className="mt-16 grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <span className="eyebrow">Submit Record</span>
              <h2 className="mt-3 text-2xl font-black tracking-tight">
                上傳跑步紀錄
              </h2>
              <p className="mt-2 text-sm text-white/70">
                同一個月可多次上傳，系統會自動累加。
              </p>

              <div className="mt-6">
                {profile ? (
                  <RunUploadForm />
                ) : (
                  <div className="clip-notch-br card-dark p-8 text-center">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center border border-[var(--line-fine)] text-vital-bright">
                      <Lock size={22} />
                    </span>
                    <h3 className="mt-5 text-lg font-bold">請先登入會員</h3>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-white/70">
                      登入後才能上傳跑步紀錄並累積里程與積分。
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                      <Link
                        href="/login?next=/run"
                        className="btn-base btn-vital btn-slab min-h-11"
                      >
                        會員登入
                      </Link>
                      <Link
                        href="/signup"
                        className="btn-base btn-ghost btn-slab min-h-11"
                      >
                        註冊新帳號
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="eyebrow">My Submissions</span>
                  <h2 className="mt-3 text-2xl font-black tracking-tight">
                    我的提交紀錄
                  </h2>
                </div>
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-blue transition hover:text-white"
                >
                  我的帳戶 <ArrowRight size={15} />
                </Link>
              </div>
              <div className="mt-6">
                {profile ? (
                  <RunSubmissionList
                    items={submissions}
                    emptyText="尚未提交任何跑步紀錄，現在就上傳第一次吧！"
                  />
                ) : (
                  <div className="slab border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/70">
                    登入後即可查看提交紀錄。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function RuleChip({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="slab border border-[var(--line-fine)] bg-white/[0.03] px-4 py-3">
      <div className="flex items-center gap-2 text-vital-bright">
        {icon}
        <span className="stat-figure text-sm">{title}</span>
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.18em] text-white/50">
        {desc}
      </div>
    </div>
  );
}
