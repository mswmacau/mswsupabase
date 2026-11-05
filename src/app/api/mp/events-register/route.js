// app/api/mp/events-register/route.js
// 活动报名
//
// 分流：
//   fee === 0  → 直接报名成功（写 event_registrations）
//   fee  >  0  → 建订单，返回 needPay，由前端接支付
//
// 已对齐真实结构（2026-11-04）：
//   event_registrations: (event_id, user_id, status) —— 会员列是 user_id，不是 member_id
//   status 只允许 'registered' | 'cancelled'（没有 confirmed）
//   表上有 unique(event_id, user_id)，重复报名会撞唯一约束，正好用来防重

import { requireMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F, toEvent } from '@/lib/mp/schema.js';
import { createOrder } from '@/lib/mp/orders.js';
import { ok, fail, failFromError, bizError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  try {
    const { member } = await requireMember(request);
    const body = await request.json().catch(() => ({}));
    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
    const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';

    if (!UUID_RE.test(eventId)) throw bizError('INVALID_PARAM', '活動參數不正確');

    const sb = db();

    // ---------- 1. 取活动 ----------
    const { data: ev, error: eErr } = await sb
      .from(T.events)
      .select('*')
      .eq(F.event.id, eventId)
      .maybeSingle();
    if (eErr) throw eErr;
    if (!ev) throw bizError('INVALID_PARAM', '活動不存在', 404);

    const status = ev[F.event.status];
    if (status !== 'published') throw bizError('EVENT_CLOSED', '此活動暫未開放報名', 409);

    const event = toEvent(ev);

    // ---------- 2. 是否已报名 ----------
    const { data: existing } = await sb
      .from(T.registrations)
      .select('*')
      .eq('event_id', eventId)
      .eq('user_id', member.id)
      .maybeSingle();

    if (existing && existing.status === 'registered') {
      throw bizError('ALREADY_REGISTERED', '你已經報名此活動', 409);
    }

    // ---------- 3. 名额（真实计数，不信任任何缓存字段）----------
    if (event.capacity > 0) {
      const { count } = await sb
        .from(T.registrations)
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('status', 'registered');
      if ((count ?? 0) >= event.capacity) {
        throw bizError('EVENT_FULL', '名額已滿', 409);
      }
    }

    // ---------- 4a. 免费活动：直接报名 ----------
    if (event.fee <= 0) {
      // 之前取消过的，用 update 复活；否则 insert
      const op = existing
        ? sb
            .from(T.registrations)
            .update({ status: 'registered' })
            .eq('id', existing.id)
            .select()
            .single()
        : sb
            .from(T.registrations)
            .insert({ event_id: eventId, user_id: member.id, status: 'registered' })
            .select()
            .single();

      const { data: saved, error: wErr } = await op;

      if (wErr) {
        // 23505 = 唯一约束冲突（并发重复报名），这本来就是我们要挡的
        if (wErr.code === '23505' || /duplicate|unique/i.test(wErr.message || '')) {
          throw bizError('ALREADY_REGISTERED', '你已經報名此活動', 409);
        }
        throw wErr;
      }

      return ok({
        needPay: false,
        registered: true,
        registrationId: saved?.id || null,
      });
    }

    // ---------- 4b. 收费活动：建订单，等前端支付 ----------
    const order = await createOrder({
      memberId: member.id,
      eventId,
      amount: event.fee,
      subject: `${event.title} 報名費`,
      requestId: requestId || `reg_${member.id}_${eventId}`,
    });

    return ok({
      needPay: true,
      orderId: order.id,
      amount: order.amount,
      subject: order.subject,
    });
  } catch (e) {
    return failFromError(e);
  }
}
