import Link from "next/link";
import { CalendarDays, Check, Clock, MapPin, Users } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getCachedAllSessions, getUserCheckins } from "@/lib/queries";
import { SessionAction } from "@/components/SessionAction";
import { BRAND, RULES } from "@/lib/config";
import { formatDate, weekdayLabel } from "@/lib/utils";
import type { TrainingSession } from "@/lib/types";

export const metadata = { title: "定期訓練" };
export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  // FE-17：profile 與 sessions 平行發出，wall-clock 由加總變最大值
  const [profile, supabaseSessions] = await Promise.all([
    getCurrentProfile(),
    getCachedAllSessions(60),
  ]);
  const checkins = profile ? await getUserCheckins(profile.id, 60) : [];

  const myMap = new Map(
    checkins.map((c) => [c.session_id, c.status])
  );

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = supabaseSessions.filter(
    (s) => s.session_date >= today && s.status !== "cancelled"
  );

  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw">
        <div className="max-w-2xl">
          <span className="eyebrow">Weekly Training</span>
          <h1 className="section-title mt-4">定期訓練活動</h1>
          <p className="mt-4 leading-relaxed text-white/60">
            逢<span className="font-semibold text-white">星期一</span>{" "}
            <span className="font-semibold text-vital">{RULES.TRAINING_TIME}</span>
            ，於 {BRAND.location}
            {BRAND.name} 進行團體街頭健身訓練。現場簽到並經後台確認後，每次可獲得{" "}
            <span className="font-semibold text-white">
              {RULES.CHECKIN_POINTS} 積分
            </span>
            。
          </p>
        </div>

        {/* 亮點 */}
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {[
            {
              icon: <Clock size={20} />,
              title: "固定時間",
              desc: "每週一 20:00–21:00，不用每次重新喬時間",
            },
            {
              icon: <Users size={20} />,
              title: "團體訓練",
              desc: "教練帶領，依程度分組調整動作難度",
            },
            {
              icon: <Check size={20} />,
              title: `+${RULES.CHECKIN_POINTS} 積分`,
              desc: "現場簽到，後台確認後積分自動入帳",
            },
          ].map((f) => (
            <div key={f.title} className="card-dark p-6">
              <div className="text-vital">{f.icon}</div>
              <h3 className="mt-4 font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* 場次列表 */}
        <h2 className="mt-16 text-2xl font-bold">近期場次</h2>

        {upcoming.length ? (
          <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                myStatus={myMap.get(s.id) ?? null}
                isLoggedIn={Boolean(profile)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
            <CalendarDays size={30} className="mx-auto text-white/30" />
            <p className="mt-4 text-sm text-white/50">
              目前沒有已排定的場次。
              {profile?.role === "admin" && (
                <>
                  {" "}
                  <Link href="/admin/sessions" className="text-blue-300 hover:underline">
                    到後台新增場次
                  </Link>
                </>
              )}
            </p>
          </div>
        )}

        {/* 我的訓練紀錄 */}
        {profile && (
          <div className="mt-16">
            <h2 className="text-2xl font-bold">我的訓練紀錄</h2>
            <div className="mt-6 overflow-x-auto">
              {checkins.length ? (
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/40">
                      <th className="py-3 pr-4">日期</th>
                      <th className="py-3 pr-4">場次</th>
                      <th className="py-3 pr-4">簽到時間</th>
                      <th className="py-3">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-line">
                    {checkins.map((c) => (
                      <tr key={c.id}>
                        <td className="py-3.5 pr-4 font-medium">
                          {c.session?.session_date ?? "—"}
                          <span className="ml-1 text-xs text-white/40">
                            （週{weekdayLabel(c.session?.session_date ?? new Date())}）
                          </span>
                        </td>
                        <td className="py-3.5 pr-4 text-white/70">
                          {c.session?.title ?? "—"}
                        </td>
                        <td className="py-3.5 pr-4 text-white/55">
                          {formatDate(c.created_at)}
                        </td>
                        <td className="py-3.5">
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                              c.status === "approved"
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                : c.status === "rejected"
                                  ? "border-red-500/40 bg-red-500/15 text-red-300"
                                  : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {c.status === "approved"
                              ? "已確認"
                              : c.status === "rejected"
                                ? "已駁回"
                                : "待確認"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/45">
                  尚無訓練紀錄，報名一場試試看。
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SessionCard({
  session,
  myStatus,
  isLoggedIn,
}: {
  session: TrainingSession;
  myStatus: string | null;
  isLoggedIn: boolean;
}) {
  const d = new Date(session.session_date + "T00:00:00");
  const day = d.getDate();
  const monthNum = d.getMonth() + 1;

  return (
    <div className="card-dark flex flex-col p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-3xl font-black leading-none">{day}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/40">
            {monthNum} 月 · 週{weekdayLabel(d)}
          </div>
        </div>
        <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-white/60">
          {session.status === "open" ? "開放報名" : "已截止"}
        </span>
      </div>

      <h3 className="mt-5 text-lg font-bold">{session.title}</h3>

      <div className="mt-3 space-y-2 text-sm text-white/60">
        <div className="flex items-center gap-2">
          <Clock size={15} className="shrink-0 text-vital" />
          {RULES.TRAINING_TIME}
        </div>
        <div className="flex items-center gap-2">
          <MapPin size={15} className="shrink-0 text-vital" />
          {session.location}
        </div>
        <div className="flex items-center gap-2">
          <Users size={15} className="shrink-0 text-vital" />
          名額 {session.capacity} 人
        </div>
      </div>

      {session.note && (
        <p className="mt-4 text-xs leading-relaxed text-white/45">{session.note}</p>
      )}

      <div className="mt-6">
        <SessionAction
          sessionId={session.id}
          myStatus={myStatus}
          isLoggedIn={isLoggedIn}
          sessionStatus={session.status}
        />
      </div>
    </div>
  );
}

