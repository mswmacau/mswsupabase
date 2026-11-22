"use client";

/**
 * src/app/admin/schedule/BatchGenerateDialog.tsx — 批量生成班表（站主需求）
 *
 * 站主原話：「如果定期訓練是星期一、四、六，希望可以一次過生成一四六，
 * 即時批量生成，不用一日一日去做。」
 *
 * 做法：選「月份＋每週哪幾天＋課程＋時間」，前端即時算出會生成哪幾天並預覽，
 * 按「生成」才打一次 POST /api/admin/training/sessions（action:"batch"）。
 * 重複的日期由後端略過並回 skipped，前端不自己判斷（前端不持有完整班表，
 * 判斷重複會與後端不一致）。
 *
 * 視覺與欄位沿用 SessionFormDialog：AdminModal、Field、INPUT/SELECT 常數、
 * 選課程自動帶入教練／場地／名額／結束時間（endTouched 邏輯一致）。
 *
 * 390：單欄、七個星期 chips 一行（7×44=308 < 390）、所有觸控目標 ≥44px。
 */

import { useId, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AdminError, AdminModal, Field } from "@/components/admin/ui";
import {
  batchCreateSessions,
  TrainingApiError,
  toMessage,
  type TrainingClass,
  type YearMonth,
} from "./api";
import {
  addMinutes,
  macauTodayISO,
  monthDayLabel,
  pad2,
} from "./format";

const DEFAULT_DURATION = 90;
const DEFAULT_START = "19:30";
const DEFAULT_END = "21:00";

const INPUT = "field [color-scheme:dark]";
const SELECT = `${INPUT} [&>option]:bg-ink-soft [&>option]:text-white`;

/**
 * 星期順序照日曆：一 → 日。
 * value 用 **1=一 … 7=日**（與後端 batch 契約同口徑；
 * JS getDay() 的 0=日是另一套，轉換見 isoWeekday()）。
 */
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 7, label: "日" },
];

/** JS getDay()（0=日）→ 本頁與後端共用的 1=一 … 7=日 */
function isoWeekday(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/** 預覽最多顯示幾個日期，其餘用「等 N 場」 */
const PREVIEW_LIMIT = 6;

function endTimeFor(start: string, durationMin: number | null): string {
  return addMinutes(start || DEFAULT_START, durationMin ?? DEFAULT_DURATION);
}

function firstActiveClass(classes: TrainingClass[]): TrainingClass | undefined {
  return classes.find((c) => c.is_active) ?? classes[0];
}

/** 'YYYY-MM' → { year, month }；不合法回 null */
function parseMonth(value: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2024 || year > 2100) return null;
  return { year, month };
}

/**
 * 該月符合「指定星期」的日期（'YYYY-MM-DD'，升冪）。
 * 用 Date.UTC 取星期，避免本地時區把日期推前／推後一天。
 * skipPast = true 時排除早於今天的日期（與後端 include_past:false 同口徑）。
 */
