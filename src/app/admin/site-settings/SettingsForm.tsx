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
 */

import { useState } from "react";
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
import { AssetUploader } from "@/components/AssetUploader";
import { deleteJson, FetchError, postJson } from "@/lib/fetch-json";

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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  withRange?: boolean;
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
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
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
            {fields.tagline_en && (
              <p className="mt-1 text-xs text-red-300">{fields.tagline_en}</p>
            )}
          </div>
        </section>

        {/* Logo / Hero */}
        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <label className="label">Logo（建議 1:1）</label>
            <AssetUploader
              kind="logo"
              value={form.logo_path}
              onChange={(p) => setField("logo_path", p)}
              aspect="1/1"
              hint="建議正方形 PNG，透明背景最佳；不支援 HEIC。"
            />
            {fields.logo_path && (
              <p className="mt-1 text-xs text-red-300">{fields.logo_path}</p>
            )}
          </div>
          <div>
            <label className="label">Hero 背景圖（建議 2:1）</label>
            <AssetUploader
              kind="hero"
              value={form.hero_bg_path}
              onChange={(p) => setField("hero_bg_path", p)}
              aspect="2/1"
              hint="首頁大圖；留空則使用預設漸層背景。"
            />
            {fields.hero_bg_path && (
              <p className="mt-1 text-xs text-red-300">
                {fields.hero_bg_path}
              </p>
            )}
          </div>
        </section>

        {/* 顏色 */}
        <section>
          <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-white/45">
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
          <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-white/45">
            字體
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            onChange={(n) => setField("radius_card", n)}
          />
          <NumberRow
            label="按鈕圓角（0–9999px）"
            value={form.radius_btn}
            min={0}
            max={9999}
            withRange
            onChange={(n) => setField("radius_btn", n)}
          />
          <NumberRow
            label="輸入框圓角（0–24px）"
            value={form.radius_field}
            min={0}
            max={24}
            withRange
            onChange={(n) => setField("radius_field", n)}
          />
          <NumberRow
            label="內容最大寬度（960–1440px）"
            value={form.container_max}
            min={960}
            max={1440}
            onChange={(n) => setField("container_max", n)}
          />
          <NumberRow
            label="區塊留白（48–160px）"
            value={form.space_section}
            min={48}
            max={160}
            onChange={(n) => setField("space_section", n)}
          />
          <NumberRow
            label="Hero 遮罩透明度（0–0.9）"
            value={form.hero_overlay_opacity}
            min={0}
            max={0.9}
            step={0.05}
            withRange
            onChange={(n) => setField("hero_overlay_opacity", n)}
          />
        </section>

        <p className="text-xs leading-relaxed text-white/40">
          儲存後自己重整頁面即時看到；其他訪客最遲 60 秒後看到新設定。
        </p>
      </div>

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
