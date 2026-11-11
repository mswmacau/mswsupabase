/**
 * src/app/admin/hyrox/page.tsx — HYROX 場次管理 ＋ 付款審核（Server 外殼）
 *
 * 取數：getAdminEvents(true)（既有查詢，含 archived），再自行篩 series === 'hyrox'。
 * 權限：已由 src/app/admin/layout.tsx 統一擋（未登入／非管理員都走 redirect）。
 * 寫入：一律經 API 路由，前端不直接改 DB。
 */

import { ShieldAlert } from "lucide-react";
import { getHyroxEvents } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { HyroxAdmin } from "./HyroxAdmin";

export const metadata = { title: "HYROX 管理" };
export const dynamic = "force-dynamic";

export default async function AdminHyroxPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="card-dark p-6">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          <ShieldAlert size={14} /> 未連接資料庫
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          尚未設定 Supabase 環境變數，暫時無法讀取 HYROX 場次。請先完成
          .env.local 設定。
        </p>
      </div>
    );
  }

  // 後台要全部狀態（draft / published / archived）；includeArchived 走不快取路徑，
  // 剛存的草稿立即看得到。統計數字（報名數／待審數）由 GET /api/admin/hyrox/events
  // 在 client 端補上（那支端點一次查回全部場次的統計）。
  const events = await getHyroxEvents({ includeArchived: true });

  return <HyroxAdmin initialEvents={events} />;
}
