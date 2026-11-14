import Link from "next/link";
import { RedemptionsView } from "../../redemptions/RedemptionsView";
import { loadRedemptions } from "../../redemptions/query";

/**
 * /admin/review?tab=redemptions — 待審核中心的「兌換」分頁（Server Component）
 *
 * 只列 status = pending_approval（也就是「今天等我批准」的那幾筆）。
 *
 * 重用而不是重寫：
 *  - 資料 → `loadRedemptions`（與 /admin/redemptions 同一支查詢）
 *  - 畫面與動作 → `RedemptionsView`（同一支 client component）
 *    approve / reject → `POST /api/admin/redemptions`（action:"review"）
 *    拒絕的二次確認對話框、退分與回庫存的 DB 函式，全部沿用，文案一字未改。
 *  - `hideFilters`：這裡的資料範圍由伺服器限定在待審批，狀態頁籤與搜尋
 *    按了也沒意義，所以隱藏；完整篩選請走 /admin/redemptions。
 */
export default async function RedemptionsTab() {
  const { rows, counts, loadError, notConfigured } = await loadRedemptions({
    status: "pending_approval",
    q: "",
  });

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
      >
        {notConfigured
          ? "尚未連接 Supabase，暫時無法讀取兌換申請。"
          : "兌換申請暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。"}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-white/70">
          只列「待審批」的兌換申請。批准後轉為待領取；拒絕會退回積分並回補庫存。
        </p>
        <p className="shrink-0 text-xs text-white/60">待審批 {counts.pending_approval} 筆</p>
      </div>

      <RedemptionsView
        rows={rows}
        counts={counts}
        status="pending_approval"
        q=""
        hideFilters
      />

      <p className="text-xs text-white/50">
        要看待領取／已完成／已取消，或搜尋特定券碼：
        <Link
          href="/admin/redemptions"
          className="ml-1 font-semibold text-white/80 underline underline-offset-2 hover:text-white"
        >
          兌換與商戶（完整紀錄）
        </Link>
      </p>
    </div>
  );
}
