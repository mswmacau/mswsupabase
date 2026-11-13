import type { ScheduleLegendItem } from "@/lib/types";
import { colorHex } from "./schedule-utils";

/**
 * 日曆上方的顏色圖例：`■ 跑步　■ 力量　■ HYROX 專項 …`
 *
 * 為什麼前台一定要有它：手機的日曆格子太窄，放不下課名，改用顏色短條表示，
 * 圖例是使用者「看懂顏色」的唯一途徑 —— 所以手機也必須顯示，不能只在桌面出現。
 *
 * 資料來自 `getScheduleLegend()`（後台可編輯）。
 * 讀不到（migration 未執行）時回空陣列 → 這裡 `return null`，
 * **不留空行、不留空白容器**，日曆照常運作。
 *
 * 色塊與短條共用 schedule-utils 的 `colorHex()`，確保圖例與格子上的顏色一致。
 */
export function ScheduleLegend({ items }: { items: ScheduleLegendItem[] }) {
  if (items.length === 0) return null;

  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      aria-label="顏色圖例"
    >
      {items.map((item) => (
        <li key={item.color_key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: colorHex(item.color_key) }}
          />
          <span className="text-[11px] leading-none text-white/70 sm:text-xs">
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
