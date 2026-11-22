"use client";

/**
 * src/components/hyrox/MyHyroxResults.tsx — 「我的完賽提交」卡（F-03）
 *
 * Server 端（F-01 頁）已把本人的提交列全部 render 出來（無 JS 也讀得到）；
 * 本檔只加兩件需要 JS 的事：
 *   1. pending 列的「刪除」按鈕（confirm 用 §5-7 凍結文案，送 DELETE /api/hyrox/results）
 *   2. 刪除後 router.refresh() 讓 server 重新出清單
 *
 * 型別自帶最小形狀（結構相容 B-03 的 MyHyroxResultRow），不 import @/lib/types。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Loader2, Trash2, XCircle } from "lucide-react";
import { deleteJson, FetchError } from "@/lib/fetch-json";

/** 本人一列提交的最小形狀（結構相容 getMyHyroxResults 的回列） */
export interface MyResultRow {
  id: string;
  division_label: string;
  race_name: string;
  race_date: string;
  finish_seconds: number;
  team_name: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** 秒 → HH:MM:SS（榜的顯示格式，server 端同一演算法） */
export function formatFinish(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** 狀態徽章三態（§1.6：待審核／已確認／已拒絕） */
function StatusBadge({ status }: { status: MyResultRow["status"] }) {
  if (status === "approved") {
    return (
      <span className="slab inline-flex items-center gap-1 border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
        <CheckCircle2 size={12} /> 已確認
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="slab inline-flex items-center gap-1 border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[11px] font-bold text-red-300">
        <XCircle size={12} /> 已拒絕
      </span>
    );
  }
  return (
    <span className="slab inline-flex items-center gap-1 border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">
      <Clock3 size={12} /> 待審核
    </span>
  );
}

export function MyHyroxResults({ rows }: { rows: MyResultRow[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(id: string) {
    // §5-7 凍結文案
    if (!window.confirm("刪除後需重新提交，確定刪除？")) return;
    setError(null);
    setDeletingId(id);
    try {
      await deleteJson("/api/hyrox/results", { id });
      router.refresh();
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.message
          : "刪除失敗，請稍後再試。"
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (rows.length === 0) {
    // §5-9 凍結文案
    return (
      <p className="text-sm leading-relaxed text-white/60">
        你還沒有提交過完賽成績。
      </p>
    );
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-xs text-red-300">
          {error}
        </p>
      )}

      <ul className="divide-y divide-[var(--line-fine)]">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="min-w-0 break-words text-sm font-semibold text-white/90">
                {row.division_label}
                {row.team_name ? ` · ${row.team_name}` : ""}
              </p>
              <p className="mt-0.5 min-w-0 truncate text-xs text-white/50">
                {row.race_name} · {row.race_date}
              </p>
              {row.status === "rejected" && row.admin_note && (
                <p className="mt-1 min-w-0 break-words text-xs text-red-300/80">
                  拒絕原因：{row.admin_note}
                </p>
              )}
            </div>

            <span className="stat-figure tnum text-sm font-bold text-white">
              {formatFinish(row.finish_seconds)}
            </span>

            <StatusBadge status={row.status} />

            {row.status === "pending" && (
              <button
                type="button"
                onClick={() => onDelete(row.id)}
                disabled={deletingId === row.id}
                className="clip-slab inline-flex min-h-11 items-center gap-1 bg-white/5 px-3 text-xs text-white/70 transition hover:bg-red-500/15 hover:text-red-200 disabled:opacity-50"
                aria-label={`刪除 ${row.division_label} ${row.race_name} 的提交`}
              >
                {deletingId === row.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                刪除
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
