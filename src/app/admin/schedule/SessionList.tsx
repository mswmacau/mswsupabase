"use client";

/**
 * src/app/admin/schedule/SessionList.tsx — 按日期分組的場次列表
 *
 * 視覺對齊客戶手上的 11 月日曆表：每組一個 `11/02（週一）` 標頭，
 * 每場一列 時段 ｜ 課名（左側 4px 色條）｜ 教練 ｜ 場地 ｜ 名額 ｜ 狀態 ｜ 動作。
 * 390 寬（手機）時動作區塊自動換到第二行，不橫向滾動。
 *
 * 三個狀態都在這裡處理：loading（含 >3 秒的文案）、error（可重試）、empty。
 */

import { useMemo } from "react";
import { AlertCircle, CalendarPlus, Pencil, RotateCw, Trash2 } from "lucide-react";
import type { ScheduleSession, SessionStatus } from "./api";
import { colorBarClass, dateGroupLabel, timeRange } from "./format";

const STATUS_META: Record<SessionStatus, { label: string; className: string }> = {
  open: {
    label: "正常",
    className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  },
  closed: {
    label: "已截止",
    className: "border-white/25 bg-white/10 text-white/70",
  },
  cancelled: {
    label: "已取消",
    className: "border-red-500/40 bg-red-500/15 text-red-200",
  },
};

/** 依 session_date 分組，維持 API 回來的日期／時間升冪順序 */
function groupByDate(sessions: ScheduleSession[]) {
  const groups: { date: string; items: ScheduleSession[] }[] = [];
  for (const session of sessions) {
    const last = groups[groups.length - 1];
    if (last && last.date === session.session_date) last.items.push(session);
    else groups.push({ date: session.session_date, items: [session] });
  }
  return groups;
}

function SessionRow({
  session,
  onEdit,
  onDelete,
}: {
  session: ScheduleSession;
  onEdit: (session: ScheduleSession) => void;
  onDelete: (session: ScheduleSession) => void;
}) {
  const cancelled = session.status === "cancelled";
  const status = STATUS_META[session.status] ?? STATUS_META.open;
  const name = session.class_name ?? session.title ?? "未命名場次";
  const coach = session.coach_name?.trim() || "—";
  // 管理員在這一場特別指定過場地就用它，否則沿用場次預設場地
  const location =
    ((session.location_override ?? session.location) ?? "").trim() || "—";

  return (
    <li className="px-3.5 py-3 sm:px-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          className={`w-[86px] shrink-0 font-mono text-sm font-semibold tabular-nums ${
            cancelled ? "text-white/45 line-through" : "text-white/85"
          }`}
        >
          {timeRange(session.start_time, session.end_time)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-6 w-1 shrink-0 rounded-full ${colorBarClass(
                session.class_color_key
              )}`}
              aria-hidden="true"
            />
            <span
              className={`min-w-0 truncate font-semibold ${
                cancelled ? "text-white/45 line-through" : "text-white"
              }`}
              title={name}
            >
              {name}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}
            >
              {status.label}
            </span>
          </div>

          <p
            className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${
              cancelled ? "text-white/35" : "text-white/60"
            }`}
          >
            <span className="break-words">教練 {coach}</span>
            <span className="break-words">場地 {location}</span>
            <span>名額 {session.capacity}</span>
          </p>

          {session.note && (
            <p
              className={`mt-1 break-words text-xs leading-relaxed ${
                cancelled ? "text-white/30" : "text-white/50"
              }`}
            >
              {session.note}
            </p>
          )}
        </div>

        {/* 手機：兩顆並排的 44px 觸控目標；≥768px 還原原本的 28px 小按鈕 */}
        <div className="ml-auto flex shrink-0 basis-full items-center justify-end gap-2 sm:basis-auto sm:justify-start md:gap-1">
          <button
            type="button"
            onClick={() => onEdit(session)}
            aria-label={`編輯 ${dateGroupLabel(session.session_date)} ${timeRange(
              session.start_time,
              session.end_time
            )} 的 ${name}`}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white md:min-h-0 md:px-2.5 md:py-1.5 md:text-xs"
          >
            <Pencil size={13} />
            編輯
          </button>
          <button
            type="button"
            onClick={() => onDelete(session)}
            aria-label={`刪除 ${dateGroupLabel(session.session_date)} ${timeRange(
              session.start_time,
              session.end_time
            )} 的 ${name}`}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-red-300/80 transition hover:bg-red-500/15 hover:text-red-200 md:min-h-0 md:px-2.5 md:py-1.5 md:text-xs"
          >
            <Trash2 size={13} />
            刪除
          </button>
        </div>
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((group) => (
        <div key={group} className="overflow-hidden rounded-xl border border-ink-line">
          <div className="h-9 border-b border-ink-line bg-white/[0.03]" />
          <div className="divide-y divide-ink-line">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-3 px-4 py-3.5">
                <div className="h-4 w-[70px] animate-pulse rounded bg-white/10" />
                <div className="h-4 flex-1 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-16 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SessionList({
  sessions,
  loading,
  slow,
  error,
  onRetry,
  onCreate,
  onEdit,
  onDelete,
}: {
  sessions: ScheduleSession[] | null;
  loading: boolean;
  slow: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onEdit: (session: ScheduleSession) => void;
  onDelete: (session: ScheduleSession) => void;
}) {
  const groups = useMemo(() => groupByDate(sessions ?? []), [sessions]);
  const cancelledCount = useMemo(
    () => (sessions ?? []).filter((s) => s.status === "cancelled").length,
    [sessions]
  );

  /* ---- 錯誤：可重試 ---- */
  if (error && !sessions) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-10 text-center"
      >
        <AlertCircle size={24} className="mx-auto text-red-300" />
        <p className="mx-auto mt-3 max-w-md break-words text-sm leading-relaxed text-red-100">
          {error}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/25 px-4 py-1.5 text-xs font-semibold text-white/85 transition hover:border-white/50 hover:text-white"
        >
          <RotateCw size={13} />
          重試
        </button>
      </div>
    );
  }

  /* ---- 載入中 ---- */
  if (loading && !sessions) {
    return (
      <div>
        <SkeletonRows />
        <p className="mt-3 text-xs text-white/55" aria-live="polite">
          {slow ? "載入較慢，仍在處理…" : "正在載入本月場次…"}
        </p>
      </div>
    );
  }

  /* ---- 空月份 ---- */
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 px-4 py-12 text-center">
        <CalendarPlus size={26} className="mx-auto text-white/50" />
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/70">
          本月還沒有場次。可以用「複製上月」快速建立，或逐場手動新增。
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-vital px-4 py-2 text-sm font-semibold text-white transition hover:bg-vital-bright"
        >
          <CalendarPlus size={15} />
          新增一場
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section
          key={group.date}
          className="overflow-hidden rounded-xl border border-ink-line"
          aria-label={dateGroupLabel(group.date)}
        >
          <h3 className="flex items-center justify-between gap-2 border-b border-ink-line bg-white/[0.03] px-4 py-2.5 text-xs font-bold tracking-[0.06em] text-white/75">
            <span>{dateGroupLabel(group.date)}</span>
            <span className="font-normal text-white/45">{group.items.length} 場</span>
          </h3>
          <ul className="divide-y divide-ink-line">
            {group.items.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}

      {cancelledCount > 0 && (
        <p className="text-xs text-white/45">
          其中 {cancelledCount} 場已取消（保留紀錄，前台不顯示）。
        </p>
      )}
    </div>
  );
}
