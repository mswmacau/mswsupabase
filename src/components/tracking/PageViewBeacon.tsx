"use client";

/**
 * src/components/tracking/PageViewBeacon.tsx — 頁面停留追蹤 beacon（T-22 前端）
 *
 * Owner：方砚。契約：計劃 V2 §5.3（度量規則）／§8.2（上報端點）；
 * 服務端 POST /api/track/page-view（白客）負責校驗／去重／上限。
 *
 * 度量規則（計劃 §5.3，逐條對應）：
 *  1. 開始：路由 commit 後（usePathname 變化）且頁面可見才開始累計；
 *     在背景開頁不會產生任何停留時間。
 *  2. 累計：只累計 document.visibilityState === 'visible' 的時間——
 *     分頁切走、最小化、鎖屏都不計（靠 visibilitychange 暫停／續計）。
 *  3. 結束：visibilitychange 轉 hidden、pagehide、站內換頁（effect cleanup）
 *     三者都觸發上報。換頁嘅結算會延遲一個 macrotask 送出——係為避開
 *     React StrictMode（開發模式）掛載後立刻 cleanup+重掛造成嘅 ~1ms 雜訊行
 *     （詳見元件內 pendingFlushRef 註解）；關分頁／硬導航走 pagehide 同步上報。
 *  4. 上報：navigator.sendBeacon 送最終值（text/plain，不阻塞卸載）；
 *     極舊瀏覽器無 sendBeacon 時回落 fetch keepalive。
 *  5. 上限：單次 30 分鐘（1,800,000 ms）封頂，與服務端一致——
 *     忘記關分頁也只按 30 分鐘計，服務端才收得落。
 *  6. 去重：同一 sid+path 60 秒內重複上報由服務端靜默丟棄（此處不重複實現）。
 *  7. 排除：路徑以 /admin、/api 開頭不上報（服務端也會擋，客戶端先擋省流量）。
 *
 * 分段口徑（重要設計決定）：每次上報的是「兩次上報之間」累計的可視時間，
 * 上報後歸零重計——隱藏→返回→再隱藏會產生兩列，合計≈實際可視時間；
 * 若改為累計值重複上報，同一段時間會被重複計算，污染平均停留。
 *
 * 私隱紀律（計劃 §5.3）：sid 由客戶端隨機生成、只存 sessionStorage
 * （分頁關閉即消失、不關聯帳號）；不記 IP、不記 user_id。
 *
 * 紅線：元件本身零 UI、零 CLS——任何時候都回傳 null，
 * 不改變前台任何可見輸出（innerText／截圖比對不受影響）。
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** 單次停留上限（毫秒）：30 分鐘，與服務端 MAX_DWELL_MS 逐字一致 */
const MAX_DWELL_MS = 1_800_000;

/** sessionStorage 鍵名（重整頁面沿用同一個 sid，不重複計一次新訪客） */
const SID_STORAGE_KEY = "msw_pv_sid";

/** 不上報的路徑前綴（服務端亦會擋，客戶端先擋省流量） */
const EXCLUDED_PREFIXES = ["/admin", "/api"] as const;

/** 公開追蹤端點（不需登入） */
const TRACK_ENDPOINT = "/api/track/page-view";

