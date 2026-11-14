import { MovedNotice } from "../_components/MovedNotice";
import { MerchantsManager } from "./MerchantsManager";
import { loadMerchants } from "./query";

export const metadata = { title: "商戶管理" };
export const dynamic = "force-dynamic";

/**
 * /admin/merchants — 核銷商戶與 PIN
 *
 * 【IA 第二階段 20261114】已整合到 `/admin/redemptions?tab=merchants`。
 * 本路由**保留**（可能有人 bookmark；店員 PIN 這種東西常常是「別人貼了連結」），
 * 內容照常可用，頂部加一條導引橫幅。
 *
 * 取數抽到 `./query`：合併頁與這頁必須用同一條「pin_hash 只留布林值」的規則，
 * 否則明碼雜湊有機會跟著 row 一起被序列化到 client component 的 props。
 * pin_hash 不會離開資料庫；產生／重設 PIN 由 /api/admin/merchants 呼叫
 * DB 函式（明文只回一次）。
 */
export default async function AdminMerchantsPage() {
  const { merchants, loadError, notConfigured } = await loadMerchants();

  return (
    <div className="min-w-0 space-y-6">
      <MovedNotice
        title="商戶管理已整合到「兌換與商戶」"
        href="/admin/redemptions?tab=merchants"
        ctaLabel="去兌換與商戶"
      >
        兌換紀錄與商戶 PIN 現在是同一頁的兩個分頁——管理員審批券、店員用 PIN 核銷，
        本來就是同一件事。這一頁仍可直接使用。
      </MovedNotice>

      <div>
        <h2 className="text-xl font-bold">商戶管理</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          核銷商戶與其 6 位 PIN。PIN 只儲存加密雜湊，產生時顯示一次——
          請即場抄下或列印 PIN 卡交給店員，遺失只能重設。
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {notConfigured
            ? "尚未連接 Supabase，暫時無法讀取商戶資料。"
            : "商戶資料暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。"}
        </div>
      ) : (
        <MerchantsManager initialMerchants={merchants} />
      )}
    </div>
  );
}
