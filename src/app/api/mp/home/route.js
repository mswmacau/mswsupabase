// app/api/mp/home/route.js
// 首页聚合端点：一个请求拿完首页所有数据。
// 为什么聚合：小程序首屏如果发 4 个并发请求，冷启动很难压到 2.0s 以内（G3 硬指标）。
//
// 已对齐真实结构（2026-11-04）：
//   rewards.status='active'（不是布尔列）、stock_remaining 可为 null（不限量）
//   events 用 event_date(date) 排序，没有 start_at、没有 type
//   event_registrations 的会员列是 user_id、状态值是 'registered'|'cancelled'
//   月度跑步真实数据来自 monthly_running_stats(user_id, period_month, total_km, runs)

import { optionalMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F, toProduct } from '@/lib/mp/schema.js';
import { ok, failFromError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 澳门时区的今天 / 本月，避免 UTC 跨日 */
function macauToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Macau' }); // YYYY-MM-DD
}

function daysUntilMonthEnd() {
  const today = macauToday();
  const [y, m, d] = today.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)); // 当月最后一天
  return Math.max(0, end.getUTCDate() - d);
}

export async function GET(request) {
  try {
    const { member } = await optionalMember(request);
    const sb = db();
    const points = member?.points ?? 0;

    // 每个子查询独立容错：某张表还没建好，首页也要能开（只是那块显示空）
    const safe = async (fn, fallback) => {
      try {
        return await fn();
      } catch (e) {
        console.warn('[mp-home] 子查詢失敗', e?.message);
        return fallback;
      }
    };

    // ---------- 热门礼品（前 4 个上架且有货）----------
    const hotProducts = await safe(async () => {
      const { data } = await sb
        .from(T.products)
        .select('*')
        .eq(F.product.status, 'active')
        .order(F.product.sortOrder, { ascending: true })
        .limit(10);
      return (data || [])
        .filter((r) => {
          const stock = r[F.product.stock];
          return stock === null || stock === undefined || stock > 0;
        })
        .slice(0, 4)
        .map((r) => toProduct(r, points));
    }, []);

    // ---------- 平台统计 ----------
    const statCount = async (table, apply) =>
      safe(async () => {
        let q = sb.from(table).select('*', { count: 'exact', head: true });
        if (apply) q = apply(q);
        const { count } = await q;
        return count ?? 0;
      }, 0);

    const [memberCount, sessionCount] = await Promise.all([
      statCount(T.members),
      statCount(T.events, (q) => q.eq(F.event.status, 'published')),
    ]);

    // 平台累计里程：把所有会员的 total_km 加总（规模小，直接取回累加）
    const totalKm = await safe(async () => {
      const { data } = await sb.from(T.members).select(F.member.totalKm).limit(1000);
      const sum = (data || []).reduce((a, r) => a + Number(r[F.member.totalKm] ?? 0), 0);
      return Math.round(sum * 10) / 10;
    }, 0);

    // ---------- 月度跑步进度（真实数据）----------
    const running = await safe(async () => {
      const month = macauToday().slice(0, 7); // YYYY-MM
      const goalKm = 300;
      let monthKm = 0;

      if (member) {
        const { data } = await sb
          .from('monthly_running_stats')
          .select('total_km, runs')
          .eq('user_id', member.id)
          .eq('period_month', month)
          .maybeSingle();
        monthKm = Number(data?.total_km ?? 0);
      }

      return {
        title: '月度跑步挑戰',
        month,
        monthKm: Math.round(monthKm * 10) / 10,
        goalKm,
        percent: Math.min(100, Math.round((monthKm / goalKm) * 1000) / 10),
        daysLeft: daysUntilMonthEnd(),
      };
    }, null);

    // ---------- 下一场已发布的活动 ----------
    const nextSession = await safe(async () => {
      const { data } = await sb
        .from(T.events)
        .select('*')
        .eq(F.event.status, 'published')
        .gte(F.event.date, macauToday())
        .order(F.event.date, { ascending: true })
        .order(F.event.startTime, { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!data) return null;

      let registered = false;
      if (member) {
        const { data: reg } = await sb
          .from(T.registrations)
          .select('id')
          .eq('event_id', data[F.event.id])
          .eq('user_id', member.id)
          .eq('status', 'registered')
          .maybeSingle();
        registered = !!reg;
      }

      const date = data[F.event.date];
      const time = (data[F.event.startTime] || '00:00').slice(0, 5);

      return {
        id: data[F.event.id],
        title: data[F.event.title],
        startAt: date ? `${date}T${time}:00+08:00` : null,
        location: data[F.event.location] || '澳門街健館',
        registered,
      };
    }, null);

    return ok({
      member,
      stats: {
        totalKm,
        memberCount,
        sessionCount,
        kmGoal: 300,
      },
      running,
      nextSession,
      hotProducts,
      banners: [],
    });
  } catch (e) {
    return failFromError(e);
  }
}
