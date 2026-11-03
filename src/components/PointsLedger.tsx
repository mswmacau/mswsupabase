"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { PointTransaction } from "@/lib/types";

/**
 * 積分明細：首屏由伺服器渲染，之後每次 20 筆由 API 追加。
 * 不一次拉全部——積分紀錄只會愈來愈長。
 */
export function PointsLedger({
  initialRows,
  initialHasMore,
  emptyText,
}: {
  initialRows: PointTransaction[];
  initialHasMore: boolean;
  emptyText: string;
}) {
  const [rows, setRows] = useState<PointTransaction[]>(initialRows);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/points/ledger?limit=20&offset=${rows.length}`,
        { headers: { Accept: "application/json" } }
      );
      const data = (await res.json()) as {
        ok: boolean;
        rows?: PointTransaction[];
        hasMore?: boolean;
        error?: string;
      };

      if (!data.ok) {
        setError(data.error ?? "載入失敗，請再試一次。");
        return;
      }

      setRows((prev) => [...prev, ...(data.rows ?? [])]);
      setHasMore(data.hasMore === true);
    } catch {
      setError("網絡不穩，載入失敗。請再試一次。");
    } finally {
      setPending(false);
    }
  }

  if (!rows.length) {
    return (
      <div className="clip-notch-br border border-dashed border-white/15 px-5 py-12 text-center text-sm leading-relaxed text-white/65">
        {emptyText}
      </div>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-[var(--line-fine)] border-y border-[var(--line-fine)]">
        {rows.map((p) => {
          const positive = p.delta >= 0;
          return (
            <li key={p.id} className="flex items-baseline justify-between gap-4 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-sm text-white/90">{p.reason}</div>
                <div className="mt-0.5 text-xs text-white/50">
                  {formatDate(p.created_at)}
                </div>
              </div>
              <span
                className={`stat-figure flex-none text-lg ${
                  positive ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {positive ? "+" : ""}
                {p.delta}
              </span>
            </li>
          );
        })}
      </ul>

      {error && (
        <p
          role="alert"
          className="slab mt-4 flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-200"
        >
          <AlertCircle size={15} className="mt-0.5 flex-none" />
          {error}
        </p>
      )}

      <div className="mt-6 text-center">
        {hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className="btn-base btn-ghost btn-slab min-h-11 min-w-[160px] disabled:cursor-not-allowed"
          >
            {pending ? (
              <>
                <Loader2 size={15} className="animate-spin" /> 載入中…
              </>
            ) : (
              "載入更多"
            )}
          </button>
        ) : (
          <p className="text-xs text-white/40">已經到底了</p>
        )}
      </div>
    </div>
  );
}
