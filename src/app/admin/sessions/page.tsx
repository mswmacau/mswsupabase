import { SessionForm } from "./SessionForm";
import { getAllSessions } from "@/lib/queries";
import { formatDate, weekdayLabel } from "@/lib/utils";

export const metadata = { title: "訓練場次" };
export const dynamic = "force-dynamic";

export default async function AdminSessionsPage() {
  const sessions = await getAllSessions(60);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">新增訓練場次</h2>
        <p className="mt-2 text-sm text-white/50">
          同一天重複建立會覆蓋既有場次（以日期為唯一鍵）。
        </p>
        <div className="mt-5">
          <SessionForm />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold">已排定場次（{sessions.length}）</h3>
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-line">
          {sessions.length ? (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/40">
                  <th className="py-3 pl-4 pr-4">日期</th>
                  <th className="py-3 pr-4">名稱</th>
                  <th className="py-3 pr-4">地點</th>
                  <th className="py-3 pr-4">名額</th>
                  <th className="py-3 pr-4">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3.5 pl-4 pr-4 font-semibold">
                      {formatDate(s.session_date)}
                      <span className="ml-1 text-xs text-white/40">
                        （週{weekdayLabel(s.session_date)}）
                      </span>
                      {s.session_date < today && (
                        <span className="ml-2 text-xs text-white/30">已過</span>
                      )}
                    </td>
                    <td className="py-3.5 pr-4 text-white/70">{s.title}</td>
                    <td className="py-3.5 pr-4 text-white/55">{s.location}</td>
                    <td className="py-3.5 pr-4 text-white/55">{s.capacity}</td>
                    <td className="py-3.5 pr-4 text-white/55">
                      {s.status === "open" ? "開放報名" : s.status === "closed" ? "已截止" : "已取消"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-white/45">
              尚無場次，schema.sql 已自動建立未來 8 週的週一場次。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
