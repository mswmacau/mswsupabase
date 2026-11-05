// app/api/mp/pay-mock-confirm/route.js
// 演示模式专用：模拟「支付成功」
//
// 只在 WECHAT_PAY_DEMO=true 时可用。
// 关键：它调用的是与正式回调完全相同的 markOrderPaid()，
// 所以演示时写入的订单状态、报名记录、名额计数，与真实支付一模一样。

import { requireMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { markOrderPaid } from '@/lib/mp/orders.js';
import { ok, fail, failFromError, bizError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    // 硬门：正式模式下一律拒绝，避免误用导致「免费报名」
    if (String(process.env.WECHAT_PAY_DEMO || 'true') !== 'true') {
      return fail('UNAUTHORIZED', '演示模式已關閉，此端點不可用', 403);
    }

    const { member } = await requireMember(request);
    const body = await request.json().catch(() => ({}));
    const { orderId } = body || {};
    if (!orderId) throw bizError('INVALID_PARAM', '缺少 orderId');

    const sb = db();
    const { data: order, error } = await sb
      .from('mp_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw error;
    if (!order) throw bizError('INVALID_PARAM', '訂單不存在', 404);
    if (String(order.member_id) !== String(member.id)) {
      throw bizError('UNAUTHORIZED', '無權操作此訂單', 403);
    }

    const { order: paid, repeated } = await markOrderPaid(orderId, {
      paidVia: 'demo',
      transactionId: `demo_${Date.now()}`,
    });

    return ok({
      paid: true,
      repeated,
      orderId: paid.id,
      status: paid.status,
      eventId: paid.event_id,
      amount: paid.amount,
    });
  } catch (e) {
    return failFromError(e);
  }
}
