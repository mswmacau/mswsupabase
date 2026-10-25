/**
 * src/lib/contrast.ts — WCAG 2.1 顏色對比度檢查（T-18）
 *
 * Owner：方砚。純函數模組：不依賴 React、DOM 或任何瀏覽器 API，
 * server 元件、client 元件、node 腳本都用得（驗證時可直接 import 實算）。
 *
 * 用途：後台「網站設定」儲存前檢查主題 9 個色槽的實際搭配，
 * 低於 WCAG AA 時在儲存按鈕旁顯示黃色警告（列出具體配對與比值），
 * 但**不阻擋儲存**——站長仍可自行決定。
 *
 * 公式（WCAG 2.1 relative luminance）：
 *   1) sRGB 通道線性化：c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4
 *   2) L = 0.2126·R + 0.7152·G + 0.0722·B
 *   3) ratio = (L_light + 0.05) / (L_dark + 0.05)
 * 閾值：正常文字 4.5:1；大字（≥18.66px 粗體／≥24px）與粗體 3:1。
 */

import type { ThemeColorField } from "./theme";

/** 正常文字的 AA 閾值 */
export const AA_NORMAL = 4.5;
/** 大字／粗體的 AA 閾值 */
export const AA_LARGE = 3;

/** 一組「前景（文字）壓在背景上」的語義配對 */
export interface ContrastPair {
  /** 前景（文字）色欄位 */
  fg: ThemeColorField;
  /** 背景色欄位 */
  bg: ThemeColorField;
  /** true = 大字／粗體場景（閾值 3:1）；省略或 false = 正常文字（4.5:1） */
  large?: boolean;
}

/** 一組未達標的配對（含實際比值，供警告條直接顯示） */
export interface ContrastProblem {
  fg: ThemeColorField;
  bg: ThemeColorField;
  large: boolean;
  /** 實際比值（四捨五入到兩位小數） */
  ratio: number;
  /** 適用的閾值（4.5 或 3） */
  required: number;
}

/** 只取 9 個色槽的型別（SiteTheme 結構上相容，方便直接傳入） */
export type ThemeColors = Partial<Record<ThemeColorField, string>>;

/**
 * 解析 #RGB / #RRGGBB（大小寫皆可）→ [r, g, b]（0–255）。
 * 其他格式（rgb()、3 位不含 #、空字串等）與非字串輸入一律回 null——
 * 呼叫方「優雅跳過」，不拋錯。
 */
export function parseHex(hex: string): [number, number, number] | null {
  // P2-1（T-28 驗收）：非字串輸入（null／undefined／數字）回 null，
  // 遵守本檔「不拋錯」契約；checkContrast 另有 typeof 護欄，此為深度防禦。
  if (typeof hex !== "string") return null;
  const m = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!m) return null;
  const body = m[1];
  if (body.length === 3) {
    return [
      parseInt(body[0] + body[0], 16),
      parseInt(body[1] + body[1], 16),
      parseInt(body[2] + body[2], 16),
    ];
  }
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ];
}

/** sRGB 通道（0–255）→ 線性化（0–1） */
function linearize(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 相對亮度 L（0–1） */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linearize) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 兩個 hex 顏色的 WCAG 對比度（1–21）。
 * 任一色不是合法 hex → 回 null（呼叫方跳過該配對，不當成 0 或不拋錯）。
 */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 檢查一組配對，回未達標清單（依傳入順序）。
 * 色值不是合法 hex 的配對直接跳過（不列入問題、不拋錯）。
 */
export function checkContrast(
  colors: ThemeColors,
  pairs: readonly ContrastPair[]
): ContrastProblem[] {
  const problems: ContrastProblem[] = [];
  for (const pair of pairs) {
    const fg = colors[pair.fg];
    const bg = colors[pair.bg];
    if (typeof fg !== "string" || typeof bg !== "string") continue;

    const ratio = contrastRatio(fg, bg);
    if (ratio === null) continue; // 非 hex（理論上不會發生：theme 驗證已把關）

    const required = pair.large ? AA_LARGE : AA_NORMAL;
    if (ratio < required) {
      problems.push({
        fg: pair.fg,
        bg: pair.bg,
        large: Boolean(pair.large),
        ratio: Math.round(ratio * 100) / 100,
        required,
      });
    }
  }
  return problems;
}

/* =============================================================
 * 前台實際搭配（依 theme.ts 的 9 個色槽語義 + globals.css 真實用法）
 * =============================================================
 *
 * 正常文字（4.5:1）：
 *  - 白字壓主背景（layout: bg-ink text-white）
 *  - 白字壓卡片深底（各頁 bg-ink-soft + text-white）
 *  - 墨字壓淺色卡片底（globals.css .card-light: color-paper + color-ink）
 *  - 白字壓活力紅主按鈕（.btn-vital）
 *  - 白字壓鈷藍連結／按鈕（.btn-cobalt）
 *
 * 大字／粗體（3:1）：
 *  - 亮紅（stat-figure／標題強調）壓卡片深底
 *  - 亮鈷藍（數字強調／hover）壓卡片深底
 *
 * 刻意不納入：
 *  - color_ink_line（深分割線）：裝飾性分隔，不是文字背景；
 *  - text-white/70 等帶透明度的衍生色：以基礎色為準做參考檢查，
 *    透明度的實際效果取決於後方堆疊，超出靜態檢查範圍。
 */
export const THEME_CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: "color_white", bg: "color_ink" },
  { fg: "color_white", bg: "color_ink_soft" },
  { fg: "color_ink", bg: "color_paper" },
  { fg: "color_white", bg: "color_vital" },
  { fg: "color_white", bg: "color_cobalt" },
  { fg: "color_vital_bright", bg: "color_ink_soft", large: true },
  { fg: "color_cobalt_bright", bg: "color_ink_soft", large: true },
] as const;

/** 便捷函式：直接檢查一份主題（等同 checkContrast(theme, THEME_CONTRAST_PAIRS)） */
export function checkThemeContrast(theme: ThemeColors): ContrastProblem[] {
  return checkContrast(theme, THEME_CONTRAST_PAIRS);
}
