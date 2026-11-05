// lib/mp/orders.js
// 订单落库 / 标记已支付。
//
// 核心设计：演示模式与正式支付**共用这一个 markOrderPaid()**。
// 这样「演示时客户看到的流程」与「上线后的真实流程」走同一条代码路径，
// 不会出现「演示一套、上线另一套」的落差。
//
// ⚠️ 2026-11-04 修正：写入 event_registrations 时，
//    会员列是 user_id（不是 member_id）、状态值是 'registered'（不是 'confirmed'）。
//    mp_orders 自己的 member_id 列保持不变。

import { db } from './db.js';
import { bizError } from './respond.js';

const T_ORDERS = 'mp_orders';
const T_REG = 'event_registrations';

/** 真实结构的报名状态值 */
const REG_STATUS = 'registered';

/**
 * 创建订单（幂等：同一 requestId 返回同一张单）
 */
export async function createOrder({ memberId, eventId, amount, subject, requestId }) {
  const sb = db();

  const { data: existing } = await sb
    .from(T_ORDERS)
    .select('*')
    .eq('request_id', requestId)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await sb
    .from(T_ORDERS)
    .insert({
      member_id: memberId,
      event_id: eventId,
      amount,
      subject,
      status: 'pending',
      request_id: requestId,
    })
    .select()
    .single();

  if (error) {
    // 唯一索引冲突 = 并发下已被创建，回查即可
    if (String(error.message).includes('duplicate')) {
      const { data: again } = await sb
        .from(T_ORDERS)
        .select('*')
        .eq('request_id', requestId)
        .maybeSingle();
      if (again) return again;
    }
    throw error;
  }
  return data;
}

/**
 * 标记订单已支付 —— 演示模式与正式回调共用
 *
 * 幂等：已 paid 的订单直接返回，不重复占名额
 * @param {string} orderId
 * @param {{ transactionId?: string, paidVia?: 'demo'|'wechat' }} opts
 */
export async function markOrderPaid(orderId, opts = {}) {
  const sb = db();

  const { data: order, error: qErr } = await sb
    .from(T_ORDERS)
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (qErr) throw qErr;
  if (!order) throw bizError('INVALID_PARAM', '訂單不存在', 404);
  if (order.status === 'paid') {
    return { order, repeated: true };
  }

  // 1. 更新订单
  const { data: updated, error: uErr } = await sb
    .from(T_ORDERS)
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      transaction_id: opts.transactionId || order.transaction_id || null,
      paid_via: opts.paidVia || 'demo',
    })
    .eq('id', orderId)
    .eq('status', 'pending') // 乐观锁：并发下只有一个能改成功
    .select()
    .maybeSingle();

  if (uErr) throw uErr;

  if (!updated) {
    // 被别人抢先改了，回查真实状态
    const { data: again } = await sb.from(T_ORDERS).select('*').eq('id', orderId).maybeSingle();
    return { order: again || order, repeated: true };
  }

  // 2. 占名额（报名记录）
  // 真实结构：event_registrations(event_id, user_id, status)，
  // 会员列叫 user_id，状态值 'registered'。
  if (updated.event_id) {
    const { error: rErr } = await sb.from(T_REG).insert({
      event_id: updated.event_id,
      user_id: updated.member_id,
      order_id: updated.id,
      status: REG_STATUS,
    });

    // 已报名（唯一索引冲突）不算失败
    if (rErr && !String(rErr.message).includes('duplicate')) {
      console.error('[mp-orders] 寫入報名失敗', rErr);
      throw rErr;
    }

    // 名额计数 +1（失败不阻塞支付结果）
    try {
      await sb.rpc('mp_event_increment', { p_event_id: updated.event_id });
    } catch (e) {
      console.warn('[mp-orders] 名額計數更新失敗（不影響支付）', e?.message);
    }
  }

  return { order: updated, repeated: false };
}
