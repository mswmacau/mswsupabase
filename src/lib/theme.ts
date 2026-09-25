/**
 * src/lib/theme.ts — 網站主題型別、預設值與 CSS 變數產生器
 *
 * Owner：白客（backend-engineer）
 * 方砚只讀：import 型別 / DEFAULT_THEME / FONT_PRESETS / COLOR_PALETTE /
 *           normalizeTheme / themeCssVars，不要修改本檔。
 *
 * 契約來源：SPEC-R6.md §1.3（SiteTheme 結構）、§2.6（驗證規則）、§3.3（CSS 變數）
 *
 * 驗證邏輯只有一份：Route Handler 用 normalizeTheme()（回傳欄位級錯誤），
 * 讀取路徑用 coerceTheme()（失敗一律退回預設值，不拋例外），
 * 兩者共用同一個 normalizeInternal()。
 */

export type FontPreset = "classic" | "system" | "serif" | "custom";

/** 9 個顏色欄位的 key */
export type ThemeColorField =
  | "color_ink"
  | "color_ink_soft"
  | "color_ink_line"
  | "color_paper"
  | "color_cobalt"
  | "color_cobalt_bright"
  | "color_vital"
  | "color_vital_bright"
  | "color_white";

export interface SiteTheme {
  brand_name: string; // 1–60
  brand_name_en: string; // 1–80
  tagline_zh: string | null; // ≤120，null = 空
  tagline_en: string | null; // ≤160，null = 空
  logo_path: string | null; // ^logo/…(jpg|jpeg|png|webp)$，null = 用文字 LOGO
  hero_bg_path: string | null; // ^hero/…(jpg|jpeg|png|webp)$，null = 用漸層預設背景
  color_ink: string; // #RRGGBB
  color_ink_soft: string;
  color_ink_line: string;
  color_paper: string;
  color_cobalt: string;
  color_cobalt_bright: string;
  color_vital: string;
  color_vital_bright: string;
  color_white: string;
  font_preset: FontPreset;
  font_stack_custom: string | null; // 僅 font_preset==='custom' 時有效，≤300
  radius_card: number; // 0–32 px
  radius_btn: number; // 0–9999 px
  radius_field: number; // 0–24 px
  container_max: number; // 960–1440 px
  space_section: number; // 48–160 px
  hero_overlay_opacity: number; // 0–0.9
}

export const COLOR_FIELDS: readonly ThemeColorField[] = [
  "color_ink",
  "color_ink_soft",
  "color_ink_line",
  "color_paper",
  "color_cobalt",
  "color_cobalt_bright",
  "color_vital",
  "color_vital_bright",
  "color_white",
] as const;

/** §3.3：貴/client 指定的 5 組色票，每個顏色欄位同時提供 chip + 原生色盤 + hex 輸入 */
export interface ColorPaletteGroup {
  label: string;
  /** 一組可能對應多個欄位（例如鈷藍 → color_cobalt，亮鈷藍 → color_cobalt_bright） */
  swatches: { field: ThemeColorField; hex: string; label: string }[];
}

export const COLOR_PALETTE: readonly ColorPaletteGroup[] = [
  {
    label: "近黑",
    swatches: [
      { field: "color_ink", hex: "#0F0F0F", label: "近黑" },
      { field: "color_ink_soft", hex: "#0F0F0F", label: "近黑" },
      { field: "color_ink_line", hex: "#0F0F0F", label: "近黑" },
    ],
  },
  {
    label: "純白",
    swatches: [
      { field: "color_white", hex: "#FFFFFF", label: "純白" },
      { field: "color_paper", hex: "#FFFFFF", label: "純白" },
    ],
  },
  {
    label: "鈷藍",
    swatches: [
      { field: "color_cobalt", hex: "#0047AB", label: "鈷藍" },
      { field: "color_cobalt_bright", hex: "#0057FF", label: "亮鈷藍" },
    ],
  },
  {
    label: "活力紅",
    swatches: [
      { field: "color_vital", hex: "#E3001B", label: "活力紅" },
      { field: "color_vital_bright", hex: "#FF2D2D", label: "亮紅" },
    ],
  },
  {
    label: "淺灰白",
    swatches: [{ field: "color_paper", hex: "#F5F5F7", label: "淺灰白" }],
  },
] as const;

