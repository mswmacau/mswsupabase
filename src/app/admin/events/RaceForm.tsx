"use client";

/**
 * src/app/admin/events/RaceForm.tsx — 賽事新增／編輯（三段式表單 + 組別編輯）
 *
 * Owner：方砚（frontend-engineer）
 *
 * 【為什麼是三段，而不是一份長表單】
 * 站主原話：「盡量俾我更大嘅自由度去編輯；但我亦唔希望管理後台頁面過於混亂
 * 或者過於複雜」。折衷做法：
 *   第一段（必填，永遠展開）賽事名／日期／地點／狀態 —— 九成情況只需要改這些
 *   第二段（常用，永遠展開）報名截止、主頁曝光開關 + 一句話標語
 *   第三段（進階，預設**收合**）集合、費用、後勤、注意事項、相簿
 * 收合的段落標題會顯示「已填 N 項」，不展開也知道有沒有填過東西。
 *
 * 【欄位對應（全部落在既有白名單，沒有新增 DB 欄位）】
 *   集合地點與出發時間 → events.start_time（≤20 字）
 *   報名費            → events.fee_cents（分；前台顯示「報名費 MOP xxx」）
 *   交通與住宿安排    → events.logistics_note（≤2000，前台後勤區塊）
 *   注意事項          → events.registration_note（≤300，前台注意事項）
 *   相簿網址／按鈕    → events.album_url / album_label（相片模式時前台顯示按鈕）
 *
 * 【組別為什麼只有存檔後才能編輯】
 * race_categories 需要 event_id（外鍵），新增中的賽事還沒有 id。
 * 硬要在前端先暫存再一起送，會出現「賽事建成了但組別失敗」的半套資料，
 * 所以明確要求先存檔，並在 UI 寫清楚這一步。
 *
 * 【手機】單欄、每個輸入都有 label、儲存按鈕固定在卡片底部（sticky），
 * 不需要滑很久找按鈕；所有按鈕 ≥44px。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { deleteJson, patchJson, postJson } from "@/lib/fetch-json";
import { AlbumLinksEditor } from "./AlbumLinksEditor";
import {
  RACE_STATUS_OPTIONS,
  deadlineApiToInput,
  deadlineInputToApi,
  isHttpUrl,
  raceDayLabel,
  raceFeeLabel,
  teamSizeLabel,
  toRaceStatus,
  type AdminRace,
  type AdminRaceCategory,
  type RaceFormProps,
  type RaceStatusValue,
} from "./race-types";

interface FormState {
  title: string;
  startDate: string;
  endDate: string;
  location: string;
  status: RaceStatusValue;
  deadline: string;
  promoOnHome: boolean;
  promoNote: string;
  /** 集合地點與出發時間（start_time） */
  assembly: string;
  /** 報名費，單位「元」（送 API 時 ×100 成 fee_cents） */
  fee: string;
  logistics: string;
  notice: string;
  albumUrl: string;
  albumLabel: string;
}

function emptyForm(): FormState {
  return {
    title: "",
    startDate: "",
    endDate: "",
    location: "",
    status: "draft",
    deadline: "",
    promoOnHome: false,
    promoNote: "",
    assembly: "",
    fee: "",
    logistics: "",
    notice: "",
    albumUrl: "",
    albumLabel: "",
  };
}

function formFromRace(race: AdminRace): FormState {
  return {
    title: race.title,
    startDate: race.event_date,
    endDate: race.end_date ?? "",
    location: race.location ?? "",
    status: toRaceStatus(race.status),
    deadline: deadlineApiToInput(race.registration_deadline),
    promoOnHome: Boolean(race.promo_on_home),
    promoNote: race.promo_note ?? "",
    assembly: race.start_time ?? "",
    fee: race.fee_cents ? String(race.fee_cents / 100) : "",
    logistics: race.logistics_note ?? "",
    notice: race.registration_note ?? "",
    albumUrl: race.album_url ?? "",
    albumLabel: race.album_label ?? "",
  };
}

/** 「元」輸入 → 分（整數）。空白／非數字 → 0（0 = 免費） */
function feeToCents(value: string): number {
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.round(n * 100));
}

