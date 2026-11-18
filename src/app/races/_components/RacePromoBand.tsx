/**
 * src/app/races/_components/RacePromoBand.tsx — 首頁「賽事推廣帶」
 *
 * 站主要求（原話）：「呢個係唔固定嘅，當我需要用嘅時候可以顯示出嚟，
 * 並且喺最醒目嘅位置（例如主頁嘅上半部分、標題下方附近），
 * 等大家一打開就能睇到同進行報名。」
 *
 * 設計約束：
 *   · 一條橫向帶狀卡，不是大卡片；高度 390 ≤110px、1440 ≤110px
 *   · 手機 390 單欄垂直堆疊、按鈕滿寬且 ≥44px 觸控高度
 *   · 桌面 1440 一行橫排
 *   · 沒有賽事時整塊不渲染（回傳 null，不留空 div、不留 margin）
 *   · 視覺重量必須低於 hero 主 CTA（同款 btn-vital btn-slab，但小一級）
 *
 * 進場動畫刻意沿用首頁的 data-fx-reveal + --fx-d：
 *   home-fx.css:33 的隱形規則掛在 `html.fx-reveal-armed` 之下，
 *   只有 JS 成功接管後才會把元素先藏起來，所以沒有 JS 時內容 100% 可見。
 */

import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, Users } from "lucide-react";
import { formatRaceDateCompact, type Race } from "../_data";

type Props = { race: Race | null };

/** 與 src/app/page.tsx:91 的 fxDelay 同一個做法（純 CSS 變數） */
function fxDelay(seconds: number): CSSProperties {
  return { "--fx-d": `${seconds}s` } as CSSProperties;
}

export function RacePromoBand({ race }: Props) {
  // 沒有賽事：整塊不存在，不留任何空白或 margin
  if (!race) return null;

  const dateLabel = formatRaceDateCompact(race);
  const registered = race.stats?.registered ?? null;
  // 賽事名若本身已以「HYROX」開頭（站主命名習慣），左邊的小標已經寫了 HYROX，
  // 這裡只為顯示去重、不動資料；去完變空字串就照原樣顯示。
  const displayTitle = race.title.replace(/^hyrox\s*/i, "").trim() || race.title;

  return (
    <div
      className="mt-6 border border-white/10 bg-white/[0.03] px-3.5 py-2.5 md:mt-8 md:px-5 md:py-3"
      data-race-promo
      data-fx-reveal
      style={fxDelay(0.62)}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-5">
        {/* 文字區：所有子項都 min-w-0，否則 truncate 在 flex 內不生效 */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] text-vital-bright">
              HYROX
            </span>
            <span className="min-w-0 truncate text-[15px] font-bold leading-tight text-white">
              {displayTitle}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-none text-white/60">
            {dateLabel && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={12} aria-hidden className="flex-shrink-0" />
                <span className="tnum">{dateLabel}</span>
              </span>
            )}
            {race.location && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin size={12} aria-hidden className="flex-shrink-0" />
                <span className="min-w-0 break-words">{race.location}</span>
              </span>
            )}
            {registered !== null && (
              <span className="inline-flex items-center gap-1">
                <Users size={12} aria-hidden className="flex-shrink-0" />
                <span className="tnum">已報 {registered} 人</span>
              </span>
            )}
          </div>
        </div>

        {/* 主按鈕：比 hero 主 CTA 小一級（hero 是 !px-6 !py-3.5 text-[15px]） */}
        <Link
          href={`/races/${race.slug}`}
          className="btn-base btn-vital btn-slab pub-press min-h-11 w-full !px-4 !py-2.5 text-[13px] md:min-h-0 md:w-auto md:flex-shrink-0"
          data-fx-magnet
        >
          報名 <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
