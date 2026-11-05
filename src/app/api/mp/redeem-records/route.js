// app/api/mp/redeem-records/route.js
// 我的兑换记录
//
// 已对齐真实结构（2026-11-04）：
//   reward_redemptions 表**没有** reward_name / reward_image_path 两列，
//   商品名与图片必须从 rewards 表 join 回来（网站 lib/rewards.ts 也是这么做的）。
//   状态四态：pending | pending_approval | completed | cancelled

import { requireMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F, toRedemption } from '@/lib/mp/schema.js';
import { ok, failFromError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { member } = await requireMember(request);
    const sp = new URL(request.url).searchParams;

    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(sp.get('pageSize') || '20', 10) || 20));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const sb = db();
    const { data: rows, error, count } = await sb
      .from(T.redemptions)
      .select('*', { count: 'exact' })
      .eq(F.redemption.memberId, member.id)
      .order(F.redemption.createdAt, { ascending: false })
      .range(from, to);

    if (error) throw error;

    // 批量取商品名与图片
    const rewardIds = [...new Set((rows || []).map((r) => r[F.redemption.productId]).filter(Boolean))];
    let productMap = {};
    if (rewardIds.length) {
      const { data: products } = await sb
        .from(T.products)
        .select(`${F.product.id}, ${F.product.name}, ${F.product.cover}`)
        .in(F.product.id, rewardIds);
      productMap = Object.fromEntries(
        (products || []).map((p) => [
          String(p[F.product.id]),
          { name: p[F.product.name], image_path: p[F.product.cover] },
        ])
      );
    }

    const list = (rows || []).map((r) =>
      toRedemption(r, productMap[String(r[F.redemption.productId])])
    );

    return ok({
      list,
      page,
      pageSize,
      total: count ?? list.length,
      hasMore: (count ?? 0) > to + 1,
    });
  } catch (e) {
    return failFromError(e);
  }
}
