import { revalidatePath } from "next/cache";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * /api/admin/merchants — 核銷商戶管理（管理員限定）
 *
 * GET  列表（永不回 pin_hash）
 * POST { action:"create", name, contact_note }
 *      { action:"status", id, status:"active"|"inactive" }
 *      { action:"pin",    id, valid_days }
 *
 * PIN 規則（DB 函式負責 hash 與有效期，本 route 只轉發）：
 *  - 從未設定過（pin_hash 為 null 或 must_reset=true）→ admin_generate_merchant_pin
 *  - 已有正式 PIN → admin_reset_merchant_pin（舊 PIN 即時失效）
 *  - 明文 PIN 只在這次回應出現，不寫入任何日誌或資料表。
 *  - 兩支 RPC 自己會寫 admin_audit_log（module=merchants）。
 */

type Body = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type PinResult = {
  ok?: boolean;
  code?: string;
  pin?: string;
  expires_at?: string;
};

export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("merchants")
      .select("id,name,contact_note,must_reset,pin_valid_days,pin_expires_at,status,created_at,pin_hash")
      .order("created_at", { ascending: true });

    if (error) return jsonDbError("GET /api/admin/merchants", error);

    // pin_hash 永不外流：只轉成 has_pin 布林值
    const merchants = ((data ?? []) as { pin_hash?: string | null }[]).map((row) => {
      const { pin_hash, ...rest } = row;
      return { ...rest, has_pin: Boolean(pin_hash) };
    });

    return jsonOk({ merchants });
  } catch (err) {
    return jsonInternal("GET /api/admin/merchants", err);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = (await readJson(request)) as Body | null;
    if (!body) return jsonBadJson();

    const action = text(body.action);

    /* ---------- 新增商戶 ---------- */
    if (action === "create") {
      const fields: Record<string, string> = {};
      const name = text(body.name);
      if (name.length < 1 || name.length > 60) fields.name = "請填 1–60 字的商戶名稱。";
      const contactNote = text(body.contact_note);
      if (contactNote.length > 200) fields.contact_note = "聯絡備註最多 200 字。";
      if (Object.keys(fields).length > 0) return jsonValidation(fields);

      const { data, error } = await supabase
        .from("merchants")
        .insert({
          name,
          contact_note: contactNote || null,
          // 新商戶未有 PIN：must_reset=true，店員在未產生 PIN 前核銷一律被拒
          must_reset: true,
          status: "active",
        })
        .select("id")
        .single();

      if (error) return jsonDbError("POST /api/admin/merchants create", error);

      await writeAuditLog(
        supabase,
        actorId,
        "merchants",
        "create",
        `新增商戶「${name}」（尚未產生 PIN）`
      );
      revalidatePath("/admin/merchants");
      revalidatePath("/admin/rewards");

      return jsonOk({
        id: (data as { id?: string } | null)?.id ?? null,
        message: "商戶已新增，請記得為它產生 PIN。",
      });
    }

    /* ---------- 啟用／停用 ---------- */
    if (action === "status") {
      const id = text(body.id);
      if (!isUuid(id)) return jsonValidation({ id: "商戶編號格式錯誤。" });
      const status = text(body.status);
      if (status !== "active" && status !== "inactive") {
        return jsonValidation({ status: "狀態只接受啟用或停用。" });
      }

      const { data, error } = await supabase
        .from("merchants")
        .update({ status })
        .eq("id", id)
        .select("id,name,status")
        .maybeSingle();

      if (error) return jsonDbError("POST /api/admin/merchants status", error);
      if (!data) return jsonNotFound("找不到這間商戶。");

      const name = (data as { name?: string }).name ?? "";
      await writeAuditLog(
        supabase,
        actorId,
        "merchants",
        status === "active" ? "activate" : "deactivate",
        `${status === "active" ? "啟用" : "停用"}商戶「${name}」`
      );
      revalidatePath("/admin/merchants");
      revalidatePath("/admin/rewards");

      return jsonOk({
        status,
        message: status === "active" ? "商戶已啟用。" : "商戶已停用。",
      });
    }

    /* ---------- 產生／重設 PIN ---------- */
    if (action === "pin") {
      const id = text(body.id);
      if (!isUuid(id)) return jsonValidation({ id: "商戶編號格式錯誤。" });

      const daysRaw = body.valid_days === undefined ? 90 : Number(body.valid_days);
      const validDays = Number.isFinite(daysRaw) ? Math.trunc(daysRaw) : NaN;
      if (!Number.isFinite(validDays) || validDays < 1 || validDays > 3650) {
        return jsonValidation({ valid_days: "有效天數需為 1–3650 的整數。" });
      }

      const { data: current, error: curErr } = await supabase
        .from("merchants")
        .select("id,name,pin_hash,must_reset")
        .eq("id", id)
        .maybeSingle();

      if (curErr) return jsonDbError("POST /api/admin/merchants pin load", curErr);
      if (!current) return jsonNotFound("找不到這間商戶。");

      const row = current as { pin_hash?: string | null; must_reset?: boolean; name?: string };
      const isFirstIssue = !row.pin_hash || row.must_reset === true;

      const { data, error } = await supabase.rpc(
        isFirstIssue ? "admin_generate_merchant_pin" : "admin_reset_merchant_pin",
        { p_merchant_id: id, p_valid_days: validDays }
      );

      if (error) {
        if (error.code === "PGRST202") {
          return jsonErr("PIN 功能暫未部署。", "SCHEMA_OUTDATED", 503);
        }
        return jsonDbError("POST /api/admin/merchants pin", error);
      }

      const result = (Array.isArray(data) ? data[0] : data) as PinResult | null;
      if (!result?.ok) {
        if (result?.code === "NOT_FOUND") return jsonNotFound("找不到這間商戶。");
        if (result?.code === "NOT_ADMIN") return jsonErr("權限不足。", "FORBIDDEN", 403);
        return jsonErr("PIN 產生失敗，請稍後再試。", "INTERNAL", 500);
      }

      revalidatePath("/admin/merchants");

      return jsonOk({
        pin: result.pin ?? "",
        expires_at: result.expires_at ?? null,
        first_issue: isFirstIssue,
        message: isFirstIssue ? "PIN 已產生。" : "PIN 已重設，舊 PIN 即時失效。",
      });
    }

    return jsonValidation({}, "不支援的操作。");
  } catch (err) {
    return jsonInternal("POST /api/admin/merchants", err);
  }
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}
