import { statusMeta } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span
      className={`slab inline-flex min-h-11 items-center justify-center border px-4 text-xs font-semibold ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
