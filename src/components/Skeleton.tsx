/**
 * src/components/Skeleton.tsx — 各路由 loading.tsx 共用的骨架元件
 *
 * Owner：方砚。對齊 SPEC-R6.md §4.3。全部為純展示元件（無 hooks），
 * 可在 Server Component（loading.tsx）直接使用。
 */

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/10 ${className}`}
      aria-hidden
    />
  );
}

/** 單張卡片骨架（活動卡 / 訓練卡 / 通用卡片） */
export function CardSkeleton() {
  return (
    <div className="card-dark overflow-hidden">
      <Shimmer className="h-40 w-full rounded-none" />
      <div className="space-y-3 p-6">
        <Shimmer className="h-5 w-2/3" />
        <Shimmer className="h-4 w-full" />
        <Shimmer className="h-4 w-5/6" />
        <Shimmer className="h-9 w-32 rounded-full" />
      </div>
    </div>
  );
}

/** 卡片網格骨架（n 張，預設 6） */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** 清單骨架（橫條） */
export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="card-dark flex items-center gap-4 p-4"
        >
          <Shimmer className="h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-4 w-1/3" />
            <Shimmer className="h-3 w-1/2" />
          </div>
          <Shimmer className="h-8 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** 表格骨架（後台列表：頭 + n 列） */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card-dark overflow-hidden">
      <div className="flex gap-4 border-b border-ink-line p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Shimmer key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-ink-line p-4 last:border-0"
        >
          {Array.from({ length: 5 }).map((_, c) => (
            <Shimmer key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 首頁 Hero + 區塊 骨架 */
export function HeroSkeleton() {
  return (
    <div className="relative overflow-hidden border-b border-ink-line pb-20 pt-32 md:pb-28 md:pt-40">
      <Shimmer className="absolute inset-0" />
      <div className="container-msw relative grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-5">
          <Shimmer className="h-4 w-40" />
          <Shimmer className="h-14 w-3/4" />
          <Shimmer className="h-5 w-full" />
          <Shimmer className="h-5 w-2/3" />
          <div className="flex gap-4 pt-4">
            <Shimmer className="h-11 w-40 rounded-full" />
            <Shimmer className="h-11 w-32 rounded-full" />
          </div>
        </div>
        <Shimmer className="hidden h-80 w-full rounded-2xl lg:block" />
      </div>
    </div>
  );
}

/** 首頁區塊標題 + 卡片列骨架 */
export function SectionSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="container-msw py-20">
      <Shimmer className="h-4 w-32" />
      <Shimmer className="mt-4 h-9 w-64" />
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** 表單骨架（上傳 / 設定頁） */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="card-dark space-y-5 p-7">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-11 w-full rounded-xl" />
        </div>
      ))}
      <Shimmer className="h-11 w-full rounded-full" />
    </div>
  );
}
