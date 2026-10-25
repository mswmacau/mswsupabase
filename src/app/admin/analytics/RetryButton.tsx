"use client";

/**
 * src/app/admin/analytics/RetryButton.tsx — 分析數據重試入口（T-24）
 *
 * 儀表板本身係 Server Component 取數；取數失敗時 Server Component 無法自我重試，
 * 所以加一個細 client 元件叫 router.refresh() 重新執行一次 server render。
 * 其餘 UI（圖表、摺疊區）全為 server 渲染，零圖表庫、零客戶端數據邏輯。
 */

import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RetryButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="btn-base btn-ghost"
    >
      <RefreshCw size={16} /> 重試
    </button>
  );
}
