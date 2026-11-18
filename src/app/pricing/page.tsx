import type { Metadata } from "next";
import {
  COURSES,
  METAL_PARTNER_BODY,
  METAL_PARTNER_TITLE,
  NOTES,
  PAYMENT,
  PRICE_GROUPS,
  type PriceGroup,
  type PriceRow,
} from "./pricing-data";

/**
 * 收費與會籍（/pricing）
 *
 * 設計前提（站主要求）：
 *  1. **先講清楚哪一樣免費、哪一樣收費、由誰收** → 第一段三張卡。這是站主最擔心的
 *     「免費／收費混淆」，所以放在價目之前，不能只寫在備註裡。
 *  2. **價目要詳細，但頁面不能太長** → 四組 `<details>` 摺疊，只有「單堂體驗」預設展開。
 *     用 `<details>/<summary>` 而不是自製 accordion：**無 JS 也能開合**，也不需要
 *     "use client"，整頁維持 server component（純靜態，不查 DB）。
 *  3. **手機優先 390**：任何寬度都不用 `<table>`（390 不允許橫向滾動的表格）。
 *     價目用 grid 排版——手機是「方案名 + 兩行價錢」的卡，lg 以上同一份 DOM
 *     變成「方案 / MSW 會員 / METAL 會員」三欄對照表。同一份 DOM 只渲染一份價錢，
 *     不會出現「桌機一份、手機一份」而兩邊價錢寫得不一樣的風險。
 *  4. 價目文字全部來自 `pricing-data.ts`，本檔只負責排版。
 */

export const metadata: Metadata = {
  title: "收費與會籍",
  description:
    "MSW 街健館收費一覽：網站會員免費，訓練課程按堂或套票收費，METAL 會籍由 Metal 健身房收取。價目、付款方式與備註逐項列明。",
};

/** 第一段三張卡：免費 / 按堂收費 / 由第三方收取 —— 逐字站主文案 */
const TIERS: readonly { tag: string; title: string; body: string }[] = [
  {
    tag: "免費",
    title: "網站會員",
    body: "註冊、報名、上載跑步紀錄、看排行榜，全部不收費。",
  },
  {
    tag: "按堂／套票收費",
    title: "MSW 訓練課程",
    body: "價目見下方。首次可單堂試，之後可買套票。",
  },
  {
    tag: "由 Metal 健身房收取",
    title: "METAL 會籍",
    body: "MSW 不代收。加入 Metal 會籍後，可用 METAL 會員價上 MSW 的課。",
  },
];

