import { Fragment } from "react";

/**
 * src/app/admin/audit-log/SummaryText.tsx — 摘要裡的舊 UUID 標註
 *
 * 背景：早期寫入的稽核紀錄，summary 裡直接塞了 UUID（例如「將會員
 * 8f3a…-… 標記為測試帳號」），因為當時還沒有把 id 換成人名／標題。
 * 站主要求：不要假裝那些 UUID 是名字，但也不要整條紀錄看不懂——
 * 所以在 UUID 後面加一個小字「（舊紀錄）」，讓閱讀的人知道
 * 「這是舊格式留下的識別碼，不是漏翻」。
 *
 * 刻意不做的事：
 *   · 不去資料庫回查那個 UUID 是誰（那要 N+1 查詢，且帳號可能已刪）
 *   · 不把 UUID 縮短或遮掉（管理員追問題時常要看完整 id）
 *   · 不改寫 summary 本身（稽核紀錄必須保持原文）
 */

const UUID_SPLIT =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** 逐段判斷用（非 global，避免 lastIndex 副作用） */
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SummaryText({ text }: { text: string }) {
  // 用 split 的結果判斷「有沒有 UUID」，不要用 global regex 的 test()：
  // test() 會改 lastIndex，連續呼叫容易出現時好時壞的行為。
  const parts = text.split(UUID_SPLIT);
  if (!parts.some((part) => UUID_ONLY.test(part))) {
    // 沒有 UUID 就走原字串（避免多一層 Fragment 包裝影響既有樣式）
    return <>{text}</>;
  }
  return (
    <>
      {parts.map((part, index) =>
        UUID_ONLY.test(part) ? (
          <Fragment key={index}>
            <span className="font-mono text-[0.92em]">{part}</span>
            <span className="ml-0.5 whitespace-nowrap text-[10px] text-white/40">
              （舊紀錄）
            </span>
          </Fragment>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}
