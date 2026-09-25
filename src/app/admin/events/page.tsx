import { getAdminEvents } from "@/lib/queries";
import { EventManager } from "./EventManager";

export const metadata = { title: "活動管理" };
export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  // 一次取回全部（含 archived），由 EventManager 在客戶端切換「已下架」篩選
  const events = await getAdminEvents(true);
  return <EventManager events={events} />;
}
