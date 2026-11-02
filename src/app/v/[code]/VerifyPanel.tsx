"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 商戶核銷面板（公開頁 /v/[code] 的唯一互動區）
 *
 * 後端契約（另一線負責，此處只照合約呼叫，不改 API）：
 *   merchant_verify_lookup(p_code text) →
 *     { ok:true, reward, merchant, member_masked } | { ok:false, code:'VERIFY_FAILED' }
 *   merchant_verify_redeem(p_code text, p_pin text) →
 *     { ok:true, reward, merchant, member_masked, at }
 *     | { ok:false, code:'VERIFY_FAILED'|'PIN_INVALID'|'PIN_LOCKED', remaining? }
 *
 * 店員用手機掃 QR 開啟，全程免登入。任何失敗都不可白屏。
 */

type VerifyInfo = {
  reward: string;
  merchant: string;
  member: string;
};

type PanelState =
  | { kind: "loading" }
  | { kind: "valid"; info: VerifyInfo }
  | { kind: "invalid" }
  | { kind: "locked" }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string }
  | { kind: "success"; info: VerifyInfo; time: string };

type RpcRow = {
  ok?: boolean;
  code?: string;
  remaining?: number;
  reward?: unknown;
  merchant?: unknown;
  member_masked?: unknown;
  at?: unknown;
};

const PIN_LENGTH = 6;
/** 伺服器會在第 5 次錯誤鎖券；本地再守一層，避免店員盲試 */
const MAX_ATTEMPTS = 5;

const NETWORK_MESSAGE = "網絡唔穩定，請再試一次。";

/** reward 契約未定死是字串還是物件，兩種都吃，讀不到就顯示「禮品」 */
function readReward(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["name", "title", "label"]) {
      const text = obj[key];
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  return "禮品";
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** 只有「連不上」才算網絡錯誤，其餘（函數未部署、權限、格式）一律當券無效 */
function isNetworkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "");
  return /fetch|network|load failed|timeout|aborted|offline/i.test(message);
}

function toInfo(row: RpcRow): VerifyInfo {
  return {
    reward: readReward(row.reward),
    merchant: readText(row.merchant, "MSW 合作商戶"),
    member: readText(row.member_masked, "會員"),
  };
}

function formatTime(value: unknown): string {
  const date = typeof value === "string" ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(safe);
}

