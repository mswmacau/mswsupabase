import { getAllCoupons, getAllMembers } from "@/lib/queries";
import { RedeemForm } from "./RedeemForm";
import { ManualIssueForm } from "./ManualIssueForm";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "優惠券管理" };
export const dynamic = "force-dynamic";

export default async function AdminCouponsPage() {
  const [coupons, members] = await Promise.all([
    getAllCoupons(300),
    getAllMembers(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">優惠券核銷</h2>
        <p className="mt-2 text-sm text-white/50">
          輸入會員出示的券碼即可標記為已使用。
        </p>
        <div className="mt-5 max-w-xl">
          <RedeemForm />
        </div>
      </div>

      <div className="rounded-2xl border border-ink-line bg-black/20 p-6">
        <h3 className="text-lg font-bold">手動發放優惠券</h3>
        <p className="mt-1.5 text-sm text-white/50">
          不限於月度達標會員，可自由選人發券（例如活動獎勵、補發）。
        </p>
        <div className="mt-5">
          <ManualIssueForm members={members} />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold">全部優惠券（{coupons.length}）</h3>
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-line">
          {coupons.length ? (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/40">
                  <th className="py-3 pl-4 pr-4">券碼</th>
                  <th className="py-3 pr-4">會員</th>
                  <th className="py-3 pr-4">名稱</th>
                  <th className="py-3 pr-4">月份</th>
                  <th className="py-3 pr-4">期限</th>
                  <th className="py-3 pr-4">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <td className="py-3.5 pl-4 pr-4 font-mono text-xs font-bold">
                      {c.code}
                    </td>
                    <td className="py-3.5 pr-4">
                      {(c as unknown as { profile?: { display_name?: string } })
                        .profile?.display_name ?? "—"}
                    </td>
                    <td className="py-3.5 pr-4 text-white/70">{c.title}</td>
                    <td className="py-3.5 pr-4 text-white/55">
                      {c.month_awarded ?? "—"}
                    </td>
                    <td className="py-3.5 pr-4 text-white/55">
                      {formatDate(c.expires_at)}
                    </td>
                    <td className="py-3.5 pr-4">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-white/45">
              尚未發放任何優惠券。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
