import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { BrandIntro } from "@/components/BrandIntro";
/* 首頁圖片輪播：資料由後台 /admin/slides 維護（表 public.home_slides） */
import { SlideCarousel } from "@/components/home/SlideCarousel";
import { getActiveSlides } from "@/lib/home-slides";
import {
  getAvailableMonths,
  getCachedMonthlyLeaderboard,
  getCachedSiteStats,
  getClassNamesByColor,
  getHyroxEvents,
  getRaceEventsForMonth,
  getScheduleLegend,
  getScheduleMonth,
  getSiteBlocks,
  getSiteContent,
  getSiteTheme,
  shiftISODate,
  type CalendarRaceRow,
} from "@/lib/queries";
import { ScheduleCalendar } from "@/components/schedule/ScheduleCalendar";
import {
  buildMonthDays,
  macauTodayISO,
  sessionRowToView,
  sortSessionViews,
  type ScheduleCta,
  type ScheduleSessionView,
  type ScheduleStatus,
} from "@/components/schedule/schedule-utils";
import type { HyroxEvent } from "@/lib/types";
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
/* 首頁「賽事推廣帶」：資料層是 src/app/races/_data.ts 的暫時實作，
   第二階段換成 @/lib/races 時這一支 import 完全不用改。
   沒有賽事時 getPromoRace() 回 null，RacePromoBand 整塊不渲染。 */
import { getPromoRace } from "./races/_data";
import { RacePromoBand } from "./races/_components/RacePromoBand";

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

/* =====================================================================
 * 首頁月曆要併入 HYROX 付費場與賽事（站主 2026-11-22）
 *
 * 站主原話：「日曆，請你主頁的也要是完整版，而且日曆中我看不到 hyrox
 * 比賽的顯示，請修正」。
 * 所以首頁月曆不再只有班表堂，而是與 /events 同一個口徑：
 *   班表堂（training_sessions）
 *   ∪ HYROX 付費場（events.series = 'hyrox'）
 *   ∪ 賽事（events.series = 'race'，多日賽事每天各一格）
 *
 * 【為什麼把 /events 的兩個函式複製過來】
 *   本輪禁區是「不改 /events」。若抽成共用模組，就必須同時改 /events 的
 *   import 與呼叫點，超出範圍。下面兩支是 `src/app/events/page.tsx` 的
 *   `hyroxToView` / `raceToViews` **鏡像**：CTA 文案、顏色語意、多日展開規則
 *   必須一致。⚠️ 日後改動 /events 那兩支時，請同步改這裡（反之亦然），
 *   否則首頁與活動頁的月曆會各講一套。
 * ===================================================================== */

/**
 * HYROX 付費場次 → 月曆格要的形狀（鏡像 /events 的 hyroxToView）。
 *
 * CTA 分三種（/hyrox/register 只認「下一個 upcoming 場次」，不讀 ?event=）：
 *   已過期 → 看場次詳情 /hyrox/[id]
 *   未登入 → /login?next=/hyrox/register?event=<id>（登入後回到報名頁）
 *   已登入 → /hyrox/register?event=<id>
 */
function hyroxHomeToView(
  event: HyroxEvent,
  todayISO: string,
  isLoggedIn: boolean
): ScheduleSessionView {
  const date = event.event_date ?? "";
  const isPast = date !== "" && date < todayISO;
  const registerHref = `/hyrox/register?event=${event.id}`;

  let cta: ScheduleCta | null;
  if (isPast) {
    // 已結束的付費場：不給報名 CTA，改成回顧頁（該頁自己會寫「已結束」）
    cta = { label: "查看活動回顧", href: `/hyrox/${event.id}` };
  } else if (isLoggedIn) {
    cta = { label: "立即報名", href: registerHref };
  } else {
    cta = {
      label: "登入後報名",
      href: `/login?next=${encodeURIComponent(registerHref)}`,
    };
  }

  return {
    id: event.id,
    kind: "hyrox",
    title: event.title,
    date,
    startTime: event.start_time ? event.start_time.slice(0, 5) : null,
    endTime: event.end_time ? event.end_time.slice(0, 5) : null,
    colorKey: null,
    coachName: null,
    location: event.location ?? null,
    capacity: event.capacity ?? null,
    status: "open",
    paid: true,
    feeCents: event.fee_cents ?? null,
    cta,
  };
}

