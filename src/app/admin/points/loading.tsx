/**
 * /admin/points 的載入骨架（積分規則／月報表／券列表都可能慢）。
 */
export default function Loading() {
  return (
    <div className="min-w-0 space-y-5" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-white/10" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
      </div>
      <div className="h-12 w-full animate-pulse rounded-xl bg-white/5" />
      <div className="h-56 w-full animate-pulse rounded-xl bg-white/5" />
      <p className="text-center text-xs text-white/40">正在讀取積分與發券資料…</p>
    </div>
  );
}
