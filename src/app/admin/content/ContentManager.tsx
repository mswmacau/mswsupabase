"use client";

/**
 * src/app/admin/content/ContentManager.tsx — 網站內容管理表單（T-7，六分區）
 *
 * Owner：方砚。對齊計劃 V2 §7.1／§8.1：
 *  ① 首頁文案（site_content）   ② 導覽選單（site_nav）
 *  ③ 頁尾聯絡（site_contact）   ④ 各頁文案（site_pages，9 頁分頁）
 *  ⑤ 首頁區塊（site_blocks）    ⑥ SEO（site_seo，T-12 實作）
 *
 * 模式復刻 admin/site-settings/SettingsForm.tsx：
 *  useState 整包表單 → postJson 儲存／deleteJson 回復 → FetchError 欄位錯誤
 *  → router.refresh() → 回復原廠前 window.confirm 二次確認。
 *
 * 每個分區各自呼叫自己的 API（/api/admin/site-*），互不影響；
 * 驗證規則（字數／條數／白名單）以後台 normalize* 為準，
 * 本檔只做「送出前擋掉明顯錯誤」的輕提示，不重寫規則。
 *
 * T-16：頂部「草稿與預覽」工具列——儲存草稿（一次提交全部六個分區，
 * 後端草稿袋為替換語義）／預覽（開新視窗走 draft mode）／發佈
 * （以後端已儲存的草稿袋為準）；載入時讀草稿狀態，有草稿時顯示橫幅與丟棄。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Loader2,
  Plus,
  RotateCcw,
  Rocket,
  Save,
  Trash2,
} from "lucide-react";
import {
  NAV_HREFS,
  type NavLink,
  type SiteBlock,
  type SiteBlocks,
  type SiteContact,
  type SiteContent,
  type SiteNav,
  type SitePages,
} from "@/lib/content";
import { deleteJson, FetchError, postJson, requestJson } from "@/lib/fetch-json";
import type { SiteSeo } from "@/lib/seo";

/* =============================================================
 * 常數：欄位中文說明與字數提示（顯示用；以後台 normalize* 為準）
 * ============================================================= */

/** 首頁文案字數上限（對應 content.ts CONTENT_*_MAXLEN） */
const CONTENT_MAXLEN = {
  about: { eyebrow: 40, lead: 200, philosophy: 400, cta: 300 },
  hero: {
    title_line1: 40,
    title_line2: 40,
    desc: 300,
    cta_primary_member: 40,
    cta_secondary_member: 40,
    cta_primary_guest: 40,
    cta_secondary_guest: 40,
  },
  feature: { title: 60, desc: 140 },
  discipline: { title: 20, sub: 40, desc: 140, icon: 8 },
  marquee: 40,
  cta: {
    title_member: 60,
    desc_member: 300,
    primary_member: 40,
    secondary_member: 40,
    title_guest: 60,
    desc_guest: 300,
    primary_guest: 40,
    secondary_guest: 40,
  },
} as const;

/** 頁尾聯絡字數上限（對應 content.ts CONTACT_MAXLEN） */
const CONTACT_MAXLEN = {
  location: 40,
  email: 120,
  instagram: 60,
  instagram_url: 200,
  intro: 120,
} as const;

/** 各頁文案字數上限（對應 content.ts PAGE_FIELD_MAXLEN 與規則） */
const PAGE_FIELD_MAXLEN_HINTS: Record<string, number> = {
  page_title: 40,
  intro: 300,
  form_intro: 200,
  admin_notice: 200,
  verify_note: 300,
  rules_note: 300,
  step_1: 160,
  step_2: 160,
  step_3: 160,
  step_4: 160,
  login_prompt: 120,
  signup_prompt: 60,
  login_card_title: 40,
  upload_hint: 120,
  confirm_hint: 120,
  success_message: 200,
  pending_label: 20,
};

function pageFieldMaxLen(field: string): number {
  if (field in PAGE_FIELD_MAXLEN_HINTS) return PAGE_FIELD_MAXLEN_HINTS[field];
  if (field.endsWith("_label")) return 40;
  if (field.endsWith("_placeholder")) return 60;
  if (field.endsWith("_link") || field.endsWith("_button")) return 40;
  return 120;
}

/**
 * 各頁文案欄位的中文說明（T-9 P2-3 修復）。
 * 兩層結構：先按頁面找 PAGE_FIELD_LABELS[pageKey][field]，找不到再回落
 * COMMON_FIELD_LABELS[field]，最後才用鍵名——因為同一個鍵在不同頁面的
 * 用途可能完全不同（如 submit_label：登入頁是「登入」、註冊頁是「建立帳號」）。
 */

/** 各頁共用的欄位說明（同名同義才放這裏） */
const COMMON_FIELD_LABELS: Record<string, string> = {
  page_title: "頁面標題（瀏覽器分頁與搜尋結果顯示）",
  form_intro: "表單簡介（右欄頂部）",
  email_label: "電郵欄位標籤",
  email_placeholder: "電郵欄位提示文字",
  password_label: "密碼欄位標籤",
  password_placeholder: "密碼欄位提示文字",
};

/** 按頁面分流的欄位說明（同一鍵在不同頁面用途不同時，各自給正確標籤） */
const PAGE_FIELD_LABELS: Partial<
  Record<keyof SitePages, Record<string, string>>
