import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Medal,
  Route,
  Timer,
  Trophy,
} from "lucide-react";
import { HeroVisual } from "@/components/HeroVisual";
import {
  getCachedMonthlyLeaderboard,
  getCachedSiteStats,
  getSiteTheme,
  getCachedUpcomingSessions,
} from "@/lib/queries";
import { BRAND, DISCIPLINES, RULES } from "@/lib/config";
import { publicAssetUrl } from "@/lib/assets";
import { currentMonth, formatKm, monthLabel, weekdayLabel } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentProfile } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const month = currentMonth();
  const [stats, sessions, leaders, profile, theme] = await Promise.all([
    getCachedSiteStats(),
    getCachedUpcomingSessions(3),
    getCachedMonthlyLeaderboard(month, 5),
    getCurrentProfile(),
    getSiteTheme(),
  ]);

  const nextSession = sessions[0] ?? null;
  const isLoggedIn = Boolean(profile);

  // Hero 背景圖（後台設定）：有則顯示並覆上黑色遮罩，無則維持預設漸層 + 網格
  const heroBgUrl = publicAssetUrl(theme.hero_bg_path);
  const heroOverlayOpacity = theme.hero_overlay_opacity;

  return (
    <>
      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div className="hero-grid absolute inset-0 opacity-70" />
        <div
          className="pointer-events-none absolute -left-40 top-10 h-[520px] w-[520px] rounded-full blur-[120px]"
          style={{
            background:
              "radial-gradient(circle, rgba(0,71,171,0.55), transparent 65%)",
          }}
        />
        <div
          className="pointer-events-none absolute -right-32 bottom-0 h-[460px] w-[460px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, rgba(227,0,27,0.4), transparent 65%)",
          }}
        />
        {heroBgUrl && (
          <>
            <div
              className="absolute inset-0 bg-center bg-cover"
              style={{ backgroundImage: `url("${heroBgUrl}")` }}
            />
            <div
              className="absolute inset-0 bg-ink"
              style={{ opacity: heroOverlayOpacity }}
            />
          </>
        )}

        <div className="container-msw relative grid items-center gap-10 pb-20 pt-32 md:pb-28 md:pt-40 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="eyebrow">Macau Street Workout</span>
            <h1 className="mt-5 text-balance text-[2.7rem] font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.2rem]">
              MSW
              <span className="relative mx-2 inline-block text-vital">
                街健館
                <svg
                  viewBox="0 0 200 12"
                  className="absolute -bottom-2 left-0 w-full"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 8 C 50 2, 150 2, 198 7"
                    stroke="#E3001B"
                    strokeWidth="4"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/70 sm:text-xl">
              {BRAND.tagline}。每週一晚固定訓練、每月 {RULES.MONTHLY_GOAL_KM}{" "}
              公里跑步挑戰，每一次汗水都換算成積分與專屬優惠券。
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              {isLoggedIn ? (
                <>
                  <Link href="/dashboard" className="btn-base btn-vital">
                    我的帳戶 <ArrowRight size={18} />
                  </Link>
                  <Link href="/run" className="btn-base btn-ghost">
                    上傳跑步紀錄
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/signup" className="btn-base btn-vital">
                    立即加入會員 <ArrowRight size={18} />
                  </Link>
                  <Link href="/events" className="btn-base btn-ghost">
                    查看活動
                  </Link>
                </>
              )}
            </div>

            {nextSession && (
              <div className="mt-10 inline-flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">
                <CalendarDays size={20} className="text-vital" />
                <div>
                  <div className="text-xs text-white/50">下一場定期訓練</div>
                  <div className="font-semibold">
                    {nextSession.session_date}（週
                    {weekdayLabel(nextSession.session_date)}）{" "}
                    {RULES.TRAINING_TIME}
                  </div>
                </div>
                <Link
                  href="/training"
                  className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-blue-300 hover:text-blue-200"
                >
                  報名 <ChevronRight size={15} />
                </Link>
              </div>
            )}
          </div>

          <div className="relative mx-auto w-full max-w-lg">
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ============ 累積數據 ============ */}
      <section className="border-b border-ink-line bg-ink-soft">
        <div className="container-msw grid grid-cols-2 gap-6 py-12 md:grid-cols-4">
          <StatBlock
            value={formatKm(stats.total_km)}
            unit="km"
            label="累積跑步里程"
          />
          <StatBlock value={String(stats.members)} unit="人" label="MSW 會員" />
          <StatBlock
            value={String(stats.total_sessions)}
            unit="場"
            label="已開訓練場次"
          />
          <StatBlock
            value={String(RULES.MONTHLY_GOAL_KM)}
            unit="km"
            label="月度跑步目標"
          />
        </div>
      </section>

      {/* ============ 兩大核心活動 ============ */}
      <section className="container-msw py-20 md:py-28">
        <div className="max-w-2xl">
          <span className="eyebrow">Core Programs</span>
          <h2 className="section-title mt-4">兩大核心活動</h2>
          <p className="mt-4 leading-relaxed text-white/60">
            固定時間的團體訓練，加上可累積的月度跑步任務。前者建立紀律，後者累積成果。
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="card-dark relative overflow-hidden p-8">
            <div className="absolute right-0 top-0 h-40 w-40 rounded-bl-[100px] bg-cobalt/15" />
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cobalt text-xl">
                💪
              </div>
              <h3 className="mt-6 text-2xl font-bold">定期訓練活動</h3>
              <p className="mt-3 leading-relaxed text-white/60">
                逢
                <span className="font-semibold text-white">星期一</span>{" "}
                <span className="font-semibold text-vital">
                  {RULES.TRAINING_TIME}
                </span>
                ，於澳門街健館進行團體街頭健身訓練。現場簽到，後台確認後即可獲得{" "}
                <span className="font-semibold text-white">
                  {RULES.CHECKIN_POINTS} 積分
                </span>
                。
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-white/70">
                <li className="flex gap-2.5">
                  <Timer size={17} className="mt-0.5 shrink-0 text-vital" />{" "}
                  每週固定，可隨時報名當週場次
                </li>
                <li className="flex gap-2.5">
                  <Medal size={17} className="mt-0.5 shrink-0 text-vital" />{" "}
                  簽到一次 +{RULES.CHECKIN_POINTS} 分
                </li>
                <li className="flex gap-2.5">
                  <CalendarDays size={17} className="mt-0.5 shrink-0 text-vital" />{" "}
                  適合任何程度，教練現場調整強度
                </li>
              </ul>
              <Link href="/training" className="btn-base btn-cobalt mt-8">
                查看訓練場次 <ArrowRight size={17} />
              </Link>
            </div>
          </div>

          <div className="card-dark relative overflow-hidden p-8">
            <div className="absolute right-0 top-0 h-40 w-40 rounded-bl-[100px] bg-vital/15" />
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-vital text-xl">
                🏃
              </div>
              <h3 className="mt-6 text-2xl font-bold">月度跑步挑戰</h3>
              <p className="mt-3 leading-relaxed text-white/60">
                上傳跑步 app 截圖並填寫公里數，後台人工確認後計入累積。當月滿{" "}
                <span className="font-semibold text-vital">
                  {RULES.MONTHLY_GOAL_KM} 公里
                </span>
                ，即完成任務並獲得專屬優惠券。
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-white/70">
                <li className="flex gap-2.5">
                  <Route size={17} className="mt-0.5 shrink-0 text-cobalt-bright" />{" "}
                  每公里 +{RULES.POINTS_PER_KM} 積分
                </li>
                <li className="flex gap-2.5">
                  <Trophy size={17} className="mt-0.5 shrink-0 text-cobalt-bright" />{" "}
                  達標額外 +{RULES.MONTHLY_BONUS_POINTS} 分
                </li>
                <li className="flex gap-2.5">
                  <Medal size={17} className="mt-0.5 shrink-0 text-cobalt-bright" />{" "}
                  月底結算，發放電子優惠券（含 QR Code）
                </li>
              </ul>
              <Link href="/run" className="btn-base btn-vital mt-8">
                上傳跑步紀錄 <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 打破界限 ============ */}
      <section className="bg-paper py-20 text-ink md:py-24">
        <div className="container-msw">
          <div className="max-w-2xl">
            <span className="eyebrow">Why MSW</span>
            <h2 className="section-title mt-4 text-ink">
              超越界限，讓訓練增加驅動力
            </h2>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              {
                icon: "🕐",
                title: "打破時間地區限制",
                desc: "每週固定有教練帶領的團體訓練；跑步任務則不限時間地點，隨時上傳紀錄。",
              },
              {
                icon: "🎁",
                title: "贏得專屬優惠券",
                desc: "月度達標即獲電子優惠券，用汗水換來的獎勵，在 MSW 街健館直接兌換。",
              },
              {
                icon: "👥",
                title: "與澳門的街健夥伴一起練",
                desc: "一群人練比一個人練走得遠。排行榜、積分、共同目標，讓訓練不再孤單。",
              },
            ].map((f) => (
              <div key={f.title} className="card-light p-7">
                <div className="text-3xl">{f.icon}</div>
                <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink/65">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 各類訓練 ============ */}
      <section className="container-msw py-20 md:py-28">
        <div className="max-w-2xl">
          <span className="eyebrow">Disciplines</span>
          <h2 className="section-title mt-4">各類訓練項目</h2>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {DISCIPLINES.map((d) => (
            <div
              key={d.title}
              className="card-dark p-7 transition duration-300 hover:-translate-y-1 hover:border-cobalt/50"
            >
              <div className="text-3xl">{d.icon}</div>
              <h3 className="mt-5 text-lg font-bold">{d.title}</h3>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                {d.sub}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                {d.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ 本月排行榜 ============ */}
      <section className="border-y border-ink-line bg-ink-soft py-20 md:py-24">
        <div className="container-msw grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <span className="eyebrow">Leaderboard</span>
            <h2 className="section-title mt-4">{monthLabel(month)}排行榜</h2>
            <p className="mt-4 max-w-md leading-relaxed text-white/60">
              依當月已確認的跑步里程排序。提交紀錄經後台確認後才會計入排名。
            </p>
            <Link href="/leaderboard" className="btn-base btn-ghost mt-8">
              查看完整排行榜 <ArrowRight size={17} />
            </Link>
          </div>

          <div className="card-dark overflow-hidden">
            {leaders.length ? (
              <ol className="divide-y divide-ink-line">
                {leaders.map((l, i) => (
                  <li key={l.user_id} className="flex items-center gap-4 px-5 py-4">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black ${
                        i === 0
                          ? "bg-vital text-white"
                          : i === 1
                            ? "bg-white/20 text-white"
                            : i === 2
                              ? "bg-amber-700/60 text-white"
                              : "bg-white/5 text-white/50"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{l.name}</div>
                      <div className="text-xs text-white/45">
                        {l.runs} 次提交 · {l.points} 積分
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-blue-300">
                        {formatKm(l.total_km)}
                      </div>
                      <div className="text-[11px] text-white/40">km</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="px-6 py-14 text-center text-sm text-white/45">
                {isSupabaseConfigured
                  ? "本月尚無已確認的跑步紀錄，成為第一位上榜者！"
                  : "尚未連接 Supabase，連接後這裡會顯示排行榜。"}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="relative overflow-hidden py-24">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 0%, rgba(0,71,171,0.35), transparent 60%)",
          }}
        />
        <div className="container-msw relative text-center">
          <h2 className="section-title text-balance">
            {isLoggedIn ? "繼續把汗水換成積分" : "準備好開始累積了嗎？"}
          </h2>
          <p className="mx-auto mt-5 max-w-xl leading-relaxed text-white/60">
            {isLoggedIn
              ? "本月里程與積分持續累積中，記得定期上傳跑步紀錄與報名訓練。"
              : "註冊只需一分鐘。加入後即可報名訓練、上傳跑步紀錄、追蹤積分與優惠券。"}
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            {isLoggedIn ? (
              <>
                <Link href="/run" className="btn-base btn-vital">
                  上傳跑步紀錄 <ArrowRight size={18} />
                </Link>
                <Link href="/training" className="btn-base btn-ghost">
                  報名訓練場次
                </Link>
              </>
            ) : (
              <>
                <Link href="/signup" className="btn-base btn-vital">
                  免費註冊會員 <ArrowRight size={18} />
                </Link>
                <Link href="/login" className="btn-base btn-ghost">
                  我已有帳號
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function StatBlock({
  value,
  unit,
  label,
}: {
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div className="px-2 py-4 text-center md:text-left">
      <div className="flex items-baseline justify-center gap-1.5 md:justify-start">
        <span className="text-4xl font-black tracking-tight md:text-5xl">
          {value}
        </span>
        <span className="text-sm font-semibold text-vital">{unit}</span>
      </div>
      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-white/45">
        {label}
      </div>
    </div>
  );
}
