import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  Gift,
  TicketCheck,
  Users,
} from "lucide-react";
import { getAdminCounts, getSiteStats } from "@/lib/queries";
import { currentMonth, formatKm, monthLabel } from "@/lib/utils";

export const metadata = { title: "後台總覽" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const [counts, stats] = await Promise.all([getAdminCounts(), getSiteStats()]);

  const cards = [
    {
      href: "/admin/runs",
      icon: <ClipboardCheck size={20} />,
      label: "待審核跑步提交",
      value: String(counts.pendingRuns),
      accent: "text-vital",
      desc: "確認後里程與積分才會入帳",
    },
    {
      href: "/admin/checkins",
      icon: <Users size={20} />,
      label: "待確認簽到",
      value: String(counts.pendingCheckins),
      accent: "text-amber-400",
      desc: "確認後 +10 積分",
    },
    {
      href: "/admin/monthly",
      icon: <Gift size={20} />,
      label: `${monthLabel(currentMonth())}達標名單`,
      value: "發券",
      accent: "text-emerald-400",
      desc: "滿 300km 會員批量發放",
    },
    {
      href: "/admin/coupons",
      icon: <TicketCheck size={20} />,
      label: "有效優惠券",
      value: String(counts.coupons),
      accent: "text-blue-400",
      desc: "核銷與查詢",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card-dark p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-white/45">
            全站累積里程
          </div>
          <div className="mt-2 text-4xl font-black text-blue-300">
            {formatKm(stats.total_km)}
            <span className="ml-1 text-base text-white/40">km</span>
          </div>
          <div className="mt-1 text-xs text-white/40">
            已確認 {stats.total_runs} 次提交
          </div>
        </div>
        <div className="card-dark p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-white/45">
            會員總數
          </div>
          <div className="mt-2 text-4xl font-black">{counts.members}</div>
          <div className="mt-1 text-xs text-white/40">
            已開訓練場次 {stats.total_sessions} 場
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="card-dark group flex items-center gap-4 p-6 transition hover:border-cobalt/50"
          >
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 ${c.accent}`}>
              {c.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white/55">{c.label}</div>
              <div className="text-2xl font-black">{c.value}</div>
              <div className="mt-0.5 text-xs text-white/40">{c.desc}</div>
            </div>
            <ArrowRight
              size={18}
              className="shrink-0 text-white/25 transition group-hover:translate-x-1 group-hover:text-white/60"
            />
          </Link>
        ))}
      </div>

      {(counts.pendingRuns > 0 || counts.pendingCheckins > 0) && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">
          有 {counts.pendingRuns} 筆跑步提交與 {counts.pendingCheckins}{" "}
          筆簽到等待確認，確認後會員才能看到里程與積分入帳。
        </div>
      )}
    </div>
  );
}
