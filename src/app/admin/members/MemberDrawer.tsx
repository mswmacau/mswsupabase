"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Ticket,
  X,
} from "lucide-react";
import { formatDate, formatDateTime, formatKm } from "@/lib/utils";
import { RoleBadge, StatusBadge } from "./ui";
import {
  isOkEnvelope,
  parseError,
  type MemberDetail,
  type MemberDetailMember,
  type MemberRow,
  type RecentCheckin,
  type RecentRun,
} from "./types";
import { useOverlay } from "./useOverlay";

/**
 * 會員詳情抽屜（右側滑出）
 *  - 開場先打 GET /api/admin/members/[id]，列表列的資料當作即時標題，
 *    詳情回來後以詳情為準（含電話、狀態原因、最近紀錄）
 *  - Esc 關閉、遮罩點擊關閉、Tab 不會跑到背景（useOverlay）
 *  - recent_runs / recent_checkins 的欄位名不確定，一律防禦性取值，缺欄位顯示「—」
 */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function pickText(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const RUN_STATUS_LABEL: Record<string, string> = {
  pending: "待審核",
  approved: "已核准",
  confirmed: "已確認",
  rejected: "已拒絕",
};

const CHECKIN_TYPE_LABEL: Record<string, string> = {
  session: "訓練簽到",
  run: "跑步簽到",
  event: "活動簽到",
  manual: "人工補登",
};

function countOf(
  counts: Record<string, unknown>,
  keys: string[],
  fallback: unknown
): number {
  const fromCounts = pickNumber(counts, keys);
  if (fromCounts !== null) return fromCounts;
  return toNumber(fallback);
}

export function MemberDrawer({
  member,
  onClose,
  onEdit,
}: {
  member: MemberRow;
  onClose: () => void;
  onEdit: (member: MemberRow & { phone?: string | null }) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useOverlay(true, panelRef, onClose);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/members/${encodeURIComponent(member.member_id)}`,
          { cache: "no-store", signal: controller.signal }
        );
        const body: unknown = await res.json();
        if (controller.signal.aborted) return;

        if (!res.ok || !isOkEnvelope<MemberDetail>(body)) {
          setError(parseError(body, "讀取會員詳情失敗。").error);
          return;
        }
        setDetail(body.data);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("網路錯誤，請稍後再試。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [member.member_id, reloadKey]);

  const data: MemberDetailMember = detail?.member ?? member;
  const counts = asRecord(detail?.counts);
  const displayName = data.display_name?.trim() || data.email || "（未具名會員）";

  const runCount = countOf(counts, ["run_count", "runs", "total_runs"], detail?.member.run_count ?? member.run_count);
  const checkinCount = countOf(
    counts,
    ["checkin_count", "checkins", "total_checkins"],
    detail?.member.checkin_count ?? member.checkin_count
  );
  const couponCount = countOf(
    counts,
    ["coupon_count", "coupons", "total_coupons"],
    detail?.member.coupon_count ?? member.coupon_count
  );

  const recentRuns: RecentRun[] = Array.isArray(detail?.recent_runs)
    ? detail!.recent_runs.slice(0, 10)
    : [];
  const recentCheckins: RecentCheckin[] = Array.isArray(detail?.recent_checkins)
    ? detail!.recent_checkins.slice(0, 10)
    : [];

  return (
    <div
      className="fixed inset-0 z-[75] bg-ink/70 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-drawer-title"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-full flex-col border-l border-ink-line bg-ink-soft sm:max-w-lg"
      >
        {/* ===== 標題列 ===== */}
        <div className="flex items-start justify-between gap-3 border-b border-ink-line px-5 py-4">
          <div className="min-w-0">
            <h3 id="member-drawer-title" className="truncate text-base font-bold">
              {displayName}
            </h3>
            <p className="mt-1 truncate text-xs text-white/60">{data.email ?? "無電郵"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RoleBadge role={data.role} />
              <StatusBadge status={data.status} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉會員詳情"
            className="shrink-0 rounded-lg p-1 text-white/50 transition hover:text-white"
            data-autofocus
          >
            <X size={18} />
          </button>
        </div>

        {/* ===== 內容 ===== */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !detail ? (
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              <span className="sr-only">載入會員詳情中</span>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : error ? (
            <div className="space-y-3">
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1 break-words">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="btn-base btn-ghost px-4 py-2 text-xs"
              >
                <RefreshCw size={14} /> 重試
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* 統計 */}
              <section aria-label="會員統計">
                <div className="grid grid-cols-3 gap-2">
                  <StatCard icon={<Activity size={15} />} label="跑步提交" value={runCount} />
                  <StatCard icon={<MapPin size={15} />} label="簽到" value={checkinCount} />
                  <StatCard icon={<Ticket size={15} />} label="優惠券" value={couponCount} />
                </div>
              </section>

              {/* 基本資料 */}
              <section aria-label="基本資料">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                  基本資料
                </h4>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <Info label="積分" value={toNumber(data.points).toLocaleString()} />
                  <Info label="總里程" value={`${formatKm(data.total_km)} km`} />
                  <Info label="加入日期" value={formatDate(data.created_at)} />
                  <Info label="最後登入" value={formatDateTime(data.last_sign_in_at)} />
                  <Info label="電話" value={data.phone?.trim() || "—"} />
                  <Info label="會員編號" value={data.member_id} mono />
                  {data.status_reason && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-white/50">狀態原因</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-white/85">
                        {data.status_reason}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* 最近跑步提交 */}
              <section aria-label="最近跑步提交">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
                  <CalendarDays size={13} /> 最近跑步提交（{recentRuns.length}）
                </h4>
                {recentRuns.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/15 px-4 py-5 text-center text-xs text-white/50">
                    暫無跑步提交紀錄。
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-line rounded-xl border border-ink-line">
                    {recentRuns.map((run, index) => {
                      const row = asRecord(run);
                      const when = pickText(row, ["created_at", "submitted_at", "run_date"]);
                      const km = pickNumber(row, ["distance_km", "km", "distance"]);
                      const status = pickText(row, ["status"]);
                      return (
                        <li
                          key={pickText(row, ["id", "record_id"]) ?? `run-${index}`}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                        >
                          <span className="text-white/75">
                            {when ? formatDate(when) : "—"}
                          </span>
                          <span className="tabular-nums text-white/85">
                            {km === null ? "—" : `${formatKm(km)} km`}
                          </span>
                          <span className="text-xs text-white/55">
                            {status ? (RUN_STATUS_LABEL[status] ?? status) : "—"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* 最近簽到 */}
              <section aria-label="最近簽到">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
                  <MapPin size={13} /> 最近簽到（{recentCheckins.length}）
                </h4>
                {recentCheckins.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/15 px-4 py-5 text-center text-xs text-white/50">
                    暫無簽到紀錄。
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-line rounded-xl border border-ink-line">
                    {recentCheckins.map((checkin, index) => {
                      const row = asRecord(checkin);
                      const when = pickText(row, [
                        "created_at",
                        "checkin_at",
                        "checked_in_at",
                        "session_date",
                      ]);
                      const title = pickText(row, ["title", "session_title", "session_name"]);
                      const type = pickText(row, ["checkin_type", "type", "kind"]);
                      return (
                        <li
                          key={pickText(row, ["id", "checkin_id"]) ?? `checkin-${index}`}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                        >
                          <span className="text-white/75">
                            {when ? formatDate(when) : "—"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-white/85 sm:text-right">
                            {title ?? (type ? (CHECKIN_TYPE_LABEL[type] ?? type) : "—")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>

        {/* ===== 底部操作 ===== */}
        <div className="border-t border-ink-line px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              aria-label="重新載入會員詳情"
              className="btn-base btn-ghost px-3 py-2 text-xs"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              重新載入
            </button>
            <button
              type="button"
              onClick={() => onEdit(detail?.member ?? member)}
              className="btn-base btn-cobalt px-4 py-2 text-xs"
            >
              <Pencil size={14} /> 編輯會員
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-ink-line bg-white/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-white/50">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function Info({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-white/50">{label}</dt>
      <dd
        className={`mt-0.5 break-words text-white/85 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
