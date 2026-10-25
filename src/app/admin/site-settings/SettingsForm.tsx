"use client";

/**
 * src/app/admin/site-settings/SettingsForm.tsx — 網站設定表單（22+ 欄位）
 *
 * Owner：方砚。對齊 SPEC-R6.md §2.6、FE-8、FE-9：
 *  - 全欄位可編輯並顯示目前值
 *  - 顏色：5 組色票 chip + 原生 color + 六碼 hex
 *  - 字體 radio（4 組）+ 自訂字體堆疊
 *  - 儲存成功綠色提示；單一欄位驗證失敗顯示紅字（來自 fields）
 *  - 回復原廠需 window.confirm 二次確認
 *
 * T-8：每個欄位附「改這裏會影響前台哪裏」說明與圖片建議像素，
 *       站長不須記住技術名詞也知道每個設定的實際效果。
 *
 * T-18：儲存前以 src/lib/contrast.ts 檢查顏色搭配的 WCAG AA 對比度，
 *       未達標在儲存按鈕旁顯示黃色警告（列出具體配對與比值）——
 *       只提醒、不阻擋儲存。
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save } from "lucide-react";
import {
  COLOR_FIELDS,
  COLOR_PALETTE,
  FONT_PRESET_ORDER,
  FONT_PRESETS,
  type SiteTheme,
  type ThemeColorField,
} from "@/lib/theme";
import { checkThemeContrast } from "@/lib/contrast";
import { AssetUploader } from "@/components/AssetUploader";
import { deleteJson, FetchError, postJson } from "@/lib/fetch-json";

/** T-8：欄位生效位置說明（改這裏會影響前台哪裏） */
function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-xs leading-relaxed text-white/55">{children}</p>
  );
}

const COLOR_LABELS: Record<ThemeColorField, string> = {
  color_ink: "主背景（墨黑）",
  color_ink_soft: "卡片深底",
  color_ink_line: "深分割線",
  color_paper: "淺色卡片底",
  color_cobalt: "鈷藍（主藍）",
  color_cobalt_bright: "亮鈷藍",
  color_vital: "活力紅",
  color_vital_bright: "亮紅",
  color_white: "白色文字",
};

/** T-8：每個顏色在前台的實際位置 */
const COLOR_HINTS: Record<ThemeColorField, string> = {
  color_ink: "全站頁面主背景。",
  color_ink_soft: "卡片、區塊的深色底。",
  color_ink_line: "深色區塊內的分割線。",
  color_paper: "淺色卡片底（目前較少用到）。",
  color_cobalt: "主要藍：連結、進度條、資訊提示。",
  color_cobalt_bright: "亮藍：hover 態、漸層、數字強調。",
  color_vital: "活力紅：主要按鈕、重点提示。",
  color_vital_bright: "亮紅：按鈕 hover、標題強調。",
  color_white: "全站主要文字顏色。",
};

function ColorField({
  field,
  value,
  onChange,
}: {
  field: ThemeColorField;
  value: string;
  onChange: (hex: string) => void;
}) {
  const swatches = COLOR_PALETTE.flatMap((g) =>
    g.swatches.filter((s) => s.field === field)
  );
  return (
    <div>
      <label className="label">{COLOR_LABELS[field]}</label>
      <div className="flex flex-wrap items-center gap-2">
        {swatches.map((s, i) => (
          <button
            key={`${s.hex}-${i}`}
            type="button"
            title={s.label}
            aria-label={s.label}
            onClick={() => onChange(s.hex.toUpperCase())}
            className="h-7 w-7 rounded-full border border-white/20 transition hover:scale-110"
            style={{ backgroundColor: s.hex }}
          />
        ))}
        <input
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-7 w-9 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          className="field w-24 py-1 text-sm uppercase"
        />
      </div>
      <FieldHint>{COLOR_HINTS[field]}</FieldHint>
    </div>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  withRange = false,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  withRange?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-3">
        {withRange && (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 accent-[var(--color-vital)]"
          />
        )}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) =>
            onChange(e.target.value === "" ? min : Number(e.target.value))
          }
          className="field w-24 py-1 text-sm"
        />
      </div>
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