function isExcludedPath(path: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** 生成 8–32 位小寫英數 sid（服務端 SID_RE 同款格式） */
function randomSid(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const len = 16;
  let out = "";
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint8Array(len);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  } else {
    for (let i = 0; i < len; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  return out;
}

/** 取（或建立）本 session 的 sid；sessionStorage 不可用時退回一次性隨機值 */
function getSid(): string {
  try {
    const existing = window.sessionStorage.getItem(SID_STORAGE_KEY);
    if (existing && /^[a-z0-9]{8,32}$/.test(existing)) return existing;
    const sid = randomSid();
    window.sessionStorage.setItem(SID_STORAGE_KEY, sid);
    return sid;
  } catch {
    return randomSid();
  }
}

/** sendBeacon 上報一次停留（text/plain；服務端 JSON 與 text/plain 都收） */
function report(path: string, sid: string, dwellMs: number, isMember: boolean) {
  const payload = JSON.stringify({
    path,
    sid,
    dwell_ms: dwellMs,
    is_member: isMember,
  });
  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(TRACK_ENDPOINT, payload);
    return;
  }
  // 極舊瀏覽器無 sendBeacon：fetch keepalive 後補（不阻塞卸載；失敗靜默——
  // 追蹤失敗絕不影響前台使用）
  void fetch(TRACK_ENDPOINT, {
    method: "POST",
    body: payload,
    keepalive: true,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
  }).catch(() => {});
}

export function PageViewBeacon({ isMember }: { isMember: boolean }) {
  const pathname = usePathname();
  // is_member 由 server 傳入（layout 以 getCurrentProfile 判斷）；用 ref 取最新值，
  // 避免登入狀態變化（不換路由）時重啟整段度量。
  const isMemberRef = useRef(isMember);
  useEffect(() => {
    isMemberRef.current = isMember;
  }, [isMember]);

  /**
   * 換頁待結算：effect cleanup 不立刻上報，改排一筆 macrotask。
   * 原因：React StrictMode（開發模式）會在掛載後立刻 cleanup + 重掛同一路徑的
   * effect——立刻上報會產生一筆 ~1ms 的雜訊行，還會因服務端 60 秒去重把隨後
   * 真正的停留上報吃掉。延遲一個 macrotask 後：同一路徑重掛 → 取消（見下方），
   * 真正換頁（路徑不同）→ 照樣結算。關分頁／硬導航有 pagehide 同步上報，
   * 不依賴這個延遲任務。
   */
  const pendingFlushRef = useRef<{ path: string; timer: number } | null>(null);

  useEffect(() => {
    if (!pathname || isExcludedPath(pathname)) return;

    // 同一路徑的 effect 重掛（StrictMode）：取消上一筆待結算，本段繼續計
    const pending = pendingFlushRef.current;
    if (pending && pending.path === pathname) {
      clearTimeout(pending.timer);
      pendingFlushRef.current = null;
    }

    const path = pathname;
    const sid = getSid();

    // 本段（兩次上報之間）累計的可視停留毫秒；visibleStart = 最近一次轉可見的時間戳
    let accumulated = 0;
    let visibleStart: number | null = null;

    /** 結算未上報的可視時間並上報，然後歸零重計（分段口徑，見檔頭註） */
    function flush() {
      if (visibleStart !== null) {
        accumulated += Date.now() - visibleStart;
        visibleStart = null;
      }
      if (accumulated <= 0) return;
      // 單次 30 分鐘封頂（客戶端也封，與服務端一致）
      const dwell = Math.min(accumulated, MAX_DWELL_MS);
      accumulated = 0;
      report(path, sid, dwell, isMemberRef.current);
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        if (visibleStart === null) visibleStart = Date.now();
      } else {
        // 轉 hidden：本段結束，立刻上報（服務端 60 秒去重擋掉快速隱藏／顯示循環）
        flush();
      }
    }

    function handlePageHide() {
      // pagehide（關分頁／重整／硬導航離開）：卸載前同步上報，sendBeacon 保證送得出
      flush();
    }

    function handlePageShow() {
      // iOS Safari 從背景帶回時可能只觸發 pageshow：可見就續計
      if (document.visibilityState === "visible" && visibleStart === null) {
        visibleStart = Date.now();
      }
    }

    // 起始：路由 commit 後且頁面可見才開始累計（背景分頁不計）
    if (document.visibilityState === "visible") visibleStart = Date.now();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      // 站內換頁：排一筆延遲結算；若同一路徑立刻重掛（StrictMode）會被取消
      const timer = window.setTimeout(() => {
        pendingFlushRef.current = null;
        flush();
      }, 0);
      pendingFlushRef.current = { path, timer };
    };
  }, [pathname]);

  // 零 UI、零 CLS：不渲染任何可見內容
  return null;
}
