import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Gift, XCircle } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getMyRedemptions,
  isRedemptionExpired,
  type RedemptionRow,
} from "@/lib/rewards";
import { RedemptionCard } from "@/components/RedemptionCard";

export const metadata = { title: "我的兌換" };
export const dynamic = "force-dynamic";

export default async function RedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/dashboard/redemptions");

  const { new: newCode } = await searchParams;
  const items = await getMyRedemptions(profile.id);

  const usable: RedemptionRow[] = [];
  const approval: RedemptionRow[] = [];
  const done: RedemptionRow[] = [];
  const closed: RedemptionRow[] = [];

  for (const item of items) {
    const expired = isRedemptionExpired(item.status, item.expires_at);
    if (expired) closed.push(item);
    else if (item.status === "pending") usable.push(item);
    else if (item.status === "pending_approval") approval.push(item);
    else if (item.status === "completed") done.push(item);
    else closed.push(item);
  }

  return (
    <section className="relative overflow-hidden pb-20 pt-24 md:pt-28">
      <div
        className="pointer-events-none absolute -right-[15%] -top-[26%] h-[520px] w-[520px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 70%, transparent), transparent 66%)",
          opacity: 0.3,
        }}
      />
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={15} /> 回我的帳戶
        </Link>

        <div className="mt-6 flex gap-6">
          <span className="vlabel hidden shrink-0 text-white/40 lg:block">
            My Redemptions
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="display-xl mt-6">
              <span className="block text-white">我的</span>
              <span className="mt-1 block">
                <span className="text-outline">兌</span>
                <span className="text-vital-bright">換</span>
              </span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-white/70">
              每張券都附 QR 碼與 12 位領取碼。到核銷商戶出示 QR，由店員即場核銷；掃不到碼時可把券碼給店員人手輸入。
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="clip-notch-br mt-12 border border-dashed border-white/15 px-6 py-14 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center border border-[var(--line-fine)] text-vital-bright">
              <Gift size={22} />
            </span>
            <p className="mt-5 text-sm text-white/70">
              你還沒有兌換紀錄。用積分換禮品，跑步、訓練簽到、每日登入都可以賺分。
            </p>
            <Link
              href="/dashboard/rewards"
              className="btn-base btn-vital btn-slab mt-6 min-h-11"
            >
              去禮品換領 <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <div className="mt-12 space-y-12">
            <Group
              title="可使用"
              count={usable.length}
              icon={<Gift size={18} className="text-vital-bright" />}
              emptyText="目前沒有可使用的券。"
            >
              {usable.map((item) => (
                <RedemptionCard
                  key={item.id}
                  item={item}
                  highlight={Boolean(newCode && item.pickup_code === newCode)}
                />
              ))}
            </Group>

            <Group
              title="待審批"
              count={approval.length}
              icon={<Clock size={18} className="text-amber-300" />}
              emptyText="沒有待審批的兌換。"
              hint="新會員首 7 日的兌換需管理員確認，確認前積分已扣、券未生效。"
            >
              {approval.map((item) => (
                <RedemptionCard
                  key={item.id}
                  item={item}
                  highlight={Boolean(newCode && item.pickup_code === newCode)}
                />
              ))}
            </Group>

            <Group
              title="已完成"
              count={done.length}
              icon={<CheckCircle2 size={18} className="text-emerald-300" />}
              emptyText="還沒有已領取的券。"
            >
              {done.map((item) => (
                <RedemptionCard key={item.id} item={item} />
              ))}
            </Group>

            <Group
              title="已取消／已過期"
              count={closed.length}
              icon={<XCircle size={18} className="text-white/55" />}
              emptyText="沒有已取消或已過期的券。"
            >
              {closed.map((item) => (
                <RedemptionCard key={item.id} item={item} />
              ))}
            </Group>
          </div>
        )}
      </div>
    </section>
  );
}

function Group({
  title,
  count,
  icon,
  emptyText,
  hint,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  emptyText: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // 空分區不佔版面（但「可使用」永遠顯示，避免頁面突然像壞了）
  if (count === 0 && title !== "可使用") return null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-fine)] pb-4">
        <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
          {icon} {title}
        </h2>
        <span className="stat-figure text-2xl text-white/80">
          {count}
          <span className="ml-1 font-sans text-xs font-medium text-white/50">張</span>
        </span>
      </div>
      {hint && <p className="mt-3 text-xs leading-relaxed text-white/50">{hint}</p>}
      {count === 0 ? (
        <div className="mt-5 border border-dashed border-white/12 px-5 py-8 text-center text-sm text-white/60">
          {emptyText}
        </div>
      ) : (
        <div className="stagger mt-5 grid gap-5 md:grid-cols-2">{children}</div>
      )}
    </div>
  );
}
