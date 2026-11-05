// app/api/mp/profile/route.js
// 会员中心：身份 + 统计 + 最近积分流水
//
// 已对齐真实结构（2026-11-04）：
//   point_transactions 只有 7 列：id / user_id / delta / reason / ref_type / ref_id / created_at
//   ⚠️ 没有 balance_after、没有 remark、没有 type —— 原版这三个字段全是错的
//   totalKm 直接取 profiles.total_km（真实存在的列），不再写死 20.8

import { requireMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F } from '@/lib/mp/schema.js';
import { ok, failFromError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const safe = async (fn, fallback) => {
  try {
    return await fn();
  } catch (e) {
    console.warn('[mp-profile] 子查詢失敗', e?.message);
    return fallback;
  }
};

export async function GET(request) {
  try {
    const { member } = await requireMember(request);
    const sb = db();

    const totalRedemptions = await safe(async () => {
      const { count } = await sb
        .from(T.redemptions)
        .select('*', { count: 'exact', head: true })
        .eq(F.redemption.memberId, member.id);
      return count ?? 0;
    }, 0);

    const totalCheckins = await safe(async () => {
      const { count } = await sb
        .from('training_checkins')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', member.id);
      return count ?? 0;
    }, 0);

    const recentLedger = await safe(async () => {
      const { data, error } = await sb
        .from(T.ledger)
        .select('*')
        .eq(F.ledger.memberId, member.id)
        .order(F.ledger.createdAt, { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []).map((r) => ({
        id: r[F.ledger.id],
        delta: r[F.ledger.delta] ?? 0,
        reason: r[F.ledger.reason] || '積分變動',
        refType: r[F.ledger.refType] || null,
        refId: r[F.ledger.refId] || null,
        createdAt: r[F.ledger.createdAt],
      }));
    }, []);

    return ok({
      member,
      stats: {
        totalRedemptions,
        totalCheckins,
        totalKm: member.totalKm ?? 0,
      },
      recentLedger,
    });
  } catch (e) {
    return failFromError(e);
  }
}
