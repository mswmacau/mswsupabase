import type { CSSProperties } from "react";
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
import { BrandIntro } from "@/components/BrandIntro";
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

/* ===== 首頁動效（只喺首頁掛載，唔影響其他頁） ===== */
import "./home-fx.css";
import { ScrollProgress } from "@/components/fx/home/ScrollProgress";
import { BackToTop } from "@/components/fx/home/BackToTop";
import { RevealHome } from "@/components/fx/home/RevealHome";
import { MarqueeBoost } from "@/components/fx/home/MarqueeBoost";
import { CursorFx } from "@/components/fx/home/CursorFx";
import { HeroSpotlight } from "@/components/fx/home/HeroSpotlight";
import { HoverFx } from "@/components/fx/home/HoverFx";
import { ScrubText } from "@/components/fx/home/ScrubText";
import { DriftWord } from "@/components/fx/home/DriftWord";
import { StatCountUp } from "@/components/fx/home/StatCountUp";
import { Countdown } from "@/components/fx/home/Countdown";

export const dynamic = "force-dynamic";

/** 訓練開始時間（"20:00 – 21:00" → "20:00"），Hero / Bento 大字用 */
const TRAINING_START = (RULES.TRAINING_TIME.split("–")[0] ?? "").trim();

/**
 * H-09 倒數目標時間：由 TRAINING_TIME 反推小時／分鐘，
 * 改 config 嘅訓練時間就會跟住改，唔使改元件。
 * 用 split(":") 而唔係 slice(3,5) 硬切：config 若寫 "9:30"（得 4 個字元）
 * 硬切會切錯，split 先至穩。
 */
const [TRAINING_HOUR_RAW, TRAINING_MINUTE_RAW] = TRAINING_START.split(":");
const TRAINING_HOUR = Number.parseInt(TRAINING_HOUR_RAW ?? "", 10) || 20;
const TRAINING_MINUTE = Number.parseInt(TRAINING_MINUTE_RAW ?? "", 10) || 0;

/** H-15 背景漂移大字：用既有品牌字串做裝飾（aria-hidden，唔新增文案） */
const DRIFT_TEXT = `${BRAND.nameEn} ・ ${BRAND.nameEn}`;

const MARQUEE_ITEMS = [
  "Street Workout",
  "街頭健身",
  "Calisthenics",
  "澳門 Macau",
  `Mon ${TRAINING_START}`,
  `${RULES.MONTHLY_GOAL_KM}km / Month`,
];

const TRAINING_ROWS = [
  { icon: <Timer size={15} />, text: "每週固定，可隨時報名當週場次" },
  { icon: <Medal size={15} />, text: `簽到一次 +${RULES.CHECKIN_POINTS} 分` },
  { icon: <CalendarDays size={15} />, text: "適合任何程度，教練現場調整強度" },
];

const RUN_ROWS = [
  { icon: <Route size={15} />, text: `每公里 +${RULES.POINTS_PER_KM} 積分` },
  { icon: <Trophy size={15} />, text: `達標額外 +${RULES.MONTHLY_BONUS_POINTS} 分` },
  { icon: <Medal size={15} />, text: "月底結算，發放電子優惠券（含 QR Code）" },
];

const FEATURES = [
  {
    no: "01",
    title: "打破時間地區限制",
    desc: "每週固定有教練帶領的團體訓練；跑步任務則不限時間地點，隨時上傳紀錄。",
  },
  {
    no: "02",
    title: "贏得專屬優惠券",
    desc: "月度達標即獲電子優惠券，用汗水換來的獎勵，在 MSW 街健館直接兌換。",
  },
  {
    no: "03",
    title: "與澳門的街健夥伴一起練",
    desc: "一群人練比一個人練走得遠。排行榜、積分、共同目標，讓訓練不再孤單。",
  },
];

/** 不規則 Bento：每行總和 12 欄，但寬度各不相同 */
const DISCIPLINE_SPANS = [
  "lg:col-span-5",
  "lg:col-span-4 lg:mt-12",
  "lg:col-span-3",
  "lg:col-span-4",
  "lg:col-span-3 lg:mt-10",
  "lg:col-span-5",
];

/**
 * H-03 reveal 交錯延遲。
 * 純 CSS 變數、server 端就輸出，唔涉及任何 client state，所以冇 hydration 風險。
 */
