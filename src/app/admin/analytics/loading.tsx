/**
 * src/app/admin/analytics/loading.tsx — 數據分析頁載入骨架（T-24）
 *
 * Server Component 取數（七支分析函數並行）期間由 Next 顯示；
 * 沿用 admin 現有 loading.tsx 模式（Skeleton 元件），並附一句文案，
 * 等太久都知系統做緊嘢。
 */

import { CardSkeleton, TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-8" role="status" aria-live="polite">
      <p className="text-sm text-white/60">數據載入中…</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton rows={4} />
      <TableSkeleton rows={6} />
    </div>
  );
}
