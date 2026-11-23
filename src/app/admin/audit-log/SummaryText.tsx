import { Fragment } from "react";

/**
 * src/app/admin/audit-log/SummaryText.tsx — 摘要裡的會員識別碼 → 人名
 *
 * 背景：早期寫入的稽核紀錄，summary 裡直接塞了會員 UUID（例如「永久刪除會員
 * 5f2a…-…」），因為當時還沒有把 id 換成人名。站主要求：管理員要看得懂
 * 「操作了誰」，看到一串 UUID 等於看不懂。
 *
 * 做法（顯示層翻譯，不改資料庫原文）：
 *   ① page.tsx 用一次批次查詢（不是 N+1）把這頁出現的 UUID 換成 display_name，
 *      以 `names` 傳進來；
 *   ② 查得到 → 顯示人名；
 *   ③ 查不到（帳號已被永久刪除，profiles 那列已 cascade 消失）→ 顯示
 *      「名稱未留存」——名稱真的沒有留下來，不能假裝知道；
 *   ④ 原文 UUID 保留在 `title`（滑鼠停留可看），追查時仍拿得到，
 *      但不會擠在正文裡干擾閱讀。
 *
 * 不改寫 summary 本身：稽核紀錄必須保持原文，翻譯只發生在渲染時。
 */

const UUID_SPLIT =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** 逐段判斷用（非 global，避免 lastIndex 副作用） */
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 帳號已被永久刪除、名稱真的查不到時顯示的字（事實陳述，不是猜測） */
const NAME_UNAVAILABLE = "未記錄名稱";
/** 不是會員（例如報名編號）而又查不到時用短的，讀起來才不會誤會是「漏了人名」 */
const ID_UNAVAILABLE = "未記錄";

export function SummaryText({
  text,
  names,
}: {
  text: string;
  /** UUID（小寫）→ 會員名稱。沒有對應 = 該帳號已不存在 */
  names?: Record<string, string>;
}) {
  // 用 split 的結果判斷「有沒有 UUID」，不要用 global regex 的 test()：
  // test() 會改 lastIndex，連續呼叫容易出現時好時壞的行為。
  const parts = text.split(UUID_SPLIT);
  if (!parts.some((part) => UUID_ONLY.test(part))) {
    // 沒有 UUID 就走原字串（避免多一層 Fragment 包裝影響既有樣式）
    return <>{text}</>;
  }
  /* 摘要裡有「會員」二字 → 那個 UUID 指的是一個會員（顯示「未記錄名稱」）；
     沒有的話（例如 HYROX 報名編號）→ 顯示「未記錄」，避免誤讀成人名。 */
  const fallback = text.includes("會員") ? NAME_UNAVAILABLE : ID_UNAVAILABLE;
  return (
    <>
      {parts.map((part, index) => {
        if (!UUID_ONLY.test(part)) {
          return <Fragment key={index}>{part}</Fragment>;
        }
        const resolved = names?.[part.toLowerCase()];
        return (
          <span
            key={index}
            /* 原文 UUID 留在 tooltip：正文不再出現，但追查時仍拿得到 */
            title={part}
            className={resolved ? undefined : "text-white/50"}
          >
            {resolved ?? fallback}
          </span>
        );
      })}
    </>
  );
}
