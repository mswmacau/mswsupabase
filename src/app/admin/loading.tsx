/**
 * /admin 的載入骨架（今日工作台）。
 *
 * 為什麼要有文字而不只是灰塊：首頁一次打 6 組查詢，冷啟動＋跨區延遲時
 * 可能超過 3 秒。只有骨架方塊的話管理員會以為頁面壞了，所以骨架之外
 * 再放一行看得見的「正在載入今日工作台…」。
 *
 * 區塊順序刻意與 page.tsx 一致（等你處理 → 場次 → 本月進度），
 * 載入完成時版面不會大幅跳動。
 */
import { CardSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p role="status" className="text-sm text-white/70">
        正在載入今日工作台…
      </p>

      {/* 等你處理：4 張小卡（與 page.tsx 同為 2×2 / 4 欄） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="card-dark h-[88px] animate-pulse bg-white/5"
            aria-hidden
          />
        ))}
      </div>

      {/* 場次清單與本月進度 */}
      <div className="grid gap-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
