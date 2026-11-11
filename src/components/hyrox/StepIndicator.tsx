/**
 * src/components/hyrox/StepIndicator.tsx — 三步報名指示器（1 資料 → 2 免責 → 3 付款）
 *
 * 目前步以 aria-current="step" 標示，顏色 + 底線雙重提示，
 * 不依賴顏色單一線索。390 寬用 grid 三欄等分，不產生橫向溢出。
 */

const STEP_LABELS = ["確認資料", "免責聲明", "付款"] as const;

export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="報名步驟">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const isCurrent = n === current;
        const isDone = n < current;
        return (
          <li key={label} className="min-w-0">
            <div
              aria-current={isCurrent ? "step" : undefined}
              className={`slab flex min-w-0 items-center gap-2 border px-2.5 py-2 transition-colors ${
                isCurrent
                  ? "border-vital/60 bg-vital/15 text-white"
                  : isDone
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-white/12 bg-white/[0.03] text-white/50"
              }`}
            >
              <span
                className={`stat-figure flex-none text-xs font-bold ${
                  isCurrent ? "text-vital-bright" : ""
                }`}
              >
                {String(n).padStart(2, "0")}
              </span>
              <span className="min-w-0 truncate text-xs font-semibold sm:text-sm">
                {label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
