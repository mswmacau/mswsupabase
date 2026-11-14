import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";

/**
 * src/app/admin/_components/MovedNotice.tsx — 「這一頁已整合到 X」導引橫幅
 *
 * 第二階段 IA 重整：8 個舊入口在側欄下架，但**路由一條都不刪**
 * （可能有人 bookmark）。舊頁頂部放這條橫幅，內容仍照常呈現，
 * 管理員不會撞到 404，也立刻知道新位置在哪。
 *
 * 為什麼用 cobalt（資訊）而不是 amber（警告）：
 * 這裡沒有故障、沒有錯誤，只是搬家。用警告色會讓人以為系統壞了，
 * 是另一種誤導（同 /admin/sessions 的處理）。
 *
 * 這一頁是 Server Component（只輸出連結），可以在任何舊頁直接 import。
 */
export function MovedNotice({
  title,
  href,
  ctaLabel,
  children,
  compact = false,
}: {
  /** 一句話說明搬到哪，例如「跑步紀錄已整合到『待審核』」 */
  title: string;
  href: string;
  ctaLabel: string;
  /** 補充說明：為什麼合併、舊頁還能做什麼 */
  children?: React.ReactNode;
  /** true = 收成一行（頁面本身還很長時用，避免橫幅吃掉首屏） */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-cobalt/40 bg-cobalt/10 px-4 py-2.5">
        <Info size={15} className="shrink-0 text-sky-300" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-semibold text-sky-100">{title}</p>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cobalt/50 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-cobalt/20"
        >
          {ctaLabel}
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cobalt/40 bg-cobalt/10 px-5 py-4">
      <div className="flex items-start gap-3">
        <Info size={18} className="mt-0.5 shrink-0 text-sky-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-sky-100">{title}</p>
          {children ? (
            <div className="mt-1.5 text-sm leading-relaxed text-sky-100/85">
              {children}
            </div>
          ) : null}
          <Link href={href} className="btn-base btn-cobalt mt-3">
            {ctaLabel}
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