function buildDates(
  year: number,
  month: number,
  weekdays: number[],
  skipPast: boolean,
  todayISO: string
): string[] {
  if (weekdays.length === 0) return [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = isoWeekday(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
    if (!weekdays.includes(weekday)) continue;
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    if (skipPast && iso < todayISO) continue;
    out.push(iso);
  }
  return out;
}

export function BatchGenerateDialog({
  classes,
  displayedMonth,
  onClose,
  onGenerated,
}: {
  classes: TrainingClass[];
  /** 預設月份＝目前檢視的月份（不是今天） */
  displayedMonth: YearMonth;
  onClose: () => void;
  /** 成功後：回傳結果訊息與「實際生成的月份」，由頁面切月＋重新載入 */
  onGenerated: (message: string, month: YearMonth) => void;
}) {
  const formId = useId();
  const prefix = useId();
  const fieldId = (name: string) => `${prefix}-${name}`;

  /** 今天（澳門）只算一次：預覽與 include_past 的判斷要用同一個基準 */
  const [todayISO] = useState(() => macauTodayISO());
  /** 使用者是否手動改過結束時間（同 SessionFormDialog） */
  const endTouched = useRef(false);

  const [monthValue, setMonthValue] = useState(
    () => `${displayedMonth.year}-${pad2(displayedMonth.month)}`
  );
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [classId, setClassId] = useState(() => firstActiveClass(classes)?.id ?? "");
  const [startTime, setStartTime] = useState(DEFAULT_START);
  /**
   * 初始結束時間固定 21:00（任務指定「預設 19:30／21:00」）。
   * 之後使用者改課程或改開始時間，才依課程時長自動重算（同 SessionFormDialog）。
   */
  const [endTime, setEndTime] = useState(DEFAULT_END);
  const [capacity, setCapacity] = useState(() => {
    const klass = firstActiveClass(classes);
    return klass?.capacity != null ? String(klass.capacity) : "";
  });
  const [location, setLocation] = useState(() => firstActiveClass(classes)?.location ?? "");
  const [coachName, setCoachName] = useState(() => firstActiveClass(classes)?.coach_name ?? "");
  const [note, setNote] = useState("");
  /** 勾選＝不要生成過去的日期（送出 include_past:false） */
  const [skipPast, setSkipPast] = useState(true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** 成功結果（保留對話框，方便「再生成一次」看全部略過） */
  const [result, setResult] = useState<string | null>(null);

  const classesEmpty = classes.length === 0;
  const selectedClass = classes.find((c) => c.id === classId);
  const parsed = parseMonth(monthValue);
  const previewDates = parsed
    ? buildDates(parsed.year, parsed.month, weekdays, skipPast, todayISO)
    : [];

  function toggleWeekday(value: number) {
    setWeekdays((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
    setResult(null);
    // 一選了星期就清掉該欄位的錯誤（不用等下一次提交）
    setFieldErrors((prev) => {
      if (!prev.weekdays) return prev;
      const rest = { ...prev };
      delete rest.weekdays;
      return rest;
    });
  }

  function handleClassChange(nextId: string) {
    const klass = classes.find((c) => c.id === nextId);
    endTouched.current = false;
    setClassId(nextId);
    setCoachName(klass?.coach_name ?? "");
    setLocation(klass?.location ?? "");
    setCapacity(klass?.capacity != null ? String(klass.capacity) : "");
    setEndTime(endTimeFor(startTime, klass?.duration_min ?? DEFAULT_DURATION));
    setResult(null);
  }

  function handleStartChange(value: string) {
    setStartTime(value);
    if (!endTouched.current) {
      setEndTime(endTimeFor(value, selectedClass?.duration_min ?? DEFAULT_DURATION));
    }
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!parsed) errors.month = "請選擇有效的月份。";
    if (weekdays.length === 0) errors.weekdays = "請至少選擇一個星期";
    if (!classId) errors.class_id = "請選擇課程。";
    if (!startTime) errors.start_time = "請選擇開始時間。";
    if (!endTime) errors.end_time = "請選擇結束時間。";
    if (startTime && endTime && endTime <= startTime) {
      errors.end_time = "結束時間需晚於開始時間。";
    }
    if (capacity.trim() !== "") {
      const n = Number(capacity);
      if (!Number.isInteger(n) || n < 1 || n > 999) {
        errors.capacity = "名額需介於 1 與 999 之間。";
      }
    }
    if (coachName.length > 60) errors.coach_name = "教練名稱過長（上限 60 字）。";
    if (location.length > 120) errors.location = "場地名稱過長（上限 120 字）。";
    if (note.length > 500) errors.note = "備註過長（上限 500 字）。";
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !parsed) {
      if (!parsed) setFieldErrors({ month: "請選擇有效的月份。" });
      return;
    }

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError("請檢查表單內容。");
      return;
    }

    setPending(true);
    setFormError(null);
    setResult(null);

    try {
      const res = await batchCreateSessions({
        year: parsed.year,
        month: parsed.month,
        // 1–7（一→日），升冪送去：後端即使不排序，行為也穩定
        weekdays: [...weekdays].sort((a, b) => a - b),
        class_id: classId,
        start_time: startTime,
        end_time: endTime,
        status: "open",
        capacity: capacity.trim() === "" ? null : Number(capacity),
        location: location.trim(),
        coach_name: coachName.trim(),
        note: note.trim(),
        include_past: !skipPast,
      });

      // 文案固定格式（站主已審）：新增 N 場，略過 M 場
      const message = `新增 ${res.created} 場，略過 ${res.skipped} 場`;
      setResult(message);
      onGenerated(message, { year: parsed.year, month: parsed.month });
    } catch (err) {
      if (err instanceof TrainingApiError && err.fields) setFieldErrors(err.fields);
      setFormError(toMessage(err));
    } finally {
      setPending(false);
    }
  }

  const previewText = (() => {
    if (!parsed || weekdays.length === 0) return null;
    const head = previewDates.slice(0, PREVIEW_LIMIT).map(monthDayLabel).join("、");
    const rest = previewDates.length - PREVIEW_LIMIT;
    return {
      count: previewDates.length,
      head,
      rest,
    };
  })();

  return (
    <AdminModal
      title="批量生成班表"
      description="選月份與每週哪幾天，一次過生成整月場次；已經存在的同一日同時段會自動略過。"
      onClose={() => {
        if (!pending) onClose();
      }}
      dismissible={!pending}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn-base btn-ghost"
          >
            {result ? "關閉" : "取消"}
          </button>
          <button
            type="submit"
            form={formId}
            disabled={pending || classesEmpty}
            className="btn-base btn-vital"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 生成中…
              </>
            ) : (
              "生成"
            )}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        method="post"
        action="/admin/schedule"
        className="space-y-4"
      >
        {classesEmpty && (
          <AdminError message="課程主檔還是空的（training_classes 沒有資料），沒法批量排班。請聯絡工程師先把課程匯入。" />
        )}
        {formError && (
          <AdminError message={formError} onDismiss={() => setFormError(null)} />
        )}
        {result && (
          <div
            role="status"
            className="slab border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            {result}
          </div>
        )}

        <Field label="月份" htmlFor={fieldId("month")} error={fieldErrors.month}>
          <input
            id={fieldId("month")}
            type="month"
            className={INPUT}
            value={monthValue}
            min="2024-01"
            max="2100-12"
            onChange={(e) => {
              setMonthValue(e.target.value);
              setResult(null);
            }}
            required
          />
        </Field>

        {/* 每週：七個 chips，多選。390 一行放得下（7×44=308） */}
        <Field
          label="每週"
          htmlFor={fieldId("weekdays")}
          error={fieldErrors.weekdays}
          hint="可多選，例如一、四、六"
        >
          <div
            id={fieldId("weekdays")}
            role="group"
            aria-label="每週"
            className="flex flex-wrap gap-1.5"
          >
            {WEEKDAYS.map((d) => {
              const active = weekdays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={`星期${d.label}`}
                  onClick={() => toggleWeekday(d.value)}
                  className={`inline-flex min-h-11 min-w-11 flex-1 items-center justify-center text-sm transition sm:flex-none sm:px-3 ${
                    active
                      ? "slab bg-vital font-bold text-white"
                      : "border border-white/15 bg-white/[0.03] text-white/70 hover:text-white"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="課程"
            htmlFor={fieldId("class")}
            error={fieldErrors.class_id}
            hint={
              selectedClass?.duration_min
                ? `時長 ${selectedClass.duration_min} 分鐘`
                : undefined
            }
          >
            <select
              id={fieldId("class")}
              className={SELECT}
              value={classId}
              onChange={(e) => handleClassChange(e.target.value)}
              required
            >
              <option value="">請選擇課程</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                  {klass.is_active ? "" : "（已停用）"}
                </option>
              ))}
            </select>
          </Field>

          <Field label="教練" htmlFor={fieldId("coach")} error={fieldErrors.coach_name}>
            <input
              id={fieldId("coach")}
              type="text"
              className={INPUT}
              value={coachName}
              onChange={(e) => setCoachName(e.target.value)}
              placeholder="例：Kelvin"
              maxLength={60}
            />
          </Field>

          <Field label="開始時間" htmlFor={fieldId("start")} error={fieldErrors.start_time}>
            <input
              id={fieldId("start")}
              type="time"
              className={INPUT}
              value={startTime}
              onChange={(e) => handleStartChange(e.target.value)}
              required
            />
          </Field>

          <Field
            label="結束時間"
            htmlFor={fieldId("end")}
            error={fieldErrors.end_time}
            hint="依課程時長自動算，可手動改"
          >
            <input
              id={fieldId("end")}
              type="time"
              className={INPUT}
              value={endTime}
              onChange={(e) => {
                endTouched.current = true;
                setEndTime(e.target.value);
              }}
              required
            />
          </Field>

          <Field
            label="名額"
            htmlFor={fieldId("capacity")}
            error={fieldErrors.capacity}
            hint="留空沿用課程預設（1–999）"
          >
            <input
              id={fieldId("capacity")}
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              className={INPUT}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="30"
            />
          </Field>

          <Field label="地點" htmlFor={fieldId("loc")} error={fieldErrors.location}>
            <input
              id={fieldId("loc")}
              type="text"
              className={INPUT}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例：澳門街健館"
              maxLength={120}
            />
          </Field>
        </div>

        <Field
          label="備註"
          htmlFor={fieldId("note")}
          error={fieldErrors.note}
          hint="上限 500 字，前台不顯示，只給後台看"
        >
          <textarea
            id={fieldId("note")}
            className={`${INPUT} min-h-[72px] resize-y`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
          />
        </Field>

        {/* 過去日期：預設不生成 */}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={skipPast}
            onChange={(e) => {
              setSkipPast(e.target.checked);
              setResult(null);
            }}
            className="h-5 w-5 shrink-0 accent-[var(--color-vital)]"
          />
          不要生成過去的日期
        </label>

        {/* 即時預覽：純前端計算，不打 API */}
        {previewText && (
          <div
            aria-live="polite"
            className="slab border border-white/15 bg-white/[0.03] px-4 py-3"
          >
            <p className="text-sm font-bold text-white">
              將生成 {previewText.count} 場
            </p>
            {previewText.count > 0 && (
              <p className="mt-1 break-words text-xs leading-relaxed text-white/65">
                {previewText.head}
                {previewText.rest > 0 ? ` 等 ${previewText.rest} 場` : ""}
              </p>
            )}
            {previewText.count === 0 && (
              <p className="mt-1 text-xs leading-relaxed text-white/60">
                這個月份沒有符合的日期（或全部已過去）。
              </p>
            )}
          </div>
        )}
      </form>
    </AdminModal>
  );
}
