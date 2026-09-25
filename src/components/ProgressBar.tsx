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
          {hint && <span className="text-xs text-white/45">{hint}</span>}
        </div>
      )}
      <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            done
              ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
              : "bg-gradient-to-r from-cobalt to-vital"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