export default function VerifyPanel({ code }: { code: string }) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const attemptsRef = useRef(0);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const lookup = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      setState({ kind: "unconfigured" });
      return;
    }

    setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.rpc("merchant_verify_lookup", {
        p_code: code,
      });

      if (error) {
        setState(
          isNetworkError(error)
            ? { kind: "error", message: NETWORK_MESSAGE }
            : { kind: "invalid" },
        );
        return;
      }

      const row = (data ?? {}) as RpcRow;
      setState(row.ok === true ? { kind: "valid", info: toInfo(row) } : { kind: "invalid" });
    } catch {
      // 網絡斷線／DNS 失敗：給重試，不要當成券無效（否則店員會趕走客人）
      setState({ kind: "error", message: NETWORK_MESSAGE });
    }
  }, [code]);

  useEffect(() => {
    void lookup();
  }, [lookup]);

  useEffect(() => {
    if (state.kind === "valid") inputRef.current?.focus();
  }, [state.kind]);

  const onPinChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    if (pinError) setPinError(null);
  };

  const submit = async () => {
    if (busyRef.current || pin.length !== PIN_LENGTH) return;
    if (state.kind !== "valid") return;

    const supabase = createClient();
    if (!supabase) {
      setState({ kind: "unconfigured" });
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    setPinError(null);

    try {
      const { data, error } = await supabase.rpc("merchant_verify_redeem", {
        p_code: code,
        p_pin: pin,
      });

      if (error) {
        setState(
          isNetworkError(error)
            ? { kind: "error", message: NETWORK_MESSAGE }
            : { kind: "invalid" },
        );
        return;
      }

      const row = (data ?? {}) as RpcRow;

      if (row.ok === true) {
        // 成功後鎖死狀態：按鈕不再出現，杜絕重複核銷
        setPin("");
        setState({
          kind: "success",
          info: toInfo(row),
          time: formatTime(row.at),
        });
        return;
      }

      if (row.code === "PIN_LOCKED") {
        setPin("");
        setState({ kind: "locked" });
        return;
      }

      if (row.code === "PIN_INVALID") {
        attemptsRef.current += 1;
        setPin("");
        const remaining =
          typeof row.remaining === "number" ? Math.max(0, row.remaining) : null;
        const left = remaining ?? MAX_ATTEMPTS - attemptsRef.current;

        if (left <= 0 || attemptsRef.current >= MAX_ATTEMPTS) {
          setState({ kind: "locked" });
          return;
        }

        setPinError(`PIN 不正確，還可再試 ${left} 次。`);
        return;
      }

      setState({ kind: "invalid" });
    } catch {
      setState({ kind: "error", message: NETWORK_MESSAGE });
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  /* ───────────── 各狀態 ───────────── */

  if (state.kind === "loading") {
    return (
      <div className="card-dark flex flex-col items-center gap-4 px-6 py-14 text-center">
        <Spinner />
        <p className="text-xl font-bold text-white/85">正在確認…</p>
        <p className="text-base text-white/55">請稍等，唔好閂咗個頁面。</p>
      </div>
    );
  }

  if (state.kind === "valid") {
    return (
      <div className="card-dark px-6 py-7">
        <p className="text-sm font-bold tracking-[0.18em] text-vital-bright">有效券</p>

        <h1 className="mt-3 text-3xl font-black leading-tight text-white">
          {state.info.reward}
        </h1>

        <dl className="mt-6 divide-y divide-white/10 border-y border-white/10 text-base">
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-white/55">核銷方</dt>
            <dd className="text-right font-bold text-white">{state.info.merchant}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-white/55">會員</dt>
            <dd className="text-right font-bold text-white">{state.info.member}</dd>
          </div>
        </dl>

        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label
            htmlFor="pin"
            className="block text-base font-bold text-white/75"
          >
            職員 PIN（6 位數字）
          </label>
          <input
            id="pin"
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={PIN_LENGTH}
            value={pin}
            onChange={(event) => onPinChange(event.target.value)}
            className="mt-3 h-16 w-full rounded-2xl border border-white/20 bg-black/40 text-center text-3xl font-black tracking-[0.45em] text-white outline-none transition focus:border-cobalt-bright"
          />

          {pinError ? (
            <p
              role="alert"
              className="mt-3 flex items-center gap-1.5 text-base font-semibold text-vital-bright"
            >
              {pinError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pin.length !== PIN_LENGTH || submitting}
            className="btn-base btn-vital mt-5 h-14 w-full text-lg"
          >
            {submitting ? (
              <>
                <Spinner small /> 核銷中…
              </>
            ) : (
              "確認核銷"
            )}
          </button>

          <p className="mt-3 text-center text-sm text-white/45">
            {pin.length === PIN_LENGTH
              ? "撳「確認核銷」後即完成，不可取消。"
              : `請入滿 ${PIN_LENGTH} 位數字。`}
          </p>
        </form>
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <div className="card-dark border-vital/60 px-6 py-8 text-center">
        <span
          aria-hidden
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-vital/15 text-3xl font-black text-vital-bright"
        >
          ✓
        </span>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-white">核銷成功</h1>
        <p className="mt-3 text-xl font-bold text-white/85">{state.info.reward}</p>
        <p className="mt-1 text-base text-white/55">時間 {state.time}</p>

        <p className="mt-7 rounded-2xl border border-vital/40 bg-vital/10 px-4 py-4 text-lg font-black text-vital-bright">
          請畀客人睇一睇
        </p>

        <p className="mt-5 text-sm leading-relaxed text-white/45">
          此券已使用，唔可以再核銷。可以閂咗個頁面。
        </p>
      </div>
    );
  }

  if (state.kind === "locked") {
    return (
      <MessageCard
        tone="locked"
        title="此券已暫停核銷 15 分鐘，請聯絡 MSW"
        body="為保障會員，短時間內錯太多次 PIN 會自動鎖券。請客人稍後再嚟，或叫佢搵 MSW 客服。"
      />
    );
  }

  if (state.kind === "invalid") {
    return (
      <MessageCard
        tone="invalid"
        title="此券無效或已使用"
        body="請重新掃描客人手機上嘅 QR Code。如果仍然顯示呢句，請聯絡 MSW。"
      />
    );
  }

  if (state.kind === "unconfigured") {
    return (
      <MessageCard
        tone="invalid"
        title="系統未連接，請聯絡 MSW"
        body="核銷系統暫時未接通，唔好收客人張券，請即刻聯絡 MSW 同事。"
      />
    );
  }

  return (
    <div className="rounded-2xl border border-vital/50 bg-vital/10 px-5 py-6">
      <p role="alert" className="text-lg font-black text-vital-bright">
        {state.message}
      </p>
      <p className="mt-2 text-base leading-relaxed text-white/70">
        請確認手機有網絡，再撳下面個掣重試。
      </p>
      <button
        type="button"
        onClick={() => {
          void lookup();
        }}
        className="btn-base btn-ghost mt-5 h-14 w-full text-lg"
      >
        重試
      </button>
    </div>
  );
}

function MessageCard({
  tone,
  title,
  body,
}: {
  tone: "invalid" | "locked";
  title: string;
  body: string;
}) {
  return (
    <div className="card-dark px-6 py-8 text-center">
      <span
        aria-hidden
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-2xl font-black text-white/60"
      >
        {tone === "locked" ? "!" : "×"}
      </span>
      <h1 className="mt-5 text-2xl font-black leading-snug text-white">{title}</h1>
      <p className="mt-3 text-base leading-relaxed text-white/60">{body}</p>
    </div>
  );
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-white/30 border-t-white ${
        small ? "h-4 w-4" : "h-8 w-8"
      }`}
    />
  );
}
