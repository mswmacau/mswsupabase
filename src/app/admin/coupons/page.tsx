import { MovedNotice } from "../_components/MovedNotice";
import { CouponsPanel } from "./CouponsPanel";

export const metadata = { title: "優惠券管理" };
export const dynamic = "force-dynamic";

/**
 * /admin/coupons — 優惠券核銷、手動發券、全部券列表
 *
 * 【IA 第二階段 20261114】已整合到 `/admin/points?tab=coupons`。
 * 本路由**保留**（可能有人 bookmark）；店員／櫃台常用，內容照常可用，
 * 頂部加導引橫幅。三塊內容本體抽到 `./CouponsPanel`，與合併頁共用。
 */
export default function AdminCouponsPage() {
  return (
    <div className="min-w-0 space-y-6">
      <MovedNotice
        title="優惠券已整合到「積分與發券」"
        href="/admin/points?tab=coupons"
        ctaLabel="去積分與發券"
      >
        規則、補發獎勵、月度達標、優惠券現在是同一頁的四個分頁。這一頁仍可直接使用。
      </MovedNotice>

      <div>
        <h2 className="text-xl font-bold">優惠券核銷</h2>
        <p className="mt-2 text-sm text-white/70">
          輸入會員出示的券碼即可標記為已使用。
        </p>
      </div>

      <CouponsPanel />
    </div>
  );
}