/** 第三段已填幾項（給收合時的摘要行用；logistics 已移到第二段，不計入） */
function advancedFilledCount(form: FormState): number {
  const values = [
    form.assembly,
    form.fee,
    form.notice,
    form.albumUrl,
    form.albumLabel,
  ];
  return values.filter((v) => v.trim() !== "").length;
}

export function RaceForm({ mode, race, onClose, onSaved }: RaceFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit" && race !== null;

  const [form, setForm] = useState<FormState>(() =>
    race ? formFromRace(race) : emptyForm()
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  /** 組別（編輯模式才有）：本地狀態，操作成功即更新，同時 router.refresh() 讓列表數字跟上 */
  const [categories, setCategories] = useState<AdminRaceCategory[]>(
    () => race?.categories ?? []
  );
  const [catMessage, setCatMessage] = useState<string | null>(null);
  const [catError, setCatError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const filled = advancedFilledCount(form);

  function buildPayload(): Record<string, unknown> {
    return {
      title: form.title.trim(),
      start_date: form.startDate,
      end_date: form.endDate.trim() === "" ? null : form.endDate,
      location: form.location.trim() === "" ? null : form.location.trim(),
      status: form.status,
      registration_deadline: deadlineInputToApi(form.deadline),
      promo_on_home: form.promoOnHome,
      promo_note: form.promoNote.trim() === "" ? null : form.promoNote.trim(),
      start_time: form.assembly.trim() === "" ? null : form.assembly.trim(),
      fee_cents: feeToCents(form.fee),
      logistics_note:
        form.logistics.trim() === "" ? null : form.logistics.trim(),
      registration_note:
        form.notice.trim() === "" ? null : form.notice.trim(),
      album_url: form.albumUrl.trim() === "" ? null : form.albumUrl.trim(),
      album_label:
        form.albumLabel.trim() === "" ? null : form.albumLabel.trim(),
    };
  }

  /** 前端先驗一次（伺服器端白名單會再驗；這裡只是少一次來回） */
  function validate(): Record<string, string> {
    const out: Record<string, string> = {};
    if (form.title.trim() === "") out.title = "請填寫賽事名稱。";
    if (form.startDate.trim() === "") out.start_date = "請選擇開始日。";
    if (form.endDate.trim() !== "" && form.endDate < form.startDate) {
      out.end_date = "結束日不可早於開始日。";
    }
    if (form.albumUrl.trim() !== "" && !isHttpUrl(form.albumUrl)) {
      out.album_url = "相簿網址必須是 http／https 開頭。";
    }
    if (form.albumLabel.trim().length > 20) {
      out.album_label = "相簿按鈕文字最多 20 個字。";
    }
    if (form.promoNote.trim().length > 120) {
      out.promo_note = "主頁標語最多 120 個字。";
    }
    if (form.notice.trim().length > 300) {
      out.registration_note = "注意事項最多 300 個字。";
    }
    if (form.logistics.trim().length > 2000) {
      out.logistics_note = "交通與住宿安排最多 2000 個字。";
    }
    if (form.assembly.trim().length > 20) {
      out.start_time = "集合與出發最多 20 個字。";
    }
    return out;
  }

  async function submit() {
    setError(null);
    setFields({});

    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setFields(clientErrors);
      setError("有欄位需要修正，請看下方紅字。");
      if (
        clientErrors.album_url ||
        clientErrors.album_label ||
        clientErrors.logistics_note ||
        clientErrors.registration_note ||
        clientErrors.start_time
      ) {
        setAdvancedOpen(true);
      }
      return;
    }

    setPending(true);
    try {
      const payload = buildPayload();
      if (isEdit && race) {
        await patchJson<{ ok: true }>(`/api/admin/races/${race.id}`, payload);
        onSaved(`已儲存「${form.title.trim()}」。`);
      } else {
        await postJson<{ ok: true }>("/api/admin/races", payload);
        onSaved(
          `已建立「${form.title.trim()}」（草稿）。要加入組別，請在列表按這一場的「編輯」。`
        );
      }
    } catch (e) {
      if (e && typeof e === "object" && "fields" in e) {
        const f = (e as { fields?: Record<string, string> }).fields;
        if (f) setFields(f);
      }
      setError(e instanceof Error ? e.message : "儲存失敗，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="race-form-title"
      className="fixed inset-0 z-[70] overflow-y-auto bg-ink/80 backdrop-blur-sm"
    >
      <div className="mx-auto my-6 w-full max-w-3xl px-4 md:my-10">
        <div data-race-form className="card-dark p-5 md:p-7">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="race-form-title" className="text-lg font-bold">
                {isEdit ? "編輯賽事" : "新增賽事"}
              </h3>
              <p className="mt-1 text-xs text-white/55">
                {isEdit
                  ? "先填必填欄位就能存檔；進階設定不收合也能直接改。"
                  : "填好第一段就能先存成草稿，之後再回來加組別。"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-sm text-white/70 transition hover:border-white/40"
            >
              <X size={15} aria-hidden /> 關閉
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 [overflow-wrap:anywhere]"
            >
              {error}
            </div>
          )}

          {/* ───────────── 第一段：必填 ───────────── */}
          <section aria-labelledby="sec1" className="space-y-4">
            <h4
              id="sec1"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55"
            >
              基本資料
            </h4>

            <div>
              <label className="label" htmlFor="rf-title">
                賽事名稱 *
              </label>
              <input
                id="rf-title"
                className="field"
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                maxLength={120}
                placeholder="例如：廣州 HYROX 2026"
              />
              <FieldError message={fields.title} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="rf-start">
                  開始日 *
                </label>
                <input
                  id="rf-start"
                  type="date"
                  className="field"
                  value={form.startDate}
                  onChange={(e) => setField("startDate", e.target.value)}
                />
                <FieldError message={fields.start_date} />
              </div>
              <div>
                <label className="label" htmlFor="rf-end">
                  結束日（單日賽事留空）
                </label>
                <input
                  id="rf-end"
                  type="date"
                  className="field"
                  value={form.endDate}
                  min={form.startDate || undefined}
                  onChange={(e) => setField("endDate", e.target.value)}
                />
                <FieldError message={fields.end_date} />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="rf-location">
                地點
              </label>
              <input
                id="rf-location"
                className="field"
                value={form.location}
                onChange={(e) => setField("location", e.target.value)}
                maxLength={120}
                placeholder="例如：廣州"
              />
              <FieldError message={fields.location} />
            </div>

            <div>
              <label className="label" htmlFor="rf-status">
                狀態
              </label>
              <select
                id="rf-status"
                className="field"
                value={form.status}
                onChange={(e) =>
                  setField("status", e.target.value as RaceStatusValue)
                }
              >
                {RACE_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-white/50">
                「草稿」與「已下架」前台完全看不到；要做到一半先給人看，用「報名中」或「已截止」。
              </p>
              <FieldError message={fields.status} />
            </div>
          </section>

          {/* ───────────── 第二段：報名與主頁 ───────────── */}
          <section
            aria-labelledby="sec2"
            className="mt-7 space-y-4 border-t border-ink-line pt-6"
          >
            <h4
              id="sec2"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55"
            >
              報名與主頁
            </h4>

            <div>
              <label className="label" htmlFor="rf-deadline">
                報名截止時間（留空 = 不限）
              </label>
              <input
                id="rf-deadline"
                type="datetime-local"
                className="field"
                value={form.deadline}
                onChange={(e) => setField("deadline", e.target.value)}
              />
              <p className="mt-1 text-xs text-white/50">
                以澳門時間填寫。過了這個時間，前台會顯示「報名已截止」，
                就算狀態仍是「報名中」也不會收新報名。
              </p>
              <FieldError message={fields.registration_deadline} />
            </div>

            <div className="rounded-xl border border-ink-line bg-ink-soft px-4 py-3">
              <label
                htmlFor="rf-promo"
                className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-white/85"
              >
                <input
                  id="rf-promo"
                  type="checkbox"
                  checked={form.promoOnHome}
                  onChange={(e) => setField("promoOnHome", e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-vital)]"
                />
                在主頁顯示這場賽事
              </label>
              <p className="mt-1 text-xs leading-relaxed text-white/50">
                主頁賽事帶同一時間建議只開一場。只有「報名中／已截止」且未完賽的賽事會真正出現。
              </p>

              <div className="mt-3">
                <label className="label" htmlFor="rf-promo-note">
                  主頁一句話標語（選填，最多 120 字）
                </label>
                <input
                  id="rf-promo-note"
                  className="field"
                  value={form.promoNote}
                  onChange={(e) => setField("promoNote", e.target.value)}
                  maxLength={120}
                  placeholder="例如：11 月廣州站，現正接受報名"
                />
                <FieldError message={fields.promo_note} />
              </div>
            </div>

            {/* 交通與住宿：站主 2026-11 明確要求「不用加欄位，先給我手動輸入方式」。
                這段自由文字會原樣（保留換行）顯示在賽事頁的後勤區塊，
                不涉及任何結構化欄位，也不需要改 DB。
                原本收在「進階（收合）」內，但這是站主每場都要填的欄位，
                收起來等於找不到，所以移到本段永遠可見。 */}
            <div>
              <label className="label" htmlFor="rf-logistics">
                交通與住宿安排（最多 2000 字，可留空）
              </label>
              <textarea
                id="rf-logistics"
                className="field min-h-28 resize-y"
                value={form.logistics}
                onChange={(e) => setField("logistics", e.target.value)}
                maxLength={2000}
                placeholder={"例如：\n巴士：11/20 07:00 關閘集合，來回\n住宿：廣州天河區，兩晚，2 人房"}
              />
              <p className="mt-1 text-xs text-white/50">
                直接照你打的文字顯示在賽事頁（保留換行）。每場賽事可以完全不同，
                也可以隨時改或清空。
              </p>
              <FieldError message={fields.logistics_note} />
            </div>
          </section>

          {/* ───────────── 第三段：進階（預設收合）───────────── */}
          <section className="mt-7 border-t border-ink-line pt-6">
            <button
              type="button"
              data-act="toggle-advanced"
              aria-expanded={advancedOpen}
              aria-controls="rf-advanced"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-white/15 px-3 text-left text-sm font-semibold text-white/85 transition hover:border-white/30 hover:bg-white/5"
            >
              <span className="min-w-0">
                進階設定
                <span className="ml-2 text-xs font-normal text-white/55">
                  （已填 {filled} 項）
                </span>
              </span>
              {advancedOpen ? (
                <ChevronUp size={16} aria-hidden className="shrink-0" />
              ) : (
                <ChevronDown size={16} aria-hidden className="shrink-0" />
              )}
            </button>

            {advancedOpen && (
              <div
                id="rf-advanced"
                data-section="advanced"
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="label" htmlFor="rf-assembly">
                    集合地點與出發時間（最多 20 字）
                  </label>
                  <input
                    id="rf-assembly"
                    className="field"
                    value={form.assembly}
                    onChange={(e) => setField("assembly", e.target.value)}
                    maxLength={20}
                    placeholder="例如：07:30 廣州南站"
                  />
                  <p className="mt-1 text-xs text-white/50">
                    給你和參賽者對時間用；前台暫時不顯示這一欄。
                  </p>
                  <FieldError message={fields.start_time} />
                </div>

                <div>
                  <label className="label" htmlFor="rf-fee">
                    報名費（MOP，留空或 0 = 免費）
                  </label>
                  <input
                    id="rf-fee"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="1"
                    className="field"
                    value={form.fee}
                    onChange={(e) => setField("fee", e.target.value)}
                    placeholder="例如：1200"
                  />
                  <FieldError message={fields.fee_cents} />
                </div>

                <div>
                  <label className="label" htmlFor="rf-notice">
                    注意事項（最多 300 字）
                  </label>
                  <textarea
                    id="rf-notice"
                    className="field min-h-24 resize-y"
                    value={form.notice}
                    onChange={(e) => setField("notice", e.target.value)}
                    maxLength={300}
                    placeholder="例如：需自備身份證副本、賽前一天不得飲酒"
                  />
                  <p className="mt-1 text-xs text-white/50">
                    {form.notice.length}/300 字。前台賽事頁的「注意事項」就是這段。
                  </p>
                  <FieldError message={fields.registration_note} />
                </div>

                <div className="rounded-xl border border-ink-line bg-ink-soft p-4">
                  <label className="label" htmlFor="rf-album">
                    相簿網址（http／https）
                  </label>
                  <input
                    id="rf-album"
                    className="field"
                    value={form.albumUrl}
                    onChange={(e) => setField("albumUrl", e.target.value)}
                    maxLength={500}
                    placeholder="https://photos.example.com/guangzhou-2026"
                  />
                  <p className="mt-1 text-xs leading-relaxed text-white/50">
                    貼上攝影師雲端相簿連結，賽事結束後把狀態改成「相片模式」就會顯示。
                  </p>
                  <FieldError message={fields.album_url} />

                  <div className="mt-3">
                    <label className="label" htmlFor="rf-album-label">
                      相簿按鈕文字（最多 20 字，留空 = 預設「睇比賽相片」）
                    </label>
                    <input
                      id="rf-album-label"
                      className="field"
                      value={form.albumLabel}
                      onChange={(e) => setField("albumLabel", e.target.value)}
                      maxLength={20}
                      placeholder="睇比賽相片"
                    />
                    <FieldError message={fields.album_label} />
                  </div>

                  {/* 更多相簿連結（F-08）：主相簿欄位零改動，其下的按鈕列。
                      只有編輯模式才渲染——連結需要 event_id（與組別同一條紀律）。
                      新增模式顯示指路文字。 */}
                  {isEdit && race ? (
                    <AlbumLinksEditor eventId={race.id} />
                  ) : (
                    <p className="mt-3 rounded-xl border border-dashed border-white/15 px-4 py-3 text-xs leading-relaxed text-white/55">
                      存檔後可為這場賽事加「更多相簿」連結（最多 5 筆，
                      相片模式時顯示在主相簿按鈕下面）。
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ───────────── 組別（只有編輯模式）───────────── */}
          <section className="mt-7 border-t border-ink-line pt-6">
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
              組別
            </h4>

            {isEdit && race ? (
              <CategoryEditor
                raceId={race.id}
                startDate={race.event_date}
                endDate={race.end_date}
                categories={categories}
                onChange={(next) => {
                  setCategories(next);
                  router.refresh();
                }}
                message={catMessage}
                onMessage={setCatMessage}
                error={catError}
                onError={setCatError}
              />
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-white/15 px-4 py-4 text-sm leading-relaxed text-white/60">
                組別要等這場賽事存檔後才能加入（組別需要賽事編號）。
                先按下方「儲存」，再回列表按「編輯」，就會出現分日期的組別編輯區。
              </p>
            )}
          </section>

          {/* ───────────── 儲存（固定在卡片底部）───────────── */}
          <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-6 flex flex-wrap items-center gap-3 rounded-b-2xl border-t border-ink-line bg-ink-soft/95 px-5 py-3 backdrop-blur md:-mx-7 md:-mb-7 md:px-7">
            <button
              type="button"
              data-act="save-race"
              onClick={() => void submit()}
              disabled={pending}
              className="btn-base btn-vital text-sm"
            >
              {pending ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden />{" "}
                  儲存中…
                </>
              ) : isEdit ? (
                "儲存變更"
              ) : (
                "建立賽事"
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-base btn-ghost text-sm"
            >
              取消
            </button>
            <span className="text-xs text-white/45">
              {isEdit ? "存檔後列表會立即更新" : "存檔後會建成草稿，前台看不到"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-300">{message}</p>;
}

/* =============================================================
 * 組別編輯：按日期分組、可加／改／刪
 * ============================================================= */

/** 賽事日期範圍內的每一天（'YYYY-MM-DD'，含頭尾） */
function daysBetween(start: string, end: string | null): string[] {
  if (!start) return [];
  const last = end && end >= start ? end : start;
  const out: string[] = [];
  const toUTC = (v: string) => Date.parse(`${v}T00:00:00Z`);
  const span = Math.round((toUTC(last) - toUTC(start)) / 86400000);
  // 上限 60 天：避免有人把結束日填成 2030 年時把選單撐爆
  for (let i = 0; i <= Math.min(span, 59); i += 1) {
    out.push(new Date(toUTC(start) + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

function CategoryEditor({
  raceId,
  startDate,
  endDate,
  categories,
  onChange,
  message,
  onMessage,
  error,
  onError,
}: {
  raceId: string;
  startDate: string;
  endDate: string | null;
  categories: AdminRaceCategory[];
  onChange: (next: AdminRaceCategory[]) => void;
  message: string | null;
  onMessage: (msg: string | null) => void;
  error: string | null;
  onError: (msg: string | null) => void;
}) {
  const days = daysBetween(startDate, endDate);

  /* 新增 */
  const [adding, setAdding] = useState(false);
  const [newDay, setNewDay] = useState(days[0] ?? startDate);
  const [newName, setNewName] = useState("");
  const [newTeamSize, setNewTeamSize] = useState("1");
  const [newFee, setNewFee] = useState("");

  /* 編輯 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTeamSize, setEditTeamSize] = useState("1");
  const [editFee, setEditFee] = useState("");

  const [pending, setPending] = useState<string | null>(null);

  /** 依日期分組（沒有組別的日期不顯示，避免空殼） */
  const grouped = new Map<string, AdminRaceCategory[]>();
  for (const cat of categories) {
    const list = grouped.get(cat.day) ?? [];
    list.push(cat);
    grouped.set(cat.day, list);
  }
  const dayKeys = Array.from(grouped.keys()).sort();

  function replaceCategory(next: AdminRaceCategory) {
    onChange(categories.map((c) => (c.id === next.id ? next : c)));
  }

  async function addCategory() {
    onError(null);
    onMessage(null);
    if (newName.trim() === "") {
      onError("請填寫組別名稱。");
      return;
    }
    const teamSize = Number(newTeamSize);
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 8) {
      onError("每組人數必須介於 1 到 8。");
      return;
    }

    setPending("add");
    try {
      const res = await postJson<{ ok: true; category: AdminRaceCategory }>(
        "/api/admin/races/categories",
        {
          event_id: raceId,
          day: newDay,
          name: newName.trim(),
          team_size: teamSize,
          fee_cents: feeToCents(newFee),
        }
      );
      onChange([...categories, res.category]);
      onMessage(`已加入組別「${res.category.name}」。`);
      setNewName("");
      setNewFee("");
      setNewTeamSize("1");
      setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "加入組別失敗，請稍後再試。");
    } finally {
      setPending(null);
    }
  }

  function startEdit(cat: AdminRaceCategory) {
    onError(null);
    onMessage(null);
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditTeamSize(String(cat.team_size));
    setEditFee(cat.fee_cents ? String(cat.fee_cents / 100) : "");
  }

  async function saveEdit(cat: AdminRaceCategory) {
    onError(null);
    onMessage(null);
    if (editName.trim() === "") {
      onError("請填寫組別名稱。");
      return;
    }
    const teamSize = Number(editTeamSize);
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 8) {
      onError("每組人數必須介於 1 到 8。");
      return;
    }

    setPending(cat.id);
    try {
      const res = await patchJson<{ ok: true; category: AdminRaceCategory }>(
        "/api/admin/races/categories",
        {
          id: cat.id,
          name: editName.trim(),
          team_size: teamSize,
          fee_cents: feeToCents(editFee),
        }
      );
      replaceCategory(res.category);
      onMessage(`已更新組別「${res.category.name}」。`);
      setEditingId(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "更新組別失敗，請稍後再試。");
    } finally {
      setPending(null);
    }
  }

  async function removeCategory(cat: AdminRaceCategory) {
    onError(null);
    onMessage(null);
    if (
      !window.confirm(`確定刪除組別「${cat.name}」（${raceDayLabel(cat.day)}）？`)
    ) {
      return;
    }
    setPending(cat.id);
    try {
      await deleteJson<{ ok: true }>("/api/admin/races/categories", {
        id: cat.id,
      });
      onChange(categories.filter((c) => c.id !== cat.id));
      onMessage(`已刪除組別「${cat.name}」。`);
    } catch (e) {
      // 例如 409：這個組別已有報名，不能刪（伺服器回中文說明）
      onError(e instanceof Error ? e.message : "刪除組別失敗，請稍後再試。");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-xs leading-relaxed text-white/55">
        每場賽事可以逐日設定不同組別。人數填「每組幾人」（1 = 個人賽、2 = 雙人、4 = 接力）。
      </p>

      {message && (
        <p role="status" className="mt-2 text-xs text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-300 [overflow-wrap:anywhere]">
          {error}
        </p>
      )}

      {dayKeys.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-white/60">
          還沒有任何組別。按下方「新增組別」開始（例如 Men Open、Mixed Doubles）。
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {dayKeys.map((day) => (
            <div key={day}>
              <div className="mb-1.5 text-xs font-semibold text-white/60">
                {raceDayLabel(day)}
                <span className="ml-2 font-normal text-white/40">
                  {(grouped.get(day) ?? []).length} 組
                </span>
              </div>
              <ul className="space-y-2">
                {(grouped.get(day) ?? []).map((cat) => (
                  <li
                    key={cat.id}
                    data-category-row
                    data-category-id={cat.id}
                    className="rounded-xl border border-ink-line bg-ink-soft px-3 py-2"
                  >
                    {editingId === cat.id ? (
                      <div className="space-y-2">
                        <div>
                          <label
                            className="label"
                            htmlFor={`cat-name-${cat.id}`}
                          >
                            組別名稱
                          </label>
                          <input
                            id={`cat-name-${cat.id}`}
                            className="field"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            maxLength={60}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label
                              className="label"
                              htmlFor={`cat-team-${cat.id}`}
                            >
                              每組人數（1–8）
                            </label>
                            <input
                              id={`cat-team-${cat.id}`}
                              type="number"
                              min={1}
                              max={8}
                              className="field"
                              value={editTeamSize}
                              onChange={(e) => setEditTeamSize(e.target.value)}
                            />
                          </div>
                          <div>
                            <label
                              className="label"
                              htmlFor={`cat-fee-${cat.id}`}
                            >
                              報名費（MOP）
                            </label>
                            <input
                              id={`cat-fee-${cat.id}`}
                              type="number"
                              min={0}
                              className="field"
                              value={editFee}
                              onChange={(e) => setEditFee(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void saveEdit(cat)}
                            disabled={pending === cat.id}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
                          >
                            {pending === cat.id ? (
                              <Loader2 size={14} className="animate-spin" aria-hidden />
                            ) : null}
                            儲存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex min-h-11 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/70 transition hover:border-white/40"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-white/90">
                            {cat.name}
                          </div>
                          <div className="mt-0.5 text-xs text-white/50">
                            {teamSizeLabel(cat.team_size)} ·{" "}
                            {raceFeeLabel(cat.fee_cents)}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`編輯組別 ${cat.name}`}
                          onClick={() => startEdit(cat)}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/20 text-white/70 transition hover:border-white/40 hover:text-white"
                        >
                          <Pencil size={15} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`刪除組別 ${cat.name}`}
                          onClick={() => void removeCategory(cat)}
                          disabled={pending === cat.id}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-500/40 text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {pending === cat.id ? (
                            <Loader2 size={15} className="animate-spin" aria-hidden />
                          ) : (
                            <Trash2 size={15} aria-hidden />
                          )}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="mt-3 space-y-3 rounded-xl border border-ink-line bg-ink-soft p-3">
          <div>
            <label className="label" htmlFor="new-cat-day">
              比賽日
            </label>
            <select
              id="new-cat-day"
              className="field"
              value={newDay}
              onChange={(e) => setNewDay(e.target.value)}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {raceDayLabel(d)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new-cat-name">
              組別名稱 *
            </label>
            <input
              id="new-cat-name"
              className="field"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={60}
              placeholder="例如：Men Open"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="new-cat-team">
                每組人數（1–8）
              </label>
              <input
                id="new-cat-team"
                type="number"
                min={1}
                max={8}
                className="field"
                value={newTeamSize}
                onChange={(e) => setNewTeamSize(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="new-cat-fee">
                報名費（MOP）
              </label>
              <input
                id="new-cat-fee"
                type="number"
                min={0}
                className="field"
                value={newFee}
                onChange={(e) => setNewFee(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-act="confirm-add-category"
              onClick={() => void addCategory()}
              disabled={pending === "add"}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
            >
              {pending === "add" ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : null}
              加入組別
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="inline-flex min-h-11 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/70 transition hover:border-white/40"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-act="add-category"
          onClick={() => {
            setAdding(true);
            onError(null);
            onMessage(null);
          }}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/25 px-3 text-xs font-semibold text-white/75 transition hover:border-white/45 hover:bg-white/5 sm:w-auto"
        >
          <Plus size={14} aria-hidden /> 新增組別
        </button>
      )}
    </div>
  );
}
