import { Lock } from "lucide-react";

/**
 * src/app/admin/_components/ReadOnlyNotice.tsx — 唯讀模組的頂部提示
 *
 * 文案由 team-lead 指定：「你目前是唯讀權限，可查看但不能修改。」
 * 刻意做得「清楚但唔搶眼」：不搶紅色、不用 role="alert"，
 * 因為這不是錯誤，而是這個帳號的長期狀態（唯讀管理員每天都會看到它）。
 */
export function ReadOnlyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
      <Lock size={16} className="mt-0.5 shrink-0 text-white/45" aria-hidden />
      <p className="min-w-0 break-words">
        你目前是唯讀權限，可查看但不能修改。
      </p>
    </div>
  );
}
