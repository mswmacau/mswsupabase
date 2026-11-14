import { MovedNotice } from "../_components/MovedNotice";
import { SectionTabNav } from "../_components/SectionTabNav";
import { RedemptionsView } from "./RedemptionsView";
import { loadRedemptions, REDEMPTION_STATUSES, type RedemptionStatus } from "./query";
import { MerchantsManager } from "../merchants/MerchantsManager";
import { loadMerchants } from "../merchants/query";

export const metadata = { title: "兌換與商戶" };
export const dynamic = "force-dynamic";

/**
 * /admin/redemptions — 兌換與商戶（IA 第二階段：兩個分頁）
 *
 * 分頁：
 *   1. 兌換紀錄（?status=／?q= 由伺服器取數，操作一律打 /api/admin/redemptions）
 *   2. 商戶 PIN（吸收 /admin/merchants）
 *
 * 為什麼合併：兩者是同一件事的兩端——管理員在這裡審批／核銷券，
 * 商戶在那裡用 PIN 核銷同一批券。原本分兩個一級入口，客戶要改一個店員 PIN
 * 得先想「這是商城還是系統」。
 *
 * 舊路由 `/admin/merchants` **保留**（可能有人 bookmark），頂部有導引橫幅。
 *
 * 分頁切換用整頁導覽（Link → 伺服器重繪），不是 client state：商戶分頁要讀
 * 另一份資料，且 PIN 對話框「只顯示一次」的行為不能被分頁卸載影響
 * （`MerchantsManager` 是 client component，重新進入分頁就是全新狀態，
 * 不會殘留上一次的明碼 PIN）。
 */
export default async function AdminRedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "merchants" ? "merchants" : "records";
  const status = (REDEMPTION_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as RedemptionStatus)
    : "all";
  const q = (params.q ?? "").trim().slice(0, 60);

  // counts 一律要（分頁徽章要用），紀錄列只有 records 分頁才需要
  const redemptions = await loadRedemptions({ status, q });
  const merchants = tab === "merchants" ? await loadMerchants() : null;

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-bold">兌換與商戶</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          審批新會員的兌換申請、替現場券做後備核銷，以及產生核銷商戶的 PIN。
          拒絕或取消都會退回積分並回補庫存，操作前請先確認券碼與會員。
        </p>
      </div>

      <SectionTabNav
        label="兌換與商戶分類"
        active={tab}
        items={[
          {
            key: "records",
            label: "兌換紀錄",
            href: "/admin/redemptions",
            count: redemptions.loadError ? null : redemptions.counts.pending_approval,
          },
          { key: "merchants", label: "商戶 PIN", href: "/admin/redemptions?tab=merchants" },
        ]}
      />

      {tab === "records" ? (
        <>
          {redemptions.loadError ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              {redemptions.notConfigured
                ? "尚未連接 Supabase，暫時無法讀取兌換紀錄。"
                : "兌換紀錄暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。"}
            </div>
          ) : (
            <>
              <MovedNotice
                compact
                title="待審批的兌換申請也可在「待審核」一次看完"
                href="/admin/review?tab=redemptions"
                ctaLabel="去待審核中心"
              />
              <RedemptionsView
                key={`${status}:${q}`}
                rows={redemptions.rows}
                counts={redemptions.counts}
                status={status}
                q={q}
              />
            </>
          )}
        </>
      ) : (
        <>
          {merchants?.loadError ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              {merchants.notConfigured
                ? "尚未連接 Supabase，暫時無法讀取商戶資料。"
                : "商戶資料暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。"}
            </div>
          ) : merchants ? (
            <>
              <p className="text-sm leading-relaxed text-white/70">
                核銷商戶與其 6 位 PIN。PIN 只儲存加密雜湊，產生時顯示一次——
                請即場抄下或列印 PIN 卡交給店員，遺失只能重設。
              </p>
              <MerchantsManager initialMerchants={merchants.merchants} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
