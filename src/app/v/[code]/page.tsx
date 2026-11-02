import type { Metadata } from "next";
import VerifyPanel from "./VerifyPanel";

/**
 * 公開核銷頁（全站唯一免登入頁）
 *
 * 紅線：
 *  1. 本頁不查 DB —— lookup 交由 client 元件用 anon key 打 RPC，
 *     避免伺服器端多一次連線，也避免 DB 慢／掛掉時整頁 500。
 *  2. 不屬於 /dashboard、/admin，proxy.ts 的 matcher 天然不覆蓋它，勿改 proxy。
 *  3. 禁止被搜尋引擎索引（券碼等同半把鑰匙）。
 */
export const metadata: Metadata = {
  title: "禮品核銷",
  robots: { index: false, follow: false, nocache: true },
};

export default async function MerchantVerifyPage({
  params,
}: {
  // Next 16：params 是 Promise
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <div
      data-msw-verify
      className="mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col px-5 pb-10 pt-6"
    >
      <p className="mb-6 flex items-center gap-2 text-base font-bold tracking-wide text-white/75">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-vital-bright"
        />
        MSW 街健館 · 禮品核銷
      </p>

      <VerifyPanel code={code} />

      <p className="mt-auto pt-8 text-center text-sm leading-relaxed text-white/45">
        此頁只供 MSW 合作商戶核銷用。
      </p>
    </div>
  );
}
