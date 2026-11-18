/**
 * 收費與會籍（/pricing）的價目資料——全站唯一的價目來源。
 *
 * 紀律（站主要求）：
 *  1. 金額、堂數、期限一律照站主價目表**逐字**輸入，不在頁面層改寫、不換算、不加「起」以外的字
 *  2. 浮動收費（巴士、住宿等逐場不同）**不放本頁**：那些由賽事頁逐場填
 *  3. 要改價錢／加方案／刪方案，只改這個檔案，`page.tsx` 不用動
 *  4. `metal: null` 代表「此方案不適用 METAL 會員價」，頁面顯示「—」，
 *     不要自行補一個價錢進去
 */

export type PriceGroupKey = "single" | "pack" | "combo" | "private";

export interface PriceRow {
  /** 方案名（逐字，含堂數） */
  name: string;
  /** 「包含什麼」一行；只由價目表本身推導，不新增事實 */
  include: string;
  /** MSW 會員價（含幣值，逐字） */
  msw: string;
  /** METAL 會員價；null = 不適用 */
  metal: string | null;
}

export interface PriceGroup {
  key: PriceGroupKey;
  /** 摺疊標題 */
  title: string;
  /** 收合狀態下也看得見的一句話，避免「要全部展開才知道多少錢」 */
  hint: string;
  /** 預設是否展開（只有「單堂體驗」展開，其餘收合＝頁面不會太長） */
  open: boolean;
  rows: PriceRow[];
}

/** 四組價目（順序＝頁面順序） */
export const PRICE_GROUPS: readonly PriceGroup[] = [
  {
    key: "single",
    title: "單堂體驗",
    hint: "單堂 MOP$100 起",
    open: true,
    rows: [
      {
        name: "單堂",
        include: "一堂課，適合第一次試堂。",
        msw: "MOP$100",
        metal: "MOP$200",
      },
    ],
  },
  {
    key: "pack",
    title: "套票",
    hint: "10 堂 MOP$2,000 起",
    open: false,
    rows: [
      {
        name: "10 堂 + 1 堂",
        include: "10 堂課，三個月內用完，送 1 堂。",
        msw: "MOP$2,000",
        metal: "MOP$1,000",
      },
      {
        name: "進階 20 堂 + 3 堂",
        include: "20 堂課，三個月內用完，送 3 堂。",
        msw: "MOP$3,688",
        metal: null,
      },
    ],
  },
  {
    key: "combo",
    title: "會籍組合",
    hint: "會籍組合 MOP$1,688 起",
    open: false,
    rows: [
      {
        name: "會籍 + 送 1 堂",
        include: "會籍，送 1 堂課，含 3 個月 METAL。",
        msw: "MOP$1,688",
        metal: null,
      },
      {
        name: "初階 10 堂 + 2 堂",
        include: "10 堂課，送 2 堂課，含 METAL 3 個月會籍。",
        msw: "MOP$2,688",
        metal: null,
      },
    ],
  },
  {
    key: "private",
    title: "私人班",
    hint: "價錢請 DM 查詢",
    open: false,
    rows: [
      {
        name: "私人 1 對 1／1 對 2",
        include: "一對一或一對二私人教學。",
        msw: "請 DM 查詢",
        metal: "請 DM 查詢",
      },
    ],
  },
];

/** 課程一覽：名稱與說明取自 `training_classes`（班表同一份資料），不另行改寫 */
export interface CourseItem {
  name: string;
  minutes: number;
  desc: string;
}

export const COURSES: readonly CourseItem[] = [
  {
    name: "Running Club",
    minutes: 60,
    desc: "每週固定晨跑團練，配速分組進行。",
  },
  {
    name: "街健基礎力量",
    minutes: 90,
    desc: "引體上升、雙槓屈臂撐、核心基礎力量訓練。",
  },
  {
    name: "Hyrox (Foundation)",
    minutes: 60,
    desc: "Hyrox 基礎動作與器材熟悉。",
  },
  {
    name: "Hyrox (Power)",
    minutes: 60,
    desc: "Hyrox 力量段（雪橇推拉、農夫走路）。",
  },
  {
    name: "Hyrox (Engine)",
    minutes: 60,
    desc: "Hyrox 心肺段（划船機、滑雪機、Burpee）。",
  },
  {
    name: "街健花式動態",
    minutes: 90,
    desc: "街健花式動作串接與動態技巧。",
  },
];

/** 付款方式（站主確認過的現況，不可寫成「已支援線上付款」） */
export const PAYMENT =
  "目前以二維碼付款，完成後把截圖上載到網站，由教練確認後入帳。線上直接付款（MP）正在開發。";

/** 備註（逐字，四條） */
export const NOTES: readonly string[] = [
  "套票需三個月內使用",
  "場地僅適用 PUNK METAL",
  "課堂不包含其他工作坊",
  "澳門街頭健身協會保留最終決定權",
];

/** METAL 會籍合作（站主授權文字；不放價錢，Metal 會籍由 Metal 收費） */
export const METAL_PARTNER_TITLE = "METAL 會籍合作";
export const METAL_PARTNER_BODY =
  "加入 METAL 會籍後，可用 METAL 會員價上 MSW 的課。有興趣加入會籍，可向 METAL 查詢詳情。";
