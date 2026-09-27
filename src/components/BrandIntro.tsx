import { ABOUT } from "@/lib/config";

/** 關鍵詞強調：紅色用 vital-bright（對 ink ≈ 5.1:1，達 WCAG AA） */
const ACCENT_VITAL = "font-bold text-vital-bright";
/** 次一級：只做字重與明度變化，不搶紅色 */
const ACCENT_STRONG = "font-bold text-white";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把段落中的關鍵詞包成強調片段，其餘文字原樣輸出。
 * 文案本體以 config 的完整字串為唯一來源（不為了排版切段），
 * 因此用字永遠與站主提供的原文一致。
 *
 * @param terms 紅色強調
 * @param strong 白色加粗（低調版強調）
 */
function Emphasize({
  text,
  terms = [],
  strong = [],
}: {
  text: string;
  terms?: readonly string[];
  strong?: readonly string[];
}) {
  const all = [...terms, ...strong];
  if (all.length === 0) return <>{text}</>;

  const chunks = text.split(new RegExp(`(${all.map(escapeRegExp).join("|")})`, "g"));

  return (
    <>
      {chunks.map((chunk, i) => {
        if (terms.includes(chunk)) {
          return (
            <span key={i} className={ACCENT_VITAL}>
              {chunk}
            </span>
          );
        }
        if (strong.includes(chunk)) {
          return (
            <span key={i} className={ACCENT_STRONG}>
              {chunk}
            </span>
          );
        }
        return chunk;
      })}
    </>
  );
}

/**
 * 首頁「關於我們」區塊。
 * 版式刻意不對稱：第一段是宣言式大字主敘述，第二、三段走 1.6 : 1 的
 * 主段 + 側欄引言，不使用等寬卡片、圖標或折疊塊。
 */
export function BrandIntro() {
  return (
    <section id="about" className="relative overflow-hidden border-b border-ink-line">
      {/* 手工質感：細網格 + 噪點（沿用其他區塊） */}
      <div className="grid-lines absolute inset-0" aria-hidden />
      <div className="noise-overlay" aria-hidden />
      {/* 單側光暈（只在左，刻意不對稱）；用底色透明度而非元素 opacity */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-1/3 h-80 w-80 rounded-full bg-cobalt/10 blur-[120px]"
      />
      {/* 右下幾何色塊：取代第二顆光暈 */}
      <div
        aria-hidden
        className="clip-notch pointer-events-none absolute -bottom-10 -right-16 hidden h-40 w-40 bg-vital/[0.07] sm:block"
      />

      <div className="container-msw section-pad relative">
        {/* ===== 01：宣言式主敘述 ===== */}
        <div className="grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-14">
          <div className="flex items-center gap-5 lg:flex-col lg:items-start lg:gap-6">
            <span
              aria-hidden
              className="stat-figure text-5xl text-outline md:text-6xl lg:text-7xl"
            >
              01
            </span>
            <span aria-hidden className="vlabel hidden text-white/40 lg:block">
              Who We Are
            </span>
          </div>

          <div>
            <span className="eyebrow">{ABOUT.eyebrow}</span>
            <h2 className="mt-6 max-w-4xl text-[clamp(1.35rem,2.6vw,2rem)] font-black leading-[1.35] tracking-[-0.01em] text-white">
              <Emphasize text={ABOUT.lead} terms={["Street Workout", "HYROX"]} />
            </h2>
          </div>
        </div>

        {/* ===== 02：不對稱雙欄（理念 / 號召） ===== */}
        <div className="mt-12 grid gap-10 border-t border-[var(--line-fine-strong)] pt-12 lg:mt-16 lg:grid-cols-[1.6fr_1fr] lg:gap-16 lg:pt-14">
          <p className="text-base leading-[1.9] text-[var(--text-muted)] lg:text-lg">
            <Emphasize
              text={ABOUT.philosophy}
              terms={["生活態度"]}
              strong={["挑戰自身極限"]}
            />
          </p>

          {/* 側欄引言：垂直細線 + 菱形標記，不做卡片 */}
          <div className="lg:border-l lg:border-[var(--line-fine-strong)] lg:pl-8">
            <span
              aria-hidden
              className="mb-4 block h-1.5 w-1.5 rotate-45 bg-vital-bright"
            />
            <p className="text-base leading-[1.9] text-white/80">
              {ABOUT.cta}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
