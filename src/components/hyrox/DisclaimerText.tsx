/**
 * src/components/hyrox/DisclaimerText.tsx — 免責聲明全文（凍結文案渲染）
 *
 * 文字來源只有一個：shared.ts 的 DISCLAIMER_INTRO / DISCLAIMER_CLAUSES。
 * 本檔只負責排版，不得在此改寫任何字（連標點都不行）。
 */

import { DISCLAIMER_CLAUSES, DISCLAIMER_INTRO } from "./shared";

export function DisclaimerText({ className = "" }: { className?: string }) {
  return (
    <div className={`min-w-0 space-y-3 ${className}`}>
      <p className="break-words text-sm leading-relaxed text-white/80">
        {DISCLAIMER_INTRO}
      </p>
      {DISCLAIMER_CLAUSES.map((clause) => (
        // 條文本身已自帶「1. 」編號，這裡刻意不用 <ol> 以免編號重複
        <p
          key={clause.slice(0, 12)}
          className="break-words text-sm leading-relaxed text-white/75"
        >
          {clause}
        </p>
      ))}
    </div>
  );
}
