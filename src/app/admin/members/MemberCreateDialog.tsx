"use client";

import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Modal, ErrorBanner } from "./ui";
import { isOkEnvelope, parseError, type MemberRole } from "./types";

/**
 * 新增會員：POST /api/admin/members
 *  - 201 { ok:true, data:{ id } }
 *  - 501 code='SERVICE_ROLE_REQUIRED'：代表專案沒有設定 service role 金鑰，
 *    無法用 admin API 建帳號。此時通知外層把「新增會員」永久禁用，並在對話框內說明原因。
 */
export function MemberCreateDialog({
  onClose,
  onCreated,
  onServiceRoleRequired,
}: {
  onClose: () => void;
  onCreated: (displayName: string) => void;
  onServiceRoleRequired: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    const nextFields: Record<string, string> = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) nextFields.email = "請填寫電郵。";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
      nextFields.email = "電郵格式不正確。";
    if (password.length < 8) nextFields.password = "密碼至少 8 個字元。";

    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      setError("請先修正以下欄位。");
      return;
    }

    setSaving(true);
    setError(null);
    setFields({});

    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          display_name: displayName.trim() || undefined,
          role,
        }),
      });
      const body: unknown = await res.json();

      if (res.status === 501) {
        const parsed = parseError(body, "未設定服務金鑰，無法新增帳號。");
        if (parsed.code === "SERVICE_ROLE_REQUIRED") {
          onServiceRoleRequired();
          setError("未設定服務金鑰，無法新增帳號。");
          return;
        }
      }

      if (!res.ok || !isOkEnvelope<{ id?: string }>(body)) {
        const parsed = parseError(body, "新增會員失敗。");
        setError(parsed.error);
        setFields(parsed.fields ?? {});
        return;
      }

      onCreated(displayName.trim() || trimmedEmail);
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="新增會員"
      description="填入電郵與初始密碼即可建立會員帳號。"
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
                <Loader2 size={16} className="animate-spin" /> 建立中…
              </>
            ) : (
              <>
                <UserPlus size={16} /> 建立帳號
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div>
          <label className="label" htmlFor="member-create-email">
            電郵 *
          </label>
          <input
            id="member-create-email"
            type="email"
            className="field"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="member@example.com"
            autoComplete="off"
            data-autofocus
          />
          {fields.email && <p className="mt-1 text-xs text-red-300">{fields.email}</p>}
        </div>

        <div>
          <label className="label" htmlFor="member-create-password">
            初始密碼 *
          </label>
          <input
            id="member-create-password"
            type="password"
            className="field"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 個字元"
            autoComplete="new-password"
          />
          {fields.password ? (
            <p className="mt-1 text-xs text-red-300">{fields.password}</p>
          ) : (
            <p className="mt-1 text-xs text-white/50">至少 8 個字元。</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="member-create-name">
            顯示名稱
          </label>
          <input
            id="member-create-name"
            className="field"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="選填"
          />
          {fields.display_name && (
            <p className="mt-1 text-xs text-red-300">{fields.display_name}</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="member-create-role">
            角色
          </label>
          <select
            id="member-create-role"
            className="field"
            value={role}
            onChange={(event) => setRole(event.target.value as MemberRole)}
          >
            <option value="member">會員</option>
            <option value="admin">管理員</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}
