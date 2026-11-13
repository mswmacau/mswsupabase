import Link from "next/link";
import { CalendarX2 } from "lucide-react";

/** /hyrox/[id] 找不到場次時顯示（比站內通用 404 更貼題） */
export const metadata = { title: "找不到這個場次" };

export default function HyroxEventNotFound() {
  return (
    <section className="container-msw flex min-h-[60vh] flex-col justify-center py-24">
      <CalendarX2 size={34} className="text-white/30" />
      <h1 className="mt-5 text-2xl font-black tracking-tight">找不到這個場次</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
        這個場次可能已經移除，或者連結有誤。可以去 HYROX 主頁睇下最近有咩場次。
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/hyrox" className="btn-base btn-vital btn-slab min-h-11">
          返回 HYROX
        </Link>
        <Link href="/events" className="btn-base btn-ghost btn-slab min-h-11">
          查看其他活動
        </Link>
      </div>
    </section>
  );
}
