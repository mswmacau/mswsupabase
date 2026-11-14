"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { FetchError, postJson } from "@/lib/fetch-json";
import { AdminError, AdminNotice, ConfirmDialog } from "@/components/admin/ui";
import { daysSince, formatMacau, groupCode, STATUS_LABEL, statusPillClass } from "./format";
import type { RedemptionRow, StatusCounts } from "./types";

/**
 * 兌換管理（client）。
 *
 * 資料由 Server Component 依 ?status= / ?q= 取回後傳入；這裡只負責：
 *  - 篩選（狀態頁籤、券碼／會員名搜尋）→ 改 URL 讓伺服器重新取數
 *  - 批准／拒絕（admin_review_redemption）
 *  - 標記已領取／取消（admin_fulfill_redemption）
 * 危險操作（拒絕、取消）一律二次確認，文案明寫會退分並回庫存。
 */

const TABS = [
  { key: "all", label: "全部" },
  { key: "pending_approval", label: "待審批" },
  { key: "pending", label: "待領取" },
  { key: "completed", label: "已完成" },
  { key: "cancelled", label: "已取消" },
] as const;

const NEW_MEMBER_DAYS = 7;

type ConfirmTarget = { row: RedemptionRow; kind: "reject" | "cancel" };

export function RedemptionsView({
  rows,
  counts,
  status,
  q,
  hideFilters = false,
}: {
  rows: RedemptionRow[];
  counts: StatusCounts;
  status: string;
  q: string;
  /**
   * IA 第二階段：`/admin/review?tab=redemptions` 只列「待審批」，
   * 由伺服器決定資料範圍，狀態頁籤與搜尋在這邊按了也不會有意義
   * （rows 只有待審批那 100 筆），因此藏起來；動作按鈕與二次確認完全保留。
   * 預設 false = /admin/redemptions 行為與 HEAD 一字不差。
   */
  hideFilters?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  function navigate(nextStatus: string, nextQ: string) {
    const params = new URLSearchParams();
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (nextQ.trim()) params.set("q", nextQ.trim());
    const suffix = params.toString();
    router.push(suffix ? `/admin/redemptions?${suffix}` : "/admin/redemptions");
  }

  async function act(row: RedemptionRow, body: Record<string, unknown>, successFallback: string) {
    setRowBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      const data = await postJson<{ message?: string }>("/api/admin/redemptions", {
        ...body,
        id: row.id,
      });
      setNotice(data.message ?? successFallback);
      router.refresh();
      return true;
    } catch (err) {
      const message = err instanceof FetchError ? err.message : "網路錯誤，請稍後再試。";
      setError(message);
      return false;
    } finally {
      setRowBusy(null);
    }
  }

  async function confirmDanger() {
    if (!confirmTarget) return;
    setConfirmError(null);
    const { row, kind } = confirmTarget;
    const ok =
      kind === "reject"
        ? await act(row, { action: "review", decision: "rejected" }, "已拒絕，積分已退回。")
        : await act(row, { action: "fulfill", outcome: "cancelled" }, "已取消，積分已退回。");
    if (ok) setConfirmTarget(null);
    else setConfirmError("操作失敗，請看頁面上方的錯誤訊息。");
  }

  const total = counts.all ?? rows.length;

  return (
    <div className="min-w-0 space-y-4">
      {error && <AdminError message={error} onDismiss={() => setError(null)} />}
      {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}

      {/* 篩選（hideFilters = 待審核中心內嵌，資料範圍已由伺服器限定） */}
      {hideFilters ? null : (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = status === tab.key || (tab.key === "all" && status === "all");
            const n = counts[tab.key] ?? 0;
            return (
              <Link
                key={tab.key}
                href={
                  tab.key === "all"
                    ? q
                      ? `/admin/redemptions?q=${encodeURIComponent(q)}`
                      : "/admin/redemptions"
                    : `/admin/redemptions?status=${tab.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`
                }
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border-vital bg-vital text-white"
                    : "border-white/15 text-white/75 hover:border-white/40 hover:text-white"
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 tabular-nums ${active ? "text-white/80" : "text-white/45"}`}>
                  {n}
                </span>
              </Link>
            );
          })}
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            navigate(status, query);
            setTimeout(() => setPending(false), 600);
          }}
        >
          <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
            />
            <input
              type="search"
              className="field pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋券碼或會員名"
              aria-label="搜尋券碼或會員名"
            />
          </div>
          <button type="submit" disabled={pending} className="btn-base btn-cobalt px-4 py-2 text-sm">
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} 搜尋
          </button>
          {(q || status !== "all") && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                navigate("all", "");
              }}
              className="btn-base btn-ghost px-3 py-2 text-sm"
            >
              清除篩選
            </button>
          )}
          <button
            type="button"
            onClick={() => router.refresh()}
            className="btn-base btn-ghost px-3 py-2 text-sm"
            aria-label="重新整理兌換列表"
          >
            <RefreshCw size={15} /> 重新整理
          </button>
        </form>
      </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center text-sm text-white/70">
          {q
            ? `找不到符合「${q}」的兌換紀錄。試試完整券碼，或改用會員名搜尋。`
            : status !== "all"
              ? `目前沒有「${STATUS_LABEL[status] ?? status}」的兌換紀錄。`
              : "目前還沒有任何兌換紀錄。會員在禮品頁兌換後，這裡會即時出現。"}
        </div>
      ) : (
        <>
          {/* 桌面表格 */}
          <div className="hidden min-w-0 overflow-x-auto rounded-xl border border-ink-line lg:block">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">
                兌換紀錄，目前顯示 {rows.length} 筆（共 {total} 筆）
              </caption>
              <colgroup>
                <col className="w-[13%]" />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead className="bg-ink-soft text-left text-xs text-white/60">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">券碼</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">會員</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">禮品</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">花費積分</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">核銷商戶</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">狀態</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">建立時間</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">領取時間</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-3">
                      <CodeLink code={row.pickup_code} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold">
                        {row.user?.display_name?.trim() || "（未具名會員）"}
                      </div>
                      {row.status === "pending_approval" && <MemberAge user={row.user} />}
                    </td>
                    <td className="max-w-[180px] px-3 py-3 text-white/80">
                      <span className="line-clamp-2">{row.reward?.name ?? "（禮品已下架）"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {row.points_spent.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-white/75">
                      {row.merchant?.name ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-white/60">
                      {formatMacau(row.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-white/60">
                      {formatMacau(row.merchant_verified_at ?? row.decided_at)}
                    </td>
                    <td className="px-3 py-3">
                      <RowActions
                        row={row}
                        busy={rowBusy === row.id}
                        onApprove={() =>
                          void act(
                            row,
                            { action: "review", decision: "approved" },
                            "已批准，券已轉為待領取。"
                          )
                        }
                        onComplete={() =>
                          void act(row, { action: "fulfill", outcome: "completed" }, "已標記為已領取。")
                        }
                        onDanger={(kind) => {
                          setConfirmError(null);
                          setConfirmTarget({ row, kind });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機卡片 */}
          <ul className="space-y-3 lg:hidden">
            {rows.map((row) => (
              <li key={row.id} className="card-dark p-4">
                <div className="flex items-start justify-between gap-2">
                  <CodeLink code={row.pickup_code} />
                  <StatusPill status={row.status} />
                </div>
                <p className="mt-2 text-sm font-semibold">
                  {row.reward?.name ?? "（禮品已下架）"}
                  <span className="ml-2 text-xs font-normal text-white/60">
                    {row.points_spent.toLocaleString()} 分
                  </span>
                </p>
                <p className="mt-1 text-xs text-white/60">
                  {row.user?.display_name?.trim() || "（未具名會員）"} · {row.merchant?.name ?? "—"}
                </p>
                {row.status === "pending_approval" && <MemberAge user={row.user} />}
                <p className="mt-1 text-xs text-white/45">
                  建立 {formatMacau(row.created_at)}
                  {row.merchant_verified_at || row.decided_at
                    ? ` · 領取 ${formatMacau(row.merchant_verified_at ?? row.decided_at)}`
                    : ""}
                </p>
                <div className="mt-3">
                  <RowActions
                    row={row}
                    busy={rowBusy === row.id}
                    mobile
                    onApprove={() =>
                      void act(
                        row,
                        { action: "review", decision: "approved" },
                        "已批准，券已轉為待領取。"
                      )
                    }
                    onComplete={() =>
                      void act(row, { action: "fulfill", outcome: "completed" }, "已標記為已領取。")
                    }
                    onDanger={(kind) => {
                      setConfirmError(null);
                      setConfirmTarget({ row, kind });
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-xs leading-relaxed text-white/50">
        領取時間：店員核銷後為「核銷時間」，管理員在後台標記則為「審批時間」，兩者都代表這張券已被使用。
        券碼可點擊，會以新視窗開啟店員核銷頁，方便現場測試。
      </p>

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.kind === "reject" ? "拒絕這筆兌換申請" : "取消這張電子券"}
          confirmLabel={confirmTarget.kind === "reject" ? "確認拒絕並退分" : "確認取消並退分"}
          pending={rowBusy === confirmTarget.row.id}
          error={confirmError}
          requireCheck="我了解這會退回積分並回補庫存，且無法復原。"
          description={
            <div className="space-y-2">
              <p>
                券碼{" "}
                <span className="font-mono text-white">
                  {groupCode(confirmTarget.row.pickup_code)}
                </span>
                （{confirmTarget.row.reward?.name ?? "禮品"}，
                {confirmTarget.row.points_spent.toLocaleString()} 分）
              </p>
              <ul className="list-disc space-y-1 pl-5 text-white/70">
                <li>
                  系統會把 <strong className="text-white">{confirmTarget.row.points_spent.toLocaleString()} 分</strong>
                  退回該會員的積分結餘。
                </li>
                <li>禮品庫存會 +1（不限量的禮品不變）。</li>
                <li>這張券會立即失效，會員無法再用它領取禮品。</li>
              </ul>
            </div>
          }
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => void confirmDanger()}
        />
      )}
    </div>
  );
}

function RowActions({
  row,
  busy,
  mobile = false,
  onApprove,
  onComplete,
  onDanger,
}: {
  row: RedemptionRow;
  busy: boolean;
  mobile?: boolean;
  onApprove: () => void;
  onComplete: () => void;
  onDanger: (kind: "reject" | "cancel") => void;
}) {
  const base = mobile
    ? "inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50"
    : "inline-flex items-center justify-center rounded-lg border p-1.5 text-xs font-semibold disabled:opacity-50";

  if (row.status === "pending_approval") {
    return (
      <div className={`flex gap-1.5 ${mobile ? "w-full" : "justify-end"}`}>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          aria-label="批准這筆兌換"
          title="批准這筆兌換"
          className={`${base} border-emerald-500/45 text-emerald-200 hover:bg-emerald-500/10`}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {mobile && "批准"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDanger("reject")}
          aria-label="拒絕這筆兌換（會退分並回庫存）"
          title="拒絕這筆兌換（會退分並回庫存）"
          className={`${base} border-red-500/45 text-red-300 hover:bg-red-500/10`}
        >
          <XCircle size={14} />
          {mobile && "拒絕"}
        </button>
      </div>
    );
  }

  if (row.status === "pending") {
    return (
      <div className={`flex gap-1.5 ${mobile ? "w-full" : "justify-end"}`}>
        <button
          type="button"
          disabled={busy}
          onClick={onComplete}
          aria-label="標記為已領取"
          title="標記為已領取"
          className={`${base} border-emerald-500/45 text-emerald-200 hover:bg-emerald-500/10`}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {mobile && "標記已領取"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDanger("cancel")}
          aria-label="取消這張券（會退分並回庫存）"
          title="取消這張券（會退分並回庫存）"
          className={`${base} border-red-500/45 text-red-300 hover:bg-red-500/10`}
        >
          <XCircle size={14} />
          {mobile && "取消"}
        </button>
      </div>
    );
  }

  return (
    <span className={`block text-xs text-white/40 ${mobile ? "" : "text-right"}`}>
      {row.status === "completed" ? (mobile ? "已核銷，無需操作" : "已核銷") : "已取消"}
    </span>
  );
}

function CodeLink({ code }: { code: string | null }) {
  if (!code) return <span className="text-xs text-white/40">（未產生）</span>;
  return (
    <a
      href={`/v/${encodeURIComponent(code)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs font-semibold text-sky-300 underline-offset-4 hover:underline"
      title="以新視窗開啟店員核銷頁（測試用）"
    >
      {groupCode(code)}
      <ExternalLink size={11} aria-hidden />
    </a>
  );
}

function MemberAge({ user }: { user: RedemptionRow["user"] }) {
  const days = daysSince(user?.created_at);
  if (days === null) return null;
  const isNew = days < NEW_MEMBER_DAYS;
  return (
    <span
      className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        isNew
          ? "border-amber-500/45 bg-amber-500/10 text-amber-200"
          : "border-white/15 bg-white/5 text-white/55"
      }`}
      title={`註冊於 ${formatMacau(user?.created_at)}`}
    >
      註冊 {days} 天
      {isNew ? "（新會員）" : ""}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(
        status
      )}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
