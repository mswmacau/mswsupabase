import Link from "next/link";
import { ArrowRight, ListOrdered } from "lucide-react";
import { ScheduleManager } from "./ScheduleManager";
import { currentMacauMonth, nowMillis } from "./format";

/**
 * /admin/schedule — 班表管理（排課唯一入口）
 *
 * 這一頁的資料全部由 client 端向 /api/admin/training/* 取（含權限檢查），
 * 這裡只放外殼，並把兩件「不能等 client render 才算」的東西算好傳下去：
 *   · 初始月份 —— 用澳門時區算，避免 SSR（UTC）與 client 得到不同月份
 *   · 現在時間 —— 給發布狀態徽章判斷「已排定 / 生效中」，避免 hydration 文字不一致
 *
 * 【IA 第二階段 20261114】側欄的「訓練場次」入口已下架（該頁第一階段改唯讀），
 * 但 `/admin/sessions` 的**全量唯讀清單仍然有用**（一次看 60 場、含已過場次），
 * 所以在這裡留一個明確入口，避免「合併後某個功能找不到」。
 *
 * Owner：方砚（frontend-engineer）
 * 契約：commit 51b2682（months / sessions / classes 三支 route）
 */
export const metadata = { title: "班表" };
export const dynamic = "force-dynamic";

export default function AdminSchedulePage() {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-xs text-white/55">
          排課、改時間、改場地、刪場次、發布月份都在這一頁。
        </p>
        <Link
          href="/admin/sessions"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white/75 transition hover:border-white/40 hover:text-white"
        >
          <ListOrdered size={15} aria-hidden />
          全量清單（唯讀）
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
      <ScheduleManager
        initialMonth={currentMacauMonth()}
        initialNowMs={nowMillis()}
      />
    </div>
  );
}
