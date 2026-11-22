import { ShieldAlert } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ResultsReview } from "@/components/hyrox/ResultsReview";

/**
 * /admin/review?tab=hyrox-results — 待審核中心的「完賽成績」分頁（F-05）
 *
 * Server 殼：只負責「未連接資料庫」降級；名單與核可／拒絕互動在
 * ResultsReview（client）——GET /api/admin/hyrox/results 的名單含
 * signed URL（私有桶），不適合整包 SSR 進 HTML。
 *
 * 空狀態降級（§1.5-⑥）：migration 未跑時 API 回 400 SCHEMA_OUTDATED，
 * client 顯示「目前沒有待審核的完賽成績。」的空名單，不 500。
 */
export default function HyroxResultsTab() {
  if (!isSupabaseConfigured) {
    return (
      <div className="card-dark p-6">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          <ShieldAlert size={14} /> 未連接資料庫
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          尚未設定 Supabase 環境變數，暫時無法讀取完賽成績。
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm leading-relaxed text-white/70">
        核對完賽截圖與成績；核可後即時上榜（完賽排行榜 60 秒內更新）。
        拒絕要填原因，會員會看到。
      </p>
      <ResultsReview />
    </div>
  );
}
