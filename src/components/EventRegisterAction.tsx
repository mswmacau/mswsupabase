"use client";

/**
 * src/components/EventRegisterAction.tsx — 活動「站內報名／取消報名」按鈕（T-26）
 *
 * Owner：方砚。复刻 SessionAction（src/components/SessionAction.tsx）的互動與
 * 錯誤處理，不發明新模式：
 *  - 未登入 → 「登入後報名」連結（/login?next=/events）
 *  - 已報名 → emerald 徽章 + 「取消報名」文字按鈕
 *  - 未報名 → btn-vital「站內報名」
 *  - 成功後 router.refresh()（server 元件重新取數，樂觀更新口徑與
 *    SessionAction 完全一致：唔喺 client 端自己改狀態，避免兩邊唔一致）
 *  - 401 未登入／重複報名／活動已過期等中文訊息由路由回傳，直接顯示
 *
 * 邊界（與計劃 §8.4 對齊）：不檢查名額（events.capacity）——路由契約沒有
 * 「已滿」一項；外部報名連結按鈕由 EventCard 原本渲染，本元件只係並存嘅
 * 第二個入口，兩者互不影響。
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

/** 活動的站內報名／取消報名按鈕 */
export function EventRegisterAction({
  eventId,
  isLoggedIn,
  registered,
}: {
  eventId: string;
  isLoggedIn: boolean;
  registered: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "join" | "leave") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/event-registrations", {
        method: action === "join" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "操作失敗。");
        return;
      }
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <Link href="/login?next=/events" className="btn-base btn-cobalt w-full text-sm">
        登入後報名
      </Link>
    );
  }

  if (registered) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-300">
          <Check size={16} /> 已報名
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => act("leave")}
          className="w-full text-center text-xs text-white/70 transition hover:text-red-300 disabled:opacity-50"
        >
          {pending ? "處理中…" : "取消報名"}
        </button>
        {error && <p className="text-center text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => act("join")}
        className="btn-base btn-vital w-full text-sm"
      >
        {pending ? (
          <>
            <Loader2 size={16} className="animate-spin" /> 處理中…
          </>
        ) : (
          "站內報名"
        )}
      </button>
      {error && <p className="text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}
