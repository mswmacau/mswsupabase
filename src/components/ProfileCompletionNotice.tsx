import Link from "next/link";
import { IdCard } from "lucide-react";

/**
 * 既有會員的資料補填提示（輕量）。
 *
 * 刻意做成「一條提示條」而非彈窗：不擋操作、不中斷瀏覽，
 * 使用者要不要現在補都由自己決定。顯示與否由呼叫端（頁面）判斷，
 * 本元件只負責畫面，避免把資料判斷邏輯散進 UI。
 */
export function ProfileCompletionNotice({
  href = "/complete-profile?next=/dashboard",
}: {
  href?: string;
}) {
  return (
    <div className="slab mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border border-cobalt/40 bg-cobalt/10 px-4 py-3">
      <p className="flex min-w-0 items-start gap-2 text-sm leading-relaxed text-blue-100">
        <IdCard size={17} className="mt-0.5 shrink-0 text-accent-blue" />
        <span>補齊個人資料，報名活動時就不用再填</span>
      </p>
      <Link
        href={href}
        className="shrink-0 text-sm font-semibold text-accent-blue underline-offset-4 transition hover:text-white hover:underline"
      >
        去補填
      </Link>
    </div>
  );
}
