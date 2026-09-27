export function ProgressBar({
  value,
  max,
  label,
  hint,
}: {
  value: number;
  max: number;
  label?: string;
  hint?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const done = max > 0 && value >= max;

  return (
    <div>
      {(label || hint) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label && <span className="text-sm font-semibold">{label}</span>}
          {hint && <span className="text-xs text-white/70">{hint}</span>}
        </div>
      )}
      {/* 進度軌：去膠囊化，2px 細軌 + 斜切填充（設計系統 .meter / .meter-fill） */}
      <div className="meter h-1.5 w-full">
        <div
          className={`meter-fill ${done ? "bg-emerald-400" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
