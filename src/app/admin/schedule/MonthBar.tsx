"use client";

/**
 * src/app/admin/schedule/MonthBar.tsx — 月份切換 + 發布狀態 + 發布／複製
 *
 * 狀態徽章三態（客戶語義，見 migration-training-months.sql）：
 *   · 草稿（前台看不到）
 *   · 已排定（12/01 生效）  —— status='published' 但還沒到 publish_at，前台仍看不到
 *   · 已發布（生效中）
 *
 * `nowMs` 由父層在 mount 後才給（null = 尚未得知）。
 * 若在這裡直接算 Date.now()，SSR 與 hydration 的文字可能不一致（React #418），
 * 所以「已排定」的判定延到 client mount 之後。
 */

import { ChevronLeft, ChevronRight, Copy, Loader2, Undo2, Upload } from "lucide-react";
import type { TrainingMonthInfo } from "./api";
import { macauMonthDay } from "./format";

type PendingAction = "publish" | "unpublish" | "copy" | null;

const PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

const PILL_PRIMARY = `${PILL_BASE} bg-vital text-white hover:bg-vital-bright`;
const PILL_GHOST = `${PILL_BASE} border border-white/20 text-white/80 hover:border-white/45 hover:text-white`;

function badgeOf(info: TrainingMonthInfo | undefined, nowMs: number | null) {
  if (!info || info.status !== "published") {
    return {
      text: "草稿（前台看不到）",
      className: "border-white/20 bg-white/5 text-white/65",
      hint: "前台看不到本月班表。",
    };
  }

  const effectiveMs = Date.parse(info.effective_at);
  const scheduled =
    nowMs !== null && Number.isFinite(effectiveMs) && effectiveMs > nowMs;

  if (scheduled) {
    return {
      text: `已排定（${macauMonthDay(info.effective_at)} 生效）`,
      className: "border-amber-500/45 bg-amber-500/15 text-amber-200",
      hint: "時間到會自動上架，前台目前還看不到。",
    };
  }

  return {
    text: "已發布（生效中）",
    className: "border-emerald-500/45 bg-emerald-500/15 text-emerald-200",
    hint: `已於 ${macauMonthDay(info.effective_at)} 生效，前台看得到本月班表。`,
  };
}

export function MonthBar({
  year,
  month,
  info,
  nowMs,
  pending,
  disabled,
  onPrev,
  onNext,
  onPublish,
  onUnpublish,
  onCopy,
}: {
  year: number;
  month: number;
  info: TrainingMonthInfo | undefined;
  nowMs: number | null;
  pending: PendingAction;
  disabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onCopy: () => void;
}) {
  const badge = badgeOf(info, nowMs);
  const published = info?.status === "published";
  const busy = pending !== null;

  return (
    <div className="rounded-xl border border-ink-line bg-ink-soft/70 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 月份切換 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={disabled || busy}
            aria-label="上一個月"
            className="shrink-0 rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={18} />
          </button>
          <div
            className="min-w-[8.5rem] text-center text-base font-bold sm:text-lg"
            aria-live="polite"
          >
            {year} 年 {month} 月
          </div>
          <button
            type="button"
            onClick={onNext}
            disabled={disabled || busy}
            aria-label="下一個月"
            className="shrink-0 rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* 狀態 + 動作 */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${badge.className}`}
          >
            {badge.text}
          </span>

          {published ? (
            <button
              type="button"
              onClick={onUnpublish}
              disabled={disabled || busy}
              className={PILL_GHOST}
            >
              {pending === "unpublish" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Undo2 size={14} />
              )}
              取消發布
            </button>
          ) : (
            <button
              type="button"
              onClick={onPublish}
              disabled={disabled || busy}
              className={PILL_PRIMARY}
            >
              {pending === "publish" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              發布本月
            </button>
          )}

          <button
            type="button"
            onClick={onCopy}
            disabled={disabled || busy}
            className={PILL_GHOST}
          >
            {pending === "copy" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Copy size={14} />
            )}
            複製上月
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-white/55">{badge.hint}</p>
    </div>
  );
}
