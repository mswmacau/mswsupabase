import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "操作紀錄" };
export const dynamic = "force-dynamic";

/**
 * src/app/admin/audit-log/page.tsx — 後台「操作紀錄」頁（T-15 前端部分）
 *
 * Owner：方砚。對齊 V1 計劃 O5 驗收標準：後台「操作紀錄」頁可依時間倒序看到
 * 最近 100 筆：時間、操作者、模組、動作、摘要；僅管理員可見。
 *
 * 資料來源：admin_audit_log（supabase/migration-audit-log.sql；RLS 僅管理員
 * select／insert）。寫入點（白客，src/lib/audit.ts）：七個內容路由的
 * POST→save／DELETE→restore，加草稿路由的 publish／save-draft／discard-draft。
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
};

/** 動作 → 中文（對照 src/lib/audit.ts 已接線的 action 值） */
const ACTION_LABELS: Record<string, string> = {
  save: "儲存",
  restore: "回復原廠",
  publish: "發佈",
  "save-draft": "儲存草稿",
  "discard-draft": "丟棄草稿",
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

export default async function AdminAuditLogPage() {
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

  const supabase = await createClient();
  let rows: AuditRow[] = [];
  let loadError = false;

  if (supabase) {
    const { data, error } = await supabase
      .from("admin_audit_log")
      .select("id, created_at, module, action, summary, profile:profiles(id, display_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[audit-log] query failed:", error.message);
      }
      loadError = true;
    } else {
      rows = (data as unknown as AuditRow[]) ?? [];
    }
  } else {
    loadError = true;
  }

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
        <div className="overflow-x-auto rounded-xl border border-ink-line">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">
              管理員操作紀錄（最近 100 筆，依時間倒序）
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
                    {r.profile
                      ? r.profile.display_name ?? "未具名會員"
                      : "已刪除的會員"}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">{moduleLabel(r.module)}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-white/75">
                    {actionLabel(r.action)}
                  </td>
                  <td className="py-3 pr-4 text-white/85">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-white/60">
        只顯示最近 100 筆，時間以澳門時間計。紀錄由系統自動寫入，只供查閱，
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
        後台誰在何時改了什麼，這裏依時間倒序記錄網站內容與草稿的儲存、回復與發佈操作。
        只有管理員能看到。
      </p>
    </div>
  );
}
