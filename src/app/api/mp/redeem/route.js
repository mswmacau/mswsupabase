// app/api/mp/redeem/route.js
// 可兑换礼品列表
//
// 已对齐真实结构（2026-11-04）：
//   rewards.status = 'active' | 'inactive'（不是 active 布尔列）
//   rewards.points_cost / stock_remaining / image_path（不是 points / stock / cover_url）
//   app_settings.rewards_enabled 是止血开关，关闭时整条兑换链要拦住

import { optionalMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F, toProduct } from '@/lib/mp/schema.js';
import { ok, fail, failFromError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 止血开关；读不到一律视为关闭（宁可不显示，也不要显示坏页） */
async function isRewardsEnabled(sb) {
  const { data, error } = await sb
    .from(T.settings)
    .select('value')
    .eq('key', 'rewards_enabled')
    .maybeSingle();
  if (error || !data) return false;
  return data.value === true || data.value === 'true';
}

export async function GET(request) {
  try {
    const sb = db();

    if (!(await isRewardsEnabled(sb))) {
      return fail('FEATURE_OFF', '禮品換領暫未開放', 403);
    }

    const { member } = await optionalMember(request);
    const sp = new URL(request.url).searchParams;

    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(sp.get('pageSize') || '20', 10) || 20));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await sb
      .from(T.products)
      .select('*', { count: 'exact' })
      .eq(F.product.status, 'active')
      .order(F.product.sortOrder, { ascending: true })
      .order(F.product.createdAt, { ascending: false })
      .range(from, to);

    if (error) throw error;

    // 商户名：service_role 绕过 RLS，可以直接读 merchants
    const merchantIds = [...new Set((data || []).map((r) => r[F.product.merchantId]).filter(Boolean))];
    let nameMap = {};
    if (merchantIds.length) {
      const { data: mch } = await sb
        .from(T.merchants)
        .select(`${F.merchant.id}, ${F.merchant.name}`)
        .in(F.merchant.id, merchantIds);
      nameMap = Object.fromEntries(
        (mch || []).map((m) => [String(m[F.merchant.id]), m[F.merchant.name]])
      );
    }

    const points = member?.points ?? 0;
    const list = (data || []).map((r) =>
      toProduct(
        { ...r, merchant_name: nameMap[String(r[F.product.merchantId])] },
        points
      )
    );

    return ok({
      list,
      page,
      pageSize,
      total: count ?? list.length,
      hasMore: (count ?? 0) > to + 1,
      memberPoints: points,
    });
  } catch (e) {
    return failFromError(e);
  }
}
