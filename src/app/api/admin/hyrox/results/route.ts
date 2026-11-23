/**
 * GET /api/admin/hyrox/results — 完賽成績管理端名單（管理員限定）
 *
 * 契約：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §1.5-③（定稿）
 *       GET ?status=pending|approved|rejected&division=<code 選填>
 *
 * 這是全站唯一會出現「提交者姓名」的完賽榜端點（公開端只讀
 * hyrox_results_public 檢視，沒有姓名）。匿名與一般會員一律 401/403。
 *
 * 排序（給人工判重用，方案 R-03）：類別 → 比賽日（新在前）→ 完賽時間 →
 * 建立時間。同隊兩位隊友各交一次同一成績時，兩筆會相鄰出現，
 * 管理員核可一筆、拒絕另一筆即可。
 *
 * 降級（§1.5-⑥）：migration 未跑（42P01 / PGRST205）→ 400 SCHEMA_OUTDATED，
 * 可讀訊息、不洩內部細節。
 *
 * Owner：白客（backend-engineer）
 */

import { authorizeModule } from "@/lib/admin-guard";
import {
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonOk,
  jsonValidation,
} from "@/lib/api";

/** 私有桶與 signed URL（同 /api/admin/hyrox/registrations 的做法） */
const PROOF_BUCKET = "run-screenshots";
const PROOF_URL_TTL = 60 * 60;

/** 一頁上限（與 /api/admin/hyrox/registrations 同值）。
 *  超量時截斷並寫 server log 留痕——契約沒有 truncated 欄位（§1.5 定稿，
 *  不得自創欄位），所以只能用 log 告知，不靜默假裝列完了。 */
const PAGE_LIMIT = 500;

const STATUS_VALUES = ["pending", "approved", "rejected"] as const;
type ResultStatus = (typeof STATUS_VALUES)[number];

/** 完賽秒數 → HH:MM:SS（server 格式化，前端不再算；契約 ③ 的 finish_label） */
function finishLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** PostgREST 回傳的原始列（profile/division 是嵌入的關聯物件） */
type RawRow = {
  id: string;
  division_code: string;
  race_name: string;
  race_date: string;
  finish_seconds: number;
  team_name: string | null;
  teammates: unknown;
  image_path: string;
  note: string | null;
  status: ResultStatus;
  admin_note: string | null;
  created_at: string;
  profile: { display_name: string | null } | null;
  division: { label: string } | null;
};

export async function POST() {
  return jsonMethodNotAllowed();
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

export async function GET(request: Request) {
  try {
    // 歸 review 模組（不是 events）：三支都只服務 /admin/review 的「HYROX 成績」分頁，
    // 與 hyrox/review 屬同一審核工作流；歸 events 會讓「UI 在 review、守衛在 events」脫節。
    const auth = await authorizeModule("review", { write: false });
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    /* --- 參數：status（必為三值之一，預設 pending）／division（選填）--- */
    const params = new URL(request.url).searchParams;
    const rawStatus = (params.get("status") ?? "pending").trim();
    if (!(STATUS_VALUES as readonly string[]).includes(rawStatus)) {
      return jsonValidation({
        status: `狀態只接受 ${STATUS_VALUES.join("／")}。`,
      });
    }
    const status = rawStatus as ResultStatus;

    const rawDivision = (params.get("division") ?? "").trim();
    if (rawDivision.length > 40) {
      return jsonValidation({ division: "類別代碼格式錯誤。" });
    }

    /* --- 取數：join profiles（指定 FK，避開 PGRST201）與 divisions --- */
    let query = supabase
      .from("hyrox_results")
      .select(
        "id,division_code,race_name,race_date,finish_seconds,team_name," +
          "teammates,image_path,note,status,admin_note,created_at," +
          "profile:profiles!hyrox_results_user_id_fkey(display_name)," +
          "division:hyrox_divisions(label)"
      )
      .eq("status", status)
      // 給人工判重（R-03）：同類別同日的相近成績排在一起
      .order("division_code", { ascending: true })
      .order("race_date", { ascending: false })
      .order("finish_seconds", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(PAGE_LIMIT);

    if (rawDivision) query = query.eq("division_code", rawDivision);

    const { data, error } = await query;

    if (error) {
      if (isSchemaMissing(error)) return schemaOutdated();
      return jsonInternal("GET /api/admin/hyrox/results read", error);
    }

    const rows = (data as unknown as RawRow[]) ?? [];
    if (rows.length >= PAGE_LIMIT) {
      console.warn(
        `[api] 完賽成績名單達上限 ${PAGE_LIMIT} 列（status=${status}），後續列未列出。`
      );
    }

    /* --- 截圖 signed URL：一次簽一批（1 小時），只簽有值的列 --- */
    const paths = rows
      .map((r) => r.image_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);

    const urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(PROOF_BUCKET)
        .createSignedUrls(paths, PROOF_URL_TTL);

      if (signErr) {
        // 簽名失敗不影響名單本身（proof_url 回 null），server log 留痕
        console.warn("[admin/hyrox/results] 截圖簽名失敗（proof_url 回 null）：", signErr.message);
      }
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl);
      }
    }

    const results = rows.map((r) => ({
      id: r.id,
      display_name: r.profile?.display_name ?? null,
      division_code: r.division_code,
      division_label: r.division?.label ?? r.division_code,
      race_name: r.race_name,
      race_date: r.race_date,
      finish_seconds: Number(r.finish_seconds ?? 0),
      finish_label: finishLabel(Number(r.finish_seconds ?? 0)),
      team_name: r.team_name ?? null,
      teammates: Array.isArray(r.teammates) ? (r.teammates as string[]) : [],
      note: r.note ?? null,
      status: r.status,
      admin_note: r.admin_note ?? null,
      created_at: r.created_at,
      proof_url: r.image_path ? (urlMap.get(r.image_path) ?? null) : null,
    }));

    return jsonOk({ results });
  } catch (err) {
    return jsonInternal("GET /api/admin/hyrox/results", err);
  }
}

/* =============================================================
 * 降級判斷（migration 未跑）
 * ============================================================= */

function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(message) && /hyrox_(results|divisions)/i.test(message);
}

function schemaOutdated() {
  return jsonErr("完賽排行榜尚未開放，請稍後再試。", "SCHEMA_OUTDATED", 400);
}
