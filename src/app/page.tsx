import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
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
/* 首頁圖片輪播：資料由後台 /admin/slides 維護（表 public.home_slides） */
import { SlideCarousel } from "@/components/home/SlideCarousel";
import { getActiveSlides } from "@/lib/home-slides";
import {
  getAvailableMonths,
  getCachedMonthlyLeaderboard,
  getCachedSiteStats,
  getClassNamesByColor,
  getNextSession,
  getScheduleLegend,
  getScheduleMonth,
  getSiteBlocks,
  getSiteContent,
  getSiteTheme,
} from "@/lib/queries";
import { ScheduleCalendar } from "@/components/schedule/ScheduleCalendar";
import {
  buildMonthDays,
  macauTodayISO,
  sessionRowToView,
  sortSessionViews,
} from "@/components/schedule/schedule-utils";
import { RULES } from "@/lib/config";
import type { BlockId } from "@/lib/content";
import { publicAssetUrl } from "@/lib/assets";
import {
  currentMonth,
  formatKm,
  formatTimeRange,
  monthLabel,
  shortTime,
  weekdayLabelOfDate,
} from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentProfile } from "@/lib/supabase/server";

/* ===== 首頁動效（只喺首頁掛載，唔影響其他頁） ===== */
import "./home-fx.css";
/* ===== 公開頁視覺層級語彙（色帶 / 抬頭節奏 / 卡片三級 / 數字主次 / 觸控 44px） =====
 * 刻意唔放進 globals.css：/training、/events、/leaderboard 已各自優化過，
 * 呢份檔只會喺有 import 佢嘅路由載入。 */
import "./public-ui.css";
import { ScrollProgress } from "@/components/fx/home/ScrollProgress";
import { BackToTop } from "@/components/fx/home/BackToTop";
import { RevealHome } from "@/components/fx/home/RevealHome";
import { MarqueeBoost } from "@/components/fx/home/MarqueeBoost";
import { HoverFx } from "@/components/fx/home/HoverFx";
import { ScrubText } from "@/components/fx/home/ScrubText";
import { DriftWord } from "@/components/fx/home/DriftWord";
/** E05 Hero 背景圖單層視差：沿用 useRafScroll，零依賴、冇新增 scroll listener */
import { HeroParallax } from "@/components/fx/home/HeroParallax";
import { StatCountUp } from "@/components/fx/home/StatCountUp";
import { Countdown } from "@/components/fx/home/Countdown";

export const dynamic = "force-dynamic";

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
 * 首頁區塊的固定渲染順序（站主 2026-02 指定）。
 *
 * 為什麼不再用 `site_blocks.order` 排序：DB 的 order 是舊次序（about 緊隨
 * stats、programs 在 reasons 之前），與站主要求的
 * 「統計帶 → 本月場次 → 排行榜 → 超越界限 → 各類訓練 → 兩大核心活動 → CTA」
 * 不一致。這裡以站主這次的指定為準，改由本常數決定順序；
 * **後台的 visible 仍然有效**（隱藏某個區塊照樣即時消失）。
 *
 * 註：「本月場次」不是 BlockId（DB 沒有這個 id，加進去要改 schema），
 * 它由下方的 scheduleAfterId 掛在統計帶之後。
 * 註：about（BrandIntro「關於我們」）站主沒指定位置，放在「各類訓練項目」
 * 之後、「兩大核心活動」之前——敘事段收完、行動入口接著收尾。
 */
const HOME_SECTION_ORDER: readonly BlockId[] = [
  "hero",
  "stats",
  "ranking",
  "reasons",
  "disciplines",
  "about",
  "programs",
  "cta",
];

/**
 * H-03 reveal 交錯延遲。
 * 純 CSS 變數、server 端就輸出，唔涉及任何 client state，所以冇 hydration 風險。
 */
function fxDelay(seconds: number): CSSProperties {
  return { "--fx-d": `${seconds}s` } as CSSProperties;
}

