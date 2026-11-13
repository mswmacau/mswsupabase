/**
 * src/app/hyrox/[id]/RegisterBar.tsx — 場次詳情頁的固定報名條
 *
 * 為什麼放在這個目錄：只允許改 `src/app/hyrox/[id]/**`（`src/components/hyrox/`
 * 由另一位工程師的後台工作佔用中）。App Router 只有 page/layout/route 這幾種檔
 * 會變成路由，同目錄的其他檔案只是普通模組。
 *
 * Server Component（沒有 "use client"）：三種 CTA 分別是 Link / disabled button /
 * 純文字，整條列不需要任何互動狀態，所以不需要 JS。這點是刻意的——
 * 「不遮住頁尾」靠純 CSS 達成，不能依賴 hydration。
 *
 * 版面：
 *   手機 → fixed 貼螢幕底、滿寬、min-h-16（實測 69px）＋安全區 padding。
 *   桌面 → 同樣 fixed，內層仍是 container-msw，內容與頁面左緣對齊。
 *   高度上限 73px（桌面實測），頁面端以 80px 留白對應（見 page.tsx 的 <style>）。
 *
 * 為什麼不用 sticky：
 *   條子放在頁面容器末端時，`position: sticky; bottom: 0` 只在「自然位置還在視窗
 *   下方」時貼底，一接近頁尾就鬆手往上飄（實測 390 滾到最底時條子距底 712px、
 *   桌面 550px），看起來像浮在內容中間而不是固定條。故用 fixed。
 *
 * 為什麼 fixed 條不會壓住站尾：page.tsx 會輸出一個只在本頁生效的 <style>，
 * 依 `[data-register-bar]` 給站尾補上等高的 padding-bottom。
 * （單純 fixed 時實測條頂 775px、© 版權行底 820px → 會被壓住。）
 *
 * 層級：z-30 —— Nav 是 z-50、手機選單遮罩是 z-40，報名條不可蓋過它們。
 *
 * 四種狀態（由 page.tsx 判定後傳入，本檔不碰資料）：
 *   open  → 「立即報名」連到 /hyrox/register?event=<id>
 *   guest → 同樣文案，先連到 /login?next=<報名頁>
 *   full  → 「名額已滿」，disabled
 *   ended → 灰色「本場已結束」，不可點（保留版面高度，避免頁尾跳動）
 */

import Link from "next/link";
import { ArrowRight, CalendarDays, Wallet } from "lucide-react";

export type RegisterBarState = "guest" | "open" | "full" | "ended";

export function RegisterBar({
  eventId,
  dateText,
  feeText,
  state,
}: {
  eventId: string;
  dateText: string;
  feeText: string;
  state: RegisterBarState;
}) {
  const registerHref = `/hyrox/register?event=${eventId}`;
  // next 的值本身含 `?`，必須編碼；login 端會走 safeNext 白名單驗證
  const loginHref = `/login?next=${encodeURIComponent(registerHref)}`;

  return (
    <div
      data-register-bar
      className="glass fixed inset-x-0 bottom-0 z-30 border-t border-ink-line pb-[env(safe-area-inset-bottom)]"
    >
      <div className="container-msw flex min-h-16 items-center justify-between gap-3 py-2.5 md:min-h-[68px] md:py-3">
        {/* 左側：日期＋費用。min-w-0 不可省，否則內層 truncate 不生效 */}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-white/55">
            <CalendarDays size={13} className="flex-none" />
            <span className="min-w-0 truncate">{dateText}</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-white">
            <Wallet size={13} className="flex-none text-vital-bright" />
            <span className="min-w-0 truncate">{feeText}</span>
          </p>
        </div>

        {/* 右側：主 CTA */}
        {state === "open" || state === "guest" ? (
          <Link
            href={state === "open" ? registerHref : loginHref}
            className="btn-base btn-vital btn-slab min-h-11 shrink-0"
          >
            立即報名 <ArrowRight size={16} />
          </Link>
        ) : state === "full" ? (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="btn-base btn-ghost btn-slab min-h-11 shrink-0 cursor-not-allowed opacity-60"
          >
            名額已滿
          </button>
        ) : (
          <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/55">
            本場已結束
          </span>
        )}
      </div>
    </div>
  );
}
