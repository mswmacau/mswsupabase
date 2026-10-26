"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Modal, ErrorBanner } from "./ui";
import {
  isOkEnvelope,
  parseError,
  type MemberRole,
  type MemberRow,
  type MemberStatus,
} from "./types";

/**
 * 編輯會員：display_name / phone / role / status / status_reason
 * 只有狀態選 suspended 或 disabled 時才顯示「原因」欄，避免正常帳號夾帶無意義原因。
 * 存檔走 PATCH /api/admin/members（body: { userId, ...變更欄位 }）。
 */
export function MemberEditDialog({
  member,
  onClose,
  onSaved,
}: {
  member: MemberRow & { phone?: string | null };
  onClose: () => void;
  onSaved: (member: MemberRow) => void;
}) {
  const [name, setName] = useState(member.display_name ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [role, setRole] = useState<MemberRole>(member.role);
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [reason, setReason] = useState(member.status_reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const needsReason = status !== "active";

  async function submit() {
    setSaving(true);
    setError(null);
    setFields({});

    const payload: Record<string, unknown> = {
      userId: member.member_id,
      display_name: name.trim(),
      role,
      status,
    };
    const trimmedPhone = phone.trim();
    if (trimmedPhone && trimmedPhone !== (member.phone ?? "")) payload.phone = trimmedPhone;
    if (needsReason) payload.status_reason = reason.trim();

    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await res.json();

      if (!res.ok || !isOkEnvelope<{ member?: MemberRow }>(body)) {
        const parsed = parseError(body, "儲存會員資料失敗。");
        setError(parsed.error);
        setFields(parsed.fields ?? {});
        return;
      }

      const updated: MemberRow = body.data.member ?? {
        ...member,
        display_name: name.trim() || null,
        role,
        status,
        status_reason: needsReason ? reason.trim() || null : null,
      };
      onSaved(updated);
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="編輯會員"
      description={`${member.display_name?.trim() || member.email || "（未具名會員）"} · ${member.email ?? "無電郵"}`}
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
            disabled={saving}
            className="btn-base btn-cobalt"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 儲存中…
              </>
            ) : (
              <>
                <Save size={16} /> 儲存變更
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div>
          <label className="label" htmlFor="member-edit-name">
            顯示名稱
          </label>
          <input
            id="member-edit-name"
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例：陳大文"
            data-autofocus
          />
          {fields.display_name && (
            <p className="mt-1 text-xs text-red-300">{fields.display_name}</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="member-edit-phone">
            電話
          </label>
          <input
            id="member-edit-phone"
            className="field"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={member.phone ? "" : "未設定（留空表示不變更）"}
            inputMode="tel"
          />
          {fields.phone && <p className="mt-1 text-xs text-red-300">{fields.phone}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="member-edit-role">
              角色
            </label>
            <select
              id="member-edit-role"
              className="field"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
            >
              <option value="member">會員</option>
              <option value="admin">管理員</option>
            </select>
            {fields.role && <p className="mt-1 text-xs text-red-300">{fields.role}</p>}
          </div>

          <div>
            <label className="label" htmlFor="member-edit-status">
              狀態
            </label>
            <select
              id="member-edit-status"
              className="field"
              value={status}
              onChange={(event) => setStatus(event.target.value as MemberStatus)}
            >
              <option value="active">正常</option>
              <option value="suspended">停權</option>
              <option value="disabled">停用</option>
            </select>
            {fields.status && <p className="mt-1 text-xs text-red-300">{fields.status}</p>}
          </div>
        </div>

        {needsReason && (
          <div>
            <label className="label" htmlFor="member-edit-reason">
              狀態原因
            </label>
            <textarea
              id="member-edit-reason"
              className="field min-h-[84px]"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例：多次提交重複紀錄"
              maxLength={200}
            />
            <p className="mt-1 text-xs text-white/50">
              會顯示在詳情抽屜，供其他管理員理解停權依據。
            </p>
            {fields.status_reason && (
              <p className="mt-1 text-xs text-red-300">{fields.status_reason}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
