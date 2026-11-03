"use client";

/**
 * src/components/admin/ui.tsx — 後台四支新頁面共用的對話框／提示／欄位外殼
 *
 * 只做「外框與樣式」，不含任何業務邏輯；行為對齊 src/app/admin/members/ui.tsx
 * （同一套 useOverlay：Esc 關閉、Tab 鎖在面板內、關閉後還原焦點）。
 * 集中在 components 底下，避免新頁面互相 import 對方 app 目錄的檔案。
 */

import { useId, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useOverlay } from "@/app/admin/members/useOverlay";

export function AdminModal({
  title,
  description,
  onClose,
  children,
  footer,
  width = "max-w-lg",
  dismissible = true,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** false = 只能按 footer 的按鈕關閉（例如 PIN 明文視窗） */
  dismissible?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useOverlay(true, panelRef, () => {
    if (dismissible) onClose();
  });

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-ink/80 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (!dismissible) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-t-2xl border border-ink-line bg-ink-soft p-5 sm:rounded-xl sm:p-6`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-bold">
              {title}
            </h3>
            {description && (
              <p id={descId} className="mt-1 text-xs leading-relaxed text-white/65">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="關閉對話框"
              className="shrink-0 rounded-lg p-1.5 text-white/50 transition hover:text-white"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="mt-4">{children}</div>

        {footer && (
          <div className="sticky bottom-0 z-10 -mx-5 mt-5 flex flex-wrap justify-end gap-2 border-t border-ink-line bg-ink-soft px-5 py-3 sm:-mx-6 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
    >
      <AlertCircle size={17} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="關閉錯誤訊息"
          className="-mr-1 shrink-0 rounded p-1 text-red-200/70 transition hover:text-red-100"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function AdminNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
    >
      <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="關閉提示訊息"
          className="-mr-1 shrink-0 rounded p-1 text-emerald-200/70 transition hover:text-emerald-100"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/** 表單欄位：標籤 + 說明 + 錯誤訊息 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const hintId = useId();
  const errId = useId();

  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="mt-1 text-xs leading-relaxed text-white/55">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/** 二次確認對話框：危險操作一律走這一個 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = "danger",
  requireCheck,
  pending = false,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "warn";
  /** 有值時要多勾一個「我已了解」才能確認 */
  requireCheck?: string;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState(false);

  return (
    <AdminModal
      title={title}
      onClose={() => {
        if (!pending) onCancel();
      }}
      dismissible={!pending}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="btn-base btn-ghost"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || (requireCheck ? !checked : false)}
            className={
              tone === "warn"
                ? "btn-base border border-amber-500/50 text-amber-200 hover:bg-amber-500/15"
                : "btn-base btn-vital"
            }
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 處理中…
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <AdminError message={error} />}
        <div className="text-sm leading-relaxed text-white/80">{description}</div>
        {requireCheck && (
          <label className="flex items-start gap-2.5 text-sm text-white/80">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>{requireCheck}</span>
          </label>
        )}
      </div>
    </AdminModal>
  );
}
