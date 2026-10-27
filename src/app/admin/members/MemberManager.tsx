"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Diff,
  Eye,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { formatDate, formatKm } from "@/lib/utils";
import { MemberCreateDialog } from "./MemberCreateDialog";
import { MemberDeleteDialog } from "./MemberDeleteDialog";
import { MemberDrawer } from "./MemberDrawer";
import { MemberEditDialog } from "./MemberEditDialog";
import { MemberPasswordDialog } from "./MemberPasswordDialog";
import { MemberPointsDialog } from "./MemberPointsDialog";
import { MemberVerificationDialog } from "./MemberVerificationDialog";
import { ErrorBanner, RoleBadge, StatusBadge } from "./ui";
import {
  isOkEnvelope,
  parseError,
  type MemberListData,
  type MemberRole,
  type MemberRow,
  type MemberStatus,
} from "./types";

/**
 * 後台會員管理（完整版）
 *
 * 資料流：一律打 /api/admin/members（後端會再驗一次管理員身分）。
 *  - 列表：GET ?q=&role=&status=&page=&limit=20
 *  - 詳情：抽屜自己打 GET /api/admin/members/[id]
 *  - 編輯：PATCH /api/admin/members
 *  - 新增：POST /api/admin/members（無 service key 時後端回 501 SERVICE_ROLE_REQUIRED）
 *  - 刪除：DELETE /api/admin/members?userId=（無 service key 時為軟刪除＝停用）
 *
 * 設計取捨：
 *  - 搜尋 debounce 300ms，切換條件時 AbortController 中止舊請求，避免舊結果覆蓋新結果
 *  - 所有錯誤都走頁內訊息區（role="alert"），不用 alert()
 *  - 表格在窄螢幕橫向滾動，外層不加固定寬度，避免整頁溢出
 */

const PAGE_SIZE = 20;

type RoleFilter = "all" | MemberRole;
type StatusFilter = "all" | MemberStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部狀態" },
  { value: "active", label: "正常" },
  { value: "suspended", label: "停權" },
  { value: "disabled", label: "停用" },
];

function memberName(member: MemberRow): string {
  return member.display_name?.trim() || member.email || "（未具名會員）";
}

