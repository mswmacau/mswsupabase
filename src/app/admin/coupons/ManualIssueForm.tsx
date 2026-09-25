"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Gift, Loader2 } from "lucide-react";

export interface Member {
  id: string;
  display_name: string | null;
}

/** 手動選會員發券（不限於月度達標者） */
export function ManualIssueForm({ members }: { members: Member[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
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

  async function submit() {
    if (!selected.length) {
      setError("請至少選擇一位會員。");
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
          month: null,
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
      setSelected([]);
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
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

      <div>
        <span className="label">選擇會員（可多選）</span>
        {members.length ? (
          <div className="max-h-56 overflow-y-auto rounded-xl border border-ink-line">
            <ul className="divide-y divide-ink-line">
              {members.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      value={m.id}
                      checked={selected.includes(m.id)}
                      onChange={() => toggle(m.id)}
                      className="h-4 w-4 accent-vital"
                    />
                    <span className="font-semibold">
                      {m.display_name ?? "匿名會員"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/45">
            尚無會員。
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title2">
            優惠券名稱
          </label>
          <input
            id="title2"
            ref={titleRef}
            defaultValue="MSW 專屬優惠券"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="days2">
            有效天數
          </label>
          <input
            id="days2"
            ref={daysRef}
            type="number"
            defaultValue={90}
            min={1}
            className="field"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="description2">
          說明（選填）
        </label>
        <input
          id="description2"
          ref={descRef}
          placeholder="例如：可兌換一堂免費團體訓練"
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
            <Gift size={17} /> 發券給 {selected.length} 位會員
          </>
        )}
      </button>
    </div>
  );
}