> = {
  login: {
    intro: "頁面簡介（左欄大字下方）",
    admin_notice: "管理員入口提示（從後台連結進入登入頁時顯示）",
    submit_label: "登入按鈕文字",
    pending_label: "登入中按鈕文字",
    signup_prompt: "還沒有帳號？引導文字",
    signup_link: "註冊連結文字",
    error_message: "登入失敗時的訊息",
  },
  signup: {
    intro: "頁面簡介（左欄大字下方）",
    display_name_label: "顯示名稱欄位標籤",
    display_name_placeholder: "顯示名稱提示文字",
    confirm_label: "確認密碼欄位標籤",
    confirm_placeholder: "確認密碼提示文字",
    confirm_hint: "確認密碼欄位說明",
    verify_note: "電郵驗證說明（內含「登入」二字會自動變成登入連結）",
    rules_note: "活動規則同意條款",
    submit_label: "註冊按鈕文字（「建立帳號」）",
    pending_label: "註冊中按鈕文字",
    login_prompt: "已有帳號？引導文字",
    login_link: "登入連結文字",
    error_email: "電郵格式錯誤訊息",
    error_password: "密碼長度不足訊息",
    error_confirm: "兩次密碼不一致訊息",
    error_submit: "註冊失敗訊息",
    success_message: "註冊成功訊息",
  },
  events: {
    empty_note: "無特別活動時的說明文字",
    card_register_label: "活動卡報名按鈕文字",
    card_note_title: "活動卡報名方式標題",
    card_note_fallback: "活動卡未填報名說明時的後備文字",
  },
  training: {
    intro: "頁面簡介（左欄「近期場次」下方）",
    open_label: "開放報名標籤",
    closed_label: "已截止標籤",
    fact_checkin_label: "簽到入帳說明標籤",
    slots_label: "名額單位（如「場可報名」）",
    history_header: "訓練紀錄表「簽到時間」欄名",
    empty_history: "尚無訓練紀錄提示",
  },
  run: {
    step_1: "上傳流程第 1 步說明",
    step_2: "上傳流程第 2 步說明",
    step_3: "上傳流程第 3 步說明",
    step_4: "上傳流程第 4 步說明",
    login_prompt: "未登入提示（頁面中間引導登入的段落）",
    login_card_title: "未登入卡片標題",
    login_button: "會員登入按鈕文字",
    signup_button: "註冊新帳號按鈕文字",
    upload_hint: "上傳區輔助說明",
    empty_submissions: "尚無跑步紀錄提示（上傳紀錄列表）",
    km_label: "公里數欄位標籤",
    km_placeholder: "公里數提示文字",
    month_label: "計入月份欄位標籤",
    screenshot_label: "截圖欄位標籤",
    note_label: "備註欄位標籤",
    note_placeholder: "備註提示文字",
    submit_label: "提交紀錄按鈕文字",
    pending_label: "上傳中按鈕文字",
  },
  leaderboard: {
    empty_month: "本月無紀錄提示",
  },
  coaches: {
    empty_state: "尚無教練資料提示",
  },
  dashboard: {
    empty_submissions: "尚無提交紀錄提示（帳戶頁紀錄列表）",
    empty_points: "尚無積分紀錄提示",
    empty_checkins: "尚無訓練紀錄提示",
  },
};

/** 欄位標籤查詢：頁面分流 → 共用 → 鍵名 */
function pageFieldLabel(page: keyof SitePages, field: string): string {
  return (
    PAGE_FIELD_LABELS[page]?.[field] ?? COMMON_FIELD_LABELS[field] ?? field
  );
}

/** 各頁分頁（順序即後台 Tab 順序） */
const PAGE_TABS: { key: keyof SitePages; label: string }[] = [
  { key: "login", label: "登入" },
  { key: "signup", label: "註冊" },
  { key: "events", label: "活動" },
  { key: "training", label: "定期訓練" },
  { key: "run", label: "跑步挑戰" },
  { key: "leaderboard", label: "排行榜" },
  { key: "about", label: "關於我們" },
  { key: "coaches", label: "教練團隊" },
  { key: "dashboard", label: "我的帳戶" },
];

/** 選單連結的顯示名稱（select 選項用；實際顯示文字由 label 欄位決定） */
const NAV_HREF_LABELS: Record<string, string> = {
  "/": "主頁",
  "/events": "活動",
  "/training": "定期訓練",
  "/run": "月度跑步挑戰",
  "/leaderboard": "排行榜",
  "/about": "關於我們",
  "/coaches": "教練團隊",
};

const NAV_LABEL_MAXLEN = 20;
const BLOCK_LABEL_MAXLEN = 20;
const BLOCK_MIN_VISIBLE = 3;

/* =============================================================
 * 共用：分區儲存狀態（复刻 SettingsForm 的 save/reset 流程）
 * ============================================================= */

interface SectionApi<T> {
  form: T;
  setForm: React.Dispatch<React.SetStateAction<T>>;
  saving: boolean;
  error: string | null;
  fields: Record<string, string>;
  success: string | null;
  save: () => Promise<void>;
  reset: () => Promise<void>;
}

