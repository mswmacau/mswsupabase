/**
 * src/app/api/hyrox/_shared/contract.ts — HYROX 端點共用的錯誤碼與欄位驗證
 *
 * Owner：白客（backend-engineer）。後台端點（/api/admin/hyrox/*）也 import 本檔，
 * 讓兩邊的錯誤碼、長度上限、proof_path 規則一字不差。
 *
 * 【為什麼不直接用 src/lib/api.ts 的 jsonErr】
 * 交付契約要求 HYROX 有專屬錯誤碼：EVENT_CLOSED / DISCLAIMER_REQUIRED /
 * PROOF_REQUIRED / ALREADY_REGISTERED / NOT_IN_REJECTED_STATE / ALREADY_REVIEWED。
 * 這些不在 src/lib/api.ts 的 ApiErrorCode union 內，而該檔不在本次交付的
 * 可修改範圍，所以在這裡另外做一個帶同樣 `{ ok:false, error, code, fields? }`
 * 外殼的回應函式；契約上通用的錯誤（401 / 一般 400 / 404）仍走 api.ts 的
 * jsonUnauthenticated / jsonValidation / jsonNotFound，文案保持一致。
 *
 * 【硬性規則】
 *   · 錯誤訊息是給終端客戶看的繁中句子，不含 SQL、路徑、堆疊、他人資料。
 *   · 任何驗證函式都回傳結果物件，不 throw（呼叫端負責轉 HTTP）。
 *   · 字串一律先 trim；長度上限與 migration-paid-events-1.sql 的 DB check 對齊。
 */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** HYROX 專屬錯誤碼（與 api.ts 的 ApiErrorCode 併用） */
export type HyroxErrorCode =
  | "EVENT_CLOSED"
  | "DISCLAIMER_REQUIRED"
  | "PROOF_REQUIRED"
  | "ALREADY_REGISTERED"
  | "NOT_IN_REJECTED_STATE"
  | "ALREADY_CONFIRMED"
  | "ALREADY_REVIEWED"
  | "INVALID_DECISION"
  | "UNAUTHENTICATED"
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL";

/**
 * 帶 HYROX 專屬錯誤碼的 JSON 回應。
 * 外殼與 src/lib/api.ts 的 ApiErr 完全一致（ok/error/code/fields）。
 */
export function hyroxErr(
  code: HyroxErrorCode,
  status: number,
  error: string,
  extra?: { fields?: Record<string, string>; payload?: Record<string, unknown> }
) {
  const body: Record<string, unknown> = {
    ok: false,
    error,
    code,
    ...(extra?.payload ?? {}),
  };
  if (extra?.fields && Object.keys(extra.fields).length > 0) body.fields = extra.fields;
  return NextResponse.json(body, { status });
}

/* =============================================================
 * 報名表三題（group_pref / weekly_freq / longest_run）
 * DB：text，長度上限 200（migration-paid-events-1.sql C 段）
 * ============================================================= */

export const ANSWER_KEYS = ["group_pref", "weekly_freq", "longest_run"] as const;
export type AnswerKey = (typeof ANSWER_KEYS)[number];

/** 與 DB check 一致的長度上限（char_length ≤ 200） */
export const ANSWER_MAX = 200;

/** 各題的中文名稱（錯誤訊息用，不含欄位路徑） */
const ANSWER_LABEL: Record<AnswerKey, string> = {
  group_pref: "分組意願",
  weekly_freq: "每週訓練頻率",
  longest_run: "最長跑步距離",
};

export type ParsedAnswers = Record<AnswerKey, string>;

export type ParseAnswersResult =
  | { ok: true; value: ParsedAnswers }
  | { ok: false; fields: Record<string, string> };

/**
 * 解析 answers 物件。
 * 契約：三欄任一空白 → 400 VALIDATION（fields 逐項）。
 * 空白判定：缺欄、null、非字串、trim 後為空字串，一律視為「空白」。
 */
