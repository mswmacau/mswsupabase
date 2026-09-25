import Link from "next/link";
import { ArrowRight, CalendarDays, Gift, Route, Users } from "lucide-react";
import { RULES } from "@/lib/config";
import { currentMonth, monthLabel } from "@/lib/utils";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getPublishedEvents } from "@/lib/queries";
import { EventCard } from "@/components/EventCard";

export const metadata = { title: "活動總覽" };
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const month = currentMonth();
  // FE-14 + PM 拍板：保留 getCurrentProfile()，CTA 依登入狀態切換
  const [events, profile] = await Promise.all([
    getPublishedEvents(),
    getCurrentProfile(),
  ]);
  const isLoggedIn = Boolean(profile);

  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw">
        <div className="max-w-2xl">
          <span className="eyebrow">Events</span>
          <h1 className="section-title mt-4">各類活動</h1>
          <p className="mt-4 leading-relaxed text-white/60">
            MSW 街健館以「固定訓練 + 可累積任務」兩條主線運作。無論你是想每週動起來，
            還是想用一個月的時間累積 {RULES.MONTHLY_GOAL_KM} 公里，這裡都有適合你的節奏。
          </p>
        </div>

        {events.length > 0 ? (
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        ) : (
          <>
            {/* ====== Fallback：與舊靜態頁完全一致（FE-14 ③） ====== */}
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              {/* 定期訓練 */}
              <article className="card-dark overflow-hidden">
                <div className="relative h-44 overflow-hidden border-b border-ink-line bg-gradient-to-br from-cobalt/40 via-ink-soft to-ink">
                  <div className="hero-grid absolute inset-0 opacity-40" />
                  <div className="relative flex h-full items-end p-7">
                    <span className="rounded-full bg-vital px-3 py-1 text-xs font-bold">
                      每週固定
                    </span>
                  </div>
                </div>
                <div className="p-7">
                  <h2 className="text-2xl font-bold">定期訓練活動</h2>
                  <p className="mt-3 leading-relaxed text-white/60">
                    逢星期一 {RULES.TRAINING_TIME}，團體街頭健身訓練。現場簽到，後台確認後獲得{" "}
                    {RULES.CHECKIN_POINTS} 積分。
                  </p>
                  <ul className="mt-5 space-y-2.5 text-sm text-white/65">
                    <li className="flex items-center gap-2.5">
                      <CalendarDays size={16} className="shrink-0 text-vital" />
                      逢星期一 · {RULES.TRAINING_TIME}
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Users size={16} className="shrink-0 text-vital" />
                      團體訓練，適合任何程度
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Gift size={16} className="shrink-0 text-vital" />
                      每次簽到 +{RULES.CHECKIN_POINTS} 積分
                    </li>
                  </ul>
                  <Link href="/training" className="btn-base btn-cobalt mt-7 w-full">
                    查看場次與報名 <ArrowRight size={17} />
                  </Link>
                </div>
              </article>

              {/* 月度跑步 */}
              <article className="card-dark overflow-hidden">
                <div className="relative h-44 overflow-hidden border-b border-ink-line bg-gradient-to-br from-vital/40 via-ink-soft to-ink">
                  <div className="hero-grid absolute inset-0 opacity-40" />
                  <div className="relative flex h-full items-end p-7">
                    <span className="rounded-full bg-cobalt px-3 py-1 text-xs font-bold">
                      {monthLabel(month)}挑戰
                    </span>
                  </div>
                </div>
                <div className="p-7">
                  <h2 className="text-2xl font-bold">一個月累積跑步</h2>
                  <p className="mt-3 leading-relaxed text-white/60">
                    上傳跑步截圖並填寫公里數，後台人工確認。當月累積達{" "}
                    {RULES.MONTHLY_GOAL_KM} 公里即完成任務，月底發放優惠券。
                  </p>
                  <ul className="mt-5 space-y-2.5 text-sm text-white/65">
                    <li className="flex items-center gap-2.5">
                      <Route size={16} className="shrink-0 text-cobalt-bright" />
                      每公里 +{RULES.POINTS_PER_KM} 積分
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Users size={16} className="shrink-0 text-cobalt-bright" />
                      不限地點，上傳截圖即可
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Gift size={16} className="shrink-0 text-cobalt-bright" />
                      達標 +{RULES.MONTHLY_BONUS_POINTS} 分與電子優惠券
                    </li>
                  </ul>
                  <Link href="/run" className="btn-base btn-vital mt-7 w-full">
                    上傳跑步紀錄 <ArrowRight size={17} />
                  </Link>
                </div>
              </article>
            </div>

            {/* 流程 */}
            <div className="mt-20">
              <h2 className="text-2xl font-bold">參加流程</h2>
              <div className="mt-8 grid gap-5 md:grid-cols-4">
                {[
                  { n: "01", t: "註冊會員", d: "用電郵註冊，一分鐘完成。" },
                  { n: "02", t: "報名訓練 / 上傳紀錄", d: "選擇週一場次報名，或上傳跑步截圖。" },
                  { n: "03", t: "後台確認", d: "管理員核對簽到與截圖，確認後入帳。" },
                  { n: "04", t: "累積領獎", d: "積分與里程累積，達標領取優惠券。" },
                ].map((s) => (
                  <div key={s.n} className="card-dark p-6">
                    <div className="text-3xl font-black text-white/15">{s.n}</div>
                    <h3 className="mt-3 font-bold">{s.t}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/55">{s.d}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="mt-16 rounded-2xl border border-ink-line bg-gradient-to-r from-cobalt/20 to-vital/20 p-8 text-center md:p-12">
              <h2 className="section-title text-balance">現在就開始累積</h2>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                {profile ? (
                  <>
                    <Link href="/run" className="btn-base btn-vital">
                      上傳跑步紀錄 <ArrowRight size={17} />
                    </Link>
                    <Link href="/training" className="btn-base btn-ghost">
                      報名訓練場次
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/signup" className="btn-base btn-vital">
                      免費註冊會員 <ArrowRight size={17} />
                    </Link>
                    <Link href="/login" className="btn-base btn-ghost">
                      我已有帳號
                    </Link>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
