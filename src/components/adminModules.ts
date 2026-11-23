/**
 * src/app/admin/_components/adminModules.ts — 兩級管理員的「模組」定義與對照
 *
 * 為什麼要這一支：白客的 getMyAdminAccess() 回的是
 * `Record<13 個模組, 'full' | 'read' | 'none'>`，但側欄是「路徑」、
 * 頁面是「路徑」，兩邊都需要同一份對照才能一致。對照表只能有一份，
 * 否則側欄隱藏了、直接打 URL 還進得去（或反過來）。
 *
 * 純常數 + 純函式：server 與 client 都可以 import（AdminNav 是 client component）。
 */

/**
 * 型別來源：白客的 src/lib/admin-guard.ts（後端守衛與 SQL 都用同一份）。
 * 這裡用 `import type` 再轉出，**不自己重定義** —— 兩份型別一旦漂移，
 * 前端會對著不存在的模組名做判斷。
 */
import type { AdminModule, ModuleAccess } from "@/lib/admin-guard";

export type { AdminModule, ModuleAccess };

/** 舊名相容（本目錄其他檔案已用 AdminAccessLevel） */
export type AdminAccessLevel = ModuleAccess;

export type AdminAccess = Record<AdminModule, ModuleAccess>;

export const ADMIN_MODULES: readonly AdminModule[] = [
  "analytics",
  "schedule",
  "events",
  "members",
  "review",
  "points",
  "rewards",
  "commerce",
  "content",
  "slides",
  "coaches",
  "theme",
  "audit",
] as const;

/** 模組中文名（拒訪卡與除錯訊息用，與側欄標籤一致） */
export const MODULE_LABELS: Record<AdminModule, string> = {
  analytics: "數據分析",
  schedule: "班表",
  events: "活動",
  members: "會員",
  review: "待審核",
  points: "積分與發券",
  rewards: "禮品",
  commerce: "兌換與商戶",
  content: "網站內容",
  slides: "首頁輪播",
  coaches: "教練",
  theme: "外觀設定",
  audit: "操作紀錄",
};

/** 第一級（站主）：全部 full */
export const FULL_ACCESS: AdminAccess = {
  analytics: "full",
  schedule: "full",
  events: "full",
  members: "full",
  review: "full",
  points: "full",
  rewards: "full",
  commerce: "full",
  content: "full",
  slides: "full",
  coaches: "full",
  theme: "full",
  audit: "full",
};

/**
 * 第二級（店長／教練）：可日常營運，但看得到改不到會員與禮品，
 * 分析／網站內容／外觀／操作紀錄完全看不到。
 * 這張表是 team-lead 2026-11-23 拍板的契約，改動前請先確認。
 */
export const LEVEL2_ACCESS: AdminAccess = {
  analytics: "none",
  schedule: "full",
  events: "full",
  members: "read",
  review: "full",
  points: "full",
  rewards: "read",
  commerce: "full",
  content: "none",
  slides: "full",
  coaches: "full",
  theme: "none",
  audit: "none",
};

/** 無身分／查詢失敗：全部 none（fail closed） */
export const NONE_ACCESS: AdminAccess = {
  analytics: "none",
  schedule: "none",
  events: "none",
  members: "none",
  review: "none",
  points: "none",
  rewards: "none",
  commerce: "none",
  content: "none",
  slides: "none",
  coaches: "none",
  theme: "none",
  audit: "none",
};

/**
 * 側欄／子路由 → 模組。
 *
 * 13 個模組對 14 個側欄項目（多出來的是「今日工作台」，它不屬任何模組，
 * 一律顯示）。子路由歸父模組，避免「側欄看不到但直接打 URL 進得去」：
 *   · /admin/merchants、/admin/point-rules → commerce（商戶 PIN／積分規則）
 *   · /admin/hyrox → events（HYROX 是活動的分頁）
 *   · /admin/coupons、/admin/checkins、/admin/monthly → points（發券／簽到／月度達標）
 */
export const PATH_MODULE: Record<string, AdminModule> = {
  "/admin/analytics": "analytics",
  "/admin/schedule": "schedule",
  "/admin/events": "events",
  "/admin/hyrox": "events",
  "/admin/members": "members",
  "/admin/review": "review",
  "/admin/points": "points",
  "/admin/coupons": "points",
  "/admin/checkins": "points",
  "/admin/monthly": "points",
  "/admin/rewards": "rewards",
  "/admin/redemptions": "commerce",
  "/admin/merchants": "commerce",
  "/admin/point-rules": "commerce",
  "/admin/content": "content",
  "/admin/slides": "slides",
  "/admin/coaches": "coaches",
  "/admin/site-settings": "theme",
  "/admin/audit-log": "audit",
};

/**
 * 由路徑找模組：取「最長前綴」，所以 /admin/points/xxx 也會歸 points。
 * 回 null = 這條路徑不屬 13 模組（例如 /admin 工作台）→ 一律當 full。
 */
export function moduleForPath(pathname: string): AdminModule | null {
  const path = pathname.replace(/\/+$/, "") || "/admin";
  let best: { mod: AdminModule; len: number } | null = null;
  for (const [prefix, mod] of Object.entries(PATH_MODULE)) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      if (!best || prefix.length > best.len) best = { mod, len: prefix.length };
    }
  }
  return best?.mod ?? null;
}

/** 這個模組看不看得到（none = 看不到） */
export function canView(access: AdminAccess, mod: AdminModule): boolean {
  return access[mod] !== "none";
}

/** 這個模組是不是唯讀（read） */
export function isReadOnly(access: AdminAccess, mod: AdminModule): boolean {
  return access[mod] === "read";
}

/**
 * 由路徑判斷「是否唯讀」——給各頁面用（例如 members 頁顯示唯讀提示）。
 * 不屬任何模組的路徑回 false。
 */
export function isPathReadOnly(access: AdminAccess, pathname: string): boolean {
  const mod = moduleForPath(pathname);
  return mod ? access[mod] === "read" : false;
}
