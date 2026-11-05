// app/api/mp/events/route.js
// 活动列表（含「我是否已报名」与「已报名人数」）
//
// 已对齐真实结构（2026-11-04）：
//   events 没有 start_at / type，时间用 event_date(date) + start_time(text)
//   event_registrations 会员列是 user_id，状态值 'registered' | 'cancelled'
//   events 没有已报名人数字段，必须即时聚合

import { optionalMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F, toEvent } from '@/lib/mp/schema.js';
import { ok, failFromError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { member } = await optionalMember(request);
    const sb = db();

    const { data: rows, error } = await sb
      .from(T.events)
      .select('*')
      .eq(F.event.status, 'published')
      .order(F.event.date, { ascending: true })
      .order(F.event.startTime, { ascending: true })
      .limit(50);

    if (error) throw error;
    const events = rows || [];
    const ids = events.map((r) => r[F.event.id]);

    // 我的报名（一次查完，不逐条查）
    let registeredSet = new Set();
    if (member) {
      const { data: mine } = await sb
        .from(T.registrations)
        .select('event_id')
        .eq('user_id', member.id)
        .eq('status', 'registered');
      registeredSet = new Set((mine || []).map((r) => String(r.event_id)));
    }

    // 每场已报名人数（同样一次查完，JS tally）
    const countMap = {};
    if (ids.length) {
      const { data: all } = await sb
        .from(T.registrations)
        .select('event_id')
        .in('event_id', ids)
        .eq('status', 'registered');
      for (const r of all || []) {
        const key = String(r.event_id);
        countMap[key] = (countMap[key] || 0) + 1;
      }
    }

    const list = events.map((r) => {
      const item = toEvent(r);
      item.registered = registeredSet.has(String(item.id));
      item.registeredCount = countMap[String(item.id)] || 0;
      return item;
    });

    return ok({ list });
  } catch (e) {
    return failFromError(e);
  }
}
