import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Gift,
  MapPin,
  Route,
  Users,
} from "lucide-react";
import { RULES } from "@/lib/config";
import { currentMonth, monthLabel } from "@/lib/utils";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getCachedPublishedEvents } from "@/lib/queries";
import { EventCalendar } from "@/components/fx/EventCalendar";

export const metadata = { title: "活動總覽" };
export const dynamic = "force-dynamic";

/** 跑馬燈：接續首頁語言 */
const MARQUEE_ITEMS = [
  "Events",
  "定期訓練",
  `${RULES.MONTHLY_GOAL_KM}km / Month`,
  "街頭健身",
  "澳門 Macau",
  "Calisthenics",
];

/** 'YYYY-MM' → 'YYYY.MM'：Hero 大數字用，去掉中文單位避免過長 */
function monthCompact(month: string): string {
  return month.replace("-", ".");
}

/** Hero 大數字三聯 */
const HERO_FACTS = [
  { value: "02", unit: "Programs", label: "兩條主線", accent: false },
  {
    value: String(RULES.MONTHLY_GOAL_KM),
    unit: "km / Month",
    label: "月度跑步目標",
    accent: true,
  },
  {
    value: `+${RULES.MONTHLY_BONUS_POINTS}`,
    unit: "Bonus",
    label: "達標額外獎分",
    accent: false,
  },
];

/** 參加流程：改時間軸軌道，號碼用超大數字 */
const STEPS = [
  { n: "01", t: "註冊會員", d: "用電郵註冊，一分鐘完成。" },
  { n: "02", t: "報名訓練 / 上傳紀錄", d: "選擇週一場次報名，或上傳跑步截圖。" },
  { n: "03", t: "後台確認", d: "管理員核對簽到與截圖，確認後入帳。" },
  { n: "04", t: "累積領獎", d: "積分與里程累積，達標領取優惠券。" },
];

