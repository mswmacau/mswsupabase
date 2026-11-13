import Link from "next/link";
import { ArrowRight, CalendarDays, Flame, Route } from "lucide-react";

/**
 * 三張分類卡：活動總覽的固定入口。
 *
 * 為什麼是獨立元件而不是寫在 page.tsx：
 *   這三張卡與資料無關（不論當月有沒有班表、有沒有 HYROX 場次都必須顯示），
 *   拆出來讓「常駐」這件事在程式碼上看得出來，也避免日後被條件渲染包進去
 *   —— 舊版 /events 正是把整段內容放在 `events.length > 0` 分支裡，
 *   沒有活動時整頁只剩 hero 和 CTA。
 */

const CARDS = [
  {
    href: "/hyrox",
    tag: "Program 01",
    title: "戶外 HYROX 訓練",
    desc: "每月一場，離開冷氣房的體能測試。付費報名，名額有限。",
    Icon: Flame,
    // 與日曆上的「付費場次」同一個橙：同一個意思就用同一個顏色
    accent: "#fb923c",
  },
  {
    href: "/training",
    tag: "Program 02",
    title: "定期訓練",
    desc: "每週固定開課，一堂一堂跟著練。現場簽到，後台確認後入帳。",
    Icon: CalendarDays,
    accent: "var(--color-cobalt-bright)",
  },
  {
    href: "/run",
    tag: "Program 03",
    title: "月度跑步累積",
    desc: "線上進行，把每一步算進里程。上傳截圖，月底統一結算。",
    Icon: Route,
    accent: "var(--color-vital-bright)",
  },
] as const;

export function CategoryCards() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {CARDS.map(({ href, tag, title, desc, Icon, accent }) => (
        <Link
          key={href}
          href={href}
          className="clip-notch group relative flex min-h-[196px] flex-col overflow-hidden border border-white/10 bg-ink-soft p-6 z-raise"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-70 transition-opacity duration-500 group-hover:opacity-100"
            style={{ backgroundColor: accent }}
          />

          <div className="flex items-center justify-between gap-3">
            <span
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center border"
              style={{
                color: accent,
                borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
              }}
            >
              <Icon size={18} />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
              {tag}
            </span>
          </div>

          <h3 className="mt-6 text-lg font-black tracking-tight text-white md:text-xl">
            {title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed break-words text-white/65">
            {desc}
          </p>

          <span className="mt-auto inline-flex items-center gap-2 pt-6 text-[12px] font-semibold tracking-[0.12em] text-white/70 transition-colors group-hover:text-white">
            了解詳情
            <ArrowRight
              size={15}
              className="transition-transform duration-500 group-hover:translate-x-1"
            />
          </span>
        </Link>
      ))}
    </div>
  );
}
