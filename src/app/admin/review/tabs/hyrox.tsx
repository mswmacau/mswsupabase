import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getHyroxEvents } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { PaymentReview } from "../../hyrox/PaymentReview";

/**
 * /admin/review?tab=hyrox — 待審核中心的「HYROX 付款」分頁（Server Component）
 *
 * 重用：`PaymentReview`（與 /admin/hyrox 同一支 client component）。
 *  - 名單：`GET /api/admin/hyrox/registrations?event_id=…`
 *  - 動作：`POST /api/admin/hyrox/review`（確認收款／拒絕並寫原因）
 * 確認收款的發分（後端讀設定值）與「已拒絕等會員重交」的行為完全沒動。
 *
 * 這一頁只做「付款審核」。場次的建立、費用、名額、收款碼上傳仍在
 * 「活動 → HYROX」分頁（`/admin/events?tab=hyrox`），本頁底部有指路。
 *
 * 為什麼要選場次才能看名單：後端那支 GET 需要 event_id（一次回一場，
 * 避免一次拉幾百筆含個資的列）。PaymentReview 自己處理選場與 seq 守衛。
 */
export default async function HyroxTab() {
  if (!isSupabaseConfigured) {
    return (
      <div className="card-dark p-6">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          <ShieldAlert size={14} /> 未連接資料庫
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          尚未設定 Supabase 環境變數，暫時無法讀取 HYROX 報名與付款資料。
        </p>
      </div>
    );
  }

  const events = await getHyroxEvents({ includeArchived: true });

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm leading-relaxed text-white/70">
        選一場次，看該場的轉帳證明並確認收款（會依設定值發放積分）。
        已完成確認的報名不再列出。
      </p>

      <PaymentReview events={events} />

      <p className="text-xs text-white/50">
        要建立場次、改費用／名額、上傳收款碼：
        <Link
          href="/admin/events?tab=hyrox"
          className="ml-1 font-semibold text-white/80 underline underline-offset-2 hover:text-white"
        >
          活動 → HYROX
        </Link>
      </p>
    </div>
  );
}
