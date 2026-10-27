"use client";

import { useId, useRef, type ReactNode } from "react";
import { AlertCircle, X } from "lucide-react";
import type { MemberRole, MemberStatus } from "./types";
import { useOverlay } from "./useOverlay";

/** 徽章、錯誤列、對話框外殼：會員管理三個對話框共用，避免樣式漂移 */

export const ROLE_LABEL: Record<MemberRole, string> = {
  member: "會員",
  admin: "管理員",
};

export const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "正常",
  suspended: "停權",
  disabled: "停用",
};

const ROLE_STYLE: Record<MemberRole, string> = {
  admin: "border-cobalt-bright/50 bg-cobalt/30 text-white",
  member: "border-white/15 bg-white/5 text-white/75",
};

const STATUS_STYLE: Record<MemberStatus, string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  suspended: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  disabled: "border-rose-500/30 bg-rose-950/40 text-rose-300",
};

export function RoleBadge({ role }: { role: MemberRole }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ROLE_STYLE[role]}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

export function StatusBadge({ status }: { status: MemberStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
  className = "",
}: {
  message: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 ${className}`}
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

/**
 * 對話框外殼：置中、可遮罩點擊關閉、Esc 關閉、focus 留在面板內。
 * 內容一律由呼叫端傳入，這裡只負責外框與無障礙語意。
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  width = "max-w-lg",
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useOverlay(true, panelRef, onClose);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-ink/80 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
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
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉對話框"
            className="shrink-0 rounded-lg p-1 text-white/50 transition hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4">{children}</div>

        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
