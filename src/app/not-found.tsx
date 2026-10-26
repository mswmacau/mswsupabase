import Link from "next/link";

export const metadata = { title: "找不到頁面" };

/**
 * 404：取代 Next.js 預設頁。
 * 預設頁會把 "404: This page could not be found." 直接混進版面，
 * 且標題沿用首頁 metadata；這裡改成站內一致的深色版式與中文文案。
 */
export default function NotFound() {
  return (
    <section className="container-msw flex min-h-[60vh] flex-col justify-center py-24">
      <span className="eyebrow">404</span>
      <h1 className="display-xl mt-4">找不到頁面</h1>
      <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/70">
        這頁不存在，或者已經搬走了。
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link href="/" className="btn-base btn-vital">
          回到主頁
        </Link>
        <Link href="/events" className="btn-base btn-ghost btn-slab">
          查看活動
        </Link>
      </div>
    </section>
  );
}