export interface FontPresetDef {
  label: string;
  /** 全部在地系統字，不載外部字體 */
  stack: string;
}

export const FONT_PRESETS: Record<FontPreset, FontPresetDef> = {
  classic: {
    label: "現代無襯線（現況）",
    stack:
      'Inter, "PingFang TC", "PingFang SC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  system: {
    label: "系統預設",
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif',
  },
  serif: {
    label: "襯線（正式感）",
    stack: '"Songti TC", "Noto Serif TC", Georgia, "Times New Roman", serif',
  },
  custom: {
    label: "自訂",
    stack: "", // 實際值取自 theme.font_stack_custom
  },
};

export const FONT_PRESET_ORDER: readonly FontPreset[] = [
  "classic",
  "system",
  "serif",
  "custom",
] as const;

/** 原廠主題（與 supabase/schema-r6.sql §2 的 site_theme 預設值逐欄一致） */
export const DEFAULT_THEME: SiteTheme = {
  brand_name: "MSW 街健館",
  brand_name_en: "Macau Street Workout",
  tagline_zh: "用自身的重量，練出澳門最強的街頭力量",
  tagline_en: "",
  logo_path: null,
  hero_bg_path: null,
  color_ink: "#0F0F0F",
  color_ink_soft: "#161616",
  color_ink_line: "#262626",
  color_paper: "#F5F5F7",
  color_cobalt: "#0047AB",
  color_cobalt_bright: "#0057FF",
  color_vital: "#E3001B",
  color_vital_bright: "#FF2D2D",
  color_white: "#FFFFFF",
  font_preset: "classic",
  font_stack_custom: null,
  radius_card: 16,
  radius_btn: 9999,
  radius_field: 12,
  container_max: 1200,
  space_section: 80,
  hero_overlay_opacity: 0.55,
};

/* =============================================================
 * 驗證（唯一的驗證邏輯，寫入端與讀取端共用）
 * ============================================================= */

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const IMAGE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]*\.(jpg|jpeg|png|webp)$/;
/** 「自訂字體」白名單：只允許英文、數字、空白、逗號、連字號、底線、點、引號 */
const CUSTOM_FONT_RE = /^[A-Za-z0-9 ,\-_."']+$/;

type FieldErrors = Record<string, string>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function has(base: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(base, key);
}

/** 展開 #abc → #AABBCC，通過驗證者一律回傳大寫六碼 */
function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  if (!HEX_RE.test(s)) return null;
  const body = s.slice(1);
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((c) => c.toUpperCase() + c.toUpperCase())
      .join("")}`;
  }
  return `#${body.toUpperCase()}`;
}

interface NumOpts {
  min: number;
  max: number;
  integer: boolean;
  decimals?: number;
  message: string;
}

/** 數值欄位：合法就採值，不合法就退回 base 並回傳錯誤訊息 */
function numField(
  src: Record<string, unknown>,
  key: string,
  base: number,
  opts: NumOpts
): { value: number; error?: string } {
  if (!has(src, key) || src[key] === undefined || src[key] === null || src[key] === "") {
    return { value: base };
  }

  const raw = src[key];
  // 明確排除物件／陣列／布林，避免 Number([16]) === 16 這種誤判
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { value: base, error: opts.message };
  }

  const n = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) {
    return { value: base, error: opts.message };
  }
  if (opts.integer && !Number.isInteger(n)) {
    return { value: base, error: opts.message };
  }

  return {
    value: opts.decimals === undefined
      ? n
      : Math.round(n * 10 ** opts.decimals) / 10 ** opts.decimals,
  };
}

/** 文字欄位（可為 null） */
function nullableText(
  src: Record<string, unknown>,
  key: string,
  base: string | null,
  maxLen: number
): string | null {
  const raw = src[key];
  if (raw === null) return null;
  if (raw === undefined) return base;
  if (typeof raw !== "string") return base;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLen) return base;
  return trimmed;
}

function imagePath(
  src: Record<string, unknown>,
  key: string,
  prefix: "logo" | "hero",
  base: string | null
): string | null {
  const raw = src[key];
  if (raw === null) return null;
  if (raw === undefined) return base;
  if (typeof raw !== "string") return base;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!trimmed.startsWith(`${prefix}/`)) return base;
  if (!IMAGE_PATH_RE.test(trimmed.slice(prefix.length + 1))) return base;
  return trimmed;
}