function fxDelay(seconds: number): CSSProperties {
  return { "--fx-d": `${seconds}s` } as CSSProperties;
}

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

  const statItems = [
    {
      value: formatKm(stats.total_km),
      unit: "km",
      label: "累積跑步里程",
      accent: true,
    },
    { value: String(stats.members), unit: "人", label: "MSW 會員", accent: false },
    {
      value: String(stats.total_sessions),
      unit: "場",
      label: "已開訓練場次",
      accent: false,
    },
    {
      value: String(RULES.MONTHLY_GOAL_KM),
      unit: "km",
      label: "月度跑步目標",
      accent: false,
    },
  ];

  return (
    <>
      {/* ===== 首頁動效：純 client 掛載點，唔改變任何既有版面與文案 ===== */}
      <ScrollProgress />
      <RevealHome />
      <MarqueeBoost />
      <HoverFx />
      <HeroSpotlight />
      <CursorFx />
      <BackToTop />

      {/* ============ HERO：宣言式超大排版 ============ */}
      <section
        className="relative overflow-hidden border-b border-ink-line"
        data-fx-hero
      >
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

        {/* 單側大光暈（只在右上，刻意不對稱） */}
        <div
          className="pointer-events-none absolute -right-[22%] -top-[32%] h-[760px] w-[760px] rounded-full blur-[140px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.5,
          }}
        />
        {/* 左下用幾何色塊代替第二顆光暈，避免左右對稱 */}
        <div className="clip-notch pointer-events-none absolute -bottom-10 -left-20 h-72 w-72 bg-vital/10" />

        {/* H-17 hero 滑鼠聚光燈：--fx-mx / --fx-my 由 HeroSpotlight 寫入，
            冇 JS 時用 CSS 預設嘅 72% / 22% 靜態光暈 */}
        <div className="fx-spot" aria-hidden />

        {/* 手工質感：細網格 + 噪點 */}
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="relative pb-16 pt-24 md:pt-32 lg:pb-20 lg:pt-36">
            {/* 豎排小標籤 */}
            <div className="absolute left-0 top-44 hidden lg:block">
              <span className="vlabel text-white/50">Macau · Est. 2026</span>
            </div>

            <div className="lg:pl-14">
              <span className="eyebrow" data-fx-reveal style={fxDelay(0.05)}>
                Macau Street Workout
              </span>

              <h1
                className="mt-6 lg:-ml-[3vw] lg:w-[112%]"
                data-fx-reveal
                style={fxDelay(0.18)}
              >
                <span className="display-hero block text-white">MSW</span>
                <span className="relative mt-1 block">
                  {/* 錯位描邊副本：純裝飾 */}
                  <span
                    aria-hidden
                    className="display-hero text-outline text-outline-vital absolute left-[0.05em] top-[0.05em] block"
                  >
                    街健館
                  </span>
                  <span className="display-hero relative block text-vital-bright">
                    街健館
                  </span>
                </span>
              </h1>

              <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:gap-8">
                <p
                  className="text-base leading-relaxed text-white/70 sm:text-lg lg:col-span-5"
                  data-fx-reveal
                  style={fxDelay(0.34)}
                >
                  {BRAND.tagline}。每週一晚固定訓練、每月{" "}
                  <span className="font-semibold text-white">
                    {RULES.MONTHLY_GOAL_KM}
                  </span>{" "}
                  公里跑步挑戰，每一次汗水都換算成積分與專屬優惠券。
                </p>

                <div
                  className="lg:col-span-5 lg:col-start-8 lg:border-l lg:border-white/10 lg:pl-8"
                  data-fx-reveal
                  style={fxDelay(0.48)}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    {isLoggedIn ? (
                      <>
                        <Link
                          href="/dashboard"
                          className="btn-base btn-vital btn-slab"
                          data-fx-sheen
                          data-fx-magnet
                        >
                          我的帳戶 <ArrowRight size={18} />
                        </Link>
                        <Link
                          href="/run"
                          className="btn-base btn-ghost btn-slab"
                          data-fx-sheen
                          data-fx-magnet
                        >
                          上傳跑步紀錄
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          href="/signup"
                          className="btn-base btn-vital btn-slab"
                          data-fx-sheen
                          data-fx-magnet
                        >
                          立即加入會員 <ArrowRight size={18} />
                        </Link>
                        <Link
                          href="/events"
                          className="btn-base btn-ghost btn-slab"
                          data-fx-sheen
                          data-fx-magnet
                        >
                          查看活動
                        </Link>
                      </>
                    )}
                  </div>

                  {nextSession && (
                    <div className="mt-8 border-l-2 border-vital bg-white/[0.03] px-5 py-4">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                        <CalendarDays size={14} className="text-vital-bright" />
                        下一場定期訓練
                      </div>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="stat-figure text-2xl text-white">
                          {nextSession.session_date}
                        </span>
                        <span className="text-sm text-white/70">
                          （週
                          {weekdayLabel(nextSession.session_date)}）{" "}
                          {RULES.TRAINING_TIME}
                        </span>
                      </div>
                      {/* H-09 倒數到下個週一訓練時間（首次 render 係 "--"，mount 後先計） */}
                      <div className="mt-2 text-sm text-white/70">
                        倒數{" "}
                        <Countdown
                          hour={TRAINING_HOUR}
                          minute={TRAINING_MINUTE}
                        />
                      </div>
                      <Link
                        href="/training"
                        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-blue hover:text-white"
                      >
                        報名 <ChevronRight size={15} />
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Hero 視覺：放大並出血出邊界 */}
            <div className="pointer-events-none relative mt-14 w-full lg:absolute lg:-right-[12%] lg:top-[2%] lg:mt-0 lg:w-[62%]">
              <div className="clip-slant opacity-90">
                <HeroVisual />
              </div>
            </div>
          </div>
        </div>

        {/* 跑馬燈：細邊框上下包夾 */}
        <div className="relative z-10 border-y border-white/10 py-3">
          <div className="marquee" aria-hidden>
            {/* H-10：data-fx-marquee 會由 MarqueeBoost 接管（含捲動加速） */}
            <div className="marquee-track" data-fx-marquee>
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

      {/* ============ 累積數據：大數字錯位，不用卡片 ============ */}
      <section
        className="relative overflow-hidden border-b border-ink-line bg-ink-soft"
        data-fx-drift-scope
      >
        <div className="grid-lines absolute inset-0" />
        {/* H-15 背景漂移大字（純裝飾，aria-hidden） */}
        <DriftWord text={DRIFT_TEXT} />
        <div className="container-msw relative">
          <div className="grid grid-cols-2 gap-y-12 py-14 md:py-20 lg:grid-cols-4">
            {statItems.map((s, i) => (
              <div
                key={s.label}
                className={`px-5 ${i > 0 ? "md:border-l md:border-white/10" : ""} ${
                  i % 2 === 1 ? "lg:mt-12" : ""
                } ${i === 2 ? "lg:mt-6" : ""}`}
                data-fx-reveal
                style={fxDelay(0.06 * i)}
              >
                <div className="flex items-start gap-2">
                  {/* H-08 CountUp：終值同原本字串完全一致 */}
                  <StatCountUp
                    text={s.value}
                    className={`stat-figure text-5xl leading-none md:text-6xl lg:text-7xl ${
                      s.accent ? "text-vital-bright" : "text-white"
                    }`}
                  />
                  <span className="text-accent-blue mt-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                    {s.unit}
                  </span>
                </div>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                  {s.label}
                </div>
                <div className="mt-4 h-px w-10 bg-white/20" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 關於我們：宣言式大字 + 不對稱雙欄 ============ */}
      <BrandIntro />

      {/* ============ 兩大核心活動：不對稱 Bento ============ */}
      <section className="container-msw section-pad">
        <div
          className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8"
          data-fx-reveal
        >
          <div>
            <span className="eyebrow">Core Programs</span>
            <h2 className="display-xl mt-5">兩大核心活動</h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-white/65">
            固定時間的團體訓練，加上可累積的月度跑步任務。前者建立紀律，後者累積成果。
          </p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-12">
          {/* 01 定期訓練：7/12，斜切角 */}
          <article
            className="clip-notch group relative overflow-hidden border border-white/10 bg-ink-soft p-8 lg:col-span-7"
            data-fx-reveal
            data-fx-tilt
            style={fxDelay(0.1)}
          >
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cobalt/25 blur-2xl transition-transform duration-500 group-hover:-translate-x-4 group-hover:translate-y-4" />
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
                  {TRAINING_START}
                </span>
                <span className="mb-2 text-sm text-white/55">
                  – {RULES.TRAINING_TIME.split("–")[1]?.trim()} · 澳門街健館
                </span>
              </div>

              <h3 className="mt-8 text-2xl font-black tracking-tight md:text-3xl">
                定期訓練活動
              </h3>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/70">
                逢
                <span className="font-semibold text-white">星期一</span>{" "}
                <span className="font-semibold text-vital-bright">
                  {RULES.TRAINING_TIME}
                </span>
                ，於澳門街健館進行團體街頭健身訓練。現場簽到，後台確認後即可獲得{" "}
                <span className="font-semibold text-white">
                  {RULES.CHECKIN_POINTS} 積分
                </span>
                。
              </p>

              <ul className="mt-8 border-t border-white/10">
                {TRAINING_ROWS.map((row) => (
                  <li
                    key={row.text}
                    className="flex items-center gap-3 border-b border-white/10 py-3 text-sm text-white/70"
                  >
                    <span className="text-vital-bright">{row.icon}</span>
                    {row.text}
                  </li>
                ))}
              </ul>

              <Link
                href="/training"
                className="btn-base btn-cobalt btn-slab mt-8"
                data-fx-sheen
                data-fx-magnet
              >
                查看訓練場次 <ArrowRight size={17} />
              </Link>
            </div>
          </article>

          {/* 02 月度跑步：5/12，下沉錯位，透明底 + 上粗線 */}
          <article
            className="group relative border-t-2 border-vital bg-transparent p-8 lg:col-span-5 lg:mt-24"
            data-fx-reveal
            data-fx-tilt
            style={fxDelay(0.2)}
          >
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
              月度跑步挑戰
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              上傳跑步 app 截圖並填寫公里數，後台人工確認後計入累積。當月滿{" "}
              <span className="font-semibold text-vital-bright">
                {RULES.MONTHLY_GOAL_KM} 公里
              </span>
              ，即完成任務並獲得專屬優惠券。
            </p>

            <ul className="mt-8 border-t border-white/10">
              {RUN_ROWS.map((row) => (
                <li
                  key={row.text}
                  className="flex items-center gap-3 border-b border-white/10 py-3 text-sm text-white/70"
                >
                  <span className="text-accent-blue">{row.icon}</span>
                  {row.text}
                </li>
              ))}
            </ul>

            <Link
              href="/run"
              className="btn-base btn-vital btn-slab mt-8"
              data-fx-sheen
              data-fx-magnet
            >
              上傳跑步紀錄 <ArrowRight size={17} />
            </Link>
          </article>
        </div>
      </section>

      {/* ============ Why MSW：01/02/03 編號橫行 ============ */}
      <section className="relative border-y border-ink-line bg-ink-soft">
        <div className="noise-overlay" />
        <div className="container-msw section-pad relative">
          <div
            className="flex flex-wrap items-end justify-between gap-6"
            data-fx-reveal
          >
            <div>
              <span className="eyebrow">Why MSW</span>
              {/* H-13 逐字點亮 scrub（文字內容完全不變，只係拆成逐字 span） */}
              <h2 className="display-xl mt-5 max-w-2xl">
                <ScrubText text="超越界限，讓訓練增加驅動力" />
              </h2>
            </div>
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45 md:block">
              Three Reasons
            </span>
          </div>

          <div className="mt-12 border-t border-white/10">
            {FEATURES.map((f, i) => (
              <div
                key={f.no}
                className="group -mx-4 border-b border-white/10 px-4 py-8 transition-colors hover:bg-white/[0.03] lg:grid lg:grid-cols-[7rem_1fr_1.1fr] lg:items-center lg:gap-10 lg:py-12"
                data-fx-reveal
                style={fxDelay(0.06 * i)}
              >
                <div className="stat-figure text-5xl text-white/25 transition-colors group-hover:text-vital-bright lg:text-6xl">
                  {f.no}
                </div>
                <h3 className="mt-4 text-2xl font-black tracking-tight md:text-3xl lg:mt-0">
                  {f.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/70 lg:mt-0 lg:max-w-md">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 各類訓練：不規則 Bento 網格 ============ */}
      <section className="container-msw section-pad">
        <div
          className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8"
          data-fx-reveal
        >
          <div>
            <span className="eyebrow">Disciplines</span>
            <h2 className="display-xl mt-5">各類訓練項目</h2>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
            {String(DISCIPLINES.length).padStart(2, "0")} Disciplines
          </span>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-12">
          {DISCIPLINES.map((d, i) => (
            <article
              key={d.title}
              className={`group relative overflow-hidden border border-white/10 bg-ink-soft/70 p-6 transition-colors hover:border-cobalt/60 hover:bg-ink-soft ${
                DISCIPLINE_SPANS[i] ?? ""
              } ${i === 0 ? "lg:min-h-[260px]" : ""}`}
              data-fx-reveal
              data-fx-tilt
              style={fxDelay(0.06 * i)}
            >
              <span className="stat-figure pointer-events-none absolute -top-2 right-4 text-6xl text-white/[0.07] transition-colors group-hover:text-vital/25 md:text-7xl">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="relative">
                <div className="text-accent-blue text-[11px] font-semibold uppercase tracking-[0.22em]">
                  {d.sub}
                </div>
                <h3 className="mt-3 text-xl font-black tracking-tight md:text-2xl">
                  {d.title}
                </h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70">
                  {d.desc}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ============ 本月排行榜 ============ */}
      <section className="relative border-t border-ink-line">
        <div className="container-msw section-pad grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5" data-fx-reveal>
            <span className="eyebrow">Leaderboard</span>
            <h2 className="display-xl mt-5">
              <span className="text-accent-blue block text-[0.4em] font-semibold uppercase tracking-[0.22em]">
                {monthLabel(month)}
              </span>
              <span className="block">排行榜</span>
            </h2>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/70">
              依當月已確認的跑步里程排序。提交紀錄經後台確認後才會計入排名。
            </p>
            <Link
              href="/leaderboard"
              className="btn-base btn-ghost btn-slab mt-8"
              data-fx-sheen
              data-fx-magnet
            >
              查看完整排行榜 <ArrowRight size={17} />
            </Link>
          </div>

          <div className="lg:col-span-7" data-fx-reveal style={fxDelay(0.12)}>
            {leaders.length ? (
              <ol className="border-t border-white/10">
                {leaders.map((l, i) => (
                  <li
                    key={l.user_id}
                    className="group flex items-center gap-5 border-b border-white/10 py-5"
                  >
                    <span className="stat-figure w-12 text-3xl text-white/25 transition-colors group-hover:text-vital-bright md:text-4xl">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold">
                        {l.name}
                      </div>
                      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
                        {l.runs} 次提交 · {l.points} 積分
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="stat-figure text-2xl text-white md:text-3xl">
                        {formatKm(l.total_km)}
                      </div>
                      <div className="text-accent-blue text-[11px] font-semibold uppercase tracking-[0.22em]">
                        km
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="border-y border-white/10 px-6 py-14 text-center text-sm text-white/70">
                {isSupabaseConfigured
                  ? "本月尚無已確認的跑步紀錄，成為第一位上榜者！"
                  : "尚未連接 Supabase，連接後這裡會顯示排行榜。"}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ CTA：超大宣言（單側光暈，不居中） ============ */}
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
        {/* 巨型描邊字：裝飾 */}
        <span
          aria-hidden
          className="display-hero text-outline pointer-events-none absolute -bottom-6 left-[-4%] select-none opacity-40"
        >
          MSW
        </span>

        <div className="container-msw section-pad relative">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-8" data-fx-reveal>
              <span className="eyebrow">Join The Crew</span>
              <h2 className="mt-6 text-5xl font-black leading-[0.95] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
                {isLoggedIn ? "繼續把汗水換成積分" : "準備好開始累積了嗎？"}
              </h2>
              <p className="mt-7 max-w-xl text-base leading-relaxed text-white/70">
                {isLoggedIn
                  ? "本月里程與積分持續累積中，記得定期上傳跑步紀錄與報名訓練。"
                  : "註冊只需一分鐘。加入後即可報名訓練、上傳跑步紀錄、追蹤積分與優惠券。"}
              </p>
            </div>

            <div
              className="flex flex-col items-start gap-4 lg:col-span-4 lg:pt-20"
              data-fx-reveal
              style={fxDelay(0.15)}
            >
              {isLoggedIn ? (
                <>
                  <Link
                    href="/run"
                    className="btn-base btn-vital btn-slab"
                    data-fx-sheen
                    data-fx-magnet
                  >
                    上傳跑步紀錄 <ArrowRight size={18} />
                  </Link>
                  <Link
                    href="/training"
                    className="btn-base btn-ghost btn-slab"
                    data-fx-sheen
                    data-fx-magnet
                  >
                    報名訓練場次
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="btn-base btn-vital btn-slab"
                    data-fx-sheen
                    data-fx-magnet
                  >
                    免費註冊會員 <ArrowRight size={18} />
                  </Link>
                  <Link
                    href="/login"
                    className="btn-base btn-ghost btn-slab"
                    data-fx-sheen
                    data-fx-magnet
                  >
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