/** 章節外殼：細線分隔 + 編號標題（沿用私隱政策頁的視覺語言，不另建卡片牆） */
function Block({
  id,
  no,
  title,
  lead,
  children,
}: {
  id: string;
  no: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="min-w-0 border-t border-[var(--line-fine-strong)] pt-8">
      <h2 className="flex items-baseline gap-3 text-xl font-bold leading-snug">
        <span className="flex-none text-[11px] font-semibold uppercase tracking-[0.22em] text-vital-bright">
          {no}
        </span>
        <span className="min-w-0 break-words text-white">{title}</span>
      </h2>
      {lead ? (
        <p className="mt-2 min-w-0 break-words text-[13px] leading-relaxed text-[var(--text-muted)]">
          {lead}
        </p>
      ) : null}
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

/** 單一方案：手機＝卡片內兩行價錢；lg 以上＝三欄對照列（同一份 DOM，靠 `lg:contents` 換位） */
function PriceRowItem({ row }: { row: PriceRow }) {
  return (
    <li className="min-w-0 py-4 first:pt-0 last:pb-0 lg:grid lg:grid-cols-[minmax(0,1fr)_9rem_9rem] lg:items-start lg:gap-x-6 lg:py-3">
      <div className="min-w-0">
        <h4 className="min-w-0 break-words text-[15px] font-bold text-white">{row.name}</h4>
        <p className="mt-1 min-w-0 break-words text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          {row.include}
        </p>
      </div>

      {/*
        mobile：grid 兩行「標籤 ……… 價錢」，價錢靠右、tabular 對齊
        lg：contents → 兩格各自成為 <li> 的第 2、3 欄
      */}
      <div className="mt-2.5 grid gap-1.5 lg:mt-0 lg:contents">
        <div className="flex min-w-0 items-baseline justify-between gap-3 lg:block lg:text-right">
          <span className="flex-none text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45 lg:hidden">
            MSW 會員
          </span>
          <span
            data-price="msw"
            className="tnum flex-none whitespace-nowrap text-sm font-bold text-white"
          >
            {row.msw}
          </span>
        </div>

        <div className="flex min-w-0 items-baseline justify-between gap-3 lg:block lg:text-right">
          <span className="flex-none text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45 lg:hidden">
            METAL 會員
          </span>
          {row.metal ? (
            <span
              data-price="metal"
              className="tnum flex-none whitespace-nowrap text-sm font-bold text-white"
            >
              {row.metal}
            </span>
          ) : (
            <span className="flex-none text-sm font-bold text-white/40" aria-label="不適用">
              —
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/** 一組摺疊價目：`<details>` 原生開合，無 JS 可用 */
function PriceGroupBlock({ group }: { group: PriceGroup }) {
  return (
    <details
      data-pricing-group={group.key}
      open={group.open}
      className="group card-dark min-w-0 overflow-hidden"
    >
      <summary className="pub-focus-ring flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04] sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block min-w-0 break-words text-[15px] font-bold text-white">
            {group.title}
          </span>
          <span className="tnum mt-0.5 block min-w-0 break-words text-[12px] text-white/50">
            {group.hint}
          </span>
        </span>
        <span
          aria-hidden
          className="flex-none text-lg leading-none text-vital-bright transition-transform duration-300 group-open:rotate-45"
        >
          +
        </span>
      </summary>

      <div data-pricing-panel className="border-t border-ink-line px-4 pb-4 pt-3 sm:px-5">
        {/* 桌機欄頭；手機隱藏，改由每行前置標籤說明 */}
        <div className="hidden pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45 lg:grid lg:grid-cols-[minmax(0,1fr)_9rem_9rem] lg:gap-x-6">
          <span>方案</span>
          <span className="text-right">MSW 會員</span>
          <span className="text-right">METAL 會員</span>
        </div>
        <ul className="divide-y divide-[var(--line-fine)]">
          {group.rows.map((row) => (
            <PriceRowItem key={row.name} row={row} />
          ))}
        </ul>
      </div>
    </details>
  );
}

export default function PricingPage() {
  return (
    <>
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div
          className="pointer-events-none absolute -right-[16%] -top-[40%] h-[560px] w-[560px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.4,
          }}
        />
        <div className="clip-notch pointer-events-none absolute -bottom-14 -left-24 h-64 w-64 bg-vital/10" />
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="relative pb-10 pt-24 md:pt-32">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-vital-bright">
              Pricing / 收費
            </p>
            <h1 className="display-xl mt-4">
              <span className="block text-white">收費</span>
              <span className="relative mt-1 block text-vital-bright">與會籍</span>
            </h1>
            <p className="mt-4 max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
              網站註冊永久免費。下面先分清「邊樣要收費、由邊個收」，再逐項列價目。
            </p>
          </div>
        </div>
      </section>

      <div className="container-msw section-pad">
        <div className="space-y-10">
          {/* ================= 01 三層收費 ================= */}
          <Block
            id="tiers"
            no="01"
            title="三種收費，先分清"
            lead="網站會員、MSW 訓練課程、METAL 會籍是三件不同的事，收費方式與收款方都不同。"
          >
            <ul className="grid gap-3 md:grid-cols-3">
              {TIERS.map((tier) => (
                <li key={tier.title} className="card-dark flex min-w-0 flex-col gap-2 p-4 sm:p-5">
                  <span className="w-fit flex-none border border-[var(--line-hairline-strong)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-vital-bright">
                    {tier.tag}
                  </span>
                  <h3 className="min-w-0 break-words text-base font-extrabold text-white">
                    {tier.title}
                  </h3>
                  <p className="min-w-0 break-words text-[13px] leading-relaxed text-[var(--text-muted)]">
                    {tier.body}
                  </p>
                </li>
              ))}
            </ul>
          </Block>

          {/* ================= 02 MSW 課程價目 ================= */}
          <Block
            id="prices"
            no="02"
            title="MSW 課程價目"
            lead="四組價目，點開看細節。手機為每方案一張卡，桌機為兩欄對照。"
          >
            <div className="space-y-2.5">
              {PRICE_GROUPS.map((group) => (
                <PriceGroupBlock key={group.key} group={group} />
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-white/45">
              價目以澳門幣（MOP）計算；「METAL 會員」欄的價錢需持有效 METAL 會籍。
            </p>
          </Block>

          {/* ================= 03 課程一覽 ================= */}
          <Block
            id="courses"
            no="03"
            title="課程一覽"
            lead="以上價目適用於以下六個課程。"
          >
            <ul className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
              {COURSES.map((course) => (
                <li key={course.name} className="card-dark min-w-0 p-3.5">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-[13.5px] font-bold leading-snug text-white">
                      {course.name}
                    </h3>
                    <span className="tnum flex-none whitespace-nowrap text-[10.5px] text-white/40">
                      {course.minutes} 分鐘
                    </span>
                  </div>
                  <p className="mt-1.5 min-w-0 break-words text-[12px] leading-[1.55] text-[var(--text-muted)]">
                    {course.desc}
                  </p>
                </li>
              ))}
            </ul>
          </Block>

          {/* ================= 04 付款方式 ================= */}
          <Block id="payment" no="04" title="付款方式">
            <p className="card-dark min-w-0 break-words p-4 text-[13px] leading-[1.85] text-[var(--text-muted)] sm:p-5">
              {PAYMENT}
            </p>
          </Block>

          {/* ================= 05 備註 ================= */}
          <Block id="notes" no="05" title="備註">
            <ul className="space-y-3">
              {NOTES.map((note) => (
                <li key={note} className="flex min-w-0 gap-3 text-[13px] leading-relaxed">
                  <span
                    aria-hidden
                    className="mt-[0.62em] block h-1.5 w-1.5 flex-none rotate-45 bg-vital-bright"
                  />
                  <span className="min-w-0 break-words text-[var(--text-muted)]">{note}</span>
                </li>
              ))}
            </ul>
          </Block>

          {/* ================= 06 METAL 會籍合作 ================= */}
          <Block id="metal" no="06" title={METAL_PARTNER_TITLE}>
            <p className="card-dark min-w-0 break-words p-4 text-[13px] leading-[1.85] text-[var(--text-muted)] sm:p-5">
              {METAL_PARTNER_BODY}
            </p>
          </Block>

        </div>
      </div>
    </>
  );
}
