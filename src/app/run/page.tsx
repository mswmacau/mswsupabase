import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Info, Trophy } from "lucide-react";
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

  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw">
        {/* Header */}
        <div className="max-w-2xl">
          <span className="eyebrow">Monthly Running Challenge</span>
          <h1 className="section-title mt-4">月度跑步挑戰</h1>
          <p className="mt-4 leading-relaxed text-white/60">
            上傳跑步 app 截圖並填寫公里數，後台人工確認後計入累積。當月滿{" "}
            <span className="font-semibold text-vital">{goal} 公里</span>
            即完成任務，可獲得專屬電子優惠券。
          </p>
        </div>

        {/* 進度卡 */}
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="card-dark p-7 md:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-white/45">
                  {monthLabel(month)} 累積里程
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-5xl font-black tracking-tight text-blue-300">
                    {formatKm(monthData.km)}
                  </span>
                  <span className="text-lg font-semibold text-white/45">
                    / {goal} km
                  </span>
                </div>
              </div>
              <div className="text-right text-sm text-white/55">
                <div>本月剩餘 {daysLeftInMonth()} 天</div>
                <div className="mt-1 text-xs text-white/40">
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
                hint={`${Math.round((monthData.km / goal) * 100)}%`}
              />
            </div>

            <div className="mt-7 grid gap-4 sm:grid-cols-3">
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

          {/* 規則說明 */}
          <div className="card-dark p-7 md:p-8">
            <h2 className="text-lg font-bold">上傳規則</h2>
            <ol className="mt-4 space-y-3.5 text-sm leading-relaxed text-white/65">
              <li>
                <span className="font-semibold text-white">1.</span>{" "}
                完成跑步後，在 app（Strava / Nike Run Club /
                咕咚等）截圖顯示距離的畫面。
              </li>
              <li>
                <span className="font-semibold text-white">2.</span>{" "}
                上傳截圖並填寫本次公里數，選擇要計入的月份。
              </li>
              <li>
                <span className="font-semibold text-white">3.</span>{" "}
                管理員核對截圖與數字，確認後里程與積分才會入帳。
              </li>
              <li>
                <span className="font-semibold text-white">4.</span>{" "}
                當月累積達 {goal} 公里，月底由後台統一發放優惠券。
              </li>
            </ol>

            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-cobalt/40 bg-cobalt/10 px-4 py-3 text-xs leading-relaxed text-blue-200">
              <Info size={16} className="mt-0.5 shrink-0" />
              <span>
                單次提交上限 {RULES.MAX_KM_PER_SUBMISSION} 公里，圖片上限{" "}
                {RULES.MAX_UPLOAD_SOURCE_MB}MB。里程須為本人實際完成，偽造紀錄將取消資格。
              </span>
            </div>
          </div>
        </div>

        {/* 上傳區 */}
        <div className="mt-14 grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <h2 className="text-2xl font-bold">上傳跑步紀錄</h2>
            <p className="mt-2 text-sm text-white/55">
              同一個月可多次上傳，系統會自動累加。
            </p>

            <div className="mt-6">
              {profile ? (
                <RunUploadForm />
              ) : (
                <div className="card-dark p-8 text-center">
                  <div className="text-4xl">🔒</div>
                  <h3 className="mt-4 text-lg font-bold">請先登入會員</h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-white/55">
                    登入後才能上傳跑步紀錄並累積里程與積分。
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Link href="/login?next=/run" className="btn-base btn-vital">
                      會員登入
                    </Link>
                    <Link href="/signup" className="btn-base btn-ghost">
                      註冊新帳號
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">我的提交紀錄</h2>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1 text-sm font-semibold text-blue-300 hover:text-blue-200"
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
                <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/45">
                  登入後即可查看提交紀錄。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
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
    <div className="rounded-xl border border-ink-line bg-black/20 p-4">
      <div className="flex items-center gap-2 text-vital">
        {icon}
        <span className="text-sm font-bold">{title}</span>
      </div>
      <div className="mt-1.5 text-xs text-white/50">{desc}</div>
    </div>
  );
}
