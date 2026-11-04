"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ImageOff,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { publicAssetUrl } from "@/lib/assets";
import { FetchError, postJson } from "@/lib/fetch-json";
import { AdminError, AdminNotice, ConfirmDialog } from "@/components/admin/ui";
import { RewardDialog } from "./RewardDialog";
import type { MerchantOption, RewardRow } from "./types";

/**
 * 禮品列表與操作。
 *  - 沒有硬刪除：reward_redemptions.reward_id 是 on delete restrict，
 *    「刪除」在本頁一律是「下架」（status=inactive），並要二次確認。
 *  - 每次寫入後 router.refresh() 讓 Server Component 重新取數。
 */
export function RewardsManager({
  initialRewards,
  merchants,
}: {
  initialRewards: RewardRow[];
  merchants: MerchantOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RewardRow[]>(initialRewards);
  const [syncedFrom, setSyncedFrom] = useState(initialRewards);

  // router.refresh() 只更新 server prop，不會更新 useState 初始值。
  // React 官方做法：在 render 期間比對 prop，變了就同步 state（不是副作用，不會多跑一次 commit）。
  if (syncedFrom !== initialRewards) {
    setSyncedFrom(initialRewards);
    setRows(initialRewards);
  }

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RewardRow | null>(null);
  const [offTarget, setOffTarget] = useState<RewardRow | null>(null);
  const [offPending, setOffPending] = useState(false);
  const [offError, setOffError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function afterChange(message: string) {
    setNotice(message);
    setError(null);
    router.refresh();
  }

  /** 下架／上架共用：把整列現值送回後端，只改 status */
  async function setStatus(row: RewardRow, status: "active" | "inactive") {
    setBusyId(row.id);
    setError(null);
    try {
      const data = await postJson<{ message?: string }>("/api/admin/rewards", {
        action: "update",
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        points_cost: row.points_cost,
        stock_total: row.stock_total,
        per_user_limit: row.per_user_limit,
        merchant_id: row.merchant_id,
        status,
        sort_order: row.sort_order,
        image_path: row.image_path,
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
      afterChange(data.message ?? (status === "active" ? "禮品已上架。" : "禮品已下架。"));
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "網路錯誤，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmOffShelf() {
    if (!offTarget) return;
    setOffPending(true);
    setOffError(null);
    try {
      await setStatus(offTarget, "inactive");
      setOffTarget(null);
    } finally {
      setOffPending(false);
    }
  }

  function refresh() {
    // useTransition 的 isPending 會一直 true 到 RSC 重新渲染完成，
    // 比固定 800ms 的假動畫誠實：按鈕何時真的更新完，spinner 就何時停。
    startTransition(() => {
      router.refresh();
    });
  }

  const activeCount = rows.filter((r) => r.status === "active").length;

  return (
    <div className="min-w-0 space-y-4">
      {error && <AdminError message={error} onDismiss={() => setError(null)} />}
      {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-white/60">
          共 {rows.length} 件禮品，{activeCount} 件上架中。排序數字越小越前。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={isPending}
            aria-busy={isPending}
            className="btn-base btn-ghost px-3 py-2 text-sm disabled:opacity-60"
            aria-label="重新整理禮品列表"
          >
            {isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            重新整理
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="btn-base btn-cobalt px-4 py-2 text-sm"
          >
            <Plus size={16} /> 新增禮品
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center">
          <ImageOff size={26} className="mx-auto text-white/30" />
          <p className="mt-3 text-sm text-white/70">尚未新增任何禮品。</p>
          <p className="mt-1 text-xs text-white/50">
            按右上角「新增禮品」建立第一件；未上架的禮品會員看不到，也不會出現在兌換頁。
          </p>
        </div>
      ) : (
        <>
          {/* 桌面：表格 */}
          <div className="hidden min-w-0 overflow-x-auto rounded-xl border border-ink-line md:block">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">禮品列表，共 {rows.length} 件</caption>
              <colgroup>
                <col className="w-[8%]" />
                <col className="w-[24%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[15%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead className="bg-ink-soft text-left text-xs text-white/60">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">圖片</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">名稱</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">積分價</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">庫存（剩／總）</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">每人上限</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">核銷商戶</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">狀態</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">排序</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-3">
                      <Thumb path={row.image_path} name={row.name} />
                    </td>
                    <td className="max-w-[220px] px-3 py-3">
                      <div className="font-semibold">{row.name}</div>
                      {row.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-white/50">
                          {row.description}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {row.points_cost.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {stockLabel(row)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {row.per_user_limit === null ? "不限" : row.per_user_limit}
                    </td>
                    <td className="px-3 py-3 text-white/75">
                      {row.merchant?.name ?? "（商戶已停用）"}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-white/60">
                      {row.sort_order}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn
                          label={`編輯 ${row.name}`}
                          onClick={() => setEditTarget(row)}
                        >
                          <Pencil size={14} />
                        </IconBtn>
                        {row.status === "active" ? (
                          <IconBtn
                            label={`下架 ${row.name}`}
                            tone="warn"
                            disabled={busyId === row.id}
                            onClick={() => {
                              setOffError(null);
                              setOffTarget(row);
                            }}
                          >
                            {busyId === row.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ArrowDownToLine size={14} />
                            )}
                          </IconBtn>
                        ) : (
                          <IconBtn
                            label={`上架 ${row.name}`}
                            tone="ok"
                            disabled={busyId === row.id}
                            onClick={() => void setStatus(row, "active")}
                          >
                            {busyId === row.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ArrowUpFromLine size={14} />
                            )}
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機：卡片 */}
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="card-dark p-4">
                <div className="flex gap-3">
                  <Thumb path={row.image_path} name={row.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold">{row.name}</p>
                      <StatusPill status={row.status} />
                    </div>
                    <p className="mt-1 text-xs text-white/60">
                      {row.points_cost.toLocaleString()} 分 · 庫存 {stockLabel(row)} · 上限{" "}
                      {row.per_user_limit === null ? "不限" : row.per_user_limit}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-white/50">
                      {row.merchant?.name ?? "（商戶已停用）"} · 排序 {row.sort_order}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditTarget(row)}
                    className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white/80"
                  >
                    <Pencil size={13} /> 編輯
                  </button>
                  {row.status === "active" ? (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setOffError(null);
                        setOffTarget(row);
                      }}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-amber-500/40 px-3 text-xs font-semibold text-amber-200 disabled:opacity-50"
                    >
                      <ArrowDownToLine size={13} /> 下架
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void setStatus(row, "active")}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-emerald-500/40 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-50"
                    >
                      <ArrowUpFromLine size={13} /> 上架
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {createOpen && (
        <RewardDialog
          merchants={merchants}
          onClose={() => setCreateOpen(false)}
          onSaved={afterChange}
        />
      )}

      {editTarget && (
        <RewardDialog
          reward={editTarget}
          merchants={merchants}
          onClose={() => setEditTarget(null)}
          onSaved={afterChange}
        />
      )}

      {offTarget && (
        <ConfirmDialog
          title={`下架「${offTarget.name}」`}
          confirmLabel="確認下架"
          tone="warn"
          pending={offPending}
          error={offError}
          requireCheck="我了解下架後會員立即無法兌換這件禮品。"
          description={
            <div className="space-y-2">
              <p>下架後：</p>
              <ul className="list-disc space-y-1 pl-5 text-white/70">
                <li>兌換頁立即看不到這件禮品，會員不能再下單。</li>
                <li>已發出的電子券不受影響，仍可正常核銷。</li>
                <li>所有兌換紀錄與積分紀錄完整保留，可隨時重新上架。</li>
              </ul>
              <p className="text-xs text-white/55">
                系統不提供刪除：禮品一旦有兌換紀錄，硬刪會被資料庫外鍵擋住。
              </p>
            </div>
          }
          onCancel={() => setOffTarget(null)}
          onConfirm={() => void confirmOffShelf()}
        />
      )}
    </div>
  );
}

function stockLabel(row: RewardRow): string {
  if (row.stock_total === null) {
    return row.stock_remaining === null ? "不限" : `${row.stock_remaining}／不限`;
  }
  const remaining = row.stock_remaining ?? 0;
  return `${remaining}／${row.stock_total}`;
}

function StatusPill({ status }: { status: "active" | "inactive" }) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-white/20 bg-white/5 text-white/60"
      }`}
    >
      {active ? "上架" : "下架"}
    </span>
  );
}

function IconBtn({
  label,
  onClick,
  disabled = false,
  tone = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "warn" | "ok";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "warn"
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
      onClick={onClick}
      className={`rounded-lg border border-white/15 p-1.5 text-white/70 transition disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function Thumb({
  path,
  name,
  size = "sm",
}: {
  path: string | null;
  name: string;
  size?: "sm" | "lg";
}) {
  const url = publicAssetUrl(path);
  const box = size === "sm" ? "h-12 w-12" : "h-16 w-16";

  if (!url) {
    return (
      <div
        className={`${box} flex shrink-0 items-center justify-center rounded-lg border border-ink-line bg-black/30 text-white/25`}
        aria-label="未設定圖片"
      >
        <ImageOff size={16} />
      </div>
    );
  }

  return (
    <span
      className={`${box} relative block shrink-0 overflow-hidden rounded-lg border border-ink-line bg-black/30`}
    >
      <Image
        src={url}
        alt={`${name} 圖片`}
        fill
        sizes="64px"
        className="object-cover"
        unoptimized
      />
    </span>
  );
}