function normalizeInternal(
  input: unknown,
  base: SiteTheme
): { theme: SiteTheme; fields: FieldErrors } {
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const fields: FieldErrors = {};

  /* --- 文字類 --- */
  let brandName: string;
  const rawBrand = src.brand_name;
  if (has(src, "brand_name") && typeof rawBrand === "string") {
    brandName = rawBrand.trim();
  } else {
    brandName = base.brand_name;
  }
  if (brandName.length < 1 || brandName.length > 60) {
    fields.brand_name = "網站名稱請填 1–60 字。";
    brandName = base.brand_name;
  }

  let brandNameEn: string;
  const rawBrandEn = src.brand_name_en;
  if (has(src, "brand_name_en") && typeof rawBrandEn === "string") {
    brandNameEn = rawBrandEn.trim();
  } else {
    brandNameEn = base.brand_name_en;
  }
  if (brandNameEn.length < 1 || brandNameEn.length > 80) {
    fields.brand_name_en = "英文名稱請填 1–80 字。";
    brandNameEn = base.brand_name_en;
  }

  const taglineZh = nullableText(src, "tagline_zh", base.tagline_zh, 120);
  if (has(src, "tagline_zh") && src.tagline_zh !== null && typeof src.tagline_zh === "string") {
    const t = src.tagline_zh.trim();
    if (t.length > 120) fields.tagline_zh = "中文標語請填 120 字以內。";
  }
  const taglineEn = nullableText(src, "tagline_en", base.tagline_en, 160);
  if (has(src, "tagline_en") && src.tagline_en !== null && typeof src.tagline_en === "string") {
    const t = src.tagline_en.trim();
    if (t.length > 160) fields.tagline_en = "英文標語請填 160 字以內。";
  }

  /* --- 圖片路徑 --- */
  const logoPath = imagePath(src, "logo_path", "logo", base.logo_path);
  if (has(src, "logo_path") && src.logo_path !== null && typeof src.logo_path === "string") {
    if (logoPath !== src.logo_path.trim())
      fields.logo_path = "Logo 圖片格式錯誤，請重新上傳。";
  }
  const heroBgPath = imagePath(src, "hero_bg_path", "hero", base.hero_bg_path);
  if (has(src, "hero_bg_path") && src.hero_bg_path !== null && typeof src.hero_bg_path === "string") {
    if (heroBgPath !== src.hero_bg_path.trim())
      fields.hero_bg_path = "Hero 背景圖片格式錯誤，請重新上傳。";
  }

  /* --- 9 個顏色 --- */
  const colors = {} as Pick<SiteTheme, ThemeColorField>;
  for (const key of COLOR_FIELDS) {
    const raw = src[key];
    let value: string;
    if (has(src, key) && typeof raw === "string") {
      const normalized = normalizeHex(raw);
      if (normalized === null) {
        fields[key] = "顏色請填 #RRGGBB 格式，例如 #0047AB。";
        value = base[key];
      } else {
        value = normalized;
      }
    } else {
      value = base[key];
    }
    colors[key] = value;
  }

  /* --- 字體 --- */
  const rawPreset = src.font_preset;
  const fontPreset: FontPreset =
    has(src, "font_preset") &&
    typeof rawPreset === "string" &&
    (FONT_PRESET_ORDER as readonly string[]).includes(rawPreset)
      ? (rawPreset as FontPreset)
      : base.font_preset;
  if (has(src, "font_preset") && typeof rawPreset === "string" && rawPreset !== fontPreset) {
    fields.font_preset = "請選擇字體。";
  }

  let fontStackCustom: string | null = null;
  if (fontPreset === "custom") {
    const rawStack = src.font_stack_custom ?? base.font_stack_custom;
    if (typeof rawStack !== "string" || rawStack.trim() === "") {
      fields.font_stack_custom = "字體名稱只可填英文、數字、空白與逗號。";
    } else {
      const trimmed = rawStack.trim();
      if (trimmed.length > 300 || !CUSTOM_FONT_RE.test(trimmed)) {
        fields.font_stack_custom = "字體名稱只可填英文、數字、空白與逗號。";
      } else {
        fontStackCustom = trimmed;
      }
    }
  }

  /* --- 數值（超出範圍一律退回 base 並記錄錯誤）--- */
  const radiusCard = numField(src, "radius_card", base.radius_card, {
    min: 0, max: 32, integer: true, message: "卡片圓角請填 0–32 的整數。",
  });
  const radiusBtn = numField(src, "radius_btn", base.radius_btn, {
    min: 0, max: 9999, integer: true, message: "按鈕圓角請填 0–9999 的整數。",
  });
  const radiusField = numField(src, "radius_field", base.radius_field, {
    min: 0, max: 24, integer: true, message: "輸入框圓角請填 0–24 的整數。",
  });
  const containerMax = numField(src, "container_max", base.container_max, {
    min: 960, max: 1440, integer: true, message: "版面寬度請填 960–1440 的整數。",
  });
  const spaceSection = numField(src, "space_section", base.space_section, {
    min: 48, max: 160, integer: true, message: "區塊留白請填 48–160 的整數。",
  });
  const heroOverlay = numField(src, "hero_overlay_opacity", base.hero_overlay_opacity, {
    min: 0, max: 0.9, integer: false, decimals: 2, message: "Hero 遮罩請填 0–0.9 的數字。",
  });

  for (const [key, result] of [
    ["radius_card", radiusCard],
    ["radius_btn", radiusBtn],
    ["radius_field", radiusField],
    ["container_max", containerMax],
    ["space_section", spaceSection],
    ["hero_overlay_opacity", heroOverlay],
  ] as const) {
    if (result.error) fields[key] = result.error;
  }

  return {
    theme: {
      brand_name: brandName,
      brand_name_en: brandNameEn,
      tagline_zh: taglineZh,
      tagline_en: taglineEn,
      logo_path: logoPath,
      hero_bg_path: heroBgPath,
      ...colors,
      font_preset: fontPreset,
      font_stack_custom: fontStackCustom,
      radius_card: radiusCard.value,
      radius_btn: radiusBtn.value,
      radius_field: radiusField.value,
      container_max: containerMax.value,
      space_section: spaceSection.value,
      hero_overlay_opacity: heroOverlay.value,
    },
    fields,
  };
}

