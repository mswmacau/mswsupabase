import Link from "next/link";
import { ArrowRight, Gift } from "lucide-react";

/** rewards_enabled=false 的整頁狀態：不留空白，也不假裝有東西可換 */
export function RewardsComingSoon() {
  return (
    <div className="clip-notch-br mt-12 border border-dashed border-white/20 px-6 py-16 text-center md:py-20">
      <span className="mx-auto flex h-14 w-14 items-center justify-center border border-[var(--line-fine)] text-vital-bright">
        <Gift size={26} />
      </span>
      <h2 className="mt-6 text-2xl font-black tracking-tight text-white">即將推出</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/70">
        禮品換領正在準備中，暫未開放兌換。你的積分會繼續累積，開放後可即時使用。
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard/points" className="btn-base btn-ghost btn-slab min-h-11">
          看積分明細
        </Link>
        <Link href="/run" className="btn-base btn-vital btn-slab min-h-11">
          去跑步賺分 <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
