// lib/mp/jwt.js
// 轻量 HS256 JWT 实现，只用 Node 原生 crypto，不新增任何 npm 依赖。
// 为什么不用 jsonwebtoken / jose：你现有的 Next.js 项目不需要为此多装一个包，
// 且小程序的验证需求单一（自家签发、自家校验），30 行足够。

import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function hmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * 签发 token
 * @param {object} payload 载荷（sub / client / openid 等）
 * @param {number} expiresInSec 有效期秒数，默认 3600
 */
export function signJwt(payload, secret, expiresInSec = 3600) {
  if (!secret) throw new Error('MP_JWT_SECRET 未設定');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const head = b64u(JSON.stringify(header));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  return `${data}.${hmac(data, secret)}`;
}

/**
 * 校验 token
 * @returns {{payload:object}|{error:'EXPIRED'|'INVALID'}}
 */
export function verifyJwt(token, secret) {
  if (!token || !secret) return { error: 'INVALID' };
  const parts = String(token).split('.');
  if (parts.length !== 3) return { error: 'INVALID' };

  const [head, body, sig] = parts;
  const expected = hmac(`${head}.${body}`, secret);

  // 定长比较，防时序攻击
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { error: 'INVALID' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { error: 'INVALID' };
  }

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return { error: 'EXPIRED', payload };
  }
  return { payload };
}
