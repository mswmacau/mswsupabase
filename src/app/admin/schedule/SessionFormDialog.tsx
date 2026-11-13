"use client";

/**
 * src/app/admin/schedule/SessionFormDialog.tsx — 新增／編輯單場班表
 *
 * 不跳頁，用 AdminModal（Esc 關閉、Tab 鎖焦點、關閉後還原焦點都由 useOverlay 處理）。
 *
 * 【自動帶入】
 * 選課程時把該課的 duration_min / coach_name / location / capacity 帶進表單：
 *   · 結束時間 = 開始時間 + duration_min（未設定時用 90 分鐘）
 *   · 使用者手動改過結束時間之後就不再覆蓋（endTouched），避免打字打到一半被搶走
 *
 * 【狀態選項有三個，不是兩個】
 * 任務需求寫「正常 / 取消」，但 DB 的 status 是 open / closed / cancelled 三態
 * （舊的 /admin/sessions 頁面就會產生 closed）。若表單只給兩個選項，
 * 編輯一場 closed 的場次按儲存會把它靜默改成 open —— 這是資料破壞，
 * 所以這裡保留「已截止」選項。
 *
 * 【送出時的欄位策略】
 * update 一律把 session_date / class_id / start_time / end_time / coach_name /
 * location / capacity / note / status 全送。後端 update 是「沒給就沿用」語義，
 * 少送一個欄位不會出錯，但會讓「使用者清空欄位」這件事無法表達。
 */

import { useId, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AdminError, AdminModal, Field } from "@/components/admin/ui";
import {
  createTrainingSession,
  TrainingApiError,
  toMessage,
  updateTrainingSession,
  type ScheduleSession,
  type SessionStatus,
  type TrainingClass,
  type YearMonth,
} from "./api";
import { addMinutes, firstDayOfMonth, pad2, shortTime } from "./format";

const DEFAULT_DURATION = 90;
const DEFAULT_START = "19:00";

const INPUT = "field [color-scheme:dark]";
const SELECT = `${INPUT} [&>option]:bg-ink-soft [&>option]:text-white`;

const STATUS_LABEL: Record<SessionStatus, string> = {
  open: "正常（開放報名）",
  closed: "已截止",
  cancelled: "已取消",
};

interface FormValues {
  session_date: string;
  class_id: string;
  start_time: string;
  end_time: string;
  coach_name: string;
  location: string;
  capacity: string;
  note: string;
  status: SessionStatus;
}

/** 結束時間：開始 + 課程時長 */
function endTimeFor(start: string, durationMin: number | null): string {
  return addMinutes(start || DEFAULT_START, durationMin ?? DEFAULT_DURATION);
}

function firstActiveClass(classes: TrainingClass[]): TrainingClass | undefined {
  return classes.find((c) => c.is_active) ?? classes[0];
}

