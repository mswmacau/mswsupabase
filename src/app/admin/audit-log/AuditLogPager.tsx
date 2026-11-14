import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * src/app/admin/audit-log/AuditLogPager.tsx — 操作紀錄的分頁器（server component）
 *
 * 為什麼是 server component：分頁狀態放在網址（`?page=N`），翻頁就只是一次
 * GET 導覽 —— 不需要 client state、不會有「先渲染舊頁再換頁」的閃動，
 * 上一頁／下一頁在瀏覽器歷史裡天然成立，連結也可以直接貼給別人。
 * 這裡沒有一行 JS。
 *
 * 觸控尺寸：手機（<768px）44px、桌面 36px —— 對齊本專案後台既有標準
 * （見 _audit/admin-p1-fix-measure.mjs 的量測口徑）。
 *
 * 到界時渲染 <span aria-disabled>：不是 disabled 的 <button>，因為
 * disabled 的按鈕仍然會被讀屏念出來、也讓「這裡到底有沒有東西可點」變得模糊；
 * 用 span 讓它徹底不進 tab 順序，視覺上再降透明度。
 */

interface AuditLogPagerProps {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
}

export function AuditLogPager({
  page,
  totalPages,
  pageSize,
  total,
}: AuditLogPagerProps) {
  if (total <= 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  // 手機與桌面共用同一組尺寸語彙，只有高度與內距分岔
  const base =
    "inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-xs font-semibold transition md:min-h-9";
  const enabled = "border-white/25 text-white/80 hover:border-white/60 hover:bg-white/5";
  const disabled = "border-white/10 text-white/30";

  return (
    <nav
      aria-label="操作紀錄分頁"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-line pt-3"
    >
      <p
        role="status"
        aria-live="polite"
        className="text-[11px] leading-relaxed text-white/60 md:text-xs"
      >
        第 {from}–{to} 筆，共 {total} 筆（第 {page} / {totalPages} 頁）
      </p>

      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={`/admin/audit-log?page=${page - 1}`}
            aria-label={`上一頁，第 ${page - 1} 頁`}
            className={`${base} ${enabled}`}
          >
            <ChevronLeft size={14} aria-hidden />
            上一頁
          </Link>
        ) : (
          <span aria-disabled="true" className={`${base} ${disabled}`}>
            <ChevronLeft size={14} aria-hidden />
            上一頁
          </span>
        )}

        {hasNext ? (
          <Link
            href={`/admin/audit-log?page=${page + 1}`}
            aria-label={`下一頁，第 ${page + 1} 頁`}
            className={`${base} ${enabled}`}
          >
            下一頁
            <ChevronRight size={14} aria-hidden />
          </Link>
        ) : (
          <span aria-disabled="true" className={`${base} ${disabled}`}>
            下一頁
            <ChevronRight size={14} aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}
