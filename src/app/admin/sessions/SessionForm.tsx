"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarPlus, CheckCircle2, Loader2 } from "lucide-react";
import { RULES } from "@/lib/config";

/** 下一個星期一，yyyy-mm-dd */
function nextMonday(): string {
  const d = new Date();
  const diff = (RULES.TRAINING_WEEKDAY - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function SessionForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // 各欄位獨立 ref（勿放進物件字面量：render 期間讀取 refs.X 會違反 React 規則）
  const sessionDateRef = useRef<HTMLInputElement>(null);
  const capacityRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const payload = {
      session_date: sessionDateRef.current?.value ?? "",
      capacity: Number(capacityRef.current?.value ?? 30),
      start_time: startTimeRef.current?.value ?? "20:00",
      end_time: endTimeRef.current?.value ?? "21:00",
      title: titleRef.current?.value ?? "",
      location: locationRef.current?.value ?? "",
      note: noteRef.current?.value ?? "",
    };
    if (!payload.session_date) {
      setError("請選擇日期。");
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!data.ok) {
        setError(data.error ?? "建立失敗。");
        return;
      }
      setSuccess(data.message ?? "場次已建立。");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="session_date">
            日期（建議選星期一）
          </label>
          <input
            id="session_date"
            ref={sessionDateRef}
            type="date"
            defaultValue={nextMonday()}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="capacity">
            名額
          </label>
          <input
            id="capacity"
            ref={capacityRef}
            type="number"
            defaultValue={30}
            min={1}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="start_time">
            開始時間
          </label>
          <input
            id="start_time"
            ref={startTimeRef}
            type="time"
            defaultValue="20:00"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="end_time">
            結束時間
          </label>
          <input
            id="end_time"
            ref={endTimeRef}
            type="time"
            defaultValue="21:00"
            className="field"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title">
            場次名稱
          </label>
          <input
            id="title"
            ref={titleRef}
            defaultValue="MSW 定期訓練"
            className="field"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="location">
            地點
          </label>
          <input
            id="location"
            ref={locationRef}
            defaultValue="澳門街健館"
            className="field"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="note">
            備註（選填）
          </label>
          <input
            id="note"
            ref={noteRef}
            placeholder="訓練重點、攜帶物品等"
            className="field"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="btn-base btn-cobalt"
      >
        {pending ? (
          <>
            <Loader2 size={17} className="animate-spin" /> 建立中…
          </>
        ) : (
          <>
            <CalendarPlus size={17} /> 建立場次
          </>
        )}
      </button>
    </div>
  );
}