function useSectionSave<T>(
  apiPath: string,
  initial: T,
  confirmText: string
): SectionApi<T> {
  const router = useRouter();
  const [form, setForm] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  function clearStatus() {
    setError(null);
    setFields({});
    setSuccess(null);
  }

  async function save() {
    setSaving(true);
    clearStatus();
    try {
      const res = await postJson<{ ok: true; data: T; message: string }>(
        apiPath,
        form
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

  async function reset() {
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    clearStatus();
    try {
      const res = await deleteJson<{ ok: true; data: T; message: string }>(
        apiPath
      );
      setForm(res.data);
      setSuccess(res.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "回復失敗，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return { form, setForm, saving, error, fields, success, save, reset };
}

/* =============================================================
 * 共用：文字欄位與分區外殼
 * ============================================================= */

function TextField({
  id,
  label,
  value,
  maxLen,
  hint,
  error,
  multiline = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  maxLen: number;
  hint?: string;
  error?: string;
  multiline?: boolean;
  onChange: (v: string) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="field"
          rows={3}
          value={value}
          maxLength={maxLen}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="field"
          value={value}
          maxLength={maxLen}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p id={hintId} className="mt-1 text-xs text-white/50">
        最多 {maxLen} 字{hint ? `・${hint}` : ""}
      </p>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function SectionShell<T>({
  title,
  desc,
  resetLabel,
  saveDisabled = false,
  disabledReason,
  previewHref = "/",
  api,
  children,
}: {
  title: string;
  desc: string;
  resetLabel: string;
  saveDisabled?: boolean;
  disabledReason?: string | null;
  /** 儲存成功「前往前台查看」連結指向（T-9 P3-1：各分區指到對應前台頁） */
  previewHref?: string;
  api: SectionApi<T>;
  children: React.ReactNode;
}) {
  return (
    <section className="card-dark space-y-5 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{title}</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/70">
            {desc}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={api.save}
            disabled={api.saving || saveDisabled}
            className="btn-base btn-vital"
          >
            {api.saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 儲存中…
              </>
            ) : (
              <>
                <Save size={16} /> 儲存
              </>
            )}
          </button>
          <button
            type="button"
            onClick={api.reset}
            disabled={api.saving}
            className="btn-base btn-ghost"
          >
            <RotateCcw size={16} /> {resetLabel}
          </button>
        </div>
      </div>

      {saveDisabled && disabledReason && (
        <p className="text-xs text-amber-300">{disabledReason}</p>
      )}
      {api.success && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <p>{api.success}</p>
          <p className="mt-1 text-xs text-emerald-200/80">
            其他人最遲 60 秒看到；自己看可按 Ctrl/Cmd+R 重新整理，或開無痕視窗。
          </p>
          <Link
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs font-semibold text-emerald-200 underline"
          >
            前往前台查看
          </Link>
        </div>
      )}
      {api.error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {api.error}
        </div>
      )}
      {api.fields.links && (
        <p className="text-xs text-amber-300">{api.fields.links}</p>
      )}
      {api.fields.home && (
        <p className="text-xs text-amber-300">{api.fields.home}</p>
      )}

      {children}
    </section>
  );
}

/* =============================================================
 * 分區一：首頁文案（site_content）
 * ============================================================= */

function ContentSection({ api }: { api: SectionApi<SiteContent> }) {
  const f = api.form;

  function patchGroup(group: "about" | "hero" | "cta", field: string, value: string) {
    api.setForm((prev) => {
      const next = { ...prev } as unknown as Record<string, Record<string, string>>;
      next[group] = { ...next[group], [field]: value };
      return next as unknown as SiteContent;
    });
  }

  function patchFeature(i: number, field: "title" | "desc", value: string) {
    api.setForm((prev) => ({
      ...prev,
      features: prev.features.map((item, idx) =>
        idx === i ? { ...item, [field]: value } : item
      ),
    }));
  }

  function patchDiscipline(
    i: number,
    field: "title" | "sub" | "desc" | "icon",
    value: string
  ) {
    api.setForm((prev) => ({
      ...prev,
      disciplines: prev.disciplines.map((item, idx) =>
        idx === i ? { ...item, [field]: value } : item
      ),
    }));
  }

  function patchMarquee(i: number, value: string) {
    api.setForm((prev) => ({
      ...prev,
      marquee: prev.marquee.map((v, idx) => (idx === i ? value : v)),
    }));
  }

  return (
    <SectionShell
      title="首頁文案"
      desc="首頁大圖、關於我們、三大理由、訓練項目、跑馬燈與底部號召的文案。改動會即時套用至首頁與「關於我們」頁。"
      resetLabel="回復原廠文案"
      previewHref="/"
      api={api}
    >
      <div className="space-y-8">
        {/* Hero */}
        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            首頁大圖（Hero）
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="hero-title-line1"
              label="主標題第一行"
              value={f.hero.title_line1}
              maxLen={CONTENT_MAXLEN.hero.title_line1}
              error={api.fields["hero.title_line1"]}
              onChange={(v) => patchGroup("hero", "title_line1", v)}
            />
            <TextField
              id="hero-title-line2"
              label="主標題第二行"
              value={f.hero.title_line2}
              maxLen={CONTENT_MAXLEN.hero.title_line2}
              error={api.fields["hero.title_line2"]}
              onChange={(v) => patchGroup("hero", "title_line2", v)}
            />
          </div>
          <TextField
            id="hero-desc"
            label="主標題下方描述"
            value={f.hero.desc}
            maxLen={CONTENT_MAXLEN.hero.desc}
            multiline
            error={api.fields["hero.desc"]}
            onChange={(v) => patchGroup("hero", "desc", v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="hero-cta-primary-member"
              label="會員主要按鈕"
              value={f.hero.cta_primary_member}
              maxLen={CONTENT_MAXLEN.hero.cta_primary_member}
              hint="已登入會員看到"
              error={api.fields["hero.cta_primary_member"]}
              onChange={(v) => patchGroup("hero", "cta_primary_member", v)}
            />
            <TextField
              id="hero-cta-secondary-member"
              label="會員次要按鈕"
              value={f.hero.cta_secondary_member}
              maxLen={CONTENT_MAXLEN.hero.cta_secondary_member}
              hint="已登入會員看到"
              error={api.fields["hero.cta_secondary_member"]}
              onChange={(v) => patchGroup("hero", "cta_secondary_member", v)}
            />
            <TextField
              id="hero-cta-primary-guest"
              label="訪客主要按鈕"
              value={f.hero.cta_primary_guest}
              maxLen={CONTENT_MAXLEN.hero.cta_primary_guest}
              hint="未登入訪客看到"
              error={api.fields["hero.cta_primary_guest"]}
              onChange={(v) => patchGroup("hero", "cta_primary_guest", v)}
            />
            <TextField
              id="hero-cta-secondary-guest"
              label="訪客次要按鈕"
              value={f.hero.cta_secondary_guest}
              maxLen={CONTENT_MAXLEN.hero.cta_secondary_guest}
              hint="未登入訪客看到"
              error={api.fields["hero.cta_secondary_guest"]}
              onChange={(v) => patchGroup("hero", "cta_secondary_guest", v)}
            />
          </div>
        </fieldset>

        {/* 關於我們（首頁與 /about 同源） */}
        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            關於我們（首頁與關於我們頁共用）
          </legend>
          <TextField
            id="about-eyebrow"
            label="區塊眉標"
            value={f.about.eyebrow}
            maxLen={CONTENT_MAXLEN.about.eyebrow}
            hint="目前前台尚未使用此欄位，可先保留空白。"
            error={api.fields["about.eyebrow"]}
            onChange={(v) => patchGroup("about", "eyebrow", v)}
          />
          <TextField
            id="about-lead"
            label="區塊引言"
            value={f.about.lead}
            maxLen={CONTENT_MAXLEN.about.lead}
            multiline
            error={api.fields["about.lead"]}
            onChange={(v) => patchGroup("about", "lead", v)}
          />
          <TextField
            id="about-philosophy"
            label="理念內文"
            value={f.about.philosophy}
            maxLen={CONTENT_MAXLEN.about.philosophy}
            multiline
            error={api.fields["about.philosophy"]}
            onChange={(v) => patchGroup("about", "philosophy", v)}
          />
          <TextField
            id="about-cta"
            label="區塊結語"
            value={f.about.cta}
            maxLen={CONTENT_MAXLEN.about.cta}
            multiline
            error={api.fields["about.cta"]}
            onChange={(v) => patchGroup("about", "cta", v)}
          />
        </fieldset>

        {/* 三大理由 */}
        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            三大理由（固定 3 項，編號由前台自動產生）
          </legend>
          {f.features.map((item, i) => (
            <div key={`feature-${i}`} className="grid gap-4 sm:grid-cols-2">
              <TextField
                id={`feature-${i}-title`}
                label={`第 ${i + 1} 項標題`}
                value={item.title}
                maxLen={CONTENT_MAXLEN.feature.title}
                error={api.fields[`features.${i}.title`]}
                onChange={(v) => patchFeature(i, "title", v)}
              />
              <TextField
                id={`feature-${i}-desc`}
                label={`第 ${i + 1} 項描述`}
                value={item.desc}
                maxLen={CONTENT_MAXLEN.feature.desc}
                multiline
                error={api.fields[`features.${i}.desc`]}
                onChange={(v) => patchFeature(i, "desc", v)}
              />
            </div>
          ))}
          {api.fields.features && (
            <p className="text-xs text-amber-300">{api.fields.features}</p>
          )}
        </fieldset>

        {/* 六大訓練項目 */}
        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            各類訓練項目（固定 6 項）
          </legend>
          {f.disciplines.map((item, i) => (
            <div key={`discipline-${i}`} className="grid gap-4 sm:grid-cols-2">
              <TextField
                id={`discipline-${i}-title`}
                label={`第 ${i + 1} 項名稱`}
                value={item.title}
                maxLen={CONTENT_MAXLEN.discipline.title}
                error={api.fields[`disciplines.${i}.title`]}
                onChange={(v) => patchDiscipline(i, "title", v)}
              />
              <TextField
                id={`discipline-${i}-sub`}
                label={`第 ${i + 1} 項英文名稱`}
                value={item.sub}
                maxLen={CONTENT_MAXLEN.discipline.sub}
                error={api.fields[`disciplines.${i}.sub`]}
                onChange={(v) => patchDiscipline(i, "sub", v)}
              />
              <TextField
                id={`discipline-${i}-desc`}
                label={`第 ${i + 1} 項描述`}
                value={item.desc}
                maxLen={CONTENT_MAXLEN.discipline.desc}
                multiline
                error={api.fields[`disciplines.${i}.desc`]}
                onChange={(v) => patchDiscipline(i, "desc", v)}
              />
              <TextField
                id={`discipline-${i}-icon`}
                label={`第 ${i + 1} 項圖示`}
                value={item.icon}
                maxLen={CONTENT_MAXLEN.discipline.icon}
                hint="填 emoji；目前前台尚未使用此欄位，可先保留空白。"
                error={api.fields[`disciplines.${i}.icon`]}
                onChange={(v) => patchDiscipline(i, "icon", v)}
              />
            </div>
          ))}
          {api.fields.disciplines && (
            <p className="text-xs text-amber-300">{api.fields.disciplines}</p>
          )}
        </fieldset>

        {/* 跑馬燈 */}
        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            跑馬燈文字（固定 6 項，首頁無限滾動顯示）
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {f.marquee.map((v, i) => (
              <TextField
                key={`marquee-${i}`}
                id={`marquee-${i}`}
                label={`第 ${i + 1} 項`}
                value={v}
                maxLen={CONTENT_MAXLEN.marquee}
                error={api.fields[`marquee.${i}`]}
                onChange={(nv) => patchMarquee(i, nv)}
              />
            ))}
          </div>
          {api.fields.marquee && (
            <p className="text-xs text-amber-300">{api.fields.marquee}</p>
          )}
        </fieldset>

        {/* 底部 CTA */}
        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            底部號召（CTA）
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="cta-title-member"
              label="會員版標題"
              value={f.cta.title_member}
              maxLen={CONTENT_MAXLEN.cta.title_member}
              error={api.fields["cta.title_member"]}
              onChange={(v) => patchGroup("cta", "title_member", v)}
            />
            <TextField
              id="cta-title-guest"
              label="訪客版標題"
              value={f.cta.title_guest}
              maxLen={CONTENT_MAXLEN.cta.title_guest}
              error={api.fields["cta.title_guest"]}
              onChange={(v) => patchGroup("cta", "title_guest", v)}
            />
            <TextField
              id="cta-desc-member"
              label="會員版描述"
              value={f.cta.desc_member}
              maxLen={CONTENT_MAXLEN.cta.desc_member}
              multiline
              error={api.fields["cta.desc_member"]}
              onChange={(v) => patchGroup("cta", "desc_member", v)}
            />
            <TextField
              id="cta-desc-guest"
              label="訪客版描述"
              value={f.cta.desc_guest}
              maxLen={CONTENT_MAXLEN.cta.desc_guest}
              multiline
              error={api.fields["cta.desc_guest"]}
              onChange={(v) => patchGroup("cta", "desc_guest", v)}
            />
            <TextField
              id="cta-primary-member"
              label="會員版主要按鈕"
              value={f.cta.primary_member}
              maxLen={CONTENT_MAXLEN.cta.primary_member}
              error={api.fields["cta.primary_member"]}
              onChange={(v) => patchGroup("cta", "primary_member", v)}
            />
            <TextField
              id="cta-secondary-member"
              label="會員版次要按鈕"
              value={f.cta.secondary_member}
              maxLen={CONTENT_MAXLEN.cta.secondary_member}
              error={api.fields["cta.secondary_member"]}
              onChange={(v) => patchGroup("cta", "secondary_member", v)}
            />
            <TextField
              id="cta-primary-guest"
              label="訪客版主要按鈕"
              value={f.cta.primary_guest}
              maxLen={CONTENT_MAXLEN.cta.primary_guest}
              error={api.fields["cta.primary_guest"]}
              onChange={(v) => patchGroup("cta", "primary_guest", v)}
            />
            <TextField
              id="cta-secondary-guest"
              label="訪客版次要按鈕"
              value={f.cta.secondary_guest}
              maxLen={CONTENT_MAXLEN.cta.secondary_guest}
              error={api.fields["cta.secondary_guest"]}
              onChange={(v) => patchGroup("cta", "secondary_guest", v)}
            />
          </div>
        </fieldset>
      </div>
    </SectionShell>
  );
}

/* =============================================================
 * 分區二：導覽選單（site_nav）
 * ============================================================= */

function NavSection({ api }: { api: SectionApi<SiteNav> }) {
  const links = api.form.links;

  function patchLink(i: number, patch: Partial<NavLink>) {
    api.setForm((prev) => ({
      ...prev,
      links: prev.links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  }

  function moveLink(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= links.length) return;
    api.setForm((prev) => {
      const next = prev.links.map((l) => ({ ...l }));
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return { ...prev, links: next };
    });
  }

  function addLink() {
    const used = new Set(links.map((l) => l.href));
    const href = NAV_HREFS.find((h) => !used.has(h)) ?? NAV_HREFS[0];
    api.setForm((prev) => ({
      ...prev,
      links: [...prev.links, { href, label: "", visible: true }],
    }));
  }

  function removeLink(i: number) {
    api.setForm((prev) => ({
      ...prev,
      links: prev.links.filter((_, idx) => idx !== i),
    }));
  }

  // 輕量客戶端檢查（規則以後台 normalizeNav 為準）
  let problem: string | null = null;
  if (links.length < 3 || links.length > 8) {
    problem = `選單項目請維持 3–8 項（目前 ${links.length} 項）。`;
  } else if (!links.some((l) => l.href === "/")) {
    problem = "選單必須包含「主頁」。";
  } else if (new Set(links.map((l) => l.href)).size !== links.length) {
    problem = "選單連結不可重複。";
  } else if (
    links.some((l) => l.label.trim().length < 1 || l.label.trim().length > NAV_LABEL_MAXLEN)
  ) {
    problem = `選單名稱請填 1–${NAV_LABEL_MAXLEN} 字。`;
  }

  return (
    <SectionShell
      title="導覽選單"
      desc="網站頂部與頁尾的選單。陣列順序即顯示順序；取消勾選「顯示」的項目會暫時下架但保留設定。必須包含「主頁」，共 3–8 項。"
      resetLabel="回復原廠選單"
      previewHref="/"
      api={api}
      saveDisabled={Boolean(problem)}
      disabledReason={problem}
    >
      <div className="space-y-3">
        {links.map((l, i) => (
          <div
            key={`nav-${i}`}
            className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
          >
            <div className="w-40 shrink-0">
              <label className="label" htmlFor={`nav-${i}-href`}>
                連結到
              </label>
              <select
                id={`nav-${i}-href`}
                className="field"
                value={l.href}
                onChange={(e) => patchLink(i, { href: e.target.value })}
              >
                {NAV_HREFS.map((h) => (
                  <option key={h} value={h}>
                    {NAV_HREF_LABELS[h] ?? h}
                  </option>
                ))}
              </select>
              {api.fields[`links.${i}.href`] && (
                <p className="mt-1 text-xs text-red-300">
                  {api.fields[`links.${i}.href`]}
                </p>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor={`nav-${i}-label`}>
                顯示名稱
              </label>
              <input
                id={`nav-${i}-label`}
                className="field"
                value={l.label}
                maxLength={NAV_LABEL_MAXLEN}
                onChange={(e) => patchLink(i, { label: e.target.value })}
              />
              {api.fields[`links.${i}.label`] && (
                <p className="mt-1 text-xs text-red-300">
                  {api.fields[`links.${i}.label`]}
                </p>
              )}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-white/75">
              <input
                type="checkbox"
                checked={l.visible}
                onChange={(e) => patchLink(i, { visible: e.target.checked })}
                className="accent-[var(--color-vital)]"
              />
              顯示
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`上移第 ${i + 1} 項`}
                disabled={i === 0}
                onClick={() => moveLink(i, -1)}
                className="clip-slab inline-flex min-h-11 min-w-11 items-center justify-center border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                aria-label={`下移第 ${i + 1} 項`}
                disabled={i === links.length - 1}
                onClick={() => moveLink(i, 1)}
                className="clip-slab inline-flex min-h-11 min-w-11 items-center justify-center border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                aria-label={`刪除第 ${i + 1} 項`}
                disabled={links.length <= 3}
                onClick={() => removeLink(i)}
                className="clip-slab inline-flex min-h-11 min-w-11 items-center justify-center border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addLink}
          disabled={links.length >= 8}
          className="btn-base btn-ghost"
        >
          <Plus size={16} /> 新增選單項目
        </button>
      </div>
    </SectionShell>
  );
}

/* =============================================================
 * 分區三：頁尾聯絡（site_contact）
 * ============================================================= */

function ContactSection({ api }: { api: SectionApi<SiteContact> }) {
  const f = api.form;

  function patch(field: "location" | "email" | "instagram" | "instagram_url", value: string) {
    api.setForm((prev) => ({ ...prev, [field]: value }));
  }

  function patchIntro(i: number, value: string) {
    api.setForm((prev) => ({
      ...prev,
      intro: prev.intro.map((v, idx) => (idx === i ? value : v)),
    }));
  }

  return (
    <SectionShell
      title="頁尾聯絡"
      desc="網站頁尾的所在地、電郵、Instagram 與品牌宣言四行。宣言四行會原樣顯示在頁尾。"
      resetLabel="回復原廠聯絡"
      previewHref="/"
      api={api}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="contact-location"
            label="所在地"
            value={f.location}
            maxLen={CONTACT_MAXLEN.location}
            error={api.fields.location}
            onChange={(v) => patch("location", v)}
          />
          <TextField
            id="contact-email"
            label="電郵地址"
            value={f.email}
            maxLen={CONTACT_MAXLEN.email}
            error={api.fields.email}
            onChange={(v) => patch("email", v)}
          />
          <TextField
            id="contact-instagram"
            label="Instagram 帳號"
            value={f.instagram}
            maxLen={CONTACT_MAXLEN.instagram}
            hint="頁尾顯示的文字"
            error={api.fields.instagram}
            onChange={(v) => patch("instagram", v)}
          />
          <TextField
            id="contact-instagram-url"
            label="Instagram 連結"
            value={f.instagram_url}
            maxLen={CONTACT_MAXLEN.instagram_url}
            hint="需以 https:// 開頭"
            error={api.fields.instagram_url}
            onChange={(v) => patch("instagram_url", v)}
          />
        </div>
        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            品牌宣言（固定 4 行）
          </legend>
          {f.intro.map((v, i) => (
            <TextField
              key={`intro-${i}`}
              id={`intro-${i}`}
              label={`第 ${i + 1} 行`}
              value={v}
              maxLen={CONTACT_MAXLEN.intro}
              error={api.fields[`intro.${i}`]}
              onChange={(nv) => patchIntro(i, nv)}
            />
          ))}
          {api.fields.intro && (
            <p className="text-xs text-amber-300">{api.fields.intro}</p>
          )}
        </fieldset>
      </div>
    </SectionShell>
  );
}

/* =============================================================
 * 分區四：各頁文案（site_pages）
 * ============================================================= */

function PagesSection({ api }: { api: SectionApi<SitePages> }) {
  const [active, setActive] = useState<keyof SitePages>("login");
  const page = api.form[active];
  const fieldKeys = Object.keys(page) as (keyof typeof page)[];

  function setField(field: string, value: string) {
    api.setForm((prev) => {
      const next = { ...prev } as unknown as Record<string, Record<string, string>>;
      next[active] = { ...next[active], [field]: value };
      return next as unknown as SitePages;
    });
  }

  return (
    <SectionShell
      title="各頁文案"
      desc="九個前台頁面的標題、說明、按鈕與空狀態文字。切換下方分頁逐頁編輯；留空的欄位會沿用原廠預設值。"
      resetLabel="回復原廠頁面"
      previewHref={`/${active}`}
      api={api}
    >
      <div className="space-y-5">
        {/* 分頁 */}
        <div role="tablist" aria-label="頁面選擇" className="flex flex-wrap gap-2">
          {PAGE_TABS.map((tab) => {
            const activeTab = tab.key === active;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab}
                onClick={() => setActive(tab.key)}
                className={`stat-figure inline-flex min-h-11 items-center px-4 text-sm transition ${
                  activeTab
                    ? "slab bg-vital text-white"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {api.fields[active as string] && (
          <p className="text-xs text-amber-300">{api.fields[active as string]}</p>
        )}

        {/* 欄位 */}
        <div className="grid gap-4 sm:grid-cols-2">
          {fieldKeys.map((field) => {
            const f = String(field);
            const maxLen = pageFieldMaxLen(f);
            const label = pageFieldLabel(active, f);
            const value = (page as unknown as Record<string, string>)[f];
            return (
              <TextField
                key={`${active}-${f}`}
                id={`${active}-${f}`}
                label={label}
                value={value}
                maxLen={maxLen}
                multiline={maxLen >= 140}
                error={api.fields[`${active}.${f}`]}
                onChange={(v) => setField(f, v)}
              />
            );
          })}
        </div>
      </div>
    </SectionShell>
  );
}

/* =============================================================
 * 分區五：首頁區塊（site_blocks）
 * ============================================================= */

function BlocksSection({ api }: { api: SectionApi<SiteBlocks> }) {
  const blocks = api.form.home;
  const visibleCount = blocks.filter((b) => b.visible).length;

  function moveBlock(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    api.setForm((prev) => {
      const next = prev.home.map((b) => ({ ...b }));
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      // 交換後按位置重編 order，保證 1–8 唯一
      return { home: next.map((b, idx) => ({ ...b, order: idx + 1 })) };
    });
  }

  function patchBlock(i: number, patch: Partial<SiteBlock>) {
    api.setForm((prev) => ({
      ...prev,
      home: prev.home.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    }));
  }

  const problem =
    visibleCount < BLOCK_MIN_VISIBLE
      ? `至少需要 ${BLOCK_MIN_VISIBLE} 個區塊保持顯示（目前 ${visibleCount} 個）。`
      : null;

  return (
    <SectionShell
      title="首頁區塊"
      desc="控制首頁八個區塊的顯示與排序。上下移動會即時改變訪客看到的順序；至少保留 3 個區塊顯示。"
      resetLabel="回復全顯預設"
      previewHref="/"
      api={api}
      saveDisabled={Boolean(problem)}
      disabledReason={problem}
    >
      <div className="space-y-3">
        {blocks.map((b, i) => (
          <div
            key={b.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
          >
            <span className="stat-figure w-8 shrink-0 text-center text-lg text-white/40">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor={`block-${b.id}-label`}>
                區塊名稱（後台顯示用）
              </label>
              <input
                id={`block-${b.id}-label`}
                className="field"
                value={b.label}
                maxLength={BLOCK_LABEL_MAXLEN}
                onChange={(e) => patchBlock(i, { label: e.target.value })}
              />
              {api.fields[`home.${i}.label`] && (
                <p className="mt-1 text-xs text-red-300">
                  {api.fields[`home.${i}.label`]}
                </p>
              )}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-white/75">
              <input
                type="checkbox"
                checked={b.visible}
                onChange={(e) => patchBlock(i, { visible: e.target.checked })}
                className="accent-[var(--color-vital)]"
              />
              顯示
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`上移${b.label}`}
                disabled={i === 0}
                onClick={() => moveBlock(i, -1)}
                className="clip-slab inline-flex min-h-11 min-w-11 items-center justify-center border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                aria-label={`下移${b.label}`}
                disabled={i === blocks.length - 1}
                onClick={() => moveBlock(i, 1)}
                className="clip-slab inline-flex min-h-11 min-w-11 items-center justify-center border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
              >
                <ArrowDown size={15} />
              </button>
            </div>
          </div>
        ))}
        <p className="text-xs text-white/50">
          目前 {visibleCount} / {blocks.length} 個區塊顯示中。
        </p>
      </div>
    </SectionShell>
  );
}

/* =============================================================
 * 分區六：SEO（site_seo，T-12 實作）
 * ============================================================= */

/** SEO 欄位上限（對應 seo.ts 的護欄參數；驗證以後台 normalizeSeo 為準） */
const SEO_MAXLEN = {
  title: 60,
  description: 200,
  og_url: 300,
  og_alt: 120,
} as const;

/** OG 圖寬高上限（對應 seo.ts 的 SEO_OG_DIM_MIN／MAX） */
const OG_DIM_MIN = 1;
const OG_DIM_MAX = 10_000;

function NumberField({
  id,
  label,
  value,
  min,
  max,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  error?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="field"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) =>
          // 清空時先落到下限，避免送出 0／NaN 被後端退回（後端以缺鍵視為沿用預設）
          onChange(e.target.value === "" ? min : Number(e.target.value))
        }
      />
      <p className="mt-1 text-xs text-white/50">
        限 {min}–{max} 的整數
      </p>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function SeoSection({ api }: { api: SectionApi<SiteSeo> }) {
  const f = api.form;
  const og = f.og_image;

  function patchOg(patch: Partial<SiteSeo["og_image"]>) {
    api.setForm((prev) => ({ ...prev, og_image: { ...prev.og_image, ...patch } }));
  }

  return (
    <SectionShell
      title="搜尋引擎與社群預覽（SEO）"
      desc="控制搜尋結果與社交平台分享時顯示的標題、簡介與分享圖，全站所有頁面共用。瀏覽器分頁標題的組裝方式：子頁面有自己的「頁面標題」時顯示「頁面標題 | MSW 街健館」；未有自設標題的頁面（如主頁）則直接顯示下方的主標題。"
      resetLabel="回復原廠 SEO 設定"
      previewHref="/"
      api={api}
    >
      <div className="space-y-6">
        <TextField
          id="seo-title"
          label="網站主標題"
          value={f.title}
          maxLen={SEO_MAXLEN.title}
          hint="主頁與未有自設標題的頁面，瀏覽器分頁直接顯示此值；社交平台分享貼文的標題亦用此值"
          error={api.fields.title}
          onChange={(v) => api.setForm((prev) => ({ ...prev, title: v }))}
        />
        <TextField
          id="seo-description"
          label="網站簡介（描述）"
          value={f.description}
          maxLen={SEO_MAXLEN.description}
          multiline
          hint="搜尋結果與社交平台分享貼文显示的網站簡介，各頁面沿用此值"
          error={api.fields.description}
          onChange={(v) => api.setForm((prev) => ({ ...prev, description: v }))}
        />

        <fieldset className="space-y-4">
          <legend className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
            社群分享圖（OG 圖）
          </legend>
          <TextField
            id="seo-og-url"
            label="分享圖路徑或網址"
            value={og.url}
            maxLen={SEO_MAXLEN.og_url}
            hint="以 / 開頭的站內相對路徑（如 /og-image.png），或 https:// 開頭的完整網址；建議尺寸 1200×630"
            error={api.fields["og_image.url"]}
            onChange={(v) => patchOg({ url: v })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="seo-og-width"
              label="分享圖闊度（像素）"
              value={og.width}
              min={OG_DIM_MIN}
              max={OG_DIM_MAX}
              error={api.fields["og_image.width"]}
              onChange={(n) => patchOg({ width: n })}
            />
            <NumberField
              id="seo-og-height"
              label="分享圖高度（像素）"
              value={og.height}
              min={OG_DIM_MIN}
              max={OG_DIM_MAX}
              error={api.fields["og_image.height"]}
              onChange={(n) => patchOg({ height: n })}
            />
          </div>
          <TextField
            id="seo-og-alt"
            label="分享圖替代文字"
            value={og.alt}
            maxLen={SEO_MAXLEN.og_alt}
            hint="讀屏軟件朗讀、或圖片載入失敗時顯示；留空會用回原廠預設文字"
            error={api.fields["og_image.alt"]}
            onChange={(v) => patchOg({ alt: v })}
          />
          {api.fields.og_image && (
            <p className="text-xs text-red-300">{api.fields.og_image}</p>
          )}
        </fieldset>

        <p className="text-xs text-white/50">
          提示：儲存後可在前台頁面按右鍵「查看原始碼」（view-source）確認
          head 內的值；其他訪客最遲 60 秒後看到新設定。
        </p>
      </div>
    </SectionShell>
  );
}

/* =============================================================
 * 草稿與預覽工具列（T-16）
 * ============================================================= */

/** 草稿袋六個分區（與 api/admin/site-draft 的分區鍵一致；替換語義） */
type DraftPayload = {
  content: SiteContent;
  nav: SiteNav;
  contact: SiteContact;
  pages: SitePages;
  blocks: SiteBlocks;
  seo: SiteSeo;
};

function DraftToolbar({
  supabaseReady,
  draftPayload,
  router,
}: {
  supabaseReady: boolean;
  draftPayload: DraftPayload;
  router: ReturnType<typeof useRouter>;
}) {
  const [draftExists, setDraftExists] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftLoading, setDraftLoading] = useState(supabaseReady);
  const [draftStatusError, setDraftStatusError] = useState<string | null>(null);
  const [action, setAction] = useState<"save" | "publish" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadDraftStatus = useCallback(async () => {
    setDraftLoading(true);
    try {
      const res = await requestJson<{ ok: true; draft: unknown }>(
        "/api/admin/site-draft",
        { method: "GET" }
      );
      setDraftExists(res.draft !== null && res.draft !== undefined);
      setDraftStatusError(null);
    } catch {
      setDraftStatusError("草稿狀態暫時讀不到，請稍後重試。");
    } finally {
      setDraftLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;
    (async () => {
      await loadDraftStatus();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [supabaseReady, loadDraftStatus]);

  const busy = action !== null;

  async function saveDraft() {
    setAction("save");
    setError(null);
    setSuccess(null);
    try {
      // 替換語義：必須一次提交全部六個分區，只傳一區會覆蓋掉其他區的草稿
      await postJson("/api/admin/site-draft", draftPayload);
      setDraftExists(true);
      setDraftSavedAt(new Date());
      setSuccess("草稿已儲存，前台不受影響。");
    } catch (e) {
      const msg =
        e instanceof FetchError && e.fields
          ? "草稿儲存失敗，請依照各分區的欄位提示修正後再試。"
          : e instanceof Error
            ? e.message
            : "草稿儲存失敗，請稍後再試。";
      setError(msg);
    } finally {
      setAction(null);
    }
  }

  function previewDraft() {
    // 新視窗打 preview 端點（啟用 draft mode）→ 302 到 /preview
    window.open("/api/admin/site-draft/preview", "_blank", "noopener,noreferrer");
  }

  async function publishDraft() {
    setAction("publish");
    setError(null);
    setSuccess(null);
    try {
      // 發佈以後端「已儲存的草稿袋」為準（publish 分支讀 DB，不讀本頁表單）
      await postJson("/api/admin/site-draft", { publish: true });
      setDraftExists(false);
      setDraftSavedAt(null);
      setSuccess("已發佈，前台最遲 60 秒更新。");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "發佈失敗，請稍後再試。");
    } finally {
      setAction(null);
    }
  }

  async function discardDraft() {
    if (!window.confirm("確定要丟棄這份未發佈的草稿嗎？丟棄後無法復原。")) return;
    setAction("discard");
    setError(null);
    setSuccess(null);
    try {
      await deleteJson("/api/admin/site-draft");
      setDraftExists(false);
      setDraftSavedAt(null);
      setSuccess("草稿已丟棄。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "丟棄失敗，請稍後再試。");
    } finally {
      setAction(null);
    }
  }

  return (
    <section className="card-dark space-y-4 p-6 md:p-8">
      <div>
        <h3 className="text-lg font-bold">草稿與預覽</h3>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/70">
          改到一半可以先「儲存草稿」——前台完全不受影響；在新視窗「預覽」確認效果後，
          按「發佈」讓全站最遲 60 秒更新。發佈以「已儲存的草稿」為準，
          所以改完內容請先儲存草稿、再按發佈。
        </p>
      </div>

      {draftLoading && (
        <p className="text-xs text-white/50">草稿狀態載入中…</p>
      )}

      {draftStatusError && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="min-w-0 flex-1">{draftStatusError}</span>
          <button
            type="button"
            onClick={loadDraftStatus}
            disabled={busy}
            className="btn-base btn-ghost text-xs"
          >
            重試
          </button>
        </div>
      )}

      {draftExists && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="min-w-0 flex-1">
            有未發佈的草稿
            {draftSavedAt
              ? `（儲存於 ${draftSavedAt.getMonth() + 1} 月 ${draftSavedAt.getDate()} 日）`
              : ""}
            ，訪客看到的仍是正式內容。
          </span>
          <button
            type="button"
            onClick={discardDraft}
            disabled={busy || !supabaseReady}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-50"
          >
            {action === "discard" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            丟棄草稿
          </button>
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveDraft}
          disabled={busy || !supabaseReady}
          className="btn-base btn-cobalt"
        >
          {action === "save" ? (
            <>
              <Loader2 size={16} className="animate-spin" /> 儲存中…
            </>
          ) : (
            <>
              <Save size={16} /> 儲存草稿
            </>
          )}
        </button>
        <button
          type="button"
          onClick={previewDraft}
          disabled={!supabaseReady}
          className="btn-base btn-ghost"
        >
          <Eye size={16} /> 預覽
        </button>
        <button
          type="button"
          onClick={publishDraft}
          disabled={busy || !supabaseReady}
          className="btn-base btn-vital"
        >
          {action === "publish" ? (
            <>
              <Loader2 size={16} className="animate-spin" /> 發佈中…
            </>
          ) : (
            <>
              <Rocket size={16} /> 發佈
            </>
          )}
        </button>
      </div>
    </section>
  );
}

/* =============================================================
 * 主元件
 * ============================================================= */

export function ContentManager({
  content,
  nav,
  contact,
  pages,
  blocks,
  seo,
  supabaseReady = true,
}: {
  content: SiteContent;
  nav: SiteNav;
  contact: SiteContact;
  pages: SitePages;
  blocks: SiteBlocks;
  seo: SiteSeo;
  /** Supabase 未連接時停用草稿工具列（與頁頂警告橫幅同一判斷） */
  supabaseReady?: boolean;
}) {
  const router = useRouter();
  const contentApi = useSectionSave(
    "/api/admin/site-content",
    content,
    "確定要回復原廠首頁文案嗎？這會清除你對首頁與關於我們文案的所有調整。"
  );
  const navApi = useSectionSave(
    "/api/admin/site-nav",
    nav,
    "確定要回復原廠選單嗎？這會清除你的選單名稱與顯隱調整。"
  );
  const contactApi = useSectionSave(
    "/api/admin/site-contact",
    contact,
    "確定要回復原廠聯絡資料嗎？這會清除頁尾的聯絡資訊與品牌宣言調整。"
  );
  const pagesApi = useSectionSave(
    "/api/admin/site-pages",
    pages,
    "確定要回復原廠頁面文案嗎？這會清除九個頁面的所有文案調整。"
  );
  // 進後台時依 order 排序顯示，避免 DB 順序與顯示順序不一致
  const blocksApi = useSectionSave(
    "/api/admin/site-blocks",
    { home: [...blocks.home].sort((a, b) => a.order - b.order) },
    "確定要回復首頁區塊預設嗎？八個區塊會全部顯示並依原順序排列。"
  );
  const seoApi = useSectionSave(
    "/api/admin/site-seo",
    seo,
    "確定要回復原廠 SEO 設定嗎？這會清除你自訂的全站標題、簡介與分享圖。"
  );

  // T-16：草稿袋為替換語義，儲存草稿必須一次收集六個分區的當前值
  const draftPayload: DraftPayload = {
    content: contentApi.form,
    nav: navApi.form,
    contact: contactApi.form,
    pages: pagesApi.form,
    blocks: blocksApi.form,
    seo: seoApi.form,
  };

  return (
    <div className="space-y-6">
      <DraftToolbar
        supabaseReady={supabaseReady}
        draftPayload={draftPayload}
        router={router}
      />
      <ContentSection api={contentApi} />
      <NavSection api={navApi} />
      <ContactSection api={contactApi} />
      <PagesSection api={pagesApi} />
      <BlocksSection api={blocksApi} />
      <SeoSection api={seoApi} />
    </div>
  );
}
