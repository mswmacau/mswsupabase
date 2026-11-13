/**
 * src/components/hyrox/shared.ts — HYROX 三頁共用的常數、純函式與凍結文案
 *
 * 型別一律從 @/lib/types 轉出（HyroxEvent / HyroxRegistration 等由白客定義，
 * 這裡只做 re-export，方便三頁用同一個 import 路徑；不要在此另立一份）。
 *
 * ⚠️ 本檔不含 JSX，server / client 兩邊都能 import。
 */

export type {
  HyroxEvent,
  HyroxRegistration,
  HyroxEventWithCounts,
  HyroxAdminRegistrationRow,
} from "@/lib/types";

import type { HyroxEvent, PaymentStatus } from "@/lib/types";

/* =============================================================
 * 報名表選項（文案凍結：組別配速由站主提供，不可自行改數字）
 * ============================================================= */

export const HYROX_GROUP_OPTIONS = [
  { value: "A", label: "A組（配速 4:00-4:30/km）" },
  { value: "B", label: "B組（5:00-5:30/km）" },
  { value: "C", label: "C組（6:00-6:30/km）" },
  { value: "D", label: "D組（7:00-7:30/km）" },
] as const;

export type HyroxGroup = (typeof HYROX_GROUP_OPTIONS)[number]["value"];

/** 代碼 → 顯示文字；未知代碼原樣顯示（後台若有人手改了自由文字也不會空白） */
export function groupLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const hit = HYROX_GROUP_OPTIONS.find((o) => o.value === code);
  return hit ? hit.label : code;
}

/** 付款狀態 → 徽章文字與樣式（前台與後台共用同一套口徑） */
export const PAYMENT_META: Record<
  PaymentStatus,
  { label: string; className: string }
