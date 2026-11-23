import { MovedNotice } from "../_components/MovedNotice";
import { MonthlyPanel, resolveMonth } from "./MonthlyPanel";
import { getAdminAccess } from "@/app/admin/_components/adminAccess";
import { AdminDeniedCard } from "@/app/admin/_components/AdminDeniedCard";
import { MODULE_LABELS, canView } from "@/components/adminModules";

export const metadata = { title: "月度名單 / 發券" };
export const dynamic = "force-dynamic";

/**
 * /admin/monthly — 月度達標名單與發券
 *
 * 【IA 第二階段 20261114】已整合到 `/admin/points?tab=monthly`。
 * 本路由**保留**（可能有人 bookmark，且 `?m=YYYY-MM` 常被貼在群組裡），
 * 內容照常可用，頂部加導引橫幅。名單與里程表本體抽到 `./MonthlyPanel`，
 * 與合併頁共用同一份（含 `?m=` 的月份處理）。
 */
export default async function AdminMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  /* 舊路由保留（頂部有「已搬家」橫幅），但仍會渲染真實資料，
     所以必須先守衛再取數：none → 拒訪卡，連橫幅都不顯示。 */
  const access = await getAdminAccess();
  if (!canView(access, "points")) {
    return <AdminDeniedCard moduleLabel={MODULE_LABELS.points} />;
  }

  const { m } = await searchParams;
  const month = resolveMonth(m);

  return (
    <div className="min-w-0 space-y-6">
      <MovedNotice
        title="月度達標已整合到「積分與發券」"
        href={`/admin/points?tab=monthly&m=${month}`}
        ctaLabel="去積分與發券"
      >
        規則、補發獎勵、月度達標、優惠券現在是同一頁的四個分頁。這一頁仍可直接使用，
        選了月份也會一併帶過去。
      </MovedNotice>

      <div>
        <h2 className="text-xl font-bold">月度達標名單與發券</h2>
      </div>

      <MonthlyPanel month={month} />
    </div>
  );
}
