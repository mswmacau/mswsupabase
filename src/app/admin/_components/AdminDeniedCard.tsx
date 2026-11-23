import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

/**
 * src/app/admin/_components/AdminDeniedCard.tsx — 「沒有這個項目的權限」卡
 *
 * 什麼時候用：第二級管理員直接打 /admin/analytics、/admin/content、
 * /admin/site-settings、/admin/audit-log 這些 none 模組的 URL。
 *
 * 為什麼是每個頁面自己 early return，而不是在 layout 用 client 守衛：
 *   · client 守衛要等 hydration 才生效 → 會先閃一下受限內容（真正的權限漏洞感）
 *   · server 端 early return 連資料都不會查，畫面直接就是這張卡
 * 代價是 4 個頁面各一行，換來「零閃現」，值得。
 *
 * 文案：站主／team-lead 指定「你沒有這個項目的權限。」＋「返回後台」。
 */
export function AdminDeniedCard({ moduleLabel }: { moduleLabel?: string }) {
  return (
    <div className="card-dark px-5 py-12 text-center md:px-8 md:py-16">
      <Lock size={30} className="mx-auto text-white/35" aria-hidden />
      <p className="mt-4 text-base font-bold text-white">
        你沒有這個項目的權限。
      </p>
      {moduleLabel ? (
        <p className="mt-1 text-xs text-white/50">（{moduleLabel}）</p>
      ) : null}
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/60">
        如需查看或操作，請聯絡第一級管理員調整你的權限。
      </p>
      <Link
        href="/admin"
        className="btn-base btn-ghost btn-slab mt-6 inline-flex min-h-11 items-center gap-2"
      >
        <ArrowLeft size={16} /> 返回後台
      </Link>
    </div>
  );
}
