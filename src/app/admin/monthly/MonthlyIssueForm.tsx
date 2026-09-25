"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Gift, Loader2 } from "lucide-react";

export interface Row {
  user_id: string;
  name: string | null;
  total_km: number;
  runs: number;
  has_coupon: boolean;
  email?: string | null;
}

export function MonthlyIssueForm({
  rows,
  month,
}: {
  rows: Row[];
  month: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(
    rows.filter((r) => !r.has_coupon).map((r) => r.user_id)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const daysRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const allSelected = rows.length > 0 && selected.length === rows.length;

  async function submit() {
    if (!selected.length) {
      setError("請至少選擇一位會員。");
      return;
    }

    // 防呆：對已發放過的會員重複發券時先二次確認
    const already = selected.filter(
      (id) => rows.find((r) => r.user_id === id)?.has_coupon
    );
    if (already.length) {
      const names = already
        .map((id) => rows.find((r) => r.user_id === id)?.name ?? "（未具名）")
        .join("、");
      if (
        !window.confirm(
          `以下會員本月已發放過優惠券：${names}。\n確定要再發一張嗎？`
        )
      )
        return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: selected,
          month,
          title: titleRef.current?.value ?? "",
          description: descRef.current?.value ?? "",
          days: Number(daysRef.current?.value ?? 90),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!data.ok) {
        setError(data.error ?? "發放失敗。");
        return;
      }
      setSuccess(data.message ?? "發放成功。");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-ink-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/40">
              <th className="w-12 py-3 pl-4">
                <input
                  type="checkbox"
                  aria-label="全選"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? [] : rows.map((r) => r.user_id))
                  }
                  className="h-4 w-4 accent-vital"
                />
              </th>
              <th className="py-3 pr-4">會員</th>
              <th className="py-3 pr-4">累積里程</th>
              <th className="py-3 pr-4">提交次數</th>
              <th className="py-3 pr-4">優惠券狀態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-line">
            {rows.map((r) => (
              <tr key={r.user_id} className="hover:bg-white/[0.03]">
                <td className="py-3.5 pl-4">
                  <input
                    type="checkbox"
                    value={r.user_id}
                    checked={selected.includes(r.user_id)}
                    onChange={() => toggle(r.user_id)}
                    className="h-4 w-4 accent-vital"
                  />
                </td>
                <td className="py-3.5 pr-4">
                  <div className="font-semibold">{r.name ?? "匿名會員"}</div>
                  {r.email && (
                    <div className="text-xs text-white/40">{r.email}</div>
                  )}
                </td>
                <td className="py-3.5 pr-4 font-bold text-blue-300">
                  {r.total_km.toFixed(1)} km
                </td>
                <td className="py-3.5 pr-4 text-white/60">{r.runs}</td>
                <td className="py-3.5 pr-4">
                  {r.has_coupon ? (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                      已發放
                    </span>
                  ) : (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                      未發放
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title">
            優惠券名稱
          </label>
          <input
            id="title"
            ref={titleRef}
            defaultValue={`${month} 月度 300km 達成優惠券`}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="days">
            有效天數
          </label>
          <input
            id="days"
            ref={daysRef}
            type="number"
            defaultValue={90}
            min={1}
            className="field"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="description">
          優惠券說明
        </label>
        <input
          id="description"
          ref={descRef}
          defaultValue={`恭喜完成 ${month} 月度 300 公里挑戰，可於 MSW 街健館兌換指定優惠。`}
          className="field"
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pending || selected.length === 0}
        className="btn-base btn-vital"
      >
        {pending ? (
          <>
            <Loader2 size={17} className="animate-spin" /> 發放中…
          </>
        ) : (
          <>
            <Gift size={17} /> 發放優惠券給 {selected.length} 位會員
          </>
        )}
      </button>
    </div>
  );
}
