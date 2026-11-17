import type { ScheduleLegendItem } from "@/lib/types";
import { colorHex } from "./schedule-utils";

/**
 * 日曆上方的顏色圖例：`■ Running Club　■ 街健基礎力量　■ Hyrox (Engine)／Hyrox (Power)…`
 *
 * 為什麼前台一定要有它：手機的日曆格子太窄，放不下課名，改用顏色短條表示，
 * 圖例是使用者「看懂顏色」的唯一途徑 —— 所以手機也必須顯示，不能只在桌面出現。
 *
 * 顯示文字以**課程名**為準（`classesByColor`，來自 getClassNamesByColor）：
 * 站主反應舊版顯示「跑步／力量」這種通稱，看不出實際上是哪一堂課。
 * 同一個顏色底下有多個課程時，以全角斜線「／」串接。
 *
 * 降級路徑（刻意保留）：
 *   `classesByColor` 沒有這個色票鍵、或該鍵的陣列是空的（後台只建了圖例、
 *   還沒建課程，或該色課程全部被停用）→ 退回 `item.label`。
 *   後台 `LegendEditor` 改的標籤因此在「沒有課程」的情況下仍然會被顯示，
 *   所以後台完全不用改。
 *
 * 讀不到（migration 未執行）時 `items` 回空陣列 → 這裡 `return null`，
 * **不留空行、不留空白容器**，日曆照常運作。
 *
 * 色塊與短條共用 schedule-utils 的 `colorHex()`，確保圖例與格子上的顏色一致。
 */

/** 圖例文字：有課程名就用課程名，否則退回後台 label */
export function legendText(
  item: ScheduleLegendItem,
  classesByColor?: Record<string, string[]>
): string {
  // 與 getClassNamesByColor() 的 key 正規化保持一致（trim + toLowerCase）
  const key = (item.color_key ?? "").trim().toLowerCase();
  const names = classesByColor?.[key];
  if (names && names.length > 0) return names.join("／");
  return item.label;
}

export function ScheduleLegend({
  items,
  classesByColor,
}: {
  items: ScheduleLegendItem[];
  /** color_key → 課程名（getClassNamesByColor）；空物件／undefined 時退回後台 label */
  classesByColor?: Record<string, string[]>;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      aria-label="顏色圖例"
    >
      {items.map((item) => (
        // min-w-0 + max-w-full：amber 那種顏色會串出三個課程名
        // （Hyrox (Engine)／Hyrox (Foundation)／Hyrox (Power)），
        // 390 寬一定要能換行，不能撐破容器。
        // 刻意**不**截斷成省略號——截掉課程名就等於沒解釋到顏色。
        <li
          key={item.color_key}
          className="inline-flex min-w-0 max-w-full items-start gap-1.5"
        >
          <span
            aria-hidden
            className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: colorHex(item.color_key) }}
          />
          <span className="min-w-0 break-words text-[11px] leading-[1.35] text-white/70 sm:text-xs">
            {legendText(item, classesByColor)}
          </span>
        </li>
      ))}
    </ul>
  );
}