export function SettingsForm({ initialTheme }: { initialTheme: SiteTheme }) {
  const router = useRouter();
  const [form, setForm] = useState<SiteTheme>(initialTheme);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  function setField<K extends keyof SiteTheme>(
    key: K,
    value: SiteTheme[K]
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * T-18：對比度檢查。以目前表單值即時重算——按下儲存那一刻送出去的
   * 就是這組顏色，警告與實際儲存結果必然一致（唔會顯示過期提示）。
   * 只提醒、不阻擋：警告出現後儲存按鈕照樣可按。
   */
  const contrastWarnings = useMemo(
    () => checkThemeContrast(form),
    [form]
  );

  async function save() {
    setSaving(true);
    setError(null);
    setFields({});
    setSuccess(null);
    const payload: SiteTheme = {
      ...form,
      font_stack_custom:
        form.font_preset === "custom" ? form.font_stack_custom : null,
    };
    try {
      const res = await postJson<{ ok: true; data: SiteTheme; message: string }>(
        "/api/admin/site-settings",
        payload
      );
      setForm(res.data);
      setSuccess(res.message);
      router.refresh();
    } catch (e) {
      if (e instanceof FetchError && e.fields) setFields(e.fields);
      setError(e instanceof Error ? e.message : "儲存失敗，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (
      !window.confirm(
        "確定要回復原廠設定嗎？這會清除你在網站設定頁做的所有調整。"
      )
    )
      return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await deleteJson<{
        ok: true;
        data: SiteTheme;
        message: string;
      }>("/api/admin/site-settings");
      setForm(res.data);
      setSuccess(res.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "回復失敗，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {success && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}
      {error && (
        <div role="alert" aria-live="polite" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="card-dark space-y-6 p-6 md:p-8">
        {/* 品牌文字 */}
        <section className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="brand_name">
              網站名稱（中文）
            </label>
            <input
              id="brand_name"
              className="field"
              value={form.brand_name}
              maxLength={60}
              onChange={(e) => setField("brand_name", e.target.value)}
            />
            <FieldHint>
              影響：頂部選單品牌字、頁尾版權宣告、定期訓練頁內文。
            </FieldHint>
            {fields.brand_name && (
              <p className="mt-1 text-xs text-red-300">{fields.brand_name}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="brand_name_en">
              網站名稱（英文）
            </label>
            <input
              id="brand_name_en"
              className="field"
              value={form.brand_name_en}
              maxLength={80}
              onChange={(e) => setField("brand_name_en", e.target.value)}
            />
            <FieldHint>
              影響：頂部選單品牌英文字、頁尾版權英文、關於我們頁側標、首頁裝飾大字。
            </FieldHint>
            {fields.brand_name_en && (
              <p className="mt-1 text-xs text-red-300">
                {fields.brand_name_en}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="tagline_zh">
              中文標語（選填）
            </label>
            <input
              id="tagline_zh"
              className="field"
              value={form.tagline_zh ?? ""}
              maxLength={120}
              onChange={(e) =>
                setField("tagline_zh", e.target.value || null)
              }
            />
            <FieldHint>
              影響：關於我們頁主標語。留空則顯示原廠預設文案。首頁大圖下方的描述句屬另一個欄位（網站內容
              → 首頁文案 → 主標題下方描述），兩處分開改。
            </FieldHint>
            {fields.tagline_zh && (
              <p className="mt-1 text-xs text-red-300">{fields.tagline_zh}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="tagline_en">
              英文標語（選填）
            </label>
            <input
              id="tagline_en"
              className="field"
              value={form.tagline_en ?? ""}
              maxLength={160}
              onChange={(e) =>
                setField("tagline_en", e.target.value || null)
              }
            />
            <FieldHint>目前前台尚未使用此欄位，可先保留空白。</FieldHint>
            {fields.tagline_en && (
              <p className="mt-1 text-xs text-red-300">{fields.tagline_en}</p>
            )}
          </div>
        </section>

        {/* Logo / Hero */}
        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <label className="label">Logo（建議 512×512）</label>
            <AssetUploader
              kind="logo"
              value={form.logo_path}
              onChange={(p) => setField("logo_path", p)}
              aspect="1/1"
              hint="建議 512×512 正方形 PNG，透明背景最佳。"
            />
            <FieldHint>影響：頂部選單左上角的網站 Logo。</FieldHint>
            {fields.logo_path && (
              <p className="mt-1 text-xs text-red-300">{fields.logo_path}</p>
            )}
          </div>
          <div>
            <label className="label">Hero 背景圖（建議 1600×900）</label>
            <AssetUploader
              kind="hero"
              value={form.hero_bg_path}
              onChange={(p) => setField("hero_bg_path", p)}
              aspect="16/9"
              hint="首頁大圖背景；建議 1600×900 以上，留空則使用預設漸層背景。"
            />
            <FieldHint>影響：首頁最上方大圖區的背景照片。</FieldHint>
            {fields.hero_bg_path && (
              <p className="mt-1 text-xs text-red-300">
                {fields.hero_bg_path}
              </p>
            )}
          </div>
        </section>

        {/* 顏色 */}
        <section>
          <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-white/70">
            品牌顏色
          </h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {COLOR_FIELDS.map((f) => (
              <ColorField
                key={f}
                field={f}
                value={form[f]}
                onChange={(hex) => setField(f, hex)}
              />
            ))}
          </div>
        </section>

        {/* 字體 */}
        <section>
          <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-white/70">
            字體
          </h3>
          <FieldHint>影響：全站所有文字（內文、標題、數字）的字體。</FieldHint>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FONT_PRESET_ORDER.map((p) => (
              <label
                key={p}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${
                  form.font_preset === p
                    ? "border-cobalt bg-cobalt/15 text-white"
                    : "border-ink-line text-white/70 hover:border-white/30"
                }`}
              >
                <input
                  type="radio"
                  name="font_preset"
                  checked={form.font_preset === p}
                  onChange={() => setField("font_preset", p)}
                  className="accent-[var(--color-vital)]"
                />
                {FONT_PRESETS[p].label}
              </label>
            ))}
          </div>
          {form.font_preset === "custom" && (
            <div className="mt-4">
              <label className="label" htmlFor="font_stack_custom">
                自訂字體堆疊（英文、數字、空白與逗號）
              </label>
              <input
                id="font_stack_custom"
                className="field"
                value={form.font_stack_custom ?? ""}
                maxLength={300}
                placeholder='e.g. "Helvetica Neue", Arial, sans-serif'
                onChange={(e) =>
                  setField("font_stack_custom", e.target.value || null)
                }
              />
              <FieldHint>
                只有在上方選擇「自訂」時才會生效；影響全站文字字體。
              </FieldHint>
              {fields.font_stack_custom && (
                <p className="mt-1 text-xs text-red-300">
                  {fields.font_stack_custom}
                </p>
              )}
            </div>
          )}
        </section>

        {/* 圓角 / 寬度 / 留白 / 遮罩 */}
        <section className="grid gap-5 sm:grid-cols-2">
          <NumberRow
            label="卡片圓角（0–32px）"
            value={form.radius_card}
            min={0}
            max={32}
            withRange
            hint="影響：全站卡片、區塊的圓角。"
            onChange={(n) => setField("radius_card", n)}
          />
          <NumberRow
            label="按鈕圓角（0–9999px）"
            value={form.radius_btn}
            min={0}
            max={9999}
            withRange
            hint="影響：全站按鈕的圓角。"
            onChange={(n) => setField("radius_btn", n)}
          />
          <NumberRow
            label="輸入框圓角（0–24px）"
            value={form.radius_field}
            min={0}
            max={24}
            withRange
            hint="影響：全站輸入框、下拉選單的圓角。"
            onChange={(n) => setField("radius_field", n)}
          />
          <NumberRow
            label="內容最大寬度（960–1440px）"
            value={form.container_max}
            min={960}
            max={1440}
            hint="影響：全站內容區的最大寬度（決定兩側留白大小）。"
            onChange={(n) => setField("container_max", n)}
          />
          <NumberRow
            label="區塊留白（48–160px）"
            value={form.space_section}
            min={48}
            max={160}
            hint="影響：全站每個區塊上下的留白高度。"
            onChange={(n) => setField("space_section", n)}
          />
          <NumberRow
            label="Hero 遮罩透明度（0–0.9）"
            value={form.hero_overlay_opacity}
            min={0}
            max={0.9}
            step={0.05}
            withRange
            hint="影響：首頁大圖上的黑色遮罩深淺（有設 Hero 背景圖才看得到）。"
            onChange={(n) => setField("hero_overlay_opacity", n)}
          />
        </section>

        <p className="text-xs leading-relaxed text-white/70">
          儲存後自己重整頁面即時看到；其他訪客最遲 60 秒後看到新設定。
        </p>
      </div>

      {/* T-18：對比度警告（黃色；列出具體配對與比值；不阻擋儲存） */}
      {contrastWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-semibold">對比度提醒（不會阻擋儲存）</p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed">
            {contrastWarnings.map((p) => (
              <li key={`${p.fg}-${p.bg}`}>
                {COLOR_LABELS[p.fg]} 壓 {COLOR_LABELS[p.bg]}：{p.ratio}:1
                （{p.large ? "大字／粗體" : "正常文字"}需達 {p.required}:1）
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-200/80">
            對比過低可能影響閱讀；如非刻意設計，建議參考 WCAG AA 調整顏色。
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || pending}
          className="btn-base btn-vital"
        >
          {saving ? (
            <>
              <Loader2 size={17} className="animate-spin" /> 儲存中…
            </>
          ) : (
            <>
              <Save size={17} /> 儲存設定
            </>
          )}
        </button>
        <button
          type="button"
          onClick={resetToDefault}
          disabled={saving || pending}
          className="btn-base btn-ghost"
        >
          <RotateCcw size={17} /> 回復原廠設定
        </button>
      </div>
    </div>
  );
}