export default async function EventsPage() {
  const month = currentMonth();
  // FE-14 + PM 拍板：保留 getCurrentProfile()，CTA 依登入狀態切換
  const [events, profile] = await Promise.all([
    getCachedPublishedEvents(),
    getCurrentProfile(),
  ]);

  return (
    <>
      {/* ================= HERO：宣言式排版 ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div
          className="pointer-events-none absolute -right-[20%] -top-[38%] h-[660px] w-[660px] rounded-full blur-[135px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.45,
          }}
        />
        <div className="clip-notch-br pointer-events-none absolute -bottom-14 -left-24 h-64 w-64 bg-vital/10" />

        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="relative pb-14 pt-28 md:pt-36 lg:pb-16">
            <div className="absolute left-0 top-40 hidden lg:block">
              <span className="vlabel text-white/50">Programs · Macau</span>
            </div>

            <div className="lg:pl-14">
              <span className="eyebrow">Events</span>

              <h1 className="mt-6 lg:-ml-[3vw] lg:w-[112%]">
                <span className="display-xl block text-white">各類活動</span>
                <span className="relative mt-1 block">
                  <span
                    aria-hidden
                    className="display-xl text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block"
                  >
                    Programs
                  </span>
                  <span className="display-xl relative block text-vital-bright">
                    Programs
                  </span>
                </span>
              </h1>

              <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
                <p className="text-base leading-relaxed text-white/70 lg:col-span-6">
                  MSW 街健館以「固定訓練 + 可累積任務」兩條主線運作。無論你是想每週動起來，
                  還是想用一個月的時間累積{" "}
                  <span className="font-semibold text-white">
                    {RULES.MONTHLY_GOAL_KM} 公里
                  </span>
                  ，這裡都有適合你的節奏。
                </p>

                <div className="lg:col-span-5 lg:col-start-8 lg:border-l lg:border-white/10 lg:pl-8">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                    活動日曆
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
                    <span className="stat-figure text-5xl leading-none text-white md:text-6xl">
                      {monthCompact(month)}
                    </span>
                    <span className="text-accent-blue mb-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                      Current Month
                    </span>
                  </div>
                  <div className="mt-5 h-px w-16 bg-white/20" />
                  <p className="mt-5 text-sm leading-relaxed text-white/65">
                    {events.length > 0
                      ? `目前有 ${events.length} 個已發佈活動，點擊卡片查看報名方式。`
                      : "目前尚未發佈特別活動，以下為常設的兩條主線。"}
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

      {events.length > 0 ? (
        /* ============ 已發佈活動：F-E1 列表 / 月曆 切換（預設 = 列表） ============ */
        <EventCalendar events={events} />
      ) : (
        <>
          {/* ====== 常設兩條主線：不對稱 Bento（7/5 分欄，佐欄下沉） ====== */}
          <section className="container-msw section-pad">
            <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
              <div>
                <span className="eyebrow">Core Programs</span>
                <h2 className="display-xl mt-5">兩條主線</h2>
              </div>
              <p className="max-w-md text-sm leading-relaxed text-white/65">
                前者建立紀律，後者累積成果。兩者都經後台確認後入帳，積分與里程都看得見。
              </p>
            </div>

            <div className="mt-14 grid gap-8 lg:grid-cols-12">
              {/* 01 定期訓練：7/12，斜切角 + 幽靈大數字 */}
              <article className="reveal-left clip-notch group relative overflow-hidden border border-white/10 bg-ink-soft p-8 z-raise">
                <span
                  aria-hidden
                  className="rank-figure pointer-events-none absolute -top-4 right-6 text-8xl text-white/[0.05] transition-colors duration-500 group-hover:text-cobalt/25 md:text-9xl"
                >
                  01
                </span>
                <div className="glow-drift pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cobalt/25 blur-3xl" />

                <div className="relative">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                      Program 01
                    </span>
                    <span className="text-accent-blue text-[11px] font-semibold uppercase tracking-[0.22em]">
                      Weekly Training
                    </span>
                  </div>

                  <div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-2">
                    <span className="stat-figure text-6xl leading-none text-white md:text-7xl">
                      MON
                    </span>
                    <span className="stat-figure text-outline text-5xl leading-none md:text-6xl">
                      {RULES.TRAINING_TIME.split("–")[0].trim()}
                    </span>
                    <span className="mb-2 text-sm text-white/55">
                      – {RULES.TRAINING_TIME.split("–")[1]?.trim()} · 澳門街健館
                    </span>
                  </div>

                  <h3 className="mt-8 text-2xl font-black tracking-tight md:text-3xl">
                    定期訓練活動
                  </h3>
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/70">
                    逢<span className="font-semibold text-white">星期一</span>{" "}
                    <span className="font-semibold text-vital-bright">
                      {RULES.TRAINING_TIME}
                    </span>
                    ，團體街頭健身訓練。現場簽到，後台確認後獲得{" "}
                    <span className="font-semibold text-white">
                      {RULES.CHECKIN_POINTS} 積分
                    </span>
                    。
                  </p>

                  <ul className="mt-8 border-t border-white/10">
                    {[
                      { icon: <CalendarDays size={15} />, t: "逢星期一 · 固定時間" },
                      { icon: <Users size={15} />, t: "團體訓練，適合任何程度" },
                      {
                        icon: <Gift size={15} />,
                        t: `每次簽到 +${RULES.CHECKIN_POINTS} 積分`,
                      },
                    ].map((r) => (
                      <li
                        key={r.t}
                        className="flex items-center gap-3 border-b border-white/10 py-3 text-sm text-white/70"
                      >
                        <span className="text-vital-bright">{r.icon}</span>
                        {r.t}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/training"
                    className="btn-base btn-cobalt btn-slab mt-8"
                  >
                    查看場次與報名 <ArrowRight size={17} />
                  </Link>
                </div>
              </article>

              {/* 02 月度跑步：5/12，下沉錯位，透明底 + 上粗線 */}
              <article className="reveal-right group relative border-t-2 border-vital bg-transparent p-8 lg:col-span-5 lg:mt-24">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                    Program 02
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-vital-bright">
                    Monthly Challenge
                  </span>
                </div>

                <div className="mt-8 flex items-end gap-3">
                  <span className="stat-figure text-6xl leading-none text-vital-bright md:text-7xl">
                    {RULES.MONTHLY_GOAL_KM}
                  </span>
                  <span className="text-accent-blue mb-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                    km / month
                  </span>
                </div>

                <h3 className="mt-8 text-2xl font-black tracking-tight md:text-3xl">
                  {monthLabel(month)}挑戰
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/70">
                  上傳跑步截圖並填寫公里數，後台人工確認。當月累積達{" "}
                  <span className="font-semibold text-vital-bright">
                    {RULES.MONTHLY_GOAL_KM} 公里
                  </span>
                  ，月底發放優惠券。
                </p>

                <ul className="mt-8 border-t border-white/10">
                  {[
                    { icon: <Route size={15} />, t: `每公里 +${RULES.POINTS_PER_KM} 積分` },
                    { icon: <MapPin size={15} />, t: "不限地點，上傳截圖即可" },
                    {
                      icon: <Gift size={15} />,
                      t: `達標 +${RULES.MONTHLY_BONUS_POINTS} 分與電子優惠券`,
                    },
                  ].map((r) => (
                    <li
                      key={r.t}
                      className="flex items-center gap-3 border-b border-white/10 py-3 text-sm text-white/70"
                    >
                      <span className="text-accent-blue">{r.icon}</span>
                      {r.t}
                    </li>
                  ))}
                </ul>

                <Link href="/run" className="btn-base btn-vital btn-slab mt-8">
                  上傳跑步紀錄 <ArrowRight size={17} />
                </Link>
              </article>
            </div>
          </section>

          {/* ====== 參加流程：時間軸軌道 + 超大數字 ====== */}
          <section className="relative border-y border-ink-line bg-ink-soft">
            <div className="noise-overlay" />
            <div className="container-msw section-pad relative">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <span className="eyebrow">How It Works</span>
                  <h2 className="display-xl mt-5">參加流程</h2>
                </div>
                <span className="hidden text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45 md:block">
                  Four Steps
                </span>
              </div>

              <div className="relative mt-12">
                {/* 水平軌道：只在大螢幕顯示 */}
                <div className="pointer-events-none absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-white/20 to-transparent md:block" />
                <div className="stagger grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                  {STEPS.map((s) => (
                    <div
                      key={s.n}
                      className="group relative border border-white/10 bg-ink/40 p-6 z-raise"
                    >
                      <div className="flex items-center gap-3">
                        <span className="rank-figure text-5xl text-white/30 transition-colors duration-500 group-hover:text-vital-bright md:text-6xl">
                          {s.n}
                        </span>
                        <span className="h-1.5 w-1.5 rotate-45 bg-vital-bright" />
                      </div>
                      <h3 className="mt-5 font-black tracking-tight">{s.t}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-white/70">
                        {s.d}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ============ 收尾 CTA：巨型宣言 + 單側光暈 ============ */}
      <section className="relative overflow-hidden border-t border-ink-line">
        <div className="grid-lines absolute inset-0" />
        <div
          className="pointer-events-none absolute -bottom-72 -right-24 h-[620px] w-[620px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, var(--color-vital), transparent 68%)",
            opacity: 0.16,
          }}
        />
        <span
          aria-hidden
          className="display-hero text-outline pointer-events-none absolute -bottom-6 left-[-4%] select-none opacity-40"
        >
          MSW
        </span>

        <div className="container-msw section-pad relative">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <span className="eyebrow">Join The Crew</span>
              <h2 className="mt-6 text-5xl font-black leading-[0.95] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
                {profile ? "繼續把汗水換成積分" : "現在就開始累積"}
              </h2>
              <p className="mt-7 max-w-xl text-base leading-relaxed text-white/70">
                {profile
                  ? "本月里程與積分持續累積中，記得定期上傳跑步紀錄與報名訓練。"
                  : "註冊只需一分鐘。加入後即可報名訓練、上傳跑步紀錄、追蹤積分與優惠券。"}
              </p>
            </div>

            <div className="flex flex-col items-start gap-4 lg:col-span-4 lg:pt-20">
              {profile ? (
                <>
                  <Link href="/run" className="btn-base btn-vital btn-slab">
                    上傳跑步紀錄 <ArrowRight size={18} />
                  </Link>
                  <Link
                    href="/training"
                    className="btn-base btn-ghost btn-slab"
                  >
                    報名訓練場次
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/signup" className="btn-base btn-vital btn-slab">
                    免費註冊會員 <ArrowRight size={18} />
                  </Link>
                  <Link href="/login" className="btn-base btn-ghost btn-slab">
                    我已有帳號
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
