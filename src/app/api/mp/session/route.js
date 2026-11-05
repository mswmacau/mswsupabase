// app/api/mp/session/route.js
// 校验 token 并返回最新会员信息（小程序从后台切回前台时刷新积分用）

import { requireMember } from '@/lib/mp/auth.js';
import { ok, failFromError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { member } = await requireMember(request);
    return ok({ member });
  } catch (e) {
    return failFromError(e);
  }
}
