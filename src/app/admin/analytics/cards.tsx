/**
 * src/app/admin/analytics/cards.tsx — 三張明細表的 <768px 卡片版型
 *
 * 為什麼要卡片：三張表在 390 寬下分別是 760 / 560 / 560 px，塞在 300px 的容器裏
 * （實測「訓練場次出席」有 460px 內容要橫向捲才看得到，而且沒有任何滑動提示）。
 * 站主鐵律以手機為先，所以手機改卡片列表（同 /admin/members、/admin/audit-log
 * 已驗證的做法），桌面繼續用原本的表格。
 *
 * 紀律：
 *  - 欄位一個都不能少：表格有幾欄，卡片就有幾個數字（欄名沿用表頭原文，不改文案）；
 *  - 不新增任何計算口徑，只做排版；
 *  - 純展示、無 state，維持 server component（不進 client bundle）。
 */

import { fmtDwell, fmtPct } from "./charts";
import type {
  EventRegistrationRow,
  PagePathRow,
  SessionAttendanceRow,
} from "./types";

/** 卡片裏「欄名 + 數字」的一格 */
function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-tight text-white/55">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/* =============================================================
 * 一、訓練場次出席（表頭：日期／名稱／名額／報名／出席／出席率／名額用量）
 * ============================================================= */

export function SessionCards({ rows }: { rows: SessionAttendanceRow[] }) {
  return (
    <ul data-card-list="session" className="space-y-2 md:hidden">
      {rows.map((s) => (
        <li key={s.session_id} className="rounded-xl border border-ink-line p-3.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs tabular-nums text-white/60">
                {s.session_date}
              </div>
              <div className="mt-0.5 break-words text-sm font-semibold">{s.title}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-lg font-black tabular-nums">
                {fmtPct(s.attendance_rate)}
              </div>
              <div className="text-[11px] text-white/50">出席率</div>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-white/[0.03] px-2 py-2 text-center">
            <Cell label="名額" value={s.capacity} />
            <Cell label="報名" value={s.registered} />
            <Cell label="出席" value={s.attended} />
            <Cell label="名額用量" value={fmtPct(s.capacity_usage)} />
          </dl>
        </li>
      ))}
    </ul>
  );
}

/* =============================================================
 * 二、活動報名（表頭：活動／日期／站內報名）
 * ============================================================= */

/** 非上架狀態的後綴標註（與表格同一套字） */
function eventStatusSuffix(status: string): string {
  if (status === "archived") return "（已下架）";
  if (status === "draft") return "（草稿）";
  return "";
}

export function EventRegistrationCards({ rows }: { rows: EventRegistrationRow[] }) {
  return (
    <ul data-card-list="event" className="space-y-2 md:hidden">
      {rows.map((r) => (
        <li key={r.event_id} className="rounded-xl border border-ink-line p-3.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-semibold">
                {r.title}
                {eventStatusSuffix(r.status) && (
                  <span className="ml-1 text-xs font-normal text-white/50">
                    {eventStatusSuffix(r.status)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 font-mono text-xs tabular-nums text-white/60">
                {r.event_date}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-lg font-black tabular-nums">{r.registered}</div>
              <div className="text-[11px] text-white/50">站內報名</div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* =============================================================
 * 三、頁面流量（表頭：頁面／瀏覽量／估算到訪／平均停留）
 * ============================================================= */

export function PagePathCards({ rows }: { rows: PagePathRow[] }) {
  return (
    <ul data-card-list="path" className="space-y-2 md:hidden">
      {rows.map((p) => (
        <li key={p.path} className="rounded-xl border border-ink-line p-3.5">
          <div className="break-all text-sm font-semibold">{p.path}</div>
          <dl className="mt-2 grid grid-cols-3 gap-1 text-center">
            <Cell label="瀏覽量" value={p.views} />
            <Cell label="估算到訪" value={p.sessions} />
            <Cell label="平均停留" value={fmtDwell(p.avg_dwell_ms)} />
          </dl>
        </li>
      ))}
    </ul>
  );
}
