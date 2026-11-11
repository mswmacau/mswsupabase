/**
 * src/lib/profile-fields.ts — 會員實名資料的共同解析與驗證
 *
 * Owner：白客（backend-engineer）；前端不直接 import 本檔。
 * 契約來源：交付需求「付費活動（HYROX）＋會員實名資料」交付 2。
 *
 * 【為什麼獨立一支】/api/auth/signup 與 /api/profile/complete 驗的是同一組欄位，
 * 口徑（尤其電話正規化）必須完全一致，否則註冊時寫進 profiles 的電話
 * 與之後補資料時寫的會長得不一樣。只放一處，兩邊都 import。
 *
 * 【硬性規則】
 *   · 任何情況都回傳結果物件，不 throw —— 呼叫端負責轉成 HTTP 400。
 *   · 錯誤訊息是給終端客戶看的繁中句子，不含欄位路徑／SQL／堆疊。
 *   · 所有字串先 trim 再驗，長度以「字元（code point）」計，
 *     避免 emoji／罕用字被算成 2 個而誤判超長。
 *
 * 【電話口徑（澳門）】寬鬆驗證：容許空格、連字號、括號、+853／853 國碼，
 * 正規化後必須剛好 8 位數字，入庫只存這 8 位數字（不存國碼）。
 * （DB 端 handle_new_user 與本檔用同一套規則清洗，見 migration-paid-events-1.sql G 段。）
 */

/** 與 DB check constraint profiles_gender_check 一字對齊 */
export const GENDERS = ["male", "female", "undisclosed"] as const;
export type GenderValue = (typeof GENDERS)[number];

/** 正規化後的實名欄位；null = 未填（DB 允許 null） */
export type RealNameFields = {
  full_name: string | null;
  gender: GenderValue | null;
  phone: string | null;
  id_last4: string | null;
};

export type ParseRealNameResult =
  | { ok: true; value: RealNameFields }
  | { ok: false; fields: Record<string, string> };

/** 以 code point 計長（中文／emoji 都算 1 個字） */
function charLen(s: string): number {
  return Array.from(s).length;
}

/** 控制字元與 HTML 角括號一律拒絕（避免日後被當成 HTML 或用來塞換行） */
const UNSAFE_RE = /[\u0000-\u001f\u007f<>]/;

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 40;
export const PHONE_MAX = 30;

/**
 * 電話正規化（澳門寬鬆口徑）
 *   "+853 6612 3456" / "853-66123456" / "66123456" → "66123456"
 * 不是 8 位數字 → null
 *
 * 國碼只在「後面剛好還有 8 位數字」時才剝掉（lookahead），
 * 避免把剛好以 853 開頭的 8 位本地號碼吃掉 3 位變成 5 位而誤判為無效。
 * 同一套規則在 DB 的 handle_new_user 也有一份（migration-paid-events-1.sql G 段）。
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  const stripped = cleaned.replace(/^\+?853(?=[0-9]{8}$)/, "");
  return /^[0-9]{8}$/.test(stripped) ? stripped : null;
}

/**
 * 解析並驗證實名資料。
 *
 * @param body   readJson() 的結果
 * @param mode   "required"：四個欄位都必填（/api/profile/complete）
 *               "optional"：可全部不填，但填了就必須合法（/api/auth/signup）
 */
export function parseRealNameFields(
  body: Record<string, unknown>,
  mode: "required" | "optional"
): ParseRealNameResult {
  const fields: Record<string, string> = {};
  const required = mode === "required";

  /** 取出字串欄位；非字串（含 number / object）一律當作格式錯誤 */
  function readString(key: string): { present: boolean; value: string; bad: boolean } {
    const raw = body[key];
    if (raw === undefined || raw === null) return { present: false, value: "", bad: false };
    if (typeof raw !== "string") return { present: true, value: "", bad: true };
    const value = raw.trim().replace(/\s+/g, " ");
    return { present: value.length > 0, value, bad: false };
  }

  /* ---------- full_name ---------- */
  let fullName: string | null = null;
  {
    const f = readString("full_name");
    if (f.bad) {
      fields.full_name = "姓名格式錯誤。";
    } else if (!f.present) {
      if (required) fields.full_name = "請填寫真實姓名。";
    } else if (UNSAFE_RE.test(f.value)) {
      fields.full_name = "姓名含有不允許的符號。";
    } else if (charLen(f.value) < FULL_NAME_MIN || charLen(f.value) > FULL_NAME_MAX) {
      fields.full_name = `姓名長度需為 ${FULL_NAME_MIN}–${FULL_NAME_MAX} 個字。`;
    } else {
      fullName = f.value;
    }
  }

  /* ---------- gender ---------- */
  let gender: GenderValue | null = null;
  {
    const f = readString("gender");
    if (f.bad) {
      fields.gender = "性別格式錯誤。";
    } else if (!f.present) {
      if (required) fields.gender = "請選擇性別。";
    } else if (!(GENDERS as readonly string[]).includes(f.value)) {
      fields.gender = "性別只能是 male、female 或 undisclosed。";
    } else {
      gender = f.value as GenderValue;
    }
  }

  /* ---------- phone ---------- */
  let phone: string | null = null;
  {
    const f = readString("phone");
    if (f.bad) {
      fields.phone = "電話格式錯誤。";
    } else if (!f.present) {
      if (required) fields.phone = "請填寫聯絡電話。";
    } else if (f.value.length > PHONE_MAX) {
      fields.phone = `電話最多 ${PHONE_MAX} 個字元。`;
    } else {
      const normalized = normalizePhone(f.value);
      if (!normalized) {
        fields.phone = "請填寫 8 位澳門手機號碼（可帶 +853）。";
      } else {
        phone = normalized;
      }
    }
  }

  /* ---------- id_last4 ---------- */
  let idLast4: string | null = null;
  {
    const f = readString("id_last4");
    if (f.bad) {
      fields.id_last4 = "證件號碼格式錯誤。";
    } else if (!f.present) {
      if (required) fields.id_last4 = "請填寫證件號碼後四位。";
    } else if (!/^[0-9]{4}$/.test(f.value)) {
      fields.id_last4 = "證件號碼後四位必須是 4 位數字。";
    } else {
      idLast4 = f.value;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: { full_name: fullName, gender, phone, id_last4: idLast4 },
  };
}