export function SessionFormDialog({
  mode,
  session,
  classes,
  displayedMonth,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  session?: ScheduleSession | null;
  classes: TrainingClass[];
  displayedMonth: YearMonth;
  onClose: () => void;
  onSaved: (message: string, sessionDate: string) => void;
}) {
  const formId = useId();
  const prefix = useId();
  const fieldId = (name: string) => `${prefix}-${name}`;

  const editing = mode === "edit" && session ? session : null;
  /** 使用者是否手動改過結束時間 */
  const endTouched = useRef(false);

  const [form, setForm] = useState<FormValues>(() => {
    if (editing) {
      const start = shortTime(editing.start_time);
      const end = shortTime(editing.end_time);
      return {
        session_date: editing.session_date,
        class_id: editing.class_id ?? "",
        start_time: start === "—" ? "" : start,
        end_time: end === "—" ? "" : end,
        coach_name: editing.coach_name ?? "",
        // 有 override 用 override，否則顯示目前生效的場地（送出後會變成該場的 override）
        location: editing.location_override ?? editing.location ?? "",
        capacity: String(editing.capacity ?? ""),
        note: editing.note ?? "",
        status: editing.status,
      };
    }

    const klass = firstActiveClass(classes);
    return {
      session_date: firstDayOfMonth(displayedMonth.year, displayedMonth.month),
      class_id: klass?.id ?? "",
      start_time: DEFAULT_START,
      end_time: endTimeFor(DEFAULT_START, klass?.duration_min ?? DEFAULT_DURATION),
      coach_name: klass?.coach_name ?? "",
      location: klass?.location ?? "",
      capacity: klass?.capacity != null ? String(klass.capacity) : "",
      note: "",
      status: "open",
    };
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const classesEmpty = classes.length === 0;
  const selectedClass = classes.find((c) => c.id === form.class_id);

  function handleClassChange(classId: string) {
    const klass = classes.find((c) => c.id === classId);
    endTouched.current = false;
    setForm((prev) => ({
      ...prev,
      class_id: classId,
      coach_name: klass ? (klass.coach_name ?? "") : prev.coach_name,
      location: klass ? (klass.location ?? "") : prev.location,
      capacity: klass?.capacity != null ? String(klass.capacity) : prev.capacity,
      end_time: endTimeFor(prev.start_time, klass?.duration_min ?? DEFAULT_DURATION),
    }));
  }

  function handleStartChange(value: string) {
    const klass = classes.find((c) => c.id === form.class_id);
    setForm((prev) => ({
      ...prev,
      start_time: value,
      end_time: endTouched.current
        ? prev.end_time
        : endTimeFor(value, klass?.duration_min ?? DEFAULT_DURATION),
    }));
  }

  function validate(values: FormValues): Record<string, string> {
    const errors: Record<string, string> = {};

    if (!values.session_date) errors.session_date = "請選擇活動日期。";
    if (!values.class_id) errors.class_id = "請選擇課程。";
    if (!values.start_time) errors.start_time = "請選擇開始時間。";
    if (!values.end_time) errors.end_time = "請選擇結束時間。";

    if (values.start_time && values.end_time && values.end_time <= values.start_time) {
      errors.end_time = "結束時間需晚於開始時間。";
    }

    if (values.capacity.trim() !== "") {
      const n = Number(values.capacity);
      if (!Number.isInteger(n) || n < 1 || n > 999) {
        errors.capacity = "名額需介於 1 與 999 之間。";
      }
    }
    if (values.coach_name.length > 60) errors.coach_name = "教練名稱過長（上限 60 字）。";
    if (values.location.length > 120) errors.location = "場地名稱過長（上限 120 字）。";
    if (values.note.length > 500) errors.note = "備註過長（上限 500 字）。";

    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError("請檢查表單內容。");
      return;
    }

    setPending(true);
    setFormError(null);

    const payload = {
      session_date: form.session_date,
      class_id: form.class_id,
      start_time: form.start_time,
      end_time: form.end_time,
      coach_name: form.coach_name.trim(),
      location: form.location.trim(),
      capacity: form.capacity.trim() === "" ? undefined : Number(form.capacity),
      note: form.note.trim(),
      status: form.status,
    };

    try {
      const result = editing
        ? await updateTrainingSession(editing.id, payload)
        : await createTrainingSession(payload);
      onSaved(result.message, form.session_date);
    } catch (err) {
      // 409 DUPLICATE / HAS_CHECKINS、400 VALIDATION 都保留使用者輸入，不關對話框
      if (err instanceof TrainingApiError && err.fields) setFieldErrors(err.fields);
      setFormError(toMessage(err));
    } finally {
      setPending(false);
    }
  }

  const dateOutsideMonth =
    form.session_date !== "" &&
    form.session_date.slice(0, 7) !==
      `${displayedMonth.year}-${pad2(displayedMonth.month)}`;

  return (
    <AdminModal
      title={editing ? "編輯場次" : "新增場次"}
      description={
        editing
          ? "改完按儲存即生效。前台日曆會跟著更新。"
          : "選課程後會自動帶入時長、教練、場地與名額，都可再改。"
      }
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
            取消
          </button>
          <button
            type="submit"
            form={formId}
            disabled={pending || classesEmpty}
            className="btn-base btn-vital"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 儲存中…
              </>
            ) : (
              "儲存"
            )}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {classesEmpty && (
          <AdminError message="課程主檔還是空的（training_classes 沒有資料），沒法排班。請聯絡工程師先把課程匯入，之後這張表單就能用。" />
        )}
        {formError && (
          <AdminError message={formError} onDismiss={() => setFormError(null)} />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="活動日期" htmlFor={fieldId("date")} error={fieldErrors.session_date}>
            <input
              id={fieldId("date")}
              type="date"
              className={INPUT}
              value={form.session_date}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, session_date: e.target.value }))
              }
              required
            />
          </Field>

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
              value={form.class_id}
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

          <Field label="開始時間" htmlFor={fieldId("start")} error={fieldErrors.start_time}>
            <input
              id={fieldId("start")}
              type="time"
              className={INPUT}
              value={form.start_time}
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
              value={form.end_time}
              onChange={(e) => {
                endTouched.current = true;
                setForm((prev) => ({ ...prev, end_time: e.target.value }));
              }}
              required
            />
          </Field>

          <Field label="教練" htmlFor={fieldId("coach")} error={fieldErrors.coach_name}>
            <input
              id={fieldId("coach")}
              type="text"
              className={INPUT}
              value={form.coach_name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, coach_name: e.target.value }))
              }
              placeholder="例：Kelvin"
              maxLength={60}
            />
          </Field>

          <Field label="場地" htmlFor={fieldId("location")} error={fieldErrors.location}>
            <input
              id={fieldId("location")}
              type="text"
              className={INPUT}
              value={form.location}
              onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="例：澳門街健館"
              maxLength={120}
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
              value={form.capacity}
              onChange={(e) => setForm((prev) => ({ ...prev, capacity: e.target.value }))}
              placeholder="30"
            />
          </Field>

          <Field label="狀態" htmlFor={fieldId("status")} error={fieldErrors.status}>
            <select
              id={fieldId("status")}
              className={SELECT}
              value={form.status}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, status: e.target.value as SessionStatus }))
              }
            >
              {(Object.keys(STATUS_LABEL) as SessionStatus[]).map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
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
            value={form.note}
            onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
            maxLength={500}
            rows={2}
          />
        </Field>

        {dateOutsideMonth && (
          <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            這個日期不在目前顯示的 {displayedMonth.year} 年 {displayedMonth.month} 月，
            儲存後要切到該月份才看得到這一場。
          </p>
        )}
      </form>
    </AdminModal>
  );
}