export function parseAnswers(raw: unknown): ParseAnswersResult {
  const fields: Record<string, string> = {};
  const value = {} as ParsedAnswers;

  const src =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  for (const key of ANSWER_KEYS) {
    const v = src[key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      fields[key] = `請填寫${ANSWER_LABEL[key]}。`;
      continue;
    }
    if (typeof v !== "string") {
      fields[key] = `${ANSWER_LABEL[key]}格式錯誤。`;
      continue;
    }
    const trimmed = v.trim();
    // 以 code point 計長，避免中文／emoji 被算成 2 個字而誤判超長
    if (Array.from(trimmed).length > ANSWER_MAX) {
      fields[key] = `${ANSWER_LABEL[key]}最多 ${ANSWER_MAX} 個字。`;
      continue;
    }
    value[key] = trimmed;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value };
}

/* =============================================================
 * 付款截圖路徑（payment_proof_path）
 *
 * 契約：必須存在、以 `${user.id}/` 開頭、不含 `..`。
 * 規則來源：run-screenshots 私有桶的路徑是 `{uid}/{timestamp}-{rand}.{ext}`
 * （src/lib/upload.ts:49-67，kind "run"/"payment"），RLS 的 runshots_insert_own
 * 也以第一層資料夾等於 auth.uid() 判定寫入權。
 * ============================================================= */

/** 只接受圖片副檔名；中間不含空白、反斜線、`..` */
const PROOF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$/i;

/** 與 DB check 對齊（payment_proof_path ≤ 500 字元） */
export const PROOF_PATH_MAX = 500;

export type ParseProofResult =
  | { ok: true; path: string }
  | { ok: false; reason: "missing" | "forbidden" };

/**
 * 驗證 proof_path 的形狀。
 *
 * @param raw  body.proof_path
 * @param uid  目前登入者的 user.id（後綴組路徑前綴，防 IDOR／跨目錄寫入）
 */
export function parseProofPath(raw: unknown, uid: string): ParseProofResult {
  if (typeof raw !== "string") return { ok: false, reason: "missing" };
  const path = raw.trim();
  if (!path) return { ok: false, reason: "missing" };
  if (path.length > PROOF_PATH_MAX) return { ok: false, reason: "forbidden" };
  // 一律拒絕：反斜線、控制字元、相對跳脫、開頭斜線
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return { ok: false, reason: "forbidden" };
  if (path.includes("..") || path.startsWith("/")) return { ok: false, reason: "forbidden" };

  const slash = path.indexOf("/");
  if (slash <= 0) return { ok: false, reason: "forbidden" };
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);

  // 必須剛好是「自己 uid 的一層資料夾 + 合法檔名」，不接受多層
  if (folder !== uid) return { ok: false, reason: "forbidden" };
  if (name.includes("/")) return { ok: false, reason: "forbidden" };
  if (!PROOF_NAME_RE.test(name)) return { ok: false, reason: "forbidden" };

  return { ok: true, path: `${uid}/${name}` };
}

/**
 * 確認 Storage 內真的有這個物件（避免 DB 指到不存在的截圖）。
 *
 * 回傳：
 *   true      物件存在
 *   false     確定找不到
 *   "unknown" Storage 查詢本身失敗（例如暫時性的網路／權限問題）
 *
 * 呼叫端的處理原則：只有 **確定找不到（false）** 才擋下使用者；
 * "unknown" 放行（不因為 Storage 抖一下就讓會員無法報名），並寫 server log。
 */
export async function proofObjectExists(
  supabase: SupabaseClient,
  path: string
): Promise<boolean | "unknown"> {
  const idx = path.lastIndexOf("/");
  const dir = idx === -1 ? "" : path.slice(0, idx);
  const base = path.slice(idx + 1);

  try {
    const { data, error } = await supabase.storage
      .from(PROOF_BUCKET)
      .list(dir, { search: base, limit: 20 });

    if (error) {
      console.warn("[hyrox] proof 存在性檢查失敗（放行）：", error.message);
      return "unknown";
    }
    return (data ?? []).some((o) => o.name === base);
  } catch (err) {
    console.warn("[hyrox] proof 存在性檢查例外（放行）：", err);
    return "unknown";
  }
}

/* =============================================================
 * 共用常數
 * ============================================================= */

/** 系列標籤：所有 HYROX 場次的 events.series 一律是這個值 */
export const HYROX_SERIES = "hyrox";

/** 付款截圖所在的私有 bucket（與 src/lib/upload.ts 的 BUCKET.payment 一致） */
export const PROOF_BUCKET = "run-screenshots";

/** signed URL 有效期（秒）：後台名單看截圖用 */
export const PROOF_URL_TTL = 60 * 60;
