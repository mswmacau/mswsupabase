/**
 * src/app/races/_components/RaceStatusPill.tsx
 *
 * 賽事狀態標籤。列表頁與詳情頁共用同一份用字，
 * 避免兩邊文案走音（例：一邊「報名中」一邊「開放報名」）。
 */

import type { RaceStatus } from "../_data";

export const RACE_STATUS_LABEL: Record<RaceStatus, string> = {
  open: "報名中",
  closed: "報名已截止",
  photos: "相片已上載",
};

export function RaceStatusPill({ status }: { status: RaceStatus }) {
  const tone =
    status === "open"
      ? "border-vital/60 bg-vital/15 text-vital-bright"
      : "border-white/15 bg-white/5 text-white/60";

  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${tone}`}
    >
      {RACE_STATUS_LABEL[status]}
    </span>
  );
}
