/**
 * /api/event-registrations — 會員端活動報名／取消報名（T-26）
 *
 * POST   { event_id: uuid }  報名某一場活動 → 200
 * DELETE { event_id: uuid }  取消報名 → 200
 *
 * 契約：計劃 V2 §8.4（复刻 /api/training/checkins 的檢查鏈）
 * 錯誤一覽（§8.4 原文）：
 *   401 未登入 / 400 格式或活動未上架或已過期或已報名 / 404 活動不存在或未報名 / 500
 *   NEW-P2-3（後補）：走錯入口——HYROX 賽事（events.series='hyrox'）不能用這支 → 400
 *
 * 檢查鏈（逐條對應 checkins 的 NEW-P2-1／NEW-P2-2）：
 *   1) isSupabaseConfigured → 未設定 400
 *   2) 未登入 → 401
 *   3) body 畸形 → 400；event_id 缺 → 400；UUID 格式 → 400（不讓 22P02 變 500）
 *   4) 活動不存在 → 404（先查後寫，不讓 FK 錯誤變 500）
 *   5) status != 'published' → 400；event_date 已過 → 400（口徑同前台
 *      getPublishedEvents：只認 event_date，多日活動的 end_date 不參與判定）
 *   6) series == 'hyrox' → 400（NEW-P2-3：HYROX 有自己的三步報名流程，
 *      見 /api/hyrox/register。通用端點放行會產生沒有付款截圖、沒有免責聲明
 *      時間的 pending_review 列，並佔用 unique(event_id, user_id)，
 *      之後走正常流程會被 409 擋死）
 *   7) 重複報名 → 400（先查給友好訊息；unique 約束 23505 是最終防線）
 *   8) 取消未報名的記錄 → 404
 *
 * 邊界（MVP，如實記錄）：不檢查容量（events.capacity）——計劃 §8.4 的錯誤
 * 清單沒有「已滿」一項，超出範圍；需要時可在第 5 步前加 count 比對。
 *
 * 邊界（NEW-P2-3）：DELETE 刻意不擋 HYROX——活動已下架／過期也應該能取消自己
 * 的報名，而且若會員曾被舊版端點寫入一筆 HYROX 列，這條路是他自己清走的唯一
 * 出口。放行 DELETE 不會新增任何資料，也不會繞過審核。
 *
 * 不動 events 表、不動既有外部連結行為（混合模式：兩個入口並存）。
 * Owner：白客
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { todayISO } from "@/lib/utils";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonErr,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/** 未授權／未登入的共用前置（401）；回傳 supabase 或 error response */
async function authorizeMember() {
  if (!isSupabaseConfigured) return { res: jsonNotConfigured() } as const;

  const supabase = await createClient();
  if (!supabase) return { res: jsonErr("客戶端初始化失敗。", "INTERNAL", 500) } as const;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { res: jsonUnauthenticated() } as const;

  return { supabase, user } as const;
}

type Authorized = Awaited<ReturnType<typeof authorizeMember>>;

/** 共用的 body 解析 + event_id 校驗（POST/DELETE 同一套） */
async function readEventId(request: Request) {
  const body = await readJson(request);
  if (!body) return { res: jsonBadJson() } as const;

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (!eventId) return { res: jsonValidation({}, "缺少活動。") } as const;
  // NEW-P2-1：UUID 格式先驗，不讓 Postgres 22P02 變成 500
  if (!isUuid(eventId)) return { res: jsonValidation({ event_id: "編號格式錯誤。" }) } as const;

  return { eventId } as const;
}

/** 報名／取消後讓前台相關頁面重新驗證（與 checkins 同紀律） */
function revalidateMemberPages() {
  revalidatePath("/events");
  revalidatePath("/dashboard");
}

/** 報名某一場活動 */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeMember()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, user } = auth;

    const parsed = await readEventId(request);
    if ("res" in parsed) return parsed.res;
    const { eventId } = parsed;

    // NEW-P2-2：先查後寫——活動不存在 → 404（而不是讓 FK 錯誤變成 500）
    // NEW-P2-3：一併取 series，用來擋 HYROX 場次（見下方第 6 步）
    const { data: event } = await supabase
      .from("events")
      .select("id, status, event_date, series")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return jsonNotFound("找不到這個活動。");

    // 未上架／已歸檔 → 400（口徑同前台 getPublishedEvents：只認 status + event_date）
    if (event.status !== "published") {
      return jsonValidation({}, "這個活動目前未開放報名。");
    }
    if (event.event_date < todayISO()) {
      return jsonValidation({}, "這個活動已經結束。");
    }

    /**
     * NEW-P2-3：HYROX 賽事必須走 /hyrox/register 的三步流程（實名資料＋免責
     * 聲明＋付款截圖，管理員審核通過才發 30 分）。通用端點若放行，會員一鍵就
     * 會產生一筆沒有付款截圖、沒有免責聲明時間的 pending_review 列（觸發器
     * migration-paid-events-1.sql 依 fee_cents 自動設定），還佔用
     * unique(event_id, user_id)，之後走正常流程反而會被 409 擋死。
     *
     * 位置：在 status／event_date 之後——既有錯誤文案與順序不動（回歸紅線）；
     * 在重複報名預查之前——身上已有舊髒列的會員也會先看到這條提示，
     * 而不是被「你已經報名過這個活動。」掩蓋真正的原因。
     *
     * 這是使用者走錯入口，不是伺服器故障 → 400 VALIDATION，不用 500。
     */
    if (event.series === "hyrox") {
      return jsonValidation(
        {},
        "這是 HYROX 賽事，請用賽事頁的報名流程（需要上載付款截圖）。"
      );
    }

    // 重複報名先查（友好訊息）；unique 約束 23505 是最終防線（並發雙擊）
    const { data: existing } = await supabase
      .from("event_registrations")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) return jsonValidation({}, "你已經報名過這個活動。");

    const { error } = await supabase
      .from("event_registrations")
      .insert({ event_id: eventId, user_id: user.id, status: "registered" });

    if (error) {
      // unique (event_id, user_id) 衝突 → 中文 400（§8.4「重複報名」）
      if (error.code === "23505") {
        return jsonValidation({}, "你已經報名過這個活動。");
      }
      return jsonDbError("POST /api/event-registrations insert", error);
    }

    revalidateMemberPages();

    return jsonOk({ message: "報名成功。" });
  } catch (err) {
    return jsonDbError("POST /api/event-registrations", err);
  }
}

/** 取消報名（僅限尚未取消的；取消 = 刪除該列，與 checkins 同模式） */
export async function DELETE(request: Request) {
  try {
    const auth = (await authorizeMember()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, user } = auth;

    const parsed = await readEventId(request);
    if ("res" in parsed) return parsed.res;
    const { eventId } = parsed;

    // 先查後刪：沒有報名記錄 → 404（§8.4「取消未報名的記錄」）
    // 註：DELETE 不檢查活動狀態——活動已下架／過期也應該能取消自己的報名。
    const { data: existing } = await supabase
      .from("event_registrations")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) return jsonNotFound("你尚未報名這個活動。");

    const { error } = await supabase
      .from("event_registrations")
      .delete()
      .eq("id", existing.id);
    if (error) return jsonDbError("DELETE /api/event-registrations delete", error);

    revalidateMemberPages();

    return jsonOk({ message: "已取消報名。" });
  } catch (err) {
    return jsonDbError("DELETE /api/event-registrations", err);
  }
}

/** H6：未實作的方法也要回 JSON（复刻 checkins 路由紀律） */
export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
