"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  Diff,
  KeyRound,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Ruler,
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
  onAdjustPoints,
  onCorrectKm,
  onResetPassword,
  readOnly = false,
  canManageAdminLevel = false,
  onAdminLevelChanged,
}: {
  member: MemberRow;
  onClose: () => void;
  onEdit: (member: MemberRow & { phone?: string | null }) => void;
  onAdjustPoints: (member: MemberRow) => void;
  /** P1-1：核准跑步提交誤按後，唯一能把 total_km 改回去的入口 */
  onCorrectKm: (member: MemberRow) => void;
  onResetPassword: (member: MemberRow) => void;
  /** 第二級管理員的唯讀模式：只留「重新載入」，所有寫入入口不渲染 */
  readOnly?: boolean;
  /** 只有第一級能改別人的管理員級別（第二級自己看不到這一區） */
  canManageAdminLevel?: boolean;
  /** 改完級別即時回寫列表那一列，不必整頁 reload */
  onAdminLevelChanged?: (memberId: string, level: number | null) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** 管理員級別：待確認的目標值（null = 沒有待確認操作） */
  const [levelConfirm, setLevelConfirm] = useState<number | null>(null);
  const [levelBusy, setLevelBusy] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);
  /** 本地覆寫：改完立即反映，不等重新載入 */
  const [levelOverride, setLevelOverride] = useState<number | null>(null);

  /**
   * 改管理員級別。PATCH /api/admin/members { userId, admin_level: 0|2 }
   * 只有第一級能呼叫；API 未實作／未跑 migration 時如實顯示後端訊息，
   * 不做「假成功」。
   */
  async function applyAdminLevel(next: number) {
    setLevelBusy(true);
    setLevelError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.member_id, admin_level: next }),
      });
      const body: unknown = await res.json().catch(() => null);
      const ok =
        body !== null && typeof body === "object" && (body as { ok?: boolean }).ok === true;
      if (!res.ok || !ok) {
        const message =
          body !== null && typeof body === "object"
            ? ((body as { error?: string }).error ?? "伺服器錯誤，請稍後再試。")
            : "伺服器錯誤，請稍後再試。";
        setLevelError(message);
        return;
      }
      /*
       * 以**後端回傳的 data.admin_level** 為準，不用送出的值推：
       *   送 2  → 回 2
       *   送 0  → 回 null（取消管理員）
       * 白客 4a1aaef 修好了這裡的語義（原本用 ?? 會把 null 當「沒帶」而回頭
       * 讀舊值，碰巧結果正確但很脆弱）。回傳缺欄位時才退回送出的值。
       */
      const savedRaw = body !== null && typeof body === "object"
        ? (body as { data?: { admin_level?: number | null } }).data?.admin_level
        : undefined;
      const savedLevel: number | null =
        savedRaw === null ? null : typeof savedRaw === "number" ? savedRaw : next === 0 ? null : next;

      setLevelOverride(savedLevel);
      setLevelConfirm(null);
      onAdminLevelChanged?.(member.member_id, savedLevel);
    } catch {
      setLevelError("網路錯誤，請稍後再試。");
    } finally {
      setLevelBusy(false);
    }
  }

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
        {/* ===== 管理員級別（只有第一級看得到這一區） =====
            級別只影響「能看到哪些後台模組」，不改 role；role 仍是進入後台的
            總開關。非管理員顯示「非管理員」，第一級顯示「第一級管理員」。 */}
        {canManageAdminLevel ? (
          <section className="border-b border-ink-line px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
              管理員級別
            </p>
            {(() => {
              /*
               * 級別判定必須與後端 admin_module_access() 一致，否則會出現
               * 「畫面說有級別、實際零權限」。四個狀態要分清楚：
               *   role !== 'admin'              → 非管理員
               *   admin_level === 2             → 第二級管理員（對照表）
               *   admin_level === 1             → 第一級管理員（全開）
               *   admin_level === null          → **未分級（無權限）**：後端回 none
               *   admin_level === undefined     → 欄位不存在（migration 未跑）
               *                                   → 當第一級（那時所有 admin 都全開）
               *
               * 為什麼要分 null 與 undefined：typeof null === 'object'，
               * 用 `typeof x === 'number'` 會把 null 與「沒有欄位」混為一談；
               * 而這兩者的後端語意相反（null = 全擋、欄位不存在 = 全開）。
               */
              const raw = levelOverride ?? data.admin_level;
              const isAdmin = data.role === "admin";

              let label = "非管理員";
              let tone = "border-white/20 bg-white/5 text-white/70";
              let target: 0 | 2 = 2;
              let actionLabel = "設為第二級管理員";
              let hint: string | null = null;

              if (isAdmin) {
                if (raw === 2) {
                  label = "第二級管理員";
                  tone = "border-cobalt/50 bg-cobalt/15 text-accent-blue";
                  target = 0;
                  actionLabel = "取消管理員";
                } else if (raw === null) {
                  label = "未設定（無權限）";
                  tone = "border-amber-500/50 bg-amber-500/15 text-amber-200";
                  target = 2;
                  actionLabel = "設為第二級管理員";
                  hint =
                    "他是管理員但未設定級別，後端會擋掉所有模組（fail closed）。請按上面設為第二級。";
                } else {
                  // raw === 1，或欄位不存在（undefined，migration 未跑）
                  label = "第一級管理員";
                  tone = "border-vital/50 bg-vital/15 text-vital-bright";
                  target = 0;
                  actionLabel = "取消管理員";
                }
              }

              return (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`slab border px-2.5 py-1 text-xs font-bold ${tone}`}
                    >
                      {label}
                    </span>

                    {levelConfirm === null ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLevelError(null);
                          setLevelConfirm(target);
                        }}
                        className="btn-base btn-ghost min-h-11 px-3 py-2 text-xs"
                      >
                        {actionLabel}
                      </button>
                    ) : null}
                  </div>

                  {hint ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
                      {hint}
                    </p>
                  ) : null}
                </>
              );
            })()}

            {levelConfirm !== null ? (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                <p className="text-xs leading-relaxed text-amber-100">
                  {levelConfirm === 2
                    ? "確定設為第二級管理員？他能進入後台做日常營運（班表／活動／待審核／積分／兌換／輪播／教練），但會員與禮品只能看不能改，也看不到數據分析、網站內容、外觀設定與操作紀錄。"
                    : "確定取消管理員？他會立即失去後台存取權。"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={levelBusy}
                    onClick={() => void applyAdminLevel(levelConfirm)}
                    className="btn-base btn-vital min-h-11 px-3 py-2 text-xs"
                  >
                    {levelBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                    確定
                  </button>
                  <button
                    type="button"
                    disabled={levelBusy}
                    onClick={() => setLevelConfirm(null)}
                    className="btn-base btn-ghost min-h-11 px-3 py-2 text-xs"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            {levelError ? (
              <p role="alert" className="mt-2 text-xs text-red-300">
                {levelError}
              </p>
            ) : null}
          </section>
        ) : null}

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={loading}
                aria-label="重新載入會員詳情"
                className="btn-base btn-ghost min-h-11 px-3 py-2 text-xs md:min-h-0"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                重新載入
              </button>
              {readOnly ? null : (
              <>
              <button
                type="button"
                onClick={() => onAdjustPoints(detail?.member ?? member)}
                aria-label="調整積分"
                className="btn-base btn-ghost min-h-11 px-3 py-2 text-xs md:min-h-0"
              >
                <Diff size={14} /> 調整積分
              </button>
              {/* P1-1：里程更正。放在積分旁邊，因為誤按核准的情境下管理員
                  下一個念頭就是「把里程改回去」 */}
              <button
                type="button"
                onClick={() => onCorrectKm(detail?.member ?? member)}
                aria-label="更正總里程"
                data-testid="member-km-correct"
                className="btn-base btn-ghost min-h-11 px-3 py-2 text-xs md:min-h-0"
              >
                <Ruler size={14} /> 更正總里程
              </button>
              <button
                type="button"
                onClick={() => onResetPassword(detail?.member ?? member)}
                aria-label="重設密碼"
                className="btn-base btn-ghost min-h-11 px-3 py-2 text-xs md:min-h-0"
              >
                <KeyRound size={14} /> 重設密碼
              </button>
              </>
              )}
            </div>
            {readOnly ? (
              <span className="text-[11px] text-white/45">唯讀權限</span>
            ) : (
            <button
              type="button"
              onClick={() => onEdit(detail?.member ?? member)}
              className="btn-base btn-cobalt min-h-11 px-4 py-2 text-xs md:min-h-0"
            >
              <Pencil size={14} /> 編輯會員
            </button>
            )}
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