> = {
  not_required: {
    label: "免付款",
    className: "bg-white/10 text-neutral-300 border-white/20",
  },
  pending_review: {
    label: "待確認付款",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  confirmed: {
    label: "已確認",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  rejected: {
    label: "已拒絕，可重交",
    className: "bg-red-500/15 text-red-300 border-red-500/40",
  },
};

/**
 * 訓練內容：HYROX 標準站點。
 * `/hyrox` 主頁與往期場次詳情頁共用同一份，兩邊文案不會走樣。
 */
export const HYROX_STATIONS = [
  { k: "跑步", v: "每完成一站跑 1 公里，全程 8 公里" },
  { k: "推／拉雪橇", v: "下肢與核心的爆發力" },
  { k: "划船機 · 滑雪機", v: "上肢與心肺耐力" },
  { k: "負重行走 · 沙袋箭步", v: "負重下的穩定與肌耐力" },
  { k: "波比跳 · 藥球上拋", v: "最後階段的意志力" },
] as const;

/** 往期卡片的相片數文案；還沒有相片時照實說「整理中」，不顯示 0 張 */
export function photoCountLabel(count: number | null | undefined): string {
  const n = Number(count ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "相片整理中";
  return `${Math.trunc(n)} 張相片`;
}

/** 費用（分）→ '澳門幣 50 元'；未設定或 0 回 '免費' */
export function feeLabel(feeCents: number | null | undefined): string {
  const cents = Number(feeCents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return "免費";
  const mop = cents / 100;
  return `澳門幣 ${Number.isInteger(mop) ? mop : mop.toFixed(2)} 元`;
}

/**
 * 場次日期文字：日期未定（null／空字串）時回 null，
 * 由呼叫端決定顯示「日期待定」還是整塊隱藏。
 */
export function eventDateValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * 挑「下一場」：published 且日期未過的最近一場；全部已過期時，
 * 退回沒有日期的 published 場次（日期待定也算下一場）。
 * 兩者都沒有回 null（上層顯示「日期待定／正在安排」空狀態）。
 */
export function pickNextEvent(
  events: HyroxEvent[],
  today: string
): HyroxEvent | null {
  const dated = events
    .filter((e) => e.status === "published" && e.event_date && e.event_date >= today)
    .sort((a, b) => ((a.event_date ?? "") < (b.event_date ?? "") ? -1 : 1));
  if (dated.length > 0) return dated[0];

  const undated = events.find((e) => e.status === "published" && !e.event_date);
  return undated ?? null;
}

/* =============================================================
 * 凍結文案（逐字照抄，不可改寫、不可摘要）
 * 來源：站主提供的免責聲明同意書與天氣取消聲明原文。
 * 任何修改都需要站主書面確認——這裡刻意拆成「前言 + 條文陣列」，
 * 讓渲染時能保有編號與段落，同時方便逐字比對。
 * ============================================================= */

export const DISCLAIMER_INTRO =
  "本人是次自願參加由MSW（以下簡稱「主辦單位」）主辦的Hyrox Outdoor training（以下簡稱「training」），聲明對是次training已充分了解，HYROX運動含高強度體能訓練，可能存在肌肉拉傷、關節損傷等潛在風險，現作出如下聲明：";

export const DISCLAIMER_CLAUSES: readonly string[] = [
  "1. 本人聲明確認自身身體狀況（無心腦血管疾病、骨骼肌肉疾病等不適合高強度運動的病史），未處於傷病康復期，亦無孕狀況，符合測試允許參與的健康條件；若隱瞞健康問題所導致的一切意外，相關責任與損失由本人自行承擔。",
  "2. 測試期間，若本人出現頭暈、乏力、疼痛等不適症狀，必須即時停止測試並告知教練；未即時終止測試導致症狀加重，相關後果將由本人自行負責。",
  "3. 主辦單位、教練如因不可抗力（包括但不限於天災、突發公共事件等）或非因故意、重大過失，導致 training 無法正常開展或引致任何損失，無須承擔由此而生的一切法律責任（包括但不限於人身傷害、財產損失賠償等），本人並承諾不就相關事宜向主辦單位或教練提起投訴、訴訟或主張其他權利。",
  "4. 本人同意主辦單位為安全、記錄及推廣目的拍攝本人之影像和影片，並同意這些影像和影片將會是主辦單位的專有財產。本人亦同意主辦單位可以任何形式或媒界使用這些拍攝本人的影像和影片而毋須以任何形式向本人付款或賠償。",
  "5. 本人同意主辦單位可以根據其私隱政策（其複本本人已閱）收集、使用和／或披露本人提供的任何個人信息。",
  "6. 本「免責聲明同意書」須受澳門特別行政區法律管轄並按其詮釋，澳門法院對與本「免責聲明同意書」的實施、訂立或詮釋有關的任何爭議具有專屬管轄權。",
  "7. 如有任何爭議，主辦單位將保留最終解釋權。",
];

export const DISCLAIMER_TEXT = [DISCLAIMER_INTRO, ...DISCLAIMER_CLAUSES].join(
  "\n\n"
);

/** 天氣取消聲明（凍結文案，逐字照抄） */
export const WEATHER_NOTICE =
  "如活動當日遭遇惡劣天氣（包括但不限於：氣象部門發布之黃色或以上暴雨警告、雷暴警告、持續性中至大雨、颱風等），基於安全考量，活動將會取消。";

/** HYROX 場次的固定系列標籤 */
export const HYROX_SERIES = "hyrox";

/*
 * 註：原本這裡有一個 withHyroxNav()，在元件層把 HYROX 硬插進導覽列
 * （因為導覽內容來自 DB 的 site_nav，只改 config 不會在線上出現）。
 * 2026 導覽收斂後 /hyrox 已是 site_nav 的正式子項（「活動」→「戶外 HYROX 訓練」），
 * 不再需要在元件層注入，已移除。本檔其餘常數與純函式（HYROX_STATIONS、
 * photoCountLabel 等）仍供 /hyrox 各頁使用。
 */
