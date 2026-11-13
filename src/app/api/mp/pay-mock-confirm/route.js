// app/api/mp/pay-mock-confirm/route.js
// 演示模式专用：模拟「支付成功」
//
// ── P0 安全修复 ────────────────────────────────────────────
// 旧写法：if (String(process.env.WECHAT_PAY_DEMO || 'true') !== 'true')
//   → 环境变量【未设定】时 || 退化成 'true'，闸门默认开启，
//     任何持有 mp token 的会员都能把自己的订单标记为已付款（等于免费报名）。
// 新语义：严格白名单，只有 process.env.WECHAT_PAY_DEMO === 'true' 才开；
//   未设定 / 空字串 / 'false' / '1' / 'TRUE' / 'true '(带空格) 一律关闭（fail closed）。
//
// 关键：它调用的是与正式回调完全相同的 markOrderPaid()，
// 所以演示时写入的订单状态、报名记录、名额计数，与真实支付一模一样。

import { requireMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { markOrderPaid } from '@/lib/mp/orders.js';
import { ok, failFromError, bizError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 演示模式是否开启。严格白名单：只认字面量 'true'。
 * 刻意不用 respond.js 的 fail()：派工单指定 403 的响应体为
 * {ok:false, code:"DEMO_DISABLED", error:"此功能未啟用。"}（error 是字串），
 * 与 fail() 的 {ok:false, error:{code, message}} 结构不同。
 * 这是全档唯一的例外，改动前请先确认小程序端没有依赖 fail() 的嵌套结构。
 */
function demoDisabledResponse() {
  return Response.json(
    { ok: false, code: 'DEMO_DISABLED', error: '此功能未啟用。' },
    { status: 403 }
  );
}

export async function POST(request) {
  try {
    // ① 先验身份：没有 token / token 无效 一律 401（鉴权行为不随闸门开关改变）
    const { member } = await requireMember(request);

    // ② 硬门：只有 WECHAT_PAY_DEMO 明确等于 'true' 才放行，其余一律 403
    if (process.env.WECHAT_PAY_DEMO !== 'true') {
      return demoDisabledResponse();
    }

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
