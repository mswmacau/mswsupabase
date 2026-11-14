"use client";

import { useState } from "react";
import { Loader2, Ruler } from "lucide-react";
import { formatKm } from "@/lib/utils";
import { ErrorBanner, Modal } from "./ui";
import { isOkEnvelope, parseError, type MemberRow } from "./types";

/**
 * 更正總里程：PATCH /api/admin/members
 *   body { userId, total_km:number, km_reason:string }
 *   → { ok:true, data:{ member:{...含 total_km}, total_km:number }, message }
 *
 * 為什麼需要這個對話框（P1-1）：
 * 核准跑步提交會**立即**把里程加到會員身上（total_km += km）並加分，
 * 誤按「通過」之後全站沒有任何介面能改回去 —— 會員自己改會被
 * guard_profile_sensitive_fields 還原、admin_update_member 也沒有這個參數。
 * 一次誤按就是排行榜與 300km 達標基準的永久錯誤，所以補這個管理員專用入口。
 *
 * 設計取捨：
 *  - 直接填「新值」而不是填「差值」：誤按情境下管理員知道正確的總里程，
 *    要求他自己算差值等於多做一次心算，也就多一次算錯的機會。
 *  - 只改里程、不碰積分（DB 函式刻意不含 points）。要調積分請用「調整積分」，
 *    那裡會寫 ledger；這裡若順便改點數，餘額與流水會對不上。
 *  - 原因必填且至少 4 個字：這筆改動會寫進 admin_audit_log，
 *    半年後回頭看「為什麼這個人從 42 km 變成 0」要有答案。
 *  - 前端先驗一次（範圍／一位小數／原因長度），避免填完才看到 400；
 *    後端仍是唯一權威，訊息以 body.fields 為準就地顯示。
 */

const MAX_KM = 10000;
const MIN_REASON = 4;
const MAX_REASON = 200;

function toKm(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 一位小數以內、0–10000 */
function validateKm(raw: string): { value: number | null; message: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, message: null };

  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, message: "請輸入有效的數字。" };
  if (n < 0) return { value: null, message: "總里程不可為負數。" };
  if (n > MAX_KM) {
    return { value: null, message: `總里程不可超過 ${MAX_KM.toLocaleString()} 公里。` };
  }
  if (Math.abs(Math.round(n * 10) / 10 - n) > 1e-9) {
    return { value: null, message: "最多一位小數（例如 12.5）。" };
  }
  return { value: Math.round(n * 10) / 10, message: null };
}

export function MemberKmDialog({
  member,
  onClose,
  onUpdated,
}: {
  member: MemberRow;
  onClose: () => void;
  onUpdated: (member: MemberRow, totalKm: number) => void;
}) {
  const currentKm = toKm(member.total_km);
  const displayName = member.display_name?.trim() || member.email || "（未具名會員）";

  const [kmText, setKmText] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const parsed = validateKm(kmText);
  const nextKm = parsed.value;
  const reasonTrimmed = reason.trim();
  const reasonTooShort = reasonTrimmed.length > 0 && reasonTrimmed.length < MIN_REASON;
  const canSubmit = nextKm !== null && reasonTrimmed.length >= MIN_REASON && !saving;

  async function submit() {
    if (nextKm === null) {
      setError(parsed.message ?? "請先填寫新的總里程。");
      return;
    }
    if (reasonTrimmed.length < MIN_REASON) {
      setError(`請填寫更正原因（至少 ${MIN_REASON} 個字）。`);
      return;
    }

    setSaving(true);
    setError(null);
    setFields({});

    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member.member_id,
          total_km: nextKm,
          km_reason: reasonTrimmed,
        }),
      });
      const body: unknown = await res.json();

      if (
        !res.ok ||
        !isOkEnvelope<{ member?: MemberRow | null; total_km?: number | null }>(body)
      ) {
        const byField = parseError(body, "更正總里程失敗。");
        setError(byField.error);
        setFields(byField.fields ?? {});
        return;
      }

      const data = body.data;
      const savedKm = Number.isFinite(Number(data.total_km))
        ? Number(data.total_km)
        : nextKm;
      const updated: MemberRow = {
        ...member,
        ...(data.member ?? {}),
        total_km: savedKm,
      };

      onUpdated(updated, savedKm);
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      testId="km-dialog"
      title="更正總里程"
      description={`${displayName} · 目前 ${formatKm(currentKm)} km`}
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn-base btn-ghost min-h-11 md:min-h-0"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            data-testid="km-submit"
            className="btn-base btn-cobalt min-h-11 md:min-h-0"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 儲存中…
              </>
            ) : (
              <>
                <Ruler size={16} /> 確認更正
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div>
          <label className="label" htmlFor="member-km-value">
            新的總里程（公里）
          </label>
          <input
            id="member-km-value"
            type="number"
            inputMode="decimal"
            step={0.1}
            min={0}
            max={MAX_KM}
            className="field tabular-nums"
            value={kmText}
            onChange={(event) => setKmText(event.target.value)}
            placeholder={`例如：0（目前 ${formatKm(currentKm)}）`}
            aria-describedby="member-km-value-help"
            data-autofocus
            data-testid="km-input"
          />
          {fields.total_km ? (
            <p className="mt-1 text-xs text-red-300">{fields.total_km}</p>
          ) : parsed.message ? (
            <p className="mt-1 text-xs text-red-300">{parsed.message}</p>
          ) : (
            <p id="member-km-value-help" className="mt-1 text-xs text-white/50">
              0 到 {MAX_KM.toLocaleString()}，最多一位小數。這是「改成多少」，不是加減多少。
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="member-km-reason">
            更正原因（必填）
          </label>
          <textarea
            id="member-km-reason"
            className="field min-h-[4.5rem] resize-y"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：誤按核准，會員實際未跑該筆里程"
            maxLength={MAX_REASON}
            aria-describedby="member-km-reason-help"
            data-testid="km-reason"
          />
          {fields.km_reason ? (
            <p className="mt-1 text-xs text-red-300">{fields.km_reason}</p>
          ) : reasonTooShort ? (
            <p className="mt-1 text-xs text-red-300">
              至少 {MIN_REASON} 個字（目前 {reasonTrimmed.length} 個）。
            </p>
          ) : (
            <p id="member-km-reason-help" className="mt-1 text-xs text-white/50">
              會寫入稽核紀錄（模組 members、動作 correct-km），方便日後追查。
            </p>
          )}
        </div>

        {/* ===== 即時預覽：講清楚「原 → 新」，避免管理員誤以為是加減 ===== */}
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-ink-line bg-white/5 px-4 py-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-white/55">更正後總里程</span>
            <span
              className="text-xl font-bold tabular-nums"
              data-testid="km-preview"
            >
              {nextKm === null ? "—" : `${formatKm(nextKm)} km`}
            </span>
          </div>
          <p className="mt-1 text-xs text-white/45">
            {nextKm === null
              ? `目前 ${formatKm(currentKm)} km，填入新值後即時預覽。`
              : `原 ${formatKm(currentKm)} km → 新 ${formatKm(nextKm)} km${
                  nextKm === currentKm ? "（與目前相同，送出不會有變化）" : ""
                }`}
          </p>
          <p className="mt-1.5 text-xs text-amber-300/90">
            只改總里程，不會動到積分。積分請用「調整積分」單獨處理。
          </p>
        </div>
      </div>
    </Modal>
  );
}