/**
 * T-5：hero 描述改讀 DB 單一字串（site_content.hero.desc）。
 * 基線將月度目標公里數以 font-semibold text-white 強調（原本喺 JSX
 * 插值 RULES.MONTHLY_GOAL_KM），DB 無值回落 DEFAULT_* 嗰陣照樣包
 * span，渲染與基線一致；後台若改寫咗個數字或者刪咗，就原樣輸出、
 * 唔標強調（後台想改標點都得）。
 */
function renderHeroDesc(desc: string) {
  const goal = String(RULES.MONTHLY_GOAL_KM);
  const idx = desc.indexOf(goal);
  if (idx < 0) return desc;
  return (
    <>
      {desc.slice(0, idx)}
      <span className="font-semibold text-white">{goal}</span>
      {desc.slice(idx + goal.length)}
    </>
  );
}

export default async function HomePage() {
  const month = currentMonth();
  // T-5 / T-20：首頁文案與區塊設定改讀 DB（site_content / site_blocks），
  // DB 無值時回落 DEFAULT_*（逐字等於原有硬編碼，沙箱渲染與基線一致）。
  const [stats, nextSession, leaders, profile, theme, content, blocks, slides] =
    await Promise.all([
      getCachedSiteStats(),
      // 「下一場定期訓練」改讀真實班表（training_sessions），不再用 config 的固定時間
      getNextSession(),
      getCachedMonthlyLeaderboard(month, 5),
      getCurrentProfile(),
      getSiteTheme(),
      getSiteContent(),
      getSiteBlocks(),
      getActiveSlides(),
    ]);

  /* ---------- 首頁「本月場次」日曆（B4 版本 1）----------
   * 站主要求「主頁同活動頁都可以放」：首頁放精簡版，讓第一次進站的人不用
   * 先找到「活動」頁才看得到班表。
   * 資料全部走 /events 同一批 cached getter，所以兩邊的月份、圖例、顏色
   * 不會各講一套。
   */
  const todayISO = macauTodayISO();
  const [availableMonths, legend, classesByColor] = await Promise.all([
    getAvailableMonths(),
    getScheduleLegend(),
    getClassNamesByColor(),
  ]);

  /** 優先顯示「含今天」的已發布月份，沒有就退回最新已發布月份 */
  const todayYearMonth = {
    year: Number(todayISO.slice(0, 4)),
    month: Number(todayISO.slice(5, 7)),
  };
  const thisMonthPublished = availableMonths.find(
    (m) => m.year === todayYearMonth.year && m.month === todayYearMonth.month
  );
  const latestPublished =
    availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : null;
  const scheduleMonth = thisMonthPublished ?? latestPublished;
  const homeSchedule = scheduleMonth
    ? await getScheduleMonth(scheduleMonth.year, scheduleMonth.month)
    : null;
  const homeDays =
    scheduleMonth && homeSchedule
      ? buildMonthDays({
          year: scheduleMonth.year,
          month: scheduleMonth.month,
          sessions: sortSessionViews(
            homeSchedule.sessions.map((row) => sessionRowToView(row, todayISO))
          ),
          todayISO,
        })
      : [];

  /**
   * H-09 倒數目標：澳門牆上時間（session_date + start_time）→ 帶 +08:00 偏移的
   * 絕對時刻。用絕對時刻而不是「下個週一 20:00」，倒數才會對準真正的那一場；
   * 瀏覽器在任何時區算出來都是同一個瞬間。
   */
  const countdownTargetISO = nextSession?.start_time
    ? `${nextSession.session_date}T${shortTime(nextSession.start_time)}:00+08:00`
    : null;
  const isLoggedIn = Boolean(profile);

  // Hero 背景圖（後台設定）：有則顯示並覆上黑色遮罩，無則維持預設漸層 + 網格
  const heroBgUrl = publicAssetUrl(theme.hero_bg_path);
  const heroOverlayOpacity = theme.hero_overlay_opacity;

  /**
   * 輪播有冇實際可顯示嘅圖（與 SlideCarousel 內部同一套過濾：組不出公開網址就當冇）。
   * 用途：輪播本身會回 null，但外面嗰層留白容器仍然會佔高度，
   * 所以要喺呢邊先判斷，冇圖就整塊（連留白）都唔渲染。
   */
  const hasSlides = slides.some((slide) => Boolean(publicAssetUrl(slide.path)));

  // H-15 背景漂移大字：用既有品牌字串做裝飾（aria-hidden，唔新增文案）。
  // T-4：英文名改讀 site_theme.brand_name_en（Nav/Footer 同源），回落 BRAND.nameEn。
  const driftText = `${theme.brand_name_en} ・ ${theme.brand_name_en}`;

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

  // T-5：跑馬燈字改讀 site_content.marquee（固定 6 項，編號 01/02/03 依索引產生）
  const marqueeItems = content.marquee;
  const features = content.features.map((f, i) => ({
    no: String(i + 1).padStart(2, "0"),
    title: f.title,
    desc: f.desc,
  }));

  // T-20：site_blocks.home 只決定 visible；渲染順序改由 HOME_SECTION_ORDER
  // （站主 2026-02 指定）決定，理由見該常數的註解。
  const orderedBlocks = blocks.home
    .filter((b) => b.visible)
    .sort(
      (a, b) =>
        HOME_SECTION_ORDER.indexOf(a.id) - HOME_SECTION_ORDER.indexOf(b.id)
    );

  /** 「本月場次」緊接統計帶之後；統計帶若被後台隱藏，退回接在第一個區塊之後 */
  const scheduleAfterId: BlockId | undefined = orderedBlocks.some(
    (b) => b.id === "stats"
  )
    ? "stats"
    : orderedBlocks[0]?.id;

  /* ============ 首頁 8 個區塊（T-20：visible 由 site_blocks 決定，
     渲染順序由 HOME_SECTION_ORDER 決定） ============ */

  const heroSection = (
    <section
      className="pub-shell pub-band-0 relative overflow-hidden border-b border-ink-line"
      data-fx-hero
    >
      {heroBgUrl && (
        <>
          {/* E05：背景圖單層視差。JS 冇跑就係原本位置（無 transform）、100% 可見 */}
          <HeroParallax>
            <div
              className="absolute inset-0 bg-center bg-cover"
              style={{ backgroundImage: `url("${heroBgUrl}")` }}
            />
          </HeroParallax>
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

      {/* 手工質感：細網格 + 噪點 */}
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      {/* 首頁圖片輪播：主標題之前、導覽列之下。
          包一層 relative z-10 蓋過上面嘅 absolute 裝飾層（.noise-overlay z-1），
          否則輪播會被網格／噪點壓住。
          pt-20 / md:pt-24 讓開 fixed Nav（h-16 / md:h-20，量得 65px / 81px）；
          其餘內距由 SlideCarousel 自己嘅 pt-8 / md:pt-12 提供。輪播根節點自帶
          container-msw，所以唔可以再放進下面嗰個 container-msw 內
          （會變雙層內距、與 h1 不對齊）。
          冇圖時整塊唔渲染，避免留一段空白內距。 */}
      {hasSlides && (
        <div className="relative z-10 pt-20">
          <SlideCarousel slides={slides} />
        </div>
      )}

      <div className="container-msw relative z-10">
        {/* 有輪播時：頂部留白只需做「輪播與大字之間」嘅呼吸空間（Nav 已由上面
            嗰層讓開）。冇輪播時：回落原本嘅 pt-24/md:pt-32/lg:pt-36，靠佢讓開
            fixed Nav，與改動前完全一致。 */}
        <div
          className={`relative pb-10 lg:pb-16 ${
            hasSlides
              ? "pt-4 md:pt-5 lg:pt-6"
              : "pt-24 md:pt-32 lg:pt-36"
          }`}
        >
          {/* 豎排小標籤 */}
          <div className="absolute left-0 top-44 hidden lg:block">
            <span className="vlabel text-white/50">Macau · Est. 2026</span>
          </div>

          {/* Hero 視覺（人形 + 單杠的裝飾 SVG）已於「刪裝飾視覺」一次下架：
              它純屬 aria-hidden 裝飾，手機卻佔 144px、桌面出血到右側壓住日期卡。
              下方背景裝飾層（光暈／網格／噪點）與輪播、h1、CTA 全部保留。 */}
          <div className="relative z-10 lg:pl-14">
            {/* h1 本身就是視覺主標：display-hero 掛在 h1 上，
                內層 span 只負責換行與顏色（字級／字重由 h1 繼承）。
                描邊副本改用 data-dup + ::before 產生，避免同一串字
                在文字節點裡出現兩次（h1.textContent 只會有一份）。 */}
            <h1
              className="pub-display-hero mt-4 md:mt-5 lg:-ml-[3vw] lg:w-[112%]"
              data-fx-reveal
              style={fxDelay(0.18)}
            >
              <span className="block text-white">
                {content.hero.title_line1}
              </span>
              <span className="relative mt-1 block">
                {/* 錯位描邊副本：純裝飾，文字由 CSS content 產生 */}
                <span
                  aria-hidden
                  data-dup={content.hero.title_line2}
                  className="text-outline text-outline-vital absolute left-[0.05em] top-[0.05em] block before:content-[attr(data-dup)]"
                />
                <span className="relative block text-vital-bright">
                  {content.hero.title_line2}
                </span>
              </span>
            </h1>

            <div className="mt-6 grid gap-6 md:mt-8 md:gap-8 lg:grid-cols-12">
              <p
                className="text-base leading-relaxed text-white/70 sm:text-lg lg:col-span-5"
                data-fx-reveal
                style={fxDelay(0.34)}
              >
                {renderHeroDesc(content.hero.desc)}
              </p>

              <div
                className="lg:col-span-5 lg:col-start-8 lg:border-l lg:border-white/10 lg:pl-8"
                data-fx-reveal
                style={fxDelay(0.48)}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {isLoggedIn ? (
                    <>
                      {/* 首屏唯一實心主色 CTA：加大尺寸與字級拉開與次要動作的差距 */}
                      <Link
                        href="/dashboard"
                        className="btn-base btn-vital btn-slab pub-press !px-6 !py-3.5 text-[15px]"
                        data-fx-sheen
                        data-fx-magnet
                      >
                        {content.hero.cta_primary_member} <ArrowRight size={18} />
                      </Link>
                      <Link
                        href="/run"
                        className="btn-base btn-ghost btn-slab"
                        data-fx-sheen
                        data-fx-magnet
                      >
                        {content.hero.cta_secondary_member}
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/signup"
                        className="btn-base btn-vital btn-slab pub-press !px-6 !py-3.5 text-[15px]"
                        data-fx-sheen
                        data-fx-magnet
                      >
                        {content.hero.cta_primary_guest} <ArrowRight size={18} />
                      </Link>
                      <Link
                        href="/events"
                        className="btn-base btn-ghost btn-slab"
                        data-fx-sheen
                        data-fx-magnet
                      >
                        {content.hero.cta_secondary_guest}
                      </Link>
                    </>
                  )}
                </div>

                {/* 「下一場定期訓練」：日期／星期／時段／課程名全部來自
                    training_sessions（getNextSession），不再用 config 的固定字串。
                    沒有場次時不編造時間，改成「班表整理中」空狀態。 */}
                {nextSession ? (
                  <div className="mt-6 border-l-2 border-vital bg-ink/75 px-4 py-3 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                      <CalendarDays size={14} className="flex-none text-vital-bright" />
                      下一場定期訓練
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="stat-figure text-2xl text-white">
                        {nextSession.session_date}
                      </span>
                      <span className="text-sm text-white/70">
                        （週{weekdayLabelOfDate(nextSession.session_date)}）{" "}
                        {formatTimeRange(
                          nextSession.start_time,
                          nextSession.end_time
                        ) || "時間待公布"}
                      </span>
                    </div>
                    <p className="mt-1.5 min-w-0 break-words text-sm font-semibold text-white/85">
                      {nextSession.class_name ?? nextSession.title}
                    </p>
                    {/* H-09 倒數到這一場的開始時刻（首次 render 係 "--"，mount 後先計） */}
                    {countdownTargetISO && (
                      <div className="mt-2 text-sm text-white/70">
                        倒數 <Countdown targetISO={countdownTargetISO} />
                      </div>
                    )}
                    <Link
                      href="/training"
                      className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-blue hover:text-white"
                    >
                      報名 <ChevronRight size={15} />
                    </Link>
                  </div>
                ) : (
                  <div className="mt-6 border-l-2 border-vital bg-ink/75 px-4 py-3 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                      <CalendarDays size={14} className="flex-none text-vital-bright" />
                      下一場定期訓練
                    </div>
                    <p className="mt-2 break-words text-sm leading-relaxed text-white/70">
                      班表整理中，請留意公告
                    </p>
                  </div>
                )}
              </div>
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
                {marqueeItems.map((w) => (
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
  );

  const statsSection = (
    <section
      className="pub-shell pub-band-1 relative overflow-hidden border-b border-ink-line"
      data-fx-drift-scope
    >
      <div className="grid-lines absolute inset-0" />
      {/* H-15 背景漂移大字（純裝飾，aria-hidden） */}
      <DriftWord text={driftText} />
      <div className="container-msw relative">
        {/* 數字主次（站主要求：一組數字不要同樣字級排成一列然後都很大）
            ─ 只有「累積跑步里程」用 .pub-figure-primary 當第一眼的主角，
              其餘三項一律 .pub-figure-aux 退成佐證。
            ─ 390：主數字獨佔一行（col-span-3），三項輔助排成一列。
            ─ 1440：12 欄，主數字 6 欄、其餘各 2 欄，並用左側細線分欄。 */}
        <div
          className="grid grid-cols-3 items-end gap-x-3 gap-y-5 py-7 md:grid-cols-12 md:gap-x-6 md:py-14"
          data-fx-seq
        >
          {statItems.map((s, i) => (
            <div
              key={s.label}
              className={`min-w-0 ${
                i === 0
                  ? "col-span-3 md:col-span-6"
                  : "col-span-1 md:col-span-2 md:border-l md:border-white/10 md:pl-5"
              }`}
            >
              <div className="flex items-start gap-1.5">
                {/* H-08 CountUp：終值同原本字串完全一致 */}
                <StatCountUp
                  text={s.value}
                  className={`${i === 0 ? "pub-figure-primary" : "pub-figure-aux"} ${
                    s.accent ? "text-vital-bright" : "text-white"
                  }`}
                />
                <span className="text-accent-blue mt-1.5 shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] md:text-[11px]">
                  {s.unit}
                </span>
              </div>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
                {s.label}
              </div>
              <div
                className={`mt-2 h-px w-8 bg-white/20 ${
                  i === 0 ? "" : "hidden md:block"
                }`}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const aboutSection = <BrandIntro about={content.about} />;

  /* 兩大核心活動：整頁視覺重量最高的區塊（最亮的色帶 + 最多的空氣） */
  const programsSection = (
    <section className="pub-shell pub-band-2 pub-pad-l" data-fx-seq>
      <div className="container-msw">
        <div className="pub-head">
          <h2 className="pub-head-title">兩大核心活動</h2>
          <p className="pub-lede">
            固定時間的團體訓練，加上可累積的月度跑步任務。前者建立紀律，後者累積成果。
          </p>
        </div>

        <div className="pub-head-body grid gap-4 md:gap-8 lg:grid-cols-12">
          {/* 01 定期訓練：主卡（實心面板 + 頂部品牌漸變線），視覺等級最高 */}
          <article
            className="clip-notch pub-card-primary pub-card-pad-lg pub-accent-top pub-lift group relative overflow-hidden lg:col-span-7"
            data-fx-tilt
          >
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cobalt/25 blur-2xl transition-transform duration-500 group-hover:-translate-x-4 group-hover:translate-y-4" />
            <div className="relative">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                  Program 01
                </span>
              </div>

              <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
                <span className="stat-figure text-4xl leading-none text-white md:text-6xl">
                  WEEKLY
                </span>
                <span className="stat-figure text-outline text-3xl leading-none md:text-5xl">
                  多時段
                </span>
                <span className="mb-1 text-sm text-white/55">· 澳門街健館</span>
              </div>

              <h3 className="mt-5 text-xl font-black tracking-tight md:text-3xl">
                定期訓練活動
              </h3>

              <ul className="mt-5 border-t border-white/10">
                {TRAINING_ROWS.map((row) => (
                  <li
                    key={row.text}
                    className="flex items-center gap-3 border-b border-white/10 py-2 text-sm text-white/70 md:py-3"
                  >
                    <span className="text-vital-bright">{row.icon}</span>
                    {row.text}
                  </li>
                ))}
              </ul>

              {/* 同一區塊只留一個實心主色（02 的上傳按鈕）。這顆是「瀏覽」性質的
                  次要動作，降級為外框，避免兩顆實心按鈕在同一視線互搶。 */}
              <Link
                href="/training"
                className="btn-base btn-ghost btn-slab mt-5"
                data-fx-sheen
                data-fx-magnet
              >
                查看訓練場次 <ArrowRight size={17} />
              </Link>
            </div>
          </article>

          {/* 02 月度跑步：次卡（透明底 + 上粗線 + 下沉錯位），刻意比 01 輕 */}
          <article
            className="group relative border-t-2 border-vital bg-transparent p-4 md:p-8 lg:col-span-5 lg:mt-24"
            data-fx-tilt
          >
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                Program 02
              </span>
            </div>

            <div className="mt-5 flex items-end gap-3">
              <span className="stat-figure text-4xl leading-none text-vital-bright md:text-6xl">
                {RULES.MONTHLY_GOAL_KM}
              </span>
              <span className="text-accent-blue mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em]">
                km / month
              </span>
            </div>

            <h3 className="mt-5 text-xl font-black tracking-tight md:text-3xl">
              月度跑步挑戰
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              上傳跑步 app 截圖並填寫公里數，後台人工確認後計入累積。當月滿{" "}
              <span className="font-semibold text-vital-bright">
                {RULES.MONTHLY_GOAL_KM} 公里
              </span>
              ，即完成任務並獲得專屬優惠券。
            </p>

            <ul className="mt-5 border-t border-white/10">
              {RUN_ROWS.map((row) => (
                <li
                  key={row.text}
                  className="flex items-center gap-3 border-b border-white/10 py-2 text-sm text-white/70 md:py-3"
                >
                  <span className="text-accent-blue">{row.icon}</span>
                  {row.text}
                </li>
              ))}
            </ul>

            <Link
              href="/run"
              className="btn-base btn-vital btn-slab pub-press mt-5"
              data-fx-sheen
              data-fx-magnet
            >
              上傳跑步紀錄 <ArrowRight size={17} />
            </Link>
          </article>
        </div>
      </div>
    </section>
  );

  const reasonsSection = (
    <section
      className="pub-shell pub-band-0 relative border-y border-ink-line"
      data-fx-seq
    >
      <div className="noise-overlay" />
      <div className="container-msw pub-pad relative">
        <div className="pub-head">
          {/* H-13 逐字點亮 scrub（文字內容完全不變，只係拆成逐字 span）。
              可讀的那份由 aria-label 提供，逐字副本是 aria-hidden，
              所以 DOM 文字裡這句話只出現一次。 */}
          <h2
            className="pub-head-title max-w-2xl"
            aria-label="超越界限，讓訓練增加驅動力"
          >
            <ScrubText text="超越界限，讓訓練增加驅動力" />
          </h2>
        </div>

        <div className="pub-head-body border-t border-white/10">
          {features.map((f) => (
            <div
              key={f.no}
              className="group -mx-4 border-b border-white/10 px-4 py-4 transition-colors hover:bg-white/[0.03] lg:grid lg:grid-cols-[7rem_1fr_1.1fr] lg:items-center lg:gap-10 lg:py-8"
            >
              <div className="pub-ghost-figure text-white/25 transition-colors group-hover:text-vital-bright">
                {f.no}
              </div>
              <h3 className="mt-2 text-xl font-black tracking-tight md:text-2xl lg:mt-0 lg:text-3xl">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-snug text-white/70 md:leading-relaxed lg:mt-0 lg:max-w-md">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const disciplinesSection = (
    <section className="pub-shell pub-band-1 pub-pad" data-fx-seq>
      <div className="container-msw">
        <div className="pub-head">
          <h2 className="pub-head-title">各類訓練項目</h2>
        </div>

        {/* 六張卡在 390 用兩欄（原本單欄六張要 1,378px），卡片降為「輔助」等級
            （.pub-card-tile：淺色帶底、無描邊），與 programs 的主卡區分開。
            桌面維持原本的不規則 Bento（DISCIPLINE_SPANS 只作用於 lg）。 */}
        <div className="pub-head-body grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-12 lg:gap-5">
          {content.disciplines.map((d, i) => (
            <article
              key={d.title}
              className={`pub-card-tile pub-card-pad pub-lift group relative overflow-hidden ${
                DISCIPLINE_SPANS[i] ?? ""
              } ${i === 0 ? "lg:min-h-[260px]" : ""}`}
              data-fx-tilt
            >
              <span className="stat-figure pointer-events-none absolute -top-2 right-3 text-4xl text-white/[0.07] transition-colors group-hover:text-vital/25 md:text-6xl">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="relative min-w-0">
                <div className="text-accent-blue text-[11px] font-semibold uppercase tracking-[0.22em]">
                  {d.sub}
                </div>
                <h3 className="mt-2 text-base font-black tracking-tight md:text-xl lg:text-2xl">
                  {d.title}
                </h3>
                <p className="mt-2 max-w-sm break-words text-[13px] leading-snug text-white/70 md:text-sm md:leading-relaxed">
                  {d.desc}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );

  const rankingSection = (
    <section
      className="pub-shell pub-band-1 relative border-t border-ink-line"
      data-fx-seq
    >
      <div className="container-msw pub-pad grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 className="pub-head-title">
            <span className="text-accent-blue block text-[0.4em] font-semibold uppercase tracking-[0.22em]">
              {monthLabel(month)}
            </span>
            <span className="block">排行榜</span>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
            依當月已確認的跑步里程排序。提交紀錄經後台確認後才會計入排名。
          </p>
          <Link
            href="/leaderboard"
            className="btn-base btn-ghost btn-slab mt-5"
            data-fx-sheen
            data-fx-magnet
          >
            查看完整排行榜 <ArrowRight size={17} />
          </Link>
        </div>

        <div className="lg:col-span-7">
          {leaders.length ? (
            <ol className="border-t border-white/10">
              {leaders.map((l, i) => (
                <li
                  key={`home-leader-${i + 1}`}
                  className="group flex items-center gap-4 border-b border-white/10 py-3.5 md:gap-5 md:py-5"
                >
                  <span className="stat-figure w-10 shrink-0 text-2xl text-white/25 transition-colors group-hover:text-vital-bright md:w-12 md:text-4xl">
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
                  <div className="shrink-0 text-right">
                    <div className="stat-figure text-xl text-white md:text-2xl">
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
            <div className="border-y border-white/10 px-6 py-10 text-center text-sm text-white/70 md:py-14">
              {isSupabaseConfigured
                ? "本月尚無已確認的跑步紀錄，成為第一位上榜者！"
                : "排行榜準備中。"}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  /**
   * 「本月場次」——首頁版日曆（B4 版本 1）。
   *
   * 站主原話：「主頁同活動頁面都可以放，請你兩個版本都做俾我睇」。
   * 首頁這一版走精簡密度（compact）：手機只留月曆格 + 顏色短條，
   * 圖例全文與說明留給 /events，避免首頁高度失控。
   *
   * 位置（站主 2026-02 指定）：緊接在統計帶之後、排行榜之前，
   * 由 render 端的 scheduleAfterId 插入。色帶用 band-0：前一塊統計帶是
   * band-1、後一塊排行榜是 band-1，夾在中間剛好深淺交替（0 → 1 → 1 會連成一片）。
   */
  const scheduleSection = (
    <section className="pub-shell pub-band-0 pub-pad" data-fx-seq>
      <div className="container-msw">
        <div className="pub-head">
          <h2 className="pub-head-title">本月場次</h2>
        </div>

        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70">
          點日期看當日的時間、教練、場地與名額，直接報名。
        </p>

        {scheduleMonth && homeSchedule ? (
          <div className="mt-6">
            <ScheduleCalendar
              // 換月時重掛載：選中的場次不該跨月沿用
              key={`${scheduleMonth.year}-${scheduleMonth.month}`}
              year={scheduleMonth.year}
              month={scheduleMonth.month}
              days={homeDays}
              legend={legend}
              classesByColor={classesByColor}
              todayISO={todayISO}
              compact
            />
          </div>
        ) : (
          <p className="mt-6 border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-sm text-white/65">
            本月班表尚未公布，公布後會出現在這裡。
          </p>
        )}

        <div className="mt-6">
          <Link href="/events" className="btn-base btn-ghost btn-slab min-h-11">
            看完整班表與顏色對照 <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );

  const ctaSection = (
    <section
      className="pub-shell pub-band-1 relative overflow-hidden border-t border-ink-line"
      data-fx-seq
    >
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

      <div className="container-msw pub-pad relative">
        <div className="grid gap-6 md:gap-12 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <h2 className="mt-4 text-4xl font-black leading-[0.95] tracking-[-0.03em] sm:text-5xl lg:text-7xl">
              {isLoggedIn ? content.cta.title_member : content.cta.title_guest}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/70">
              {isLoggedIn ? content.cta.desc_member : content.cta.desc_guest}
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 lg:col-span-4 lg:gap-4 lg:pt-16">
            {isLoggedIn ? (
              <>
                <Link
                  href="/run"
                  className="btn-base btn-vital btn-slab pub-press"
                  data-fx-sheen
                  data-fx-magnet
                >
                  {content.cta.primary_member} <ArrowRight size={18} />
                </Link>
                <Link
                  href="/training"
                  className="btn-base btn-ghost btn-slab"
                  data-fx-sheen
                  data-fx-magnet
                >
                  {content.cta.secondary_member}
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/signup"
                  className="btn-base btn-vital btn-slab pub-press"
                  data-fx-sheen
                  data-fx-magnet
                >
                  {content.cta.primary_guest} <ArrowRight size={18} />
                </Link>
                <Link
                  href="/login"
                  className="btn-base btn-ghost btn-slab"
                  data-fx-sheen
                  data-fx-magnet
                >
                  {content.cta.secondary_guest}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const sections: Record<BlockId, ReactNode> = {
    hero: heroSection,
    stats: statsSection,
    about: aboutSection,
    programs: programsSection,
    reasons: reasonsSection,
    disciplines: disciplinesSection,
    ranking: rankingSection,
    cta: ctaSection,
  };

  return (
    <>
      {/* ===== 首頁動效：純 client 掛載點，唔改變任何既有版面與文案 ===== */}
      <ScrollProgress />
      <RevealHome />
      <MarqueeBoost />
      <HoverFx />
      <BackToTop />

      {/* T-20：依 site_blocks 的 visible 過濾、依 HOME_SECTION_ORDER（站主
          2026-02 指定）排序渲染。
          首頁輪播已移到 hero 區塊內、主標題之前（見 heroSection），
          所以這裡不再跟在 hero 之後插入輪播。

          「本月場次」不是 site_blocks 的一個區塊（DB 的 BlockId 沒有這個 id，
          加進去就要改資料庫），所以固定插在統計帶之後（scheduleAfterId）；
          若統計帶被後台隱藏，就改插在第一個區塊之後，確保它不會整塊消失。 */}
      {orderedBlocks.map((b) => (
        <Fragment key={b.id}>
          {sections[b.id]}
          {b.id === scheduleAfterId ? scheduleSection : null}
        </Fragment>
      ))}
    </>
  );
}
