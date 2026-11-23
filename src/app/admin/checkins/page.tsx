import { getPendingCheckins } from "@/lib/queries";
import { CheckinCard } from "../_components/CheckinCard";
import { MovedNotice } from "../_components/MovedNotice";
import { formatDate } from "@/lib/utils";
import { RULES } from "@/lib/config";
import { getAdminAccess } from "@/app/admin/_components/adminAccess";
import { AdminDeniedCard } from "@/app/admin/_components/AdminDeniedCard";
import { MODULE_LABELS, canView } from "@/components/adminModules";

export const metadata = { title: "簽到確認" };
export const dynamic = "force-dynamic";

/**
 * /admin/checkins — 訓練簽到確認
 *
 * 【IA 第二階段 20261114】已整合到 `/admin/review?tab=checkins`。
 * 本路由**保留**（可能有人 bookmark），內容照常可用，頂部加導引橫幅。
 * 卡片 JSX 抽到 `../_components/CheckinCard`，與待審核中心共用。
 */
export default async function AdminCheckinsPage() {
  /* 舊路由保留（頂部有「已搬家」橫幅），但仍會渲染真實資料，
     所以必須先守衛再取數：none → 拒訪卡，連橫幅都不顯示。 */
  const access = await getAdminAccess();
  if (!canView(access, "review")) {
    return <AdminDeniedCard moduleLabel={MODULE_LABELS.review} />;
  }

  const items = await getPendingCheckins();

  return (
    <div>
      <div className="mb-6">
        <MovedNotice
          title="簽到確認已整合到「待審核」"
          href="/admin/review?tab=checkins"
          ctaLabel="去待審核中心"
        >
          跑步、簽到、兌換、HYROX 付款四個入口合成一頁，一次看完今天有什麼等你按。
          這一頁仍可直接使用。
        </MovedNotice>
      </div>

      <h2 className="text-xl font-bold">訓練簽到確認</h2>
      <p className="mt-2 text-sm text-white/70">
        確認後會員立即獲得 {RULES.CHECKIN_POINTS} 積分。
      </p>

      <div className="mt-6 space-y-3">
        {items.length ? (
          items.map((c) => <CheckinCard key={c.id} checkin={c} />)
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center text-sm text-white/70">
            目前沒有待確認的簽到。
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-white/60">
        提示：訓練日期 {formatDate(new Date().toISOString())} 起算，會員報名後會出現在這裡。
      </p>
    </div>
  );
}
