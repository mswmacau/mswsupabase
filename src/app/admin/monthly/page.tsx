import Link from "next/link";
import { PartyPopper } from "lucide-react";
import { MonthlyIssueForm } from "./MonthlyIssueForm";
import { getMonthOverview, getQualifiedList } from "@/lib/queries";
import { RULES } from "@/lib/config";
import { currentMonth, monthLabel, recentMonths } from "@/lib/utils";

export const metadata = { title: "月度名單 / 發券" };
export const dynamic = "force-dynamic";

export default async function AdminMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();

  const [qualified, overview] = await Promise.all([
    getQualifiedList(month),
    getMonthOverview(month),
  ]);

  const months = recentMonths(6);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">月度達標名單與發券</h2>
        <p className="mt-2 text-sm text-white/50">
          當月累積達 {RULES.MONTHLY_GOAL_KM} 公里（僅計已確認）的會員會出現在這裡。
          達標時系統已自動發券並 +{RULES.MONTHLY_BONUS_POINTS} 分；若需補發，可用下方表單。
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {months.map((mm) => (
            <Link
              key={mm}
              href={`/admin/monthly?m=${mm}`}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                mm === month
                  ? "border-vital bg-vital text-white"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              {monthLabel(mm)}
            </Link>
          ))}
        </div>
      </div>

      {qualified.length ? (
        <MonthlyIssueForm
          month={month}
          rows={qualified.map((r) => ({
            user_id: r.user_id,
            name: r.name,
            email: r.email,
            total_km: r.total_km,
            runs: r.runs,
            has_coupon: r.has_coupon,
          }))}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center">
          <PartyPopper size={30} className="mx-auto text-white/25" />
          <p className="mt-4 text-sm text-white/45">
            {monthLabel(month)}尚無會員達標（≥ {RULES.MONTHLY_GOAL_KM} km）。
          </p>
        </div>
      )}

      {/* 全部會員累積 */}
      <div>
        <h3 className="text-lg font-bold">{monthLabel(month)}全體累積里程</h3>
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-line">
          {overview.length ? (
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/40">
                  <th className="py-3 pl-4 pr-4">會員</th>
                  <th className="py-3 pr-4">累積里程</th>
                  <th className="py-3 pr-4">提交次數</th>
                  <th className="py-3 pr-4">距離達標</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {overview.map((r) => (
                  <tr key={r.user_id}>
                    <td className="py-3.5 pl-4 pr-4 font-semibold">{r.name}</td>
                    <td className="py-3.5 pr-4 font-bold text-blue-300">
                      {Number(r.total_km).toFixed(1)} km
                    </td>
                    <td className="py-3.5 pr-4 text-white/60">{r.runs}</td>
                    <td className="py-3.5 pr-4 text-white/55">
                      {Number(r.total_km) >= RULES.MONTHLY_GOAL_KM
                        ? "已達標"
                        : `還差 ${(RULES.MONTHLY_GOAL_KM - Number(r.total_km)).toFixed(1)} km`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-white/45">
              本月尚無任何已確認紀錄。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
