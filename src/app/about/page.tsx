import Link from "next/link";
import { ArrowUpRight, AtSign } from "lucide-react";
import { CountUp } from "@/components/fx/CountUp";
import { getCachedSiteStats } from "@/lib/queries";
import { ABOUT, BRAND } from "@/lib/config";

export const metadata = { title: "關於我們" };
export const dynamic = "force-dynamic";

/**
 * 關於我們（基礎版）
 *
 * - 所有中文文案一律由 config 嘅 ABOUT / BRAND 讀出，呢個檔案唔寫死任何一格字
 * - 數字全部嚟自 getCachedSiteStats()（site_stats，120 秒 cache），用 F-G2 嘅 CountUp
 * - IG 連結重用 BRAND.instagramUrl（同 footer 同一個，冇新增 config 欄位）
 *
 * 未做：F-A1 成立時間線、F-A2 教練卡（等站主提供文案 / 教練資料 + 相片）
 */
export default async function AboutPage() {
  const stats = await getCachedSiteStats();

  // 標籤同數字單位沿用真站現有用字（首頁「累積數據」區塊）
  const figures = [
    { value: stats.total_km, unit: "km", label: "累積跑步里程", accent: true },
    { value: stats.members, unit: "人", label: "MSW 會員", accent: false },
    { value: stats.total_sessions, unit: "場", label: "已開訓練場次", accent: false },
  ];

  return (
    <>
      {/* ================= HERO：沿用真站 hero 排版 ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div
          className="pointer-events-none absolute -right-[16%] -top-[40%] h-[640px] w-[640px] rounded-full blur-[135px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.45,
          }}
        />
        <div className="clip-notch pointer-events-none absolute -bottom-14 -left-24 h-64 w-64 bg-vital/10" />

        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="relative pb-14 pt-28 md:pt-36 lg:pb-16">
            <div className="absolute left-0 top-40 hidden lg:block">
              <span className="vlabel text-white/50">{BRAND.nameEn}</span>
            </div>

            <div className="lg:pl-14">
              <span className="eyebrow">{ABOUT.eyebrow}</span>

              <h1 className="mt-6 lg:-ml-[3vw] lg:w-[112%]">
                <span className="display-xl block text-white">關於我們</span>
                <span className="relative mt-1 block">
                  <span
                    aria-hidden
                    className="display-xl text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block"
                  >
                    About
                  </span>
                  <span className="display-xl relative block text-vital-bright">
                    About
                  </span>
                </span>
              </h1>

              <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
                <p className="text-base leading-relaxed text-white/70 lg:col-span-7 sm:text-lg">
                  {ABOUT.lead}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 理念 / 號召：宣言式排版，唔用圓角卡 ============ */}
      <section className="container-msw section-pad">
        <div className="grid gap-10 border-t border-[var(--line-fine-strong)] pt-12 lg:grid-cols-[1.6fr_1fr] lg:gap-16 lg:pt-14">
          <p className="text-base leading-[1.9] text-[var(--text-muted)] lg:text-lg">
            {ABOUT.philosophy}
          </p>

          {/* 側欄引言：垂直細線 + 菱形標記（同首頁 BrandIntro 一致） */}
          <div className="lg:border-l lg:border-[var(--line-fine-strong)] lg:pl-8">
            <span
              aria-hidden
              className="mb-4 block h-1.5 w-1.5 rotate-45 bg-vital-bright"
            />
            <p className="text-base leading-[1.9] text-white/80">{ABOUT.cta}</p>
          </div>
        </div>
      </section>

      {/* ============ 累積數字：CountUp（F-G2 / F-A3） ============ */}
      <section className="relative border-y border-ink-line bg-ink-soft">
        <div className="grid-lines absolute inset-0" />
        <div className="container-msw relative">
          <div className="grid grid-cols-1 gap-y-12 py-14 md:py-20 lg:grid-cols-3">
            {figures.map((f, i) => (
              <div
                key={f.label}
                className={`px-5 ${i > 0 ? "md:border-l md:border-white/10" : ""} ${
                  i === 1 ? "lg:mt-12" : i === 2 ? "lg:mt-6" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`stat-figure text-5xl leading-none md:text-6xl lg:text-7xl ${
                      f.accent ? "text-vital-bright" : "text-white"
                    }`}
                  >
                    <CountUp value={f.value} />
                  </span>
                  <span className="text-accent-blue mt-2 text-[11px] font-semibold uppercase tracking-[0.22em]">
                    {f.unit}
                  </span>
                </div>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                  {f.label}
                </div>
                <div className="mt-4 h-px w-10 bg-white/20" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 追蹤我們：IG（重用 BRAND.instagramUrl） ============ */}
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
              <span className="eyebrow">{BRAND.nameEn}</span>
              <h2 className="display-xl mt-6">追蹤我們</h2>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/70">
                {BRAND.tagline}。
              </p>
            </div>

            <div className="flex flex-col items-start gap-4 lg:col-span-5 lg:pl-10">
              <a
                href={BRAND.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex min-h-11 items-center gap-2.5 text-lg font-semibold text-white transition-colors hover:text-vital-bright"
              >
                <span className="flex-none text-vital-bright">
                  <AtSign size={18} aria-hidden />
                </span>
                <span className="min-w-0 break-all">{BRAND.instagram}</span>
                <ArrowUpRight
                  size={16}
                  aria-hidden
                  className="flex-none opacity-60 transition-opacity group-hover:opacity-100"
                />
                <span className="sr-only">（另開新視窗）</span>
              </a>

              <Link href="/training" className="btn-base btn-ghost btn-slab">
                報名訓練場次
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
