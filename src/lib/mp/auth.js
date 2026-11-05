// lib/mp/auth.js
// JWT 鉴权中间层。所有需要身份的端点第一行就调 requireMember(request)。

import { verifyJwt } from './jwt.js';
import { db } from './db.js';
import { T, F, toMember } from './schema.js';
import { bizError } from './respond.js';

function readToken(request) {
  const raw = request.headers.get('authorization') || '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
}

/**
 * 必须登录。失败抛业务异常，由路由的 catch 转成标准错误响应。
 * @returns {{ row: object, member: object }}
 */
export async function requireMember(request) {
  const token = readToken(request);
  if (!token) throw bizError('UNAUTHORIZED', '請先登入', 401);

  const res = verifyJwt(token, process.env.MP_JWT_SECRET);
  if (res.error === 'EXPIRED') throw bizError('TOKEN_EXPIRED', '登入已過期', 401);
  if (res.error) throw bizError('UNAUTHORIZED', '登入憑證無效', 401);
  if (res.payload.client !== 'mp') throw bizError('UNAUTHORIZED', '登入來源不正確', 401);

  const { data, error } = await db()
    .from(T.members)
    .select('*')
    .eq(F.member.id, res.payload.sub)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw bizError('MEMBER_NOT_FOUND', '會員不存在，請重新登入', 404);

  return { row: data, member: toMember(data) };
}

/**
 * 可选登录。有 token 就识别会员，没有就当游客。
 * 用于「活动列表要标记已报名」这类公开端点。
 * @returns {{ row: object|null, member: object|null }}
 */
export async function optionalMember(request) {
  try {
    return await requireMember(request);
  } catch {
    return { row: null, member: null };
  }
}
