"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { formatDate, formatKm } from "@/lib/utils";

/**
 * 後台會員管理：搜尋 / 列表 / 改角色 / 調整積分
 *
 * 設計：
 *  - 列表一律打 /api/admin/members（後端會再驗一次管理員身分）。
 *    不在 Server Component 直接查，因為改角色／改積分需要 security definer
 *    RPC，統一走同一條 API 比較好對齊錯誤訊息與稽核。
 *  - 搜尋 debounce 300ms；切換關鍵字時中止上一個請求，避免舊結果覆蓋新結果。
 *  - 角色下拉選了即送出；因為 value 綁定列資料，失敗時會自動回到原值。
 *  - 積分用頁內對話框，不用 alert()；成功／失敗都顯示在頁內訊息區。
 */

type Role = "member" | "admin";

type MemberRow = {
  member_id: string;
  display_name: string | null;
  email: string | null;
  role: Role;
  points: number;
  total_km: number | string;
  created_at: string;
  last_sign_in_at: string | null;
  run_count: number | string;
  checkin_count: number | string;
  coupon_count: number | string;
};

const ROLE_LABEL: Record<Role, string> = {
  member: "會員",
  admin: "管理員",
};

const PAGE_LIMIT = 50;

function memberName(m: MemberRow): string {
  return m.display_name?.trim() || m.email || "（未具名會員）";
}

export function MemberManager() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [target, setTarget] = useState<MemberRow | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [savingPoints, setSavingPoints] = useState(false);
  // 對話框內的錯誤（頁面層的訊息區在遮罩後面，看不到）
  const [pointsError, setPointsError] = useState<string | null>(null);

  /* ---------- 搜尋 debounce 300ms ---------- */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  /* ---------- 讀取列表 ---------- */
  useEffect(() => {
    const controller = new AbortController();

    async function fetchMembers() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search) params.set("q", search);
        params.set("limit", String(PAGE_LIMIT));

        const res = await fetch(`/api/admin/members?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await res.json()) as {
          ok: boolean;
          error?: string;
          data?: { members?: MemberRow[] };
        };
        if (controller.signal.aborted) return;

        if (!body.ok) {
          setMembers([]);
          setError(body.error ?? "讀取會員資料失敗。");
          return;
        }

        setMembers(Array.isArray(body.data?.members) ? body.data.members : []);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("網路錯誤，請稍後再試。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void fetchMembers();
    return () => controller.abort();
  }, [search, reloadKey]);

  /* ---------- 改角色 ---------- */
  async function changeRole(member: MemberRow, role: Role) {
    if (role === member.role) return;

    setBusyId(member.member_id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_role",
          userId: member.member_id,
          role,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
      };

      if (!body.ok) {
        setError(body.error ?? "更新角色失敗。");
        return;
      }

      setMembers((prev) =>
        prev.map((m) =>
          m.member_id === member.member_id ? { ...m, role } : m
        )
      );
      setNotice(`已將「${memberName(member)}」設為${ROLE_LABEL[role]}。`);
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  }

  /* ---------- 調整積分 ---------- */
  function openPoints(member: MemberRow) {
    setTarget(member);
    setDelta("");
    setReason("");
    setPointsError(null);
    setError(null);
    setNotice(null);
  }

  function closePoints() {
    if (savingPoints) return;
    setTarget(null);
  }

  async function submitPoints() {
    if (!target) return;

    const value = Number(delta);
    if (!Number.isInteger(value) || value === 0) {
      setPointsError("請輸入非 0 的整數（正數加分、負數扣分）。");
      return;
    }

    setSavingPoints(true);
    setPointsError(null);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust_points",
          userId: target.member_id,
          delta: value,
          reason: reason.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
        data?: { points?: number };
      };

      if (!body.ok) {
        setPointsError(body.error ?? "調整積分失敗。");
        return;
      }

      const points = Number(body.data?.points);
      if (Number.isFinite(points)) {
        setMembers((prev) =>
          prev.map((m) =>
            m.member_id === target.member_id ? { ...m, points } : m
          )
        );
      }
      setNotice(body.message ?? "已調整積分。");
      setTarget(null);
    } catch {
      setPointsError("網路錯誤，請稍後再試。");
    } finally {
      setSavingPoints(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ===== 頁內訊息區 ===== */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* ===== 工具列 ===== */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
          />
          <input
            type="search"
            className="field !pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋名稱或電郵"
            aria-label="搜尋會員名稱或電郵"
          />
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={loading}
          className="btn-base btn-ghost"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          重新整理
        </button>
      </div>

      {/* ===== 列表 ===== */}
      {loading && members.length === 0 ? (
        <div className="rounded-xl border border-ink-line bg-ink-soft px-4 py-12 text-center text-sm text-white/60">
          <Loader2 size={20} className="mx-auto animate-spin" />
          <span className="mt-2 block">載入中…</span>
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-12 text-center text-sm text-white/60">
          {search ? "找不到符合條件的會員。" : "尚無會員資料。"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-line">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-ink-soft text-left text-xs text-white/60">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  名稱
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  電郵
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  角色
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                  積分
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                  總里程
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  加入日期
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  提交／簽到／券
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-line">
              {members.map((m) => (
                <tr key={m.member_id}>
                  <td className="max-w-[180px] truncate px-4 py-3 font-semibold">
                    {m.display_name?.trim() || "（未具名會員）"}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-white/70">
                    {m.email ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="field !w-auto !px-2.5 !py-1.5 text-xs"
                      value={m.role}
                      disabled={busyId === m.member_id}
                      aria-label={`${memberName(m)} 的角色`}
                      onChange={(e) =>
                        void changeRole(m, e.target.value as Role)
                      }
                    >
                      <option value="member">會員</option>
                      <option value="admin">管理員</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {Number(m.points).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatKm(m.total_km)} km
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-white/70">
                    {formatDate(m.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-white/70">
                    {Number(m.run_count)}／{Number(m.checkin_count)}／
                    {Number(m.coupon_count)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openPoints(m)}
                      disabled={busyId === m.member_id}
                      className="btn-base btn-ghost !px-3 !py-1.5 text-xs"
                    >
                      <Coins size={14} /> 調整積分
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-white/50">
        顯示 {members.length} 位（最多 {PAGE_LIMIT} 位，可用搜尋縮小範圍）。
      </p>

      {/* ===== 調整積分對話框 ===== */}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="points-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-ink-line bg-ink-soft p-5">
            <div className="flex items-start justify-between gap-4">
              <h3 id="points-title" className="text-base font-bold">
                調整積分
              </h3>
              <button
                type="button"
                onClick={closePoints}
                disabled={savingPoints}
                aria-label="關閉"
                className="text-white/50 transition hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <p className="mt-1 text-xs text-white/60">
              {memberName(target)} · 目前 {Number(target.points).toLocaleString()}{" "}
              分
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="label" htmlFor="points-delta">
                  調整值（正數加分、負數扣分）
                </label>
                <input
                  id="points-delta"
                  type="number"
                  step={1}
                  className="field"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="例：50 或 -20"
                  autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="points-reason">
                  原因（選填）
                </label>
                <input
                  id="points-reason"
                  type="text"
                  className="field"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="例：活動補發"
                  maxLength={200}
                />
              </div>
            </div>

            {pointsError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{pointsError}</span>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closePoints}
                disabled={savingPoints}
                className="btn-base btn-ghost"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitPoints()}
                disabled={savingPoints}
                className="btn-base btn-cobalt"
              >
                {savingPoints ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> 儲存中…
                  </>
                ) : (
                  <>
                    <Coins size={16} /> 確認調整
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
