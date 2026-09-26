"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";

/**
 * 登出按鈕。
 * 以 fetch 打 /api/auth/logout（cookie 由該 route 明確清除），
 * 成功後用整頁導向回首頁，確保所有 SSR 頁面都重新以匿名狀態渲染。
 */
export function LogoutButton({
  className = "",
  label = "登出",
}: {
  className?: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 即使請求失敗，下面仍強制整頁重整，讓前端狀態回到未登入
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 登出後必須整頁重載，讓所有 SSR 頁面重新以匿名狀態渲染（router.push 只做客戶端導覽，不足以重置）
    window.location.assign("/");
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className={`flex w-full items-center gap-2 text-sm text-red-300 transition hover:bg-red-500/10 disabled:opacity-60 ${className}`}
    >
      {pending ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <LogOut size={15} />
      )}
      {pending ? "登出中…" : label}
    </button>
  );
}
