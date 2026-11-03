"use client";

import { useState } from "react";
import { Loader2, Printer, ShieldAlert } from "lucide-react";
import { AdminError, AdminModal, Field } from "@/components/admin/ui";
import { FetchError, postJson } from "@/lib/fetch-json";
import type { MerchantRow } from "./types";

/**
 * 產生／重設核銷 PIN。
 *
 * 安全規則（配合 DB）：
 *  - 明文 PIN 只在這次回應出現，DB 只存 bcrypt hash；關掉視窗後無法再查。
 *  - 必須勾「已抄下」才能關閉（dismissible=false，Esc／點遮罩都不會關）。
 *  - 提供「列印 PIN 卡」：window.print() + globals.css 的 @media print 只印 #pin-print-card。
 */
export function PinDialog({
  merchant,
  onClose,
  onIssued,
}: {
  merchant: MerchantRow;
  onClose: () => void;
  onIssued: (message: string) => void;
}) {
  const isReset = merchant.has_pin && !merchant.must_reset;
  const [days, setDays] = useState(String(merchant.pin_valid_days || 90));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const [pin, setPin] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setError(null);
    setFields({});
    const value = Number(days);
    if (!Number.isInteger(value) || value < 1 || value > 3650) {
      setFields({ valid_days: "有效天數需為 1–3650 的整數。" });
      return;
    }

    setPending(true);
    try {
      const data = await postJson<{ pin?: string; expires_at?: string | null; message?: string }>(
        "/api/admin/merchants",
        { action: "pin", id: merchant.id, valid_days: value }
      );
      if (!data.pin) {
        setError("伺服器沒有回傳 PIN，請再試一次。");
        return;
      }
      setPin(data.pin);
      setExpiresAt(data.expires_at ?? null);
      onIssued(data.message ?? (isReset ? "PIN 已重設。" : "PIN 已產生。"));
    } catch (err) {
      if (err instanceof FetchError) {
        setError(err.message);
        if (err.fields) setFields(err.fields);
      } else {
        setError("網路錯誤，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  /* ---------- 已產生 PIN：只顯示一次 ---------- */
  if (pin) {
    return (
      <AdminModal
        title={isReset ? "新 PIN 已產生（只顯示一次）" : "PIN 已產生（只顯示一次）"}
        description="關閉後不會再顯示。請即場抄下或列印，並親手交給店員。"
        dismissible={false}
        width="max-w-xl"
        onClose={() => undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-base btn-ghost px-4 py-2 text-sm"
            >
              <Printer size={16} /> 列印 PIN 卡
            </button>
            <button
              type="button"
              disabled={!copied}
              onClick={onClose}
              className="btn-base btn-cobalt px-4 py-2 text-sm"
              title={copied ? undefined : "請先勾選「已抄下」"}
            >
              完成，關閉視窗
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div
            id="pin-print-card"
            className="rounded-xl border border-white/15 bg-white p-6 text-black"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              MSW 街健館 · 商戶核銷 PIN
            </p>
            <p className="mt-2 text-xl font-black">{merchant.name}</p>
            <p className="pin-card-code mt-5 text-center font-mono text-5xl font-black tracking-[0.35em] text-black">
              {pin}
            </p>
            <p className="mt-6 text-xs leading-relaxed text-neutral-600">
              此 PIN 只供店員在核銷頁輸入，請勿貼在公開位置或轉發。
              {expiresAt ? `有效至 ${formatMacauDate(expiresAt)}。` : ""}
              如懷疑外洩，請立即在後台重設。
            </p>
          </div>

          <label className="flex items-start gap-2.5 text-sm text-white/85">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={copied}
              onChange={(event) => setCopied(event.target.checked)}
            />
            <span>我已抄下或列印這個 PIN（關閉後無法再次查看）</span>
          </label>

          {expiresAt && (
            <p className="text-xs text-white/55">
              有效期至 {formatMacauDate(expiresAt)}（{days} 天）。
            </p>
          )}
        </div>
      </AdminModal>
    );
  }

  /* ---------- 未產生：先問有效天數 ---------- */
  return (
    <AdminModal
      title={isReset ? `重設「${merchant.name}」的 PIN` : `為「${merchant.name}」產生 PIN`}
      description={
        isReset
          ? "重設後舊 PIN 即時失效，店員需改用新 PIN 核銷。"
          : "此商戶尚未有可用 PIN，未產生前店員無法核銷。"
      }
      dismissible={!pending}
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className="btn-base btn-ghost">
            取消
          </button>
          <button
            type="button"
            onClick={() => void issue()}
            disabled={pending}
            className={isReset ? "btn-base btn-vital" : "btn-base btn-cobalt"}
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 產生中…
              </>
            ) : isReset ? (
              "確認重設 PIN"
            ) : (
              "產生 PIN"
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <AdminError message={error} onDismiss={() => setError(null)} />}

        {isReset && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span>
              重設會令現有 PIN 立即作廢（包括已發給店員的卡片）。店員下次核銷要用新 PIN。
            </span>
          </div>
        )}

        <Field
          label="有效天數"
          htmlFor="pin-days"
          hint="預設 90 天；到期後店員核銷會被拒絕，需要重新產生。"
          error={fields.valid_days}
        >
          <input
            id="pin-days"
            className="field"
            inputMode="numeric"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            data-autofocus
          />
        </Field>
      </div>
    </AdminModal>
  );
}

/** 澳門時間日期（YYYY-MM-DD），避免伺服器／瀏覽器時區差異 */
function formatMacauDate(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = new Date(t + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
