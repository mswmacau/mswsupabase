"use client";

/**
 * 澳門時間（UTC+8，無日光節約）——用 UTC getter 手算，
 * 避免「伺服器渲染 vs 瀏覽器 hydration」因時區不同而對不上。
 */
export function formatMacau(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = new Date(t + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}`;
}

/** 註冊天數（不足一天算 0）；created_at 壞掉回 null */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export const STATUS_LABEL: Record<string, string> = {
  pending_approval: "待審批",
  pending: "待領取",
  completed: "已完成",
  cancelled: "已取消",
};

export function statusPillClass(status: string): string {
  switch (status) {
    case "pending_approval":
      return "border-amber-500/45 bg-amber-500/10 text-amber-200";
    case "pending":
      return "border-sky-500/40 bg-sky-500/10 text-sky-200";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "cancelled":
      return "border-white/20 bg-white/5 text-white/55";
    default:
      return "border-white/20 bg-white/5 text-white/60";
  }
}

/** A2B3C4 → A2B3-C4（只為了好讀，實際連結仍用原始碼） */
export function groupCode(code: string | null): string {
  if (!code) return "（未產生）";
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join("-") ?? clean;
}
