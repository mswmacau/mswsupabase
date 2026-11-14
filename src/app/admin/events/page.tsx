import { getAdminEvents, getHyroxEvents } from "@/lib/queries";
import { SectionTabs } from "../_components/SectionTabs";
import { EventManager } from "./EventManager";
import { HyroxAdmin } from "../hyrox/HyroxAdmin";

export const metadata = { title: "活動管理" };
export const dynamic = "force-dynamic";

/**
 * /admin/events — 活動管理（兩個分頁：一般活動 / HYROX 場次）
 *
 * IA 第二階段：HYROX 場次（原 `/admin/hyrox`）併入本頁第二個分頁。
 * 兩者寫同一張 `events` 表（HYROX 只是 `series='hyrox'` 的子集），
 * 卻有兩套表單——同一筆資料兩個入口、兩種編輯方式，等於隨時可能互相蓋掉語意。
 *
 * 合併方式刻意保守：**兩個元件並存**，依分頁渲染不同表單。
 *   - 一般活動：`EventManager`（欄位不動）
 *   - HYROX：`HyroxAdmin`（費用、名額、收款碼、付款審核入口，欄位不動）
 * 不做「一份通用表單」——那要改欄位與 API，是這階段最不該碰的東西。
 *
 * 付款審核另外收在 `/admin/review?tab=hyrox`（每天要按的事集中在一頁）。
 * 舊路由 `/admin/hyrox` 保留並有導引橫幅。
 */
export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = tab === "hyrox" ? "hyrox" : "events";

  if (active === "hyrox") {
    // includeArchived：後台要看全部狀態（draft / published / archived）；
    // 走不快取路徑，剛存的草稿立即看得到。
    const events = await getHyroxEvents({ includeArchived: true });
    return (
      <div className="min-w-0 space-y-5">
        <SectionTabs active="hyrox" />
        <HyroxAdmin initialEvents={events} />
      </div>
    );
  }

  // 一次取回全部（含 archived），由 EventManager 在客戶端切換「已下架」篩選
  const events = await getAdminEvents(true);
  return (
    <div className="min-w-0 space-y-5">
      <SectionTabs active="events" />
      <EventManager events={events} />
    </div>
  );
}