export type ThemeNormalizeResult =
  | { ok: true; theme: SiteTheme }
  | { ok: false; fields: FieldErrors };

/**
 * 寫入端用：任何一個欄位不合法就回傳 { ok:false, fields }，
 * 讓 Route Handler 組成 400 validation 錯誤，而不是把髒資料寫進 DB。
 */
export function normalizeTheme(
  input: unknown,
  base: SiteTheme = DEFAULT_THEME
): ThemeNormalizeResult {
  const { theme, fields } = normalizeInternal(input, base);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, theme };
}

/**
 * 讀取端用：DB 裡的值有可能是舊版或被手改過，這裡一律「退回預設值」而不是拋錯，
 * 保證 root layout 永遠拿得到一份完整的 SiteTheme。
 */
export function coerceTheme(
  input: unknown,
  base: SiteTheme = DEFAULT_THEME
): SiteTheme {
  return normalizeInternal(input, base).theme;
}

/* =============================================================
 * CSS 變數（SPEC-R6 §3.3 表格，恰好 15 個）
 * ============================================================= */

export function themeCssVars(theme: SiteTheme): Record<`--${string}`, string> {
  const stack =
    theme.font_preset === "custom"
      ? theme.font_stack_custom ?? FONT_PRESETS.classic.stack
      : FONT_PRESETS[theme.font_preset].stack;

  return {
    "--color-ink": theme.color_ink,
    "--color-ink-soft": theme.color_ink_soft,
    "--color-ink-line": theme.color_ink_line,
    "--color-paper": theme.color_paper,
    "--color-cobalt": theme.color_cobalt,
    "--color-cobalt-bright": theme.color_cobalt_bright,
    "--color-vital": theme.color_vital,
    "--color-vital-bright": theme.color_vital_bright,
    "--color-white": theme.color_white,
    "--font-sans": stack,
    "--radius-card": `${theme.radius_card}px`,
    "--radius-btn": `${theme.radius_btn}px`,
    "--radius-field": `${theme.radius_field}px`,
    "--container-max": `${theme.container_max}px`,
    "--space-section": `${theme.space_section}px`,
  };
}
