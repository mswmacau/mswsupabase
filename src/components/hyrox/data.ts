/**
 * src/components/hyrox/data.ts — 往期場次與回顧相片的資料入口（server only）
 *
 * ⚠️ 只能在 Server Component 內 import；client 元件請打 /api/admin/hyrox/photos。
 *
 * 後端（白客，51730f7）已落地：
 *   getHyroxPastEvents(): Promise<HyroxPastEvent[]>   // archived + photo_count
 *   getEventPhotos(eventId): Promise<EventPhoto[]>    // sort_order 升冪
 * 這裡只做兩件事：
 *   1) 把「查詢失敗」收斂成空陣列，讓前台走空狀態而不是整頁 500；
 *   2) 提供 loadPastEvent(id) 的單場取法（往期找不到時退回已上架場次，
 *      剛結束但還沒下架的場次也開得起來）。
 *
 * 型別直接轉出後端的（HyroxPastEvent / EventPhoto），不另立一份口徑。
 */

import {
  getEventPhotos,
  getHyroxEventById,
  getHyroxPastEvents,
} from "@/lib/queries";
import type { EventPhoto, HyroxPastEvent } from "@/lib/types";

export type PastEvent = HyroxPastEvent;
export type HyroxPhoto = EventPhoto;

/**
 * 往期場次（公開可讀），後端已按 event_date 降冪排好。
 * 資料表未建／RLS 未放行時回空陣列 → `/hyrox` 的往期區塊整段不顯示。
 */
export async function loadPastEvents(): Promise<PastEvent[]> {
  try {
    return await getHyroxPastEvents();
  } catch {
    return [];
  }
}

/**
 * 依 id 取單場：先找往期清單，找不到再退回「已上架場次」查詢。
 * 都找不到回 null → 上層 notFound()。
 */
export async function loadPastEvent(id: string): Promise<PastEvent | null> {
  const past = await loadPastEvents();
  const hit = past.find((e) => e.id === id);
  if (hit) return hit;

  try {
    const live = await getHyroxEventById(id);
    return live ? { ...live, photo_count: 0 } : null;
  } catch {
    return null;
  }
}

/** 某場次的回顧相片；查詢失敗時回空陣列（上層顯示「相片整理中」空狀態） */
export async function loadEventPhotos(eventId: string): Promise<HyroxPhoto[]> {
  try {
    return await getEventPhotos(eventId);
  } catch {
    return [];
  }
}
