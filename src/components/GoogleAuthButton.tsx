"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

/**
 * 「用 Google 繼續」＋「或」分隔線。
 *
 * 【為何是獨立元件】LoginForm 是表單（單一 <form>），而 OAuth 走的是整頁導向、
 * 不該混進 <form> 的 submit 流程；抽出來也讓微信提示的 client state 不外洩到表單邏輯。
 *
 * 【微信偵測與 hydration】navigator.userAgent 只有瀏覽器才有，SSR 一定拿不到。
 * 若在 render 期間直接讀，server 畫的是「有按鈕」、client 首渲可能畫「沒按鈕」→ hydration mismatch（#418）。
 * 故用 useSyncExternalStore：server snapshot 固定 false（與 SSR 輸出一致），
 * hydration 完成後才換成真實 UA 判斷，全程不在 effect 內 setState。
 * 下方三個模組層函式刻意放在元件外，維持參考穩定（UA 不會在同一個頁面生命週期內改變）。
 */
const subscribeNever = () => () => {};
const getIsWeChatSnapshot = () => /MicroMessenger/i.test(navigator.userAgent);
const getIsWeChatServerSnapshot = () => false;

export function GoogleAuthButton({
  next,
  emailFallbackLabel = "登入",
}: {
  next: string;
  /** 微信內無法用 Google 時，引導改用 Email 的動作名稱（登入／註冊） */
  emailFallbackLabel?: "登入" | "註冊";
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** server snapshot = false：SSR 與 hydration 首渲都渲染按鈕，之後才依 UA 切換 */
  const isWeChat = useSyncExternalStore(
    subscribeNever,
    getIsWeChatSnapshot,
    getIsWeChatServerSnapshot
  );

  async function onClick() {
    const supabase = createClient();
    if (!supabase) {
      setError("尚未連接 Supabase，暫時無法使用 Google 登入。");
      return;
    }

    setPending(true);
    setError(null);

    // next 已由 /login 頁面過白名單，這裡再過一次（同一個來源函式，成本為零）
    const target = safeNext(next, "/dashboard");

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
            target
          )}`,
        },
      });
      if (oauthError) {
        setError("無法連接 Google，請再試一次或改用 Email 登入。");
        setPending(false);
      }
      // 成功時瀏覽器會整頁導向 Google，維持 pending 即可
    } catch {
      setError("網路錯誤，請稍後再試。");
      setPending(false);
    }
  }

  return (
    <div>
      {isWeChat ? (
        <p
          role="note"
          className="slab border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200"
        >
          微信內無法使用 Google 登入。請點右上角 ⋯ → 在瀏覽器開啟，或直接用
          Email {emailFallbackLabel}。
        </p>
      ) : (
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="btn-base btn-google min-h-11 w-full"
        >
          {pending ? (
            <>
              <Loader2 size={17} className="animate-spin" /> 正在前往 Google…
            </>
          ) : (
            <>
              <GoogleGlyph />
              用 Google 繼續
            </>
          )}
        </button>
      )}

      {error && (
        <p role="alert" aria-live="polite" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {/* 分隔線：Google 與 Email 兩條路並列，不是主次關係 */}
      <div className="my-6 flex items-center gap-3 text-xs text-white/50">
        <span className="h-px flex-1 bg-[var(--line-fine)]" />
        <span aria-hidden="true">或</span>
        <span className="h-px flex-1 bg-[var(--line-fine)]" />
      </div>
    </div>
  );
}

/** Google 四色 G（官方配色，18×18）；純裝飾，語意由按鈕文字承擔 */
function GoogleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
