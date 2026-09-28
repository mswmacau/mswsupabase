/**
 * F-R2 路線圖（Brief §2.4）
 *
 * 0 → goal 一條路線，白點標示目前位置（left: km / goal × 100%），終點旗。
 * 數字全部由 props 傳入（monthData.km + RULES.MONTHLY_GOAL_KM），
 * server component，唔使 JS 都睇得到。
 */

import { Flag } from "lucide-react";
import { formatKm } from "@/lib/utils";

export function GoalRoute({ km, goal }: { km: number; goal: number }) {
  const safeKm = Number.isFinite(km) ? Math.max(0, km) : 0;
  const pct = goal > 0 ? Math.min(100, (safeKm / goal) * 100) : 0;

  return (
    <div className="mt-8">
      <div className="relative py-6">
        {/* 軌道：重用既有 meter / meter-fill token */}
        <div className="meter absolute inset-x-0 top-1/2 -translate-y-1/2">
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>

        {/* 目前位置：白點 */}
        <span
          aria-hidden
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-white bg-vital-bright"
          style={{ left: `${pct}%` }}
        />

        {/* 終點旗 */}
        <span aria-hidden className="absolute right-0 top-1/2 -translate-y-1/2 text-vital-bright">
          <Flag size={16} />
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="stat-figure text-sm text-white/45">0 km</span>
        <span className="stat-figure text-sm text-white/70">{goal} km</span>
      </div>

      {/* 進度數字畀螢幕閱讀器；一般視覺上面由路線位置表達 */}
      <span className="sr-only">
        目前 {formatKm(safeKm)} km，目標 {goal} km
      </span>
    </div>
  );
}