/**
 * 賽事 → 月曆格要的形狀（鏡像 /events 的 raceToViews）。
 *
 * 【多日賽事每一天各產生一筆】11/20–11/22 的賽事要在三個格子都出現，
 * 只標第一天會讓人以為 21、22 號沒事。三筆的 id 相同，所以月曆的
 * React key 一定要帶 `date`（ScheduleCalendar 用 `${kind}-${id}-${date}`）。
 *
 * 【CTA 只有兩種，都不導向報名】已結束（以**最後一天**判斷）→ 查看賽事回顧；
 * 未結束 → 查看賽事。兩者都連 /races/[id]。
 *
 * 【paid 一律 false】`paid` 的語意是「HYROX 付費場」，會影響「需付費」徽章
 * 與付費統計；賽事不是付費場，不能混進去。
 */
function raceHomeToViews(
  event: CalendarRaceRow,
  todayISO: string
): ScheduleSessionView[] {
  const start = event.event_date;
  if (!start) return [];

  // end_date 早於 event_date（或等於）都視為單日賽事，不讓髒資料把日期倒著展開
  const end = event.end_date && event.end_date > start ? event.end_date : start;
  const ended = end < todayISO;

  const cta: ScheduleCta = ended
    ? { label: "查看賽事回顧", href: `/races/${event.id}` }
    : { label: "查看賽事", href: `/races/${event.id}` };

  const status: ScheduleStatus = event.status === "open" ? "open" : "closed";

  const views: ScheduleSessionView[] = [];
  let cursor = start;
  // 上限 60 天：end_date 若被打成 2099 年，也不至於把整個月曆灌爆
  for (let i = 0; i < 60; i += 1) {
    views.push({
      id: event.id,
      kind: "race",
      title: event.title,
      date: cursor,
      startTime: event.start_time ? event.start_time.slice(0, 5) : null,
      endTime: event.end_time ? event.end_time.slice(0, 5) : null,
      colorKey: null,
      coachName: null,
      location: event.location ?? null,
      capacity: null,
      status,
      paid: false,
      feeCents: event.fee_cents ?? null,
      cta,
    });
    if (cursor >= end) break;
    cursor = shiftISODate(cursor, 1);
  }

  return views;
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
  const [stats, leaders, profile, theme, content, blocks, slides, promoRace] =
    await Promise.all([
      getCachedSiteStats(),
      getCachedMonthlyLeaderboard(month, 5),
      getCurrentProfile(),
      getSiteTheme(),
      getSiteContent(),
      getSiteBlocks(),
      getActiveSlides(),
      // 賽事推廣帶：與上面幾支並行，不增加一個序列化的 DB round trip
      getPromoRace(),
    ]);

  /* ---------- 首頁「本月場次」日曆（B4 版本 1 → 2026-11 完整版）----------
   * 站主要求「主頁同活動頁都可以放」：首頁放日曆，讓第一次進站的人不用
   * 先找到「活動」頁才看得到班表。
   * 資料全部走 /events 同一批 cached getter（HYROX 亦同一個查詢函式），
   * 所以兩邊的月份、圖例、顏色、HYROX／賽事內容不會各講一套。
   *
   * 2026-11 站主：「主頁的也要是完整版，而且日曆中我看不到 hyrox 比賽」：
   *   ① 移除 compact（圖例全文、手機 pill 改完整標籤）
   *   ② 併入 HYROX 付費場與賽事（見上面的 hyroxHomeToView / raceHomeToViews）
   */
  const todayISO = macauTodayISO();
  const [
    availableMonths,
    legend,
    classesByColor,
    // 含 archived（往期回顧場），draft 在下面過濾掉，不能外洩。
    // 首頁是 force-dynamic，用得到讀 cookie 的版本；/events 亦係同一支。
    hyroxAll,
  ] = await Promise.all([
    getAvailableMonths(),
    getScheduleLegend(),
    getClassNamesByColor(),
    getHyroxEvents({ includeArchived: true }),
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

  // 班表與賽事都要「顯示月份」才查得到，所以兩支並行、放喺 months 之後
  const monthQueries = scheduleMonth
    ? await Promise.all([
        getScheduleMonth(scheduleMonth.year, scheduleMonth.month),
        getRaceEventsForMonth(scheduleMonth.year, scheduleMonth.month),
      ])
    : null;
  const homeSchedule = monthQueries ? monthQueries[0] : null;
  const monthRaces: CalendarRaceRow[] = monthQueries ? monthQueries[1] : [];

  const scheduleMonthKey = scheduleMonth
    ? `${scheduleMonth.year}-${String(scheduleMonth.month).padStart(2, "0")}`
    : null;

  /**
   * 當月要畫上日曆的 HYROX 場次。過濾口徑與 /events 的 hyroxInMonth 完全一致：
   * 排除 draft、必須有 event_date、且屬於顯示月份（含 archived）。
   */
  const hyroxInMonth = scheduleMonthKey
    ? hyroxAll.filter(
        (e) =>
          e.status !== "draft" &&
          e.event_date !== null &&
          e.event_date.slice(0, 7) === scheduleMonthKey
      )
    : [];

  const classViews: ScheduleSessionView[] = homeSchedule
    ? homeSchedule.sessions.map((row) => sessionRowToView(row, todayISO))
    : [];
  const hyroxViews: ScheduleSessionView[] = hyroxInMonth.map((e) =>
    // 首頁有 profile，所以 CTA 可以照登入狀態分岔（同 /events 一樣）
    hyroxHomeToView(e, todayISO, Boolean(profile))
  );
  // 賽事不受「班表是否發布」影響，一律鋪上去；跨月賽事由
  // getRaceEventsForMonth 的多日展開保證，buildMonthDays 只會把當月的日子排進格。
  const raceViews: ScheduleSessionView[] = monthRaces.flatMap((e) =>
    raceHomeToViews(e, todayISO)
  );

  const homeDays = scheduleMonth
    ? buildMonthDays({
        year: scheduleMonth.year,
        month: scheduleMonth.month,
        sessions: sortSessionViews([...classViews, ...hyroxViews, ...raceViews]),
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

            {/* 賽事推廣帶（站主要求：hero 內部、標題與標語下方附近、最醒目）。
                位置刻意放在 CTA 之後、hero 結束之前：不與主 CTA 爭第一眼，
                但仍在首屏。沒有賽事時 RacePromoBand 回傳 null，
                不留空 div、不留 margin —— 主頁總高與改動前一致。 */}
            <RacePromoBand race={promoRace} />
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
   * 「本月場次」——首頁版日曆。
   *
   * 站主原話：「主頁同活動頁面都可以放，請你兩個版本都做俾我睇」。
   * 2026-11 站主再指示：「主頁的也要是**完整版**，而且日曆中我看不到
   * hyrox 比賽的顯示」→ 已移除 compact，並併入 HYROX 付費場與賽事
   * （資料組裝見上方 hyroxHomeToView / raceHomeToViews）。
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
              /* 首頁月曆是摘要：手機議程只列「今天及之後」，避免 39 行把首頁拉長 3 屏。
                 桌面 grid 不受影響（一律整月）；/events 不傳，維持整月可回看歷史。 */
              fromTodayOnly
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

        {/* 完賽排行榜入口（站主 2026-11-22：「放到主頁」）。
            放「本月場次」之後、同一色帶內，不新增 band（避免與下一塊
            band-1 連成一片）；文案用既有字串（/hyrox 入口卡同一組），
            不發明新文案。 */}
        <div className="mt-8 card-dark flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              <Trophy size={14} /> Results
            </p>
            <h3 className="mt-2 break-words text-lg font-black tracking-tight md:text-xl">
              HYROX 完賽排行榜
            </h3>
          </div>
          <Link
            href="/hyrox/results"
            className="btn-base btn-vital btn-slab min-h-11 w-full flex-none sm:w-auto"
          >
            查看完賽排行榜 <ArrowRight size={16} />
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
