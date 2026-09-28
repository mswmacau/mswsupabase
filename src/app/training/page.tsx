import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getCachedAllSessions, getUserCheckins } from "@/lib/queries";
import { SessionAction } from "@/components/SessionAction";
import { NextSessionCard } from "@/components/fx/NextSessionCard";
import { SessionFilter } from "@/components/fx/SessionFilter";
import { BRAND, RULES } from "@/lib/config";
import { formatDate, weekdayLabel } from "@/lib/utils";
import type { TrainingSession } from "@/lib/types";

export const metadata = { title: "定期訓練" };
export const dynamic = "force-dynamic";

/** 訓練開始 / 結束時間（"20:00 – 21:00" → "20:00" / "21:00"） */
const TRAINING_START = RULES.TRAINING_TIME.split("–")[0].trim();
const TRAINING_END = RULES.TRAINING_TIME.split("–")[1]?.trim() ?? "";

/** 跑馬燈：接續首頁語言，全大寫寬字距 */
const MARQUEE_ITEMS = [
  "Street Workout",
  `Mon ${TRAINING_START}`,
  `+${RULES.CHECKIN_POINTS} Points / Session`,
  "澳門 Macau",
  "All Levels Welcome",
  "Calisthenics",
];

/** Hero 數字三聯：大數字主導，不用小圖標堆砌 */
const HERO_FACTS = [
  { value: "01", unit: "Day / Week", label: "每週固定訓練日", accent: false },
  { value: TRAINING_START, unit: `To ${TRAINING_END}`, label: "訓練時段", accent: false },
  {
    value: `+${RULES.CHECKIN_POINTS}`,
    unit: "Points",
    label: "簽到一次入帳",
    accent: true,
  },
];

