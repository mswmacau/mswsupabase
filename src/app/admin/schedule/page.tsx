import { ScheduleManager } from "./ScheduleManager";
import { currentMacauMonth, nowMillis } from "./format";

/**
 * /admin/schedule — 月班表管理
 *
 * 這一頁的資料全部由 client 端向 /api/admin/training/* 取（含權限檢查），
 * 這裡只放外殼，並把兩件「不能等 client render 才算」的東西算好傳下去：
 *   · 初始月份 —— 用澳門時區算，避免 SSR（UTC）與 client 得到不同月份
 *   · 現在時間 —— 給發布狀態徽章判斷「已排定 / 生效中」，避免 hydration 文字不一致
 *
 * Owner：方砚（frontend-engineer）
 * 契約：commit 51b2682（months / sessions / classes 三支 route）
 */
export const metadata = { title: "月班表" };
export const dynamic = "force-dynamic";

export default function AdminSchedulePage() {
  return (
    <ScheduleManager
      initialMonth={currentMacauMonth()}
      initialNowMs={nowMillis()}
    />
  );
}
