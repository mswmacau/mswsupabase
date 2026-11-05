// app/api/mp/redeem-submit/route.js
// 提交兑换 —— 全系统最需要谨慎的端点
//
// 设计原则（2026-11-04 拍板）：
//   **不重写扣分算法。** 你网站已经有 rpc('redeem_reward')，里面有行锁、每人限购、
//   四态状态机、提货码生成。我再写一套 = 两套真相，将来对不上账。
//
//   本路由只做三件事：鉴权 → 调 DB → 把错误码翻成客人看得懂的话。
//
// 为什么调的是 mp_redeem_reward 而不是 redeem_reward：
//   redeem_reward 第一句是 auth.uid()，它认的是 PostgREST 请求里的 JWT sub。
//   我们服务端用的是 service_role，没有用户 JWT，auth.uid() 会是 null。
//   mp_redeem_reward（004 迁移）只做一件事：把会员 id 注入成 claims，然后原封不动
//   转交给 redeem_reward。业务逻辑一行都没有复制。

import { requireMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F, assetUrl, REDEMPTION_STATUS_LABEL } from '@/lib/mp/schema.js';
import { ok, fail, failFromError, bizError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RPC 业务错误码 → HTTP 响应。
 * 这些码与网站 src/app/api/rewards/redeem/route.ts 的映射表逐条对齐，
 * 保证「同一个失败原因，网站和小程序说的话一样」。
 */
function mapBizCode(res) {
  switch (res.code) {
    case 'UNAUTHENTICATED':
      return fail('UNAUTHORIZED', '登入已失效，請重新進入', 401);
    // redeem_reward 源碼第 332–338 行：冪等鍵 btrim 後長度須 16–64
    // 正常情況下本路由已先擋掉，這裡補上只是避免 RPC 回此碼時掉進 default 顯示通用錯誤
    case 'INVALID_ARGUMENT':
      return fail('INVALID_PARAM', '提交參數不正確，請返回重試', 400);
    case 'INSUFFICIENT_POINTS':
      return fail(
        'INSUFFICIENT_POINTS',
        `積分不足：你現時有 ${Number(res.points ?? 0)} 分，這件禮品需要 ${Number(res.required ?? 0)} 分`,
        409
      );
    case 'OUT_OF_STOCK':
      return fail('OUT_OF_STOCK', '這件禮品已換完', 409);
    case 'PER_USER_LIMIT':
      return fail(
        'PER_USER_LIMIT',
        `每人限換 ${Number(res.limit ?? 0)} 件，你已換 ${Number(res.used ?? 0)} 件`,
        409
      );
    case 'REWARD_INACTIVE':
      return fail('REWARD_INACTIVE', '這件禮品已下架', 409);
    case 'FEATURE_OFF':
      return fail('FEATURE_OFF', '禮品換領暫未開放', 403);
    case 'RETRY':
      return fail('RETRY', '系統繁忙，請再按一次確認', 409);
    default:
      console.error('[mp-redeem-submit] 未預期的 RPC 回傳', res);
      return fail('INTERNAL', '兌換失敗，請稍後重試', 500);
  }
}

function mapRpcError(error) {
  // PGRST202 = 函数不存在（迁移没跑）
  if (error?.code === 'PGRST202' || /schema cache|does not exist/i.test(error?.message || '')) {
    console.error('[mp-redeem-submit] 橋接函數未建立', error);
    return fail(
      'SCHEMA_OUTDATED',
      '兌換服務未初始化：請先執行 db/migrations/004_mp_redeem_bridge.sql',
      503
    );
  }
  console.error('[mp-redeem-submit] rpc 失敗', error);
  return fail('INTERNAL', '兌換失敗，請稍後重試', 500);
}

export async function POST(request) {
  try {
    const { member } = await requireMember(request);
    const pointsBefore = Number(member.points ?? 0);

    const body = await request.json().catch(() => ({}));
    const rewardId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';

    if (!UUID_RE.test(rewardId)) throw bizError('INVALID_PARAM', '商品參數不正確');
    // redeem_reward 内部要求幂等键 16–64 位
    if (requestId.length < 16 || requestId.length > 64) {
      throw bizError('INVALID_PARAM', '缺少有效的 requestId（防重複提交用）');
    }

    const sb = db();

    // ---------- 1. 调 RPC（扣分 / 扣库存 / 生成提货码 全在这一个事务里）----------
    const { data, error } = await sb.rpc('mp_redeem_reward', {
      p_user_id: String(member.id),
      p_reward_id: rewardId,
      p_idempotency_key: requestId,
    });

    if (error) return mapRpcError(error);

    const res = data || {};
    if (res.ok !== true) return mapBizCode(res);

    // ---------- 2. 把这一笔记录捞回来，取得 id / 提货码 / 状态 ----------
    // RPC 的返回值里没有 redemption_id，所以补一次查询。
    // 只取最新一笔且必须匹配本商品的记录，不会拿错。
    let redemptionId = null;
    let couponCode = typeof res.code === 'string' ? res.code : '';
    let status = typeof res.status === 'string' ? res.status : 'pending';
    let expiresAt = res.expires_at || null;

    const { data: rows } = await sb
      .from(T.redemptions)
      .select('*')
      .eq(F.redemption.memberId, member.id)
      .eq(F.redemption.productId, rewardId)
      .order(F.redemption.createdAt, { ascending: false })
      .limit(1);

    if (rows && rows.length) {
      const row = rows[0];
      redemptionId = row[F.redemption.id] || null;
      couponCode = row[F.redemption.couponCode] || couponCode;
      status = row[F.redemption.status] || status;
      expiresAt = row[F.redemption.expiresAt] || expiresAt;
    }

    // ---------- 3. 余额：优先用 RPC 回的权威值 ----------
    let pointsAfter =
      typeof res.points_balance === 'number' ? res.points_balance : null;

    if (pointsAfter === null) {
      const { data: fresh } = await sb
        .from(T.members)
        .select(F.member.points)
        .eq(F.member.id, member.id)
        .maybeSingle();
      pointsAfter = Number(fresh?.[F.member.points] ?? 0);
    }

    const { data: product } = await sb
      .from(T.products)
      .select(`${F.product.name}, ${F.product.cover}`)
      .eq(F.product.id, rewardId)
      .maybeSingle();

    return ok({
      redemptionId,
      pointsBefore,
      pointsAfter,
      // 幂等命中：同一 requestId 重复提交，返回上次结果，不重复扣分
      duplicate: res.duplicate === true,
      // 状态可能是 pending_approval（新会员 < 7 天的兑换要审批）
      status,
      statusText: REDEMPTION_STATUS_LABEL[status] || status,
      couponCode,
      expiresAt,
      productName: product?.[F.product.name] || '',
      productCover: assetUrl(product?.[F.product.cover]),
    });
  } catch (e) {
    return failFromError(e);
  }
}