export default async function TrainingPage() {
  // FE-17：profile 與 sessions 平行發出，wall-clock 由加總變最大值
  const [profile, supabaseSessions] = await Promise.all([
    getCurrentProfile(),
    getCachedAllSessions(60),
  ]);
  const checkins = profile ? await getUserCheckins(profile.id, 60) : [];

  const myMap = new Map(checkins.map((c) => [c.session_id, c.status]));

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = supabaseSessions.filter(
    (s) => s.session_date >= today && s.status !== "cancelled"
  );

  return (
    <>
      {/* ================= HERO：宣言式排版 + 單側光暈 ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        {/* 單側大光暈（只在右上，刻意不對稱） */}
        <div
          className="pointer-events-none absolute -right-[18%] -top-[42%] h-[620px] w-[620px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.45,
          }}
        />
        {/* 左下用幾何色塊代替第二顆光暈，避免左右對稱 */}
        <div className="clip-notch pointer-events-none absolute -bottom-12 -left-24 h-64 w-64 bg-vital/10" />

        {/* 手工質感：細網格 + 噪點 */}
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="relative pb-14 pt-28 md:pt-36 lg:pb-16">
            {/* 豎排小標籤 */}
            <div className="absolute left-0 top-40 hidden lg:block">
              <span className="vlabel text-white/50">Monday Night Crew</span>
            </div>

            <div className="lg:pl-14">
              <span className="eyebrow">Weekly Training</span>

              <h1 className="mt-6 lg:-ml-[3vw] lg:w-[112%]">
                <span className="display-xl block text-white">定期訓練</span>
                <span className="relative mt-1 block">
                  {/* 錯位描邊副本：純裝飾 */}
                  <span
                    aria-hidden
                    className="display-xl text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block"
                  >
                    場次
                  </span>
                  <span className="display-xl relative block text-vital-bright">
                    場次
                  </span>
                </span>
              </h1>

              <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
                <p className="text-base leading-relaxed text-white/70 lg:col-span-6">
                  逢<span className="font-semibold text-white">星期一</span>{" "}
                  <span className="font-semibold text-vital-bright">
                    {RULES.TRAINING_TIME}
                  </span>
                  ，於 {BRAND.location}
                  {BRAND.name} 進行團體街頭健身訓練。現場簽到並經後台確認後，每次可獲得{" "}
                  <span className="font-semibold text-white">
                    {RULES.CHECKIN_POINTS} 積分
                  </span>
                  。
                </p>

                <div className="lg:col-span-5 lg:col-start-8 lg:border-l lg:border-white/10 lg:pl-8">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                    場次節奏
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-1">
                    <span className="stat-figure text-5xl leading-none text-white md:text-6xl">
                      MON
                    </span>
                    <span className="stat-figure text-outline text-4xl leading-none md:text-5xl">
                      {TRAINING_START}
                    </span>
                  </div>
                  <div className="mt-5 h-px w-16 bg-white/20" />
                  <p className="mt-5 text-sm leading-relaxed text-white/65">
                    固定時間，不用每次重新喬。教練現場依程度分組調整動作難度。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 大數字三聯：去卡片化，只靠髮絲線分隔 */}
        <div className="relative z-10 border-t border-white/10">
          <div className="container-msw">
            <div className="grid grid-cols-1 divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {HERO_FACTS.map((f) => (
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

        {/* 跑馬燈：細邊框上下包夾 */}
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

      {/* ============ 近期場次：標題 sticky，內容滾動覆蓋 ============ */}
      <section className="container-msw section-pad">
        {/* F-T1 / F-T2：下場訓練倒數卡（無場次時完全唔 render） */}
        {upcoming.length > 0 && <NextSessionCard session={upcoming[0]} />}

        <div className="grid gap-12 lg:grid-cols-12">
          {/* 左欄：sticky，隨右側內容滾動而停留在畫面中 */}
          <div className="lg:col-span-4">
            <div className="reveal-left lg:sticky lg:top-24">
              <span className="eyebrow">Upcoming Sessions</span>
              <h2 className="display-xl mt-5">近期場次</h2>
              <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/70">
                報名後於現場簽到，後台確認即入帳積分。適合任何程度，教練會依程度分組調整強度。
              </p>

              <div className="mt-10 flex items-end gap-3">
                <span className="stat-figure text-6xl leading-none text-vital-bright md:text-7xl">
                  {String(upcoming.length).padStart(2, "0")}
                </span>
                <span className="text-accent-blue mb-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                  場可報名
                </span>
              </div>
              <div className="mt-6 h-px w-16 bg-white/20" />
            </div>
          </div>

          {/* 右欄：場次網格，錯位入場 */}
          <div className="lg:col-span-8">
            {upcoming.length ? (
              // F-T3：月份篩選；SessionCard 原封不動，只係喺 client 端搬到 SessionFilter 內 render
              <SessionFilter
                items={upcoming.map((s) => ({
                  id: s.id,
                  sessionDate: s.session_date,
                  card: (
                    <SessionCard
                      key={s.id}
                      session={s}
                      myStatus={myMap.get(s.id) ?? null}
                      isLoggedIn={Boolean(profile)}
                    />
                  ),
                }))}
              />
            ) : (
              <div className="border-y border-white/10 px-6 py-16 text-center">
                <CalendarDays size={30} className="mx-auto text-white/45" />
                <p className="mt-4 text-sm text-white/70">
                  目前沒有已排定的場次。
                  {profile?.role === "admin" && (
                    <>
                      {" "}
                      <Link
                        href="/admin/sessions"
                        className="text-accent-blue hover:text-white"
                      >
                        到後台新增場次
                      </Link>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ 我的訓練紀錄：節奏式 ledger，不用預設表格樣式 ============ */}
      {profile && (
        <section className="relative border-y border-ink-line bg-ink-soft">
          <div className="noise-overlay" />
          <div className="container-msw section-pad relative">
            <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
              <div>
                <span className="eyebrow">My Records</span>
                <h2 className="display-xl mt-5">我的訓練紀錄</h2>
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                {String(checkins.length).padStart(2, "0")} Records
              </span>
            </div>

            <div className="mt-8 overflow-x-auto">
              {checkins.length ? (
                <table className="ledger min-w-[560px] text-sm">
                  <thead>
                    <tr>
                      <th className="w-44">日期</th>
                      <th>場次</th>
                      <th className="w-36">簽到時間</th>
                      <th className="w-32">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkins.map((c) => (
                      <tr key={c.id} className="row-em group">
                        <td>
                          <span className="rank-figure text-2xl text-white/30">
                            {c.session?.session_date ?? "—"}
                          </span>
                          <span className="ml-2 text-xs text-white/60">
                            週
                            {weekdayLabel(
                              c.session?.session_date ?? new Date()
                            )}
                          </span>
                        </td>
                        <td className="min-w-0 text-white/75">
                          {c.session?.title ?? "—"}
                        </td>
                        <td className="tnum text-white/70">
                          {formatDate(c.created_at)}
                        </td>
                        <td>
                          <span
                            className={`slab inline-flex items-center border px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] ${
                              c.status === "approved"
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                : c.status === "rejected"
                                  ? "border-red-500/40 bg-red-500/15 text-red-300"
                                  : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {c.status === "approved"
                              ? "已確認"
                              : c.status === "rejected"
                                ? "已駁回"
                                : "待確認"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="border-y border-white/10 px-4 py-14 text-center text-sm text-white/70">
                  尚無訓練紀錄，報名一場試試看。
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ============ 收尾：巨型宣言 + 單側光暈 ============ */}
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
              <span className="eyebrow">Keep Showing Up</span>
              <h2 className="mt-6 text-4xl font-black leading-[0.98] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
                訓練之外，還有月度跑步挑戰
              </h2>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/70">
                每週練一次不夠？每月累積 {RULES.MONTHLY_GOAL_KM} 公里，上傳紀錄就能持續把汗水換成積分與優惠券。
              </p>
            </div>
            <div className="flex flex-col items-start gap-4 lg:col-span-5 lg:pl-10">
              <Link href="/run" className="btn-base btn-vital btn-slab">
                上傳跑步紀錄 <ArrowRight size={17} />
              </Link>
              <Link href="/leaderboard" className="btn-base btn-ghost btn-slab">
                查看排行榜
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function SessionCard({
  session,
  myStatus,
  isLoggedIn,
}: {
  session: TrainingSession;
  myStatus: string | null;
  isLoggedIn: boolean;
}) {
  const d = new Date(session.session_date + "T00:00:00");
  const day = d.getDate();
  const monthNum = d.getMonth() + 1;
  const isOpen = session.status === "open";

  return (
    <article className="group relative overflow-hidden border border-white/10 bg-ink-soft p-6 z-raise">
      {/* 巨型幽靈數字：hover 亮起，營造景深 */}
      <span
        aria-hidden
        className="rank-figure pointer-events-none absolute -top-3 right-4 text-7xl text-white/[0.06] transition-colors duration-500 group-hover:text-vital/25 md:text-8xl"
      >
        {String(day).padStart(2, "0")}
      </span>
      {/* hover 時漂移的內部光暈 */}
      <div className="glow-drift pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cobalt/20 blur-2xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-end gap-2">
              <span className="stat-figure text-5xl leading-none text-white md:text-6xl">
                {String(day).padStart(2, "0")}
              </span>
              <span className="text-accent-blue mb-1 text-[11px] font-semibold uppercase tracking-[0.22em]">
                {monthNum} 月
              </span>
            </div>
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
              週{weekdayLabel(d)}
            </div>
          </div>

          <span
            className={`slab shrink-0 border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
              isOpen
                ? "border-vital/60 bg-vital/12 text-vital-bright"
                : "border-white/15 bg-white/5 text-white/60"
            }`}
          >
            {isOpen ? "開放報名" : "已截止"}
          </span>
        </div>

        <h3 className="mt-7 text-xl font-black tracking-tight">{session.title}</h3>

        <div className="mt-4 space-y-2 text-sm text-white/70">
          <div className="flex items-center gap-2">
            <Clock size={15} className="shrink-0 text-vital-bright" />
            {RULES.TRAINING_TIME}
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={15} className="shrink-0 text-vital-bright" />
            <span className="truncate">{session.location}</span>
          </div>
          <div className="flex items-center gap-2">
            <Users size={15} className="shrink-0 text-vital-bright" />
            名額 {session.capacity} 人
          </div>
        </div>

        {session.note && (
          <p className="mt-4 border-l border-white/15 pl-3 text-xs leading-relaxed text-white/65">
            {session.note}
          </p>
        )}

        <div className="mt-7">
          <SessionAction
            sessionId={session.id}
            myStatus={myStatus}
            isLoggedIn={isLoggedIn}
            sessionStatus={session.status}
          />
        </div>
      </div>
    </article>
  );
}
