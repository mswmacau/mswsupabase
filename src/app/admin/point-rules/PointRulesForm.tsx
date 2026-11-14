"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Award, Loader2, Save, Search, Sparkles } from "lucide-react";
import { AdminError, AdminModal, AdminNotice, Field } from "@/components/admin/ui";
import { FetchError, postJson, requestJson } from "@/lib/fetch-json";

/**
 * 積分規則（11 個 app_settings 數值）＋手動補發。
 *
 *  - 儲存：POST /api/admin/point-rules {action:"save", rules}
 *    後端 upsert app_settings 並寫 admin_audit_log（module=point-rules）。
 *  - 補發：POST {action:"award", type, user_id, ref_id?, ref_user_id?}
 *    ⚠️ 活動／打卡的 ref_id 必須是「該會員的 training_checkins.id」，
 *       所以 UI 讓管理員從該會員最近簽到中選一筆，而不是選活動。
 */

export type RuleValues = Record<string, number>;

interface RuleDef {
  key: string;
  label: string;
  desc: string;
  unit?: string;
}

const GROUPS: { title: string; hint: string; items: RuleDef[] }[] = [
  {
    title: "註冊",
    hint: "新會員建立帳號時自動發放，每人一次。",
    items: [{ key: "signup_bonus", label: "註冊獎勵", desc: "完成註冊即送，只在第一次建立帳號時發放。", unit: "分" }],
  },
  {
    title: "登入",
    hint: "每日登入自動發放，同一天只算一次。",
    items: [{ key: "daily_login_points", label: "每日登入", desc: "每天首次登入 +X 分（澳門時間換日）。", unit: "分" }],
  },
  {
    title: "活動",
    hint: "由管理員確認活動簽到後發放。",
    items: [{ key: "event_bonus", label: "活動出席", desc: "每筆活動簽到經確認後發放，同一簽到不重複。", unit: "分" }],
  },
  {
    title: "打卡",
    hint: "運動打卡與連續達標；週上限以澳門時間的星期一為一週起點。",
    items: [
      { key: "checkin_bonus", label: "運動打卡", desc: "每筆打卡經確認後發放，同一筆不重複。", unit: "分" },
      { key: "checkin_weekly_cap", label: "打卡每週上限", desc: "每週最多發放幾次打卡獎；0 = 本週不發。", unit: "次" },
      { key: "streak_bonus", label: "連續達標獎", desc: "連續打卡達到設定天數時的額外獎勵。", unit: "分" },
      { key: "streak_days", label: "連續達標天數", desc: "連續多少天打卡才觸發上面的獎勵。", unit: "天" },
    ],
  },
  {
    title: "邀請",
    hint: "邀請人獲得獎勵；被邀請人只用作防重複的依據。",
    items: [
      { key: "referral_bonus", label: "邀請好友", desc: "成功邀請一位新會員的獎勵。", unit: "分" },
      { key: "referral_monthly_cap", label: "邀請每月上限", desc: "每位會員每月最多可因邀請獲得幾次；0 = 不發。", unit: "人" },
    ],
  },
  {
    title: "生日",
    hint: "每位會員每年（澳門時間）只發一次。",
    items: [{ key: "birthday_bonus", label: "生日禮", desc: "會員生日當月可獲得的獎勵，每年一次。", unit: "分" }],
  },
  {
    title: "月達標",
    hint: "月度跑步目標達標時自動發放。",
    items: [{ key: "monthly_points_bonus", label: "月達標獎勵", desc: "完成當月跑步目標時額外加分（與里程分數分開）。", unit: "分" }],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.items.map((i) => i.key));

export interface MemberOption {
  id: string;
  display_name: string | null;
  points?: number;
  created_at?: string;
}

interface CheckinOption {
  id: string;
  created_at: string;
  status: string;
  session: { title: string | null; session_date: string | null; starts_at: string | null } | null;
}

const AWARD_TYPES = [
  { value: "birthday", label: "生日禮" },
  { value: "referral", label: "邀請好友" },
  { value: "event", label: "活動出席" },
  { value: "checkin", label: "運動打卡" },
] as const;

export function PointRulesForm({
  initialRules,
  initialEnabled,
  initialMembers,
  hasServiceRole,
  mode = "all",
}: {
  initialRules: RuleValues;
  initialEnabled: boolean;
  initialMembers: MemberOption[];
  hasServiceRole: boolean;
  /**
   * IA 第二階段：/admin/points 把這一頁拆成「積分規則」與「補發獎勵」兩個分頁。
   *
   * 只做「顯示哪一段」的切換——state、handler、送出路徑（POST /api/admin/point-rules）
   * 與欄位完全沒動。"all" 是預設值，`/admin/point-rules` 的行為與 HEAD 一字不差。
   */
  mode?: "all" | "rules" | "award";
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const key of ALL_KEYS) next[key] = String(initialRules[key] ?? 0);
    return next;
  });
  const [enabled, setEnabled] = useState(initialEnabled);
  // 儲存成功後更新「現時值」提示（不必重整頁面）
  const [saved, setSaved] = useState<RuleValues>(initialRules);
  const [savePending, setSavePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function save() {
    setError(null);
    setFields({});

    const rules: Record<string, number> = {};
    const local: Record<string, string> = {};
    for (const key of ALL_KEYS) {
      const raw = values[key]?.trim() ?? "";
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0) {
        local[key] = "請填 0 或以上的整數。";
        continue;
      }
      rules[key] = n;
    }
    if (Object.keys(local).length > 0) {
      setFields(local);
      setError("有欄位格式不正確，請檢查後再儲存。");
      return;
    }

    setSavePending(true);
    try {
      const data = await postJson<{ message?: string }>("/api/admin/point-rules", {
        action: "save",
        rules,
        rewards_enabled: enabled,
      });
      setNotice(data.message ?? "積分規則已儲存。");
      setSaved(rules);
      setDirty(false);
      router.refresh();
    } catch (err) {
      if (err instanceof FetchError) {
        setError(err.message);
        if (err.fields) setFields(err.fields);
      } else {
        setError("網路錯誤，請稍後再試。");
      }
    } finally {
      setSavePending(false);
    }
  }

  const showRules = mode === "all" || mode === "rules";
  const showAward = mode === "all" || mode === "award";

  return (
    <div className="min-w-0 space-y-6">
      {error && <AdminError message={error} onDismiss={() => setError(null)} />}
      {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}

      {showRules && (
        <>
      <SaveRow dirty={dirty} pending={savePending} onSave={() => void save()} />

      <div className="space-y-4">
        {GROUPS.map((group) => (
          <section key={group.title} className="card-dark p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-white">{group.title}</h3>
              <p className="text-xs text-white/50">{group.hint}</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {group.items.map((item) => (
                <Field
                  key={item.key}
                  label={item.label}
                  htmlFor={`rule-${item.key}`}
                  hint={`${item.desc}　目前設定：${saved[item.key] ?? 0} ${item.unit ?? ""}`}
                  error={fields[item.key]}
                >
                  <div className="flex items-center gap-2">
                    <input
                      id={`rule-${item.key}`}
                      className="field tabular-nums"
                      inputMode="numeric"
                      value={values[item.key] ?? ""}
                      onChange={(event) => setField(item.key, event.target.value)}
                    />
                    <span className="w-8 shrink-0 text-xs text-white/50">{item.unit ?? ""}</span>
                  </div>
                </Field>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="card-dark p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold">兌換功能開關</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/60">
              關閉後會員在禮品頁看不到兌換入口，`redeem_reward` 亦會拒絕新兌換；
              已發出的電子券仍可正常核銷。懷疑被濫用時可即時關掉。
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setDirty(true);
              }}
            />
            <span className={enabled ? "text-emerald-300" : "text-amber-300"}>
              {enabled ? "已開啟" : "已關閉"}
            </span>
          </label>
        </div>
      </section>

      <SaveRow dirty={dirty} pending={savePending} onSave={() => void save()} />
        </>
      )}

      {showAward && (
        <ManualAward initialMembers={initialMembers} hasServiceRole={hasServiceRole} />
      )}
    </div>
  );
}

/** 上下各放一次，避免長表單只在上方或下方才有儲存鍵 */
function SaveRow({
  dirty,
  pending,
  onSave,
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-line bg-ink-soft px-4 py-3">
      <p className="text-xs text-white/55">{dirty ? "有未儲存的變更。" : "所有變更已儲存。"}</p>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="btn-base btn-cobalt px-4 py-2 text-sm"
      >
        {pending ? (
          <>
            <Loader2 size={16} className="animate-spin" /> 儲存中…
          </>
        ) : (
          <>
            <Save size={16} /> 儲存積分規則
          </>
        )}
      </button>
    </div>
  );
}

/* =============================================================
 * 手動補發
 * ============================================================= */

function ManualAward({
  initialMembers,
  hasServiceRole,
}: {
  initialMembers: MemberOption[];
  hasServiceRole: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<(typeof AWARD_TYPES)[number]["value"]>("birthday");
  const [member, setMember] = useState<MemberOption | null>(null);
  const [refMember, setRefMember] = useState<MemberOption | null>(null);
  const [checkinId, setCheckinId] = useState("");
  const [checkins, setCheckins] = useState<CheckinOption[]>([]);
  const [checkinLoading, setCheckinLoading] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const needsCheckin = type === "event" || type === "checkin";

  /* 換會員或類型時由事件處理器直接抓簽到（不在 effect 內同步 setState） */
  async function loadCheckins(userId: string) {
    setCheckinLoading(true);
    setCheckinId("");
    try {
      const data = await requestJson<{ checkins?: CheckinOption[] }>(
        `/api/admin/point-rules?mode=checkins&user_id=${encodeURIComponent(userId)}`,
        { method: "GET" }
      );
      setCheckins(Array.isArray(data.checkins) ? data.checkins : []);
    } catch {
      setCheckins([]);
    } finally {
      setCheckinLoading(false);
    }
  }

  const typeLabel = AWARD_TYPES.find((t) => t.value === type)?.label ?? type;
  const canSubmit =
    Boolean(member) &&
    !pending &&
    (type === "referral" ? Boolean(refMember) && refMember?.id !== member?.id : true) &&
    (needsCheckin ? Boolean(checkinId) : true);

  async function submit() {
    if (!member) {
      setError("請先選擇會員。");
      return;
    }
    if (type === "referral" && !refMember) {
      setError("請選擇被邀請的會員。");
      return;
    }
    if (needsCheckin && !checkinId) {
      setError("請選擇該會員的一筆簽到紀錄。");
      return;
    }

    setPending(true);
    setError(null);
    setConfirmError(null);
    try {
      const payload: Record<string, unknown> = {
        action: "award",
        type,
        user_id: member.id,
      };
      if (type === "referral") payload.ref_user_id = refMember?.id;
      if (needsCheckin) payload.ref_id = checkinId;

      const data = await postJson<{ message?: string; skipped?: boolean }>(
        "/api/admin/point-rules",
        payload
      );
      setNotice(data.message ?? "已處理補發。");
      setConfirmOpen(false);
      setCheckinId("");
      router.refresh();
    } catch (err) {
      const message = err instanceof FetchError ? err.message : "網路錯誤，請稍後再試。";
      setConfirmError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card-dark p-5">
      <div className="flex items-start gap-2">
        <Sparkles size={17} className="mt-0.5 shrink-0 text-violet-300" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold">手動補發積分</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/60">
            用於系統漏發或線下補償。每次補發都會寫入操作紀錄；同一筆簽到／同一年生日不會重複加分。
          </p>
        </div>
      </div>

      {!hasServiceRole && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
          提示：目前未設定服務金鑰，補發會以你的管理員身分呼叫資料庫函式。
          若出現「資料庫未開放補發權限」，請執行{" "}
          <code className="font-mono">supabase/migration-points-r1-4-admin-grants.sql</code>。
        </p>
      )}

      <div className="mt-4 space-y-4">
        {error && <AdminError message={error} onDismiss={() => setError(null)} />}
        {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="補發類型" htmlFor="award-type">
            <select
              id="award-type"
              className="field"
              value={type}
              onChange={(event) => {
                const next = event.target.value as typeof type;
                setType(next);
                setNotice(null);
                setCheckinId("");
                if (next === "event" || next === "checkin") {
                  if (member) void loadCheckins(member.id);
                } else {
                  setCheckins([]);
                }
              }}
            >
              {AWARD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <MemberPicker
            id="award-member"
            label="會員"
            value={member}
            initial={initialMembers}
            onChange={(m) => {
              setMember(m);
              setNotice(null);
              setCheckinId("");
              setCheckins([]);
              if (m && needsCheckin) void loadCheckins(m.id);
            }}
          />

          {type === "referral" && (
            <MemberPicker
              id="award-ref-member"
              label="被邀請的會員"
              hint="用於防重複：同一位被邀請人只會計一次，且每月有人數上限。"
              value={refMember}
              initial={initialMembers}
              onChange={setRefMember}
            />
          )}

          {needsCheckin && (
            <Field
              label="該會員的簽到紀錄"
              htmlFor="award-checkin"
              hint="必須選「該會員」的簽到；系統用簽到 id 防重複，不是用活動 id。"
              error={
                member && !checkinLoading && checkins.length === 0
                  ? "此會員沒有簽到紀錄，無法用這個類型補發。"
                  : undefined
              }
            >
              <select
                id="award-checkin"
                className="field"
                value={checkinId}
                onChange={(event) => setCheckinId(event.target.value)}
                disabled={!member || checkinLoading}
              >
                <option value="">
                  {!member
                    ? "請先選擇會員"
                    : checkinLoading
                      ? "讀取簽到中…"
                      : checkins.length === 0
                        ? "沒有簽到紀錄"
                        : "請選擇一筆簽到"}
                </option>
                {checkins.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatDate(c.session?.session_date ?? c.created_at)} ·{" "}
                    {c.session?.title ?? "訓練"}（{c.status === "approved" ? "已確認" : c.status === "pending" ? "待確認" : "已駁回"}）
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-white/50">
            {member
              ? `將對「${member.display_name?.trim() || "（未具名會員）"}」補發${typeLabel}獎勵。`
              : "先選會員，再按補發。"}
          </p>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              setConfirmError(null);
              setError(null);
              setConfirmOpen(true);
            }}
            className="btn-base btn-ghost px-4 py-2 text-sm"
          >
            <Award size={16} /> 補發…
          </button>
        </div>
      </div>

      {confirmOpen && member && (
        <AdminModal
          title={`確認補發：${typeLabel}`}
          description="補發會即時增加會員積分，並寫入操作紀錄。"
          dismissible={!pending}
          onClose={() => {
            if (!pending) setConfirmOpen(false);
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="btn-base btn-ghost"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={pending}
                className="btn-base btn-cobalt"
              >
                {pending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> 補發中…
                  </>
                ) : (
                  "確認補發"
                )}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-white/80">
            {confirmError && <AdminError message={confirmError} />}
            <p>
              會員：<strong className="text-white">{member.display_name?.trim() || "（未具名會員）"}</strong>
            </p>
            <p>類型：{typeLabel}</p>
            {type === "referral" && refMember && (
              <p>
                被邀請人：
                <strong className="text-white">{refMember.display_name?.trim() || "（未具名會員）"}</strong>
              </p>
            )}
            {needsCheckin && checkinId && (
              <p className="text-xs text-white/60">
                簽到編號：<span className="font-mono">{checkinId.slice(0, 8)}…</span>
              </p>
            )}
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
              若系統判斷已曾發放（同筆簽到／同年生日／本月邀請達上限），會如實回報「未發放」，不會重複加分。
            </p>
          </div>
        </AdminModal>
      )}
    </section>
  );
}

/** 會員搜尋選擇器：輸入關鍵字 → 打 API → 選一位 */
function MemberPicker({
  id,
  label,
  hint,
  value,
  initial,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: MemberOption | null;
  initial: MemberOption[];
  onChange: (member: MemberOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MemberOption[]>(initial);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      requestJson<{ members?: MemberOption[] }>(
        `/api/admin/point-rules?mode=members&q=${encodeURIComponent(q)}`,
        { method: "GET" }
      )
        .then((data) => {
          if (alive) setOptions(Array.isArray(data.members) ? data.members : []);
        })
        .catch(() => {
          if (alive) setOptions([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, initial]);

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2">
          <span className="min-w-0 truncate text-sm">
            {value.display_name?.trim() || "（未具名會員）"}
            {typeof value.points === "number" && (
              <span className="ml-2 text-xs text-white/50">{value.points} 分</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="shrink-0 text-xs font-semibold text-white/60 underline-offset-2 hover:text-white hover:underline"
          >
            重選
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
            />
            <input
              id={id}
              className="field pl-9"
              value={query}
              placeholder="輸入會員名稱搜尋"
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                setOpen(true);
                if (!next.trim()) setOptions(initial);
              }}
              onFocus={() => setOpen(true)}
            />
          </div>

          {open && (
            <div className="max-h-52 overflow-y-auto rounded-lg border border-ink-line bg-ink p-1">
              {loading ? (
                <p className="flex items-center gap-2 px-3 py-2 text-xs text-white/50">
                  <Loader2 size={13} className="animate-spin" /> 搜尋中…
                </p>
              ) : options.length === 0 ? (
                <p className="px-3 py-2 text-xs text-white/50">
                  {query.trim() ? "找不到符合的會員，試試其他關鍵字。" : "最近加入的會員會顯示在這裡。"}
                </p>
              ) : (
                <ul>
                  {options.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(m);
                          setOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-white/8"
                      >
                        <span className="min-w-0 truncate">
                          {m.display_name?.trim() || "（未具名會員）"}
                        </span>
                        <span className="shrink-0 text-xs text-white/45">
                          {typeof m.points === "number" ? `${m.points} 分` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = new Date(t + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}
