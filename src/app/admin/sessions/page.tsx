import Link from "next/link";
import { ArrowRight, CalendarRange, Info } from "lucide-react";
import { getAllSessions } from "@/lib/queries";
import { formatDate, todayISO, weekdayLabel } from "@/lib/utils";

export const metadata = { title: "訓練場次（唯讀）" };
export const dynamic = "force-dynamic";

/**
 * /admin/sessions — 訓練場次（唯讀查詢）
 *
 * 【20261114 IA 重整第一階段：本頁已改為唯讀】
 *
 * 為什麼拿掉新增表單：**資訊架構收斂**，不是因為表單壞掉。
 * `/admin/schedule`（月班表）是這一頁的超集——逐場新增／編輯／刪除、按月檢視、
 * 複製上月、一次發布、顏色圖例，全都在那裡。兩個入口並存的結果是管理員
 * 每次要排課都得先猜「該去哪一頁」，而這一頁的表單只能新增、不能改也不能刪，
 * 兩邊寫入同一張表卻只有一邊看得到全貌。
 *
 * 【更正上一位的錯誤記載】先前這段註解寫著「本頁表單 POST 的
 * `/api/admin/sessions` 用 `.upsert(onConflict: "session_date")`，會得到
 * Postgres 42P10，表單一直是壞的」——**這個說法是錯的**。
 * `src/app/api/admin/sessions/route.ts` 早在 commit 71ead3c（2026-11-13）就已
 * 移除 upsert，改成「帶 id → UPDATE、不帶 id → INSERT、唯一鍵衝突自行對映 409」，
 * 全檔沒有 onConflict。表單在移除前的 HEAD 上是可用的。
 * 移除它的理由只有一個：排課入口要收斂到月班表（第一階段只整理，不合併路由）。
 *
 * **路由保留**（第一階段不刪任何路由；合併／301 是第二階段）。
 *
 * 資料來源與權限完全沒變：`getAllSessions()`（src/lib/queries.ts），
 * `/admin/*` 的權限由 src/app/admin/layout.tsx 與 RLS 把關。
 */
export default async function AdminSessionsPage() {
  const sessions = await getAllSessions(60);
  // 一律用澳門時間（src/lib/utils.ts:1-10 的專案紀律）。
  // 原本寫 new Date().toISOString().slice(0,10) 是 UTC，澳門時間 00:00-08:00
  // 會少算一天，「今天起 N 場」跟著錯。
  const today = todayISO();
  const upcoming = sessions.filter((s) => s.session_date >= today).length;

  return (
    <div className="space-y-6">
      {/*
       * 引導橫幅用「資訊」樣式（cobalt）而不是警告樣式（amber）：
       * 這裡沒有故障、沒有錯誤，只是告訴管理員排課搬到哪一頁了。
       * 用警告色會讓管理員以為系統有問題，是另一種誤導。
       */}
      <div className="rounded-xl border border-cobalt/40 bg-cobalt/10 px-5 py-4">
        <div className="flex items-start gap-3">
          <Info size={18} className="mt-0.5 shrink-0 text-sky-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-sky-100">
              排課請到「月班表」：可按月檢視、逐場編輯、複製上月、一次發布
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-sky-100/85">
              本頁保留為查詢用（唯讀）。新增、修改、刪除場次都在月班表，那裡看得到整月班表與顏色圖例。
            </p>
            <Link
              href="/admin/schedule"
              className="btn-base btn-cobalt mt-3"
            >
              <CalendarRange size={17} aria-hidden />
              前往月班表
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold">訓練場次（唯讀查詢）</h2>
          <p className="text-xs text-white/60">
            共 {sessions.length} 場（含已過場次）· 今天起 {upcoming} 場
          </p>
        </div>
        <p className="mt-2 flex items-start gap-2 text-sm text-white/70">
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            此頁僅供查詢。要排課、改時間、改場地或刪除場次，請到
            <Link
              href="/admin/schedule"
              className="ml-1 font-semibold text-white underline underline-offset-2 hover:text-vital-bright"
            >
              月班表
            </Link>
            。
          </span>
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-line">
          {sessions.length ? (
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">
                已排定訓練場次共 {sessions.length} 場，依日期由新到舊
              </caption>
              <thead>
                <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/70">
                  <th scope="col" className="py-3 pl-4 pr-4">日期</th>
                  <th scope="col" className="py-3 pr-4">名稱</th>
                  <th scope="col" className="py-3 pr-4">地點</th>
                  <th scope="col" className="py-3 pr-4">名額</th>
                  <th scope="col" className="py-3 pr-4">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3.5 pl-4 pr-4 font-semibold">
                      {formatDate(s.session_date)}
                      <span className="ml-1 text-xs text-white/70">
                        （週{weekdayLabel(s.session_date)}）
                      </span>
                      {s.session_date < today && (
                        <span className="ml-2 text-xs text-white/60">已過</span>
                      )}
                    </td>
                    <td className="py-3.5 pr-4 text-white/70">{s.title}</td>
                    <td className="py-3.5 pr-4 text-white/75">{s.location}</td>
                    <td className="py-3.5 pr-4 text-white/75">{s.capacity}</td>
                    <td className="py-3.5 pr-4 text-white/75">
                      {s.status === "open" ? "開放報名" : s.status === "closed" ? "已截止" : "已取消"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-white/70">
              目前沒有場次。請到
              <Link
                href="/admin/schedule"
                className="mx-1 font-semibold text-white underline underline-offset-2 hover:text-vital-bright"
              >
                月班表
              </Link>
              建立。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
