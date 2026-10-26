"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Modal, ErrorBanner } from "./ui";
import { isOkEnvelope, parseError, type MemberRow } from "./types";

/**
 * 刪除會員：DELETE /api/admin/members?userId=xxx
 *  - 沒有 service role 金鑰時後端改為軟刪除（= 停用），回 { data:{ soft_deleted:true } }
 *  - 二次確認：必須勾選確認，並要求輸入會員名稱後才能按「確認刪除」
 */
export function MemberDeleteDialog({
  member,
  onClose,
  onDeleted,
}: {
  member: MemberRow;
  onClose: () => void;
  onDeleted: (member: MemberRow, softDeleted: boolean) => void;
}) {
  const label = member.display_name?.trim() || member.email || "（未具名會員）";
  const [typed, setTyped] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameMatches = typed.trim() === label;
  const canDelete = confirmed && nameMatches && !pending;

  async function submit() {
    if (!canDelete) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/members?userId=${encodeURIComponent(member.member_id)}`,
        { method: "DELETE" }
      );
      const body: unknown = await res.json();

      if (!res.ok || !isOkEnvelope<{ soft_deleted?: boolean }>(body)) {
        setError(parseError(body, "刪除會員失敗。").error);
        return;
      }

      onDeleted(member, body.data.soft_deleted === true);
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title="刪除會員"
      description={`即將刪除「${label}」，此動作無法在介面上復原。`}
      onClose={() => {
        if (!pending) onClose();
      }}
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
            type="button"
            onClick={() => void submit()}
            disabled={!canDelete}
            className="btn-base btn-vital"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 處理中…
              </>
            ) : (
              <>
                <Trash2 size={16} /> 確認刪除
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
          若專案未設定服務金鑰，系統只會把此帳號「停用」（軟刪除），資料仍保留；之後可在列表中重新啟用。
        </div>

        <div>
          <label className="label" htmlFor="member-delete-confirm-name">
            請輸入會員名稱「{label}」以確認
          </label>
          <input
            id="member-delete-confirm-name"
            className="field"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={label}
            data-autofocus
          />
        </div>

        <label className="flex items-start gap-2.5 text-sm text-white/80">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>我了解刪除後此會員將無法登入，且相關紀錄不會一併移除。</span>
        </label>
      </div>
    </Modal>
  );
}
