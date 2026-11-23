import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AuditLogCards } from "./AuditLogCards";
import { SummaryText } from "./SummaryText";
import { AuditLogPager } from "./AuditLogPager";
import { AdminDeniedCard } from "@/app/admin/_components/AdminDeniedCard";
import { getAdminAccess } from "@/app/admin/_components/adminAccess";
import { canView, MODULE_LABELS as ACCESS_MODULE_LABELS } from "@/components/adminModules";

export const metadata = { title: "操作紀錄" };
export const dynamic = "force-dynamic";

/**
 * src/app/admin/audit-log/page.tsx — 後台「操作紀錄」頁（T-15 前端部分）
 *
 * Owner：方砚。對齊 V1 計劃 O5 驗收標準：後台「操作紀錄」頁可依時間倒序看到
 * 操作紀錄：時間、操作者、模組、動作、摘要；僅管理員可見。
 *
 * 資料來源：admin_audit_log（supabase/migration-audit-log.sql；RLS 僅管理員
 * select／insert）。寫入點（白客，src/lib/audit.ts）：七個內容路由的
 * POST→save／DELETE→restore，加草稿路由的 publish／save-draft／discard-draft。
 *
 * 【分頁：server 端，不是前端切】
 * 改動前是 `.limit(100)` 一次撈完再全部渲染，手機 100 張卡片 = 17,081px（20.2 屏）。
 * 現在改成 `.range(from, to)` + `{ count: "exact" }`：每次只抓一頁 20 筆，
 * 資料長到幾千筆也不會把 payload 與 DOM 撐爆。頁碼走 `?page=N`（純 GET，
 * 可分享、上一頁下一頁在瀏覽器歷史裡成立、SEO/除錯都看得到狀態）。
 *
 * 為什麼手機與桌面共用同一個 PAGE_SIZE（20）而不是桌面 50：
 *   ① 一條程式路徑、一組 URL，不會出現「手機第 2 頁 ≠ 桌面第 2 頁」的錯位；
 *   ② 桌面 100 列原本 5,673px，20 列／頁後約 1,600px，已經不需要另一套頁大小；
 *   ③ 若日後要拆成 50／頁，只需在此加一個 searchParams 並讓 AuditLogPager 帶上，
 *      分頁器與查詢都不用重寫。
 *
 * 排序穩定性：created_at 大量同秒（同一批匯入／同一支腳本）時，單靠
 * created_at desc 分頁會漏筆或重複（Postgres 對同值列的順序未定義），
 * 所以補第二排序鍵 id desc，讓每頁的邊界是確定的。
 *
 * 權限：/admin/* 全站由 src/app/admin/layout.tsx 把關（未登入／非管理員
 * 看不到本頁）；RLS 再兜一層（非管理員查回 0 列）。
 *
 * 取數模式复刻現有 admin 頁：server 元件以登入 session 的 createClient()
 * 直接查表；Supabase 未連接或查詢失敗時顯示可讀提示，不拋 500。
 */

interface AuditRow {
  id: string;
  created_at: string;
  module: string;
  action: string;
  summary: string;
  /** actor_id 的 embed；帳號被刪除（on delete set null）時為 null */
  profile: { id: string; display_name: string | null } | null;
}

/** 每頁筆數（手機與桌面共用，理由見檔頭） */
const PAGE_SIZE = 20;

/** 模組名（路由名）→ 中文（對照 migration-audit-log.sql 的寫入點） */
const MODULE_LABELS: Record<string, string> = {
  "site-content": "首頁文案",
  "site-nav": "導覽選單",
  "site-contact": "頁尾聯絡",
  "site-pages": "頁面文案",
  "site-blocks": "首頁區塊",
  "site-seo": "SEO",
  "site-settings": "網站設定",
  "site-draft": "草稿",
  rewards: "禮品管理",
  redemptions: "兌換管理",
  merchants: "商戶管理",
  "point-rules": "積分規則",
};

/** 動作 → 中文（對照 src/lib/audit.ts 已接線的 action 值） */
const ACTION_LABELS: Record<string, string> = {
  save: "儲存",
  restore: "回復原廠",
  publish: "發佈",
  "save-draft": "儲存草稿",
  "discard-draft": "丟棄草稿",
  create: "新增",
  update: "更新",
  deactivate: "停用",
  activate: "啟用",
  pin_generate: "產生 PIN",
  pin_reset: "重設 PIN",
  review: "審批兌換",
  fulfill: "核銷",
  award: "手動補發",
};

/** 澳門時區（UTC+8，全年無日光節約）的人話時間：2026/10/23 14:05 */
const MACAU_OFFSET_MS = 8 * 60 * 60 * 1000;

function formatMacauDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const macau = new Date(d.getTime() + MACAU_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${macau.getUTCFullYear()}/${pad(macau.getUTCMonth() + 1)}/${pad(
    macau.getUTCDate()
  )} ${pad(macau.getUTCHours())}:${pad(macau.getUTCMinutes())}`;
}

function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** ?page= 解析：只認正整數，其餘一律回第 1 頁（不猜使用者意思、不拋錯） */
function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  /* 兩級管理員：none 模組直接給拒訪卡（server 端 early return，不查資料、不閃現） */
  const access = await getAdminAccess();
  if (!canView(access, "audit")) return <AdminDeniedCard moduleLabel={ACCESS_MODULE_LABELS.audit} />;

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6">
        <PageIntro />
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          尚未連接 Supabase，操作紀錄暫時無法讀取。
        </div>
      </div>
    );
  }

  const params = await searchParams;
  let page = parsePage(params.page);

  const supabase = await createClient();
  let rows: AuditRow[] = [];
  let total = 0;
  let loadError = false;

  if (supabase) {
    // 為什麼要「先數再抓」兩支查詢，而不是一支 range 查詢順便帶 count：
    // PostgREST 對超出範圍的 range 直接回錯誤（不是回空陣列），所以「先抓、
    // 出錯再夾頁」這條路永遠走不到，?page=999 會變成整頁錯誤。
    // 先取總筆數 → 在程式裡把頁碼夾到 [1, totalPages] → 再抓一定存在的範圍。
    const counted = await supabase
      .from("admin_audit_log")
      .select("id", { count: "exact", head: true });

    if (counted.error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[audit-log] count failed:", counted.error.message);
      }
      loadError = true;
    } else {
      total = counted.count ?? 0;
      const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
      page = Math.min(page, lastPage);

      const from = (page - 1) * PAGE_SIZE;
      const { data, error } = await supabase
        .from("admin_audit_log")
        .select(
          "id, created_at, module, action, summary, profile:profiles(id, display_name)"
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[audit-log] query failed:", error.message);
        }
        loadError = true;
      } else {
        rows = (data as unknown as AuditRow[]) ?? [];
      }
    }
  } else {
    loadError = true;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageIntro />

      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          操作紀錄暫時讀不到，請稍後重新整理頁面；若持續失敗請聯絡技術人員。
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center text-sm text-white/70">
          尚無操作紀錄
        </div>
      ) : (
        <>
          {/* ===== 手機（<768px）：卡片列表，避免 720px 表格塞進 348px 容器 =====
              稽核紀錄是唯讀的，卡片只用「展開」看完整摘要，沒有任何寫入入口。 */}
          <AuditLogCards
            rows={rows.map((r) => ({
              id: r.id,
              time: formatMacauDateTime(r.created_at),
              actor: `操作人：${
                r.profile ? r.profile.display_name ?? "未具名會員" : "已刪除的會員"
              }`,
              module: moduleLabel(r.module),
              action: actionLabel(r.action),
              summary: r.summary,
            }))}
          />

          {/* ===== 桌面（≥768px）：原本的表格，欄位與樣式與改動前一致 ===== */}
          <div className="hidden overflow-x-auto rounded-xl border border-ink-line md:block">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">
              管理員操作紀錄（每頁 20 筆，依時間倒序）
            </caption>
            <thead>
              <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/70">
                <th className="py-3 pl-4 pr-4 whitespace-nowrap">時間</th>
                <th className="py-3 pr-4 whitespace-nowrap">操作者</th>
                <th className="py-3 pr-4 whitespace-nowrap">模組</th>
                <th className="py-3 pr-4 whitespace-nowrap">動作</th>
                <th className="py-3 pr-4">摘要</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 pl-4 pr-4 whitespace-nowrap text-white/75">
                    {formatMacauDateTime(r.created_at)}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-white/75">
                    操作人：
                    {r.profile
                      ? r.profile.display_name ?? "未具名會員"
                      : "已刪除的會員"}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">{moduleLabel(r.module)}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-white/75">
                    {actionLabel(r.action)}
                  </td>
                  <td className="py-3 pr-4 text-white/85">
                    <SummaryText text={r.summary} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <AuditLogPager
            page={page}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            total={total}
          />
        </>
      )}

      <p className="text-xs leading-relaxed text-white/60">
        每頁 20 筆、依時間倒序，時間以澳門時間計。紀錄由系統自動寫入，只供查閱，
        不能被修改或刪除。
      </p>
    </div>
  );
}

function PageIntro() {
  return (
    <div>
      <h2 className="text-2xl font-bold">操作紀錄</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/75">
        只有管理員能看到。
      </p>
    </div>
  );
}
