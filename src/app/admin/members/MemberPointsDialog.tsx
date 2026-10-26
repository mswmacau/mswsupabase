"use client";

import { useState } from "react";
import { Diff, Loader2 } from "lucide-react";
import { ErrorBanner, Modal } from "./ui";
import { isOkEnvelope, parseError, type MemberRow } from "./types";

/**
 * 調整積分：PATCH /api/admin/members
 *   body { userId, points_delta:number, points_reason?:string }
 *   → { ok:true, data:{ member:{...含 points}, points:number } }
 *
 * 設計取捨：
 *  - 調整值可正可負但不可為 0，絕對值上限 10000（與後端驗證一致，前端先擋一次，
 *    避免使用者填完按送出才看到 400）
 *  - 調整後點數即時預覽；若低於 0，明確告知會被夾為 0，而不是靜默改數字
 *  - 錯誤一律留在對話框內（role="alert"），不關閉對話框，避免使用者重填
 */

const MAX_ABS = 10000;

function toPoints(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function validateDelta(raw: string): { value: number | null; message: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, message: null };

  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, message: "請輸入有效的數字。" };
  if (!Number.isInteger(n)) return { value: null, message: "調整值必須是整數。" };
  if (n === 0) return { value: null, message: "調整值不可為 0。" };
  if (Math.abs(n) > MAX_ABS) {
    return { value: null, message: `調整值的絕對值不可超過 ${MAX_ABS.toLocaleString()}。` };
  }
  return { value: n, message: null };
}

export function MemberPointsDialog({
  member,
  onClose,
  onUpdated,
}: {
  member: MemberRow;
  onClose: () => void;
  onUpdated: (member: MemberRow, points: number) => void;
}) {
  const currentPoints = toPoints(member.points);
  const displayName = member.display_name?.trim() || member.email || "（未具名會員）";

  const [deltaText, setDeltaText] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const parsed = validateDelta(deltaText);
  const delta = parsed.value;
  const rawNext = delta === null ? null : currentPoints + delta;
  const nextPoints = rawNext === null ? null : Math.max(0, rawNext);
  const willClamp = rawNext !== null && rawNext < 0;

  async function submit() {
    if (delta === null) {
      setError(parsed.message ?? "請先填寫調整值。");
      return;
    }

    setSaving(true);
    setError(null);
    setFields({});

    const payload: Record<string, unknown> = {
      userId: member.member_id,
      points_delta: delta,
    };
    const trimmedReason = reason.trim();
    if (trimmedReason) payload.points_reason = trimmedReason;

    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await res.json();

      if (!res.ok || !isOkEnvelope<{ member?: MemberRow; points?: number }>(body)) {
        const byField = parseError(body, "調整積分失敗。");
        setError(byField.error);
        setFields(byField.fields ?? {});
        return;
      }

      const data = body.data;
      const points = Number.isFinite(Number(data.points))
        ? Number(data.points)
        : (nextPoints ?? currentPoints);
      const updated: MemberRow = {
        ...member,
        ...(data.member ?? {}),
        points,
      };

      onUpdated(updated, points);
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="調整積分"
      description={`${displayName} · 目前 ${currentPoints.toLocaleString()} 點`}
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn-base btn-ghost"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || delta === null}
            className="btn-base btn-cobalt"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 調整中…
              </>
            ) : (
              <>
                <Diff size={16} /> 確認調整
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div>
          <label className="label" htmlFor="member-points-delta">
            調整值（可正可負）
          </label>
          <input
            id="member-points-delta"
            type="number"
            inputMode="numeric"
            step={1}
            className="field tabular-nums"
            value={deltaText}
            onChange={(event) => setDeltaText(event.target.value)}
            placeholder="例如：50 或 -30"
            data-autofocus
          />
          {fields.points_delta ? (
            <p className="mt-1 text-xs text-red-300">{fields.points_delta}</p>
          ) : parsed.message ? (
            <p className="mt-1 text-xs text-red-300">{parsed.message}</p>
          ) : (
            <p className="mt-1 text-xs text-white/50">
              不可為 0，絕對值上限 {MAX_ABS.toLocaleString()}。
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="member-points-reason">
            原因（選填）
          </label>
          <input
            id="member-points-reason"
            className="field"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：活動補錄 / 資料修正"
            maxLength={200}
          />
          {fields.points_reason ? (
            <p className="mt-1 text-xs text-red-300">{fields.points_reason}</p>
          ) : (
            <p className="mt-1 text-xs text-white/50">會寫入稽核紀錄，方便日後追查。</p>
          )}
        </div>

        {/* ===== 即時預覽 ===== */}
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-ink-line bg-white/5 px-4 py-3"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-white/55">調整後點數</span>
            <span className="text-xl font-bold tabular-nums" data-testid="points-preview">
              {nextPoints === null ? "—" : nextPoints.toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-xs text-white/45">
            {nextPoints === null
              ? `目前 ${currentPoints.toLocaleString()} 點，填入調整值後即時預覽。`
              : `${currentPoints.toLocaleString()} ${
                  (delta ?? 0) >= 0 ? "+" : "−"
                } ${Math.abs(delta ?? 0).toLocaleString()} = ${nextPoints.toLocaleString()}`}
          </p>
          {willClamp && (
            <p className="mt-1.5 text-xs text-amber-300">
              原始計算結果為負數，送出後會以 0 計。
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
