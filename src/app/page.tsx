import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandIntro } from "@/components/BrandIntro";
/* 首頁圖片輪播：資料由後台 /admin/slides 維護（表 public.home_slides） */
import { SlideCarousel } from "@/components/home/SlideCarousel";
import { getActiveSlides } from "@/lib/home-slides";
import {
  getAvailableMonths,
  getCachedMonthlyLeaderboard,
  getCachedSiteStats,
  getClassNamesByColor,
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
import type { BlockId, SiteBlock } from "@/lib/content";
import { publicAssetUrl } from "@/lib/assets";
import {
  currentMonth,
  formatKm,
  monthLabel,
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

export const dynamic = "force-dynamic";

/**
 * 首頁區塊的固定渲染順序（站主指定）。
 *
 * 為什麼不再用 `site_blocks.order` 排序：DB 的 order 是舊次序（about 緊隨
 * stats、programs 在 reasons 之前）。這裡以站主的指定為準，改由本常數決定
 * 順序；**後台的 visible 仍然有效**（隱藏某個區塊照樣即時消失）。
 *
 * 2026-11 改版：站主要求「頁面重要的往上移」，`programs`（兩大核心活動）與
 * `disciplines`（各類訓練項目）已整段下架，故不在本表內。`BlockId` 型別仍
 * 保留這兩個 id（後台 site_blocks 的資料未變、也不該為了前台改 schema），
 * 所以這裡改用子集型別 `HomeBlockId`，避免 `sections` 對照表被迫塞入已刪除
 * 的區塊。
 *
 * 註：「本月場次」不是 BlockId（DB 沒有這個 id，加進去要改 schema），
 * 它由下方的 scheduleAfterId 掛在統計帶之後。
 */
const HOME_SECTION_ORDER = [
  "hero",
  "stats",
  "ranking",
  "reasons",
  "about",
  "cta",
] as const;

type HomeBlockId = (typeof HOME_SECTION_ORDER)[number];

const isHomeBlockId = (id: BlockId): id is HomeBlockId =>
  (HOME_SECTION_ORDER as readonly BlockId[]).includes(id);

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
  const [stats, leaders, profile, theme, content, blocks, slides] =
    await Promise.all([
      getCachedSiteStats(),
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

  /* 2026-11：hero 右欄（含「下一場定期訓練」卡與倒數）已下架——場次資訊在
     下方「本月場次」日曆與 /training 已有，屬重複。倒數目標時刻
     （countdownTargetISO）與 Countdown 用法一併移除。 */
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
  // （站主指定）決定，理由見該常數的註解。
  // 2026-11：DB 的 site_blocks 仍留著 programs／disciplines 兩個 id（後台資料
  // 未改），這裡用 isHomeBlockId 把它們濾掉，否則會渲染出 undefined 造成空白。
  const orderedBlocks = blocks.home
    .filter(
      (b): b is SiteBlock & { id: HomeBlockId } =>
        b.visible && isHomeBlockId(b.id)
    )
    .sort(
      (a, b) =>
        HOME_SECTION_ORDER.indexOf(a.id) - HOME_SECTION_ORDER.indexOf(b.id)
    );

  /** 「本月場次」緊接統計帶之後；統計帶若被後台隱藏，退回接在第一個區塊之後 */
  const scheduleAfterId: HomeBlockId | undefined = orderedBlocks.some(
    (b) => b.id === "stats"
  )
    ? "stats"
    : orderedBlocks[0]?.id;

  /* ============ 首頁 6 個區塊（T-20：visible 由 site_blocks 決定，
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
            {/* 2026-11 改版（站主要求）：
                ─ 桌面：大標題在左、標語在右，同一列（12 欄切 7／5、底部對齊）。
                ─ 手機：窄屏沒有一列兩欄的空間，標語仍在大標題下方。
                ─ h1 的 lg:-ml-[3vw] lg:w-[112%] 出血設計保留（站主要的大字），
                  但外層兩欄都加了 min-w-0，出血量只吃掉欄距，不會壓到標語、
                  也不會把標語推出視窗右緣。
                ─ 原 hero 右欄（我的帳戶 CTA／上傳跑步紀錄 CTA／下一場定期訓練卡）
                  整塊下架；兩顆 CTA 移到下方一行，入口不消失。 */}
            <div className="lg:grid lg:grid-cols-12 lg:items-end lg:gap-8">
              {/* 標題欄 */}
              <div className="min-w-0 lg:col-span-7">
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
              </div>

              {/* 標語欄（= site_content.hero.desc，文案一字未改） */}
              <div className="min-w-0 lg:col-span-5 lg:pb-1">
                <p
                  className="mt-6 break-words text-base leading-relaxed text-white/70 sm:text-lg lg:mt-0"
                  data-fx-reveal
                  style={fxDelay(0.34)}
                >
                  {renderHeroDesc(content.hero.desc)}
                </p>
              </div>
            </div>

            {/* 兩顆 CTA：搬到標題下方一行（文案、類別與登入／未登入兩套分支原樣保留） */}
            <div
              className="mt-6 flex flex-wrap items-center gap-3 md:mt-8"
              data-fx-reveal
              style={fxDelay(0.48)}
            >
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

  /* 「超越界限，讓訓練增加驅動力」——2026-11 站主要求把重要區塊往上移，
     刪掉 programs／disciplines 之後，這一塊夾在排行榜與關於我們之間；
     色帶由 band-0 改為 band-2：about 是 BrandIntro（component，固定 band-0），
     原本兩塊相鄰同色，改用最亮的一層讓 ranking(1) → reasons(2) → about(0) 三段都不同。 */
  const reasonsSection = (
    <section
      className="pub-shell pub-band-2 relative border-y border-ink-line"
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
            依當月已確認的跑步里程排序。
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

  /* 2026-11：programs（兩大核心活動）與 disciplines（各類訓練項目）已整段下架，
     所以對照表只剩 6 個區塊；型別用 HomeBlockId 子集，BlockId 本身不動。 */
  const sections: Record<HomeBlockId, ReactNode> = {
    hero: heroSection,
    stats: statsSection,
    about: aboutSection,
    reasons: reasonsSection,
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

      {/* T-20：依 site_blocks 的 visible 過濾、依 HOME_SECTION_ORDER（站主指定）
          排序渲染。2026-11 起 programs／disciplines 已下架，DB 若仍把它們設為
          visible，會被 isHomeBlockId 過濾掉（不會渲染成空白區塊，也不會壞排序）。
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