export function MemberManager() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasServiceRole, setHasServiceRole] = useState(true);

  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [drawerMember, setDrawerMember] = useState<MemberRow | null>(null);
  const [editMember, setEditMember] = useState<(MemberRow & { phone?: string | null }) | null>(null);
  const [deleteMember, setDeleteMember] = useState<MemberRow | null>(null);
  const [pointsMember, setPointsMember] = useState<MemberRow | null>(null);
  const [passwordMember, setPasswordMember] = useState<MemberRow | null>(null);
  const [verifyMember, setVerifyMember] = useState<MemberRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const hasFilters = search !== "" || roleFilter !== "all" || statusFilter !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /* ---------- 搜尋 debounce 300ms ---------- */
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  /* ---------- 讀取列表 ---------- */
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        if (search) params.set("q", search);
        if (roleFilter !== "all") params.set("role", roleFilter);
        if (statusFilter !== "all") params.set("status", statusFilter);

        const res = await fetch(`/api/admin/members?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await res.json();
        if (controller.signal.aborted) return;

        if (!res.ok || !isOkEnvelope<MemberListData>(body)) {
          setMembers([]);
          setTotal(0);
          setError(parseError(body, "讀取會員資料失敗。").error);
          return;
        }

        const data = body.data;
        const list = Array.isArray(data.members) ? data.members : [];
        const nextTotal = Number(data.total) || 0;
        setMembers(list);
        setTotal(nextTotal);
        setHasServiceRole(data.has_service_role !== false);

        const lastPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
        if (page > lastPage) setPage(lastPage);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("網路錯誤，請稍後再試。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [search, roleFilter, statusFilter, page, reloadKey]);

  /* ---------- 啟用／停用快捷鍵 ---------- */
  async function toggleStatus(member: MemberRow) {
    const nextStatus: MemberStatus = member.status === "active" ? "suspended" : "active";
    setBusyId(member.member_id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.member_id, status: nextStatus }),
      });
      const body: unknown = await res.json();

      if (!res.ok || !isOkEnvelope<{ member?: MemberRow }>(body)) {
        setError(parseError(body, "更新會員狀態失敗。").error);
        return;
      }

      const updated = body.data.member;
      setMembers((prev) =>
        prev.map((row) =>
          row.member_id === member.member_id
            ? { ...row, ...(updated ?? {}), status: updated?.status ?? nextStatus }
            : row
        )
      );
      setNotice(
        `已將「${memberName(member)}」${nextStatus === "active" ? "啟用" : "停用"}。`
      );
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  }

  function clearFilters() {
    setQuery("");
    setSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setPage(1);
  }

  const summary = useMemo(() => {
    if (loading && members.length === 0) return "載入中…";
    if (total === 0) return "沒有符合條件的會員";
    return `共 ${total.toLocaleString()} 位會員`;
  }, [loading, members.length, total]);

  return (
    <div className="min-w-0 space-y-4">
      {/* ===== 頁內訊息區 ===== */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="關閉提示訊息"
            className="-mr-1 shrink-0 rounded p-1 text-emerald-200/70 transition hover:text-emerald-100"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* ===== 工具列 ===== */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
            />
            <input
              type="search"
              className="field pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋名稱或電郵"
              aria-label="搜尋會員名稱或電郵"
            />
          </div>

          <select
            className="field w-auto"
            value={roleFilter}
            aria-label="依角色篩選"
            onChange={(event) => {
              setRoleFilter(event.target.value as RoleFilter);
              setPage(1);
            }}
          >
            <option value="all">全部角色</option>
            <option value="admin">管理員</option>
            <option value="member">會員</option>
          </select>

          <select
            className="field w-auto"
            value={statusFilter}
            aria-label="依狀態篩選"
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setPage(1);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={loading}
            aria-label="重新整理會員列表"
            className="btn-base btn-ghost px-3 py-2 text-sm"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            重新整理
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!hasServiceRole}
            aria-label="新增會員"
            aria-describedby={hasServiceRole ? undefined : "service-role-hint"}
            title={hasServiceRole ? undefined : "未設定服務金鑰，無法新增帳號"}
            className="btn-base btn-cobalt px-4 py-2 text-sm"
          >
            <Plus size={16} /> 新增會員
          </button>
        </div>
      </div>

      {!hasServiceRole && (
        <p
          id="service-role-hint"
          className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          <KeyRound size={14} className="mt-0.5 shrink-0" />
          未設定服務金鑰，無法新增帳號；刪除會員時只會停用。
        </p>
      )}

      {/* ===== 列表 ===== */}
      <div className="min-w-0 overflow-x-auto rounded-xl border border-ink-line" aria-busy={loading}>
        <table className="w-full min-w-[840px] table-fixed text-sm">
          <caption className="sr-only">
            會員列表，共 {total} 位；點擊列可開啟詳情抽屜
          </caption>
          <colgroup>
            <col className="w-[17%]" />
            <col className="w-[19%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[23%]" />
          </colgroup>
          <thead className="bg-ink-soft text-left text-xs text-white/60">
            <tr>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">名稱</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">電郵</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">角色</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">狀態</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">積分</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">總里程</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">加入日期</th>
              <th scope="col" className="sticky right-0 z-10 whitespace-nowrap border-l border-ink-line bg-ink-soft px-4 py-3 text-right font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-line">
            {loading && members.length === 0 ? (
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="animate-pulse">
                  {Array.from({ length: 8 }).map((__, cell) => (
                    <td key={cell} className="px-4 py-3.5">
                      <span className="block h-3.5 rounded bg-white/10" />
                    </td>
                  ))}
                </tr>
              ))
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-white/60">
                  {error ? (
                    "暫時無法顯示會員資料。"
                  ) : hasFilters ? (
                    <div className="space-y-3">
                      <p>找不到符合條件的會員。</p>
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="btn-base btn-ghost px-4 py-2 text-xs"
                      >
                        清除篩選
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Users size={22} className="mx-auto text-white/30" />
                      <p>尚無會員資料。</p>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr
                  key={member.member_id}
                  onClick={() => setDrawerMember(member)}
                  className="cursor-pointer transition hover:bg-white/5 focus-within:bg-white/5"
                >
                  <td className="px-4 py-3">
                    <div className="truncate font-semibold" title={memberName(member)}>
                      {member.display_name?.trim() || "（未具名會員）"}
                    </div>
                    <div className="truncate text-xs text-white/45">
                      最後登入 {formatDate(member.last_sign_in_at)}
                    </div>
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-white/70" title={member.email ?? undefined}>
                    {member.email ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={member.role} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={member.status} />
                    {member.status_reason && (
                      <span
                        className="mt-1 block max-w-[160px] truncate text-xs text-white/40"
                        title={member.status_reason}
                      >
                        {member.status_reason}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {Number(member.points ?? 0).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {formatKm(member.total_km)} km
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-white/70">
                    {formatDate(member.created_at)}
                  </td>
                  <td className="sticky right-0 z-10 whitespace-nowrap border-l border-ink-line bg-ink px-3 py-3">
                    <div className="flex items-center justify-end gap-0">
                      <IconAction
                        label={`檢視 ${memberName(member)} 的詳情`}
                        onClick={() => setDrawerMember(member)}
                      >
                        <Eye size={15} />
                      </IconAction>
                      <IconAction
                        label={`編輯 ${memberName(member)}`}
                        onClick={() => setEditMember(member)}
                      >
                        <Pencil size={15} />
                      </IconAction>
                      <IconAction label="調整積分" onClick={() => setPointsMember(member)}>
                        <Diff size={15} />
                      </IconAction>
                      <IconAction label="重設密碼" onClick={() => setPasswordMember(member)}>
                        <KeyRound size={15} />
                      </IconAction>
                      <IconAction label="重寄驗證信" onClick={() => setVerifyMember(member)}>
                        <Mail size={15} />
                      </IconAction>
                      <IconAction
                        label={
                          member.status === "active"
                            ? `停用 ${memberName(member)}`
                            : `啟用 ${memberName(member)}`
                        }
                        onClick={() => void toggleStatus(member)}
                        disabled={busyId === member.member_id}
                        tone={member.status === "active" ? "warn" : "ok"}
                      >
                        {busyId === member.member_id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Power size={15} />
                        )}
                      </IconAction>
                      <IconAction
                        label={`刪除 ${memberName(member)}`}
                        onClick={() => setDeleteMember(member)}
                        tone="danger"
                      >
                        <Trash2 size={15} />
                      </IconAction>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ===== 分頁 ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
        <span>{summary}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            aria-label="上一頁"
            className="btn-base btn-ghost px-3 py-1.5 text-xs"
          >
            <ChevronLeft size={15} /> 上一頁
          </button>
          <span aria-live="polite" className="tabular-nums">
            第 {page} / {totalPages} 頁
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            aria-label="下一頁"
            className="btn-base btn-ghost px-3 py-1.5 text-xs"
          >
            下一頁 <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* ===== 抽屜與對話框 ===== */}
      {drawerMember && (
        <MemberDrawer
          member={drawerMember}
          onClose={() => setDrawerMember(null)}
          onEdit={(member) => {
            setDrawerMember(null);
            setEditMember(member);
          }}
          onAdjustPoints={(member) => {
            setDrawerMember(null);
            setPointsMember(member);
          }}
          onResetPassword={(member) => {
            setDrawerMember(null);
            setPasswordMember(member);
          }}
        />
      )}

      {editMember && (
        <MemberEditDialog
          member={editMember}
          onClose={() => setEditMember(null)}
          onSaved={(updated) => {
            setMembers((prev) =>
              prev.map((row) => (row.member_id === updated.member_id ? { ...row, ...updated } : row))
            );
            setNotice(`已更新「${memberName(updated)}」的資料。`);
          }}
        />
      )}

      {pointsMember && (
        <MemberPointsDialog
          member={pointsMember}
          onClose={() => setPointsMember(null)}
          onUpdated={(updated, points) => {
            setMembers((prev) =>
              prev.map((row) =>
                row.member_id === updated.member_id ? { ...row, ...updated, points } : row
              )
            );
            setNotice(`已將「${memberName(updated)}」的積分調整為 ${points.toLocaleString()}。`);
          }}
        />
      )}

      {passwordMember && (
        <MemberPasswordDialog
          member={passwordMember}
          onClose={() => setPasswordMember(null)}
        />
      )}

      {verifyMember && (
        <MemberVerificationDialog
          member={verifyMember}
          onClose={() => setVerifyMember(null)}
        />
      )}

      {createOpen && (
        <MemberCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(name) => {
            setNotice(`已新增會員「${name}」。`);
            setPage(1);
            setReloadKey((key) => key + 1);
          }}
          onServiceRoleRequired={() => setHasServiceRole(false)}
        />
      )}

      {deleteMember && (
        <MemberDeleteDialog
          member={deleteMember}
          onClose={() => setDeleteMember(null)}
          onDeleted={(member, softDeleted) => {
            setNotice(
              softDeleted
                ? `未設定服務金鑰，已改為停用「${memberName(member)}」。`
                : `已刪除「${memberName(member)}」。`
            );
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  disabled = false,
  tone = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "warn" | "ok" | "danger";
  children: ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "hover:border-red-500/50 hover:text-red-300"
      : tone === "warn"
        ? "hover:border-amber-500/50 hover:text-amber-300"
        : tone === "ok"
          ? "hover:border-emerald-500/50 hover:text-emerald-300"
          : "hover:border-white/40 hover:text-white";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`rounded-lg border border-white/15 p-1 text-white/65 transition disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}
