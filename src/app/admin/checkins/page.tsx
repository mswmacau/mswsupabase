import { getPendingCheckins } from "@/lib/queries";
import { CheckinReviewActions } from "@/components/ReviewActions";
import { formatDate, formatDateTime, weekdayLabel } from "@/lib/utils";
import { RULES } from "@/lib/config";

export const metadata = { title: "簽到確認" };
export const dynamic = "force-dynamic";

export default async function AdminCheckinsPage() {
  const items = await getPendingCheckins();

  return (
    <div>
      <h2 className="text-xl font-bold">訓練簽到確認</h2>
      <p className="mt-2 text-sm text-white/50">
        確認後會員立即獲得 {RULES.CHECKIN_POINTS} 積分。
      </p>

      <div className="mt-6 space-y-3">
        {items.length ? (
          items.map((c) => (
            <div
              key={c.id}
              className="card-dark flex flex-wrap items-center gap-4 p-5"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cobalt/20 text-sm font-bold">
                {new Date(c.session?.session_date ?? "").getDate() || "—"}
              </div>

              <div className="min-w-[180px] flex-1">
                <div className="font-semibold">
                  {c.profile?.display_name ?? "（未具名會員）"}
                </div>
                <div className="mt-0.5 text-xs text-white/45">
                  {c.session?.session_date
                    ? `${c.session.session_date}（週${weekdayLabel(c.session.session_date)}）`
                    : "場次資料遺失"}{" "}
                  · {c.session?.title ?? ""} · {c.session?.location ?? ""}
                </div>
                <div className="mt-0.5 text-xs text-white/35">
                  簽到時間 {formatDateTime(c.created_at)}
                </div>
              </div>

              <CheckinReviewActions checkinId={c.id} />
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center text-sm text-white/45">
            目前沒有待確認的簽到。
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-white/35">
        提示：訓練日期 {formatDate(new Date().toISOString())} 起算，會員報名後會出現在這裡。
      </p>
    </div>
  );
}
