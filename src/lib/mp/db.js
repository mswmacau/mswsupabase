// src/lib/mp/db.js
// 小程序 API 专用 Supabase 服务端客户端（高权限，绕过 RLS）。
//
// ── 为什么不复用 @/lib/supabase/admin 的 createAdminClient() ──
// 试过，会 500。原因：admin.ts 的校验假设「SUPABASE_SERVICE_ROLE_KEY 一定是
// 一段 JWT，且 payload.role === 'service_role'」。但 Supabase 2025 起新增了
// 长 41 字符的 sb_secret_ 格式 secret key，它不是 JWT，jwtRole() 读不到 claim，
// isServiceRoleConfigured 判为 false，createAdminClient() 直接抛错。
// 实测该格式的 key 完全可用（全表读取正常），所以这里做「双格式识别」。
//
// ⚠️ 不要为了「统一」而改回 createAdminClient()：
//    除非确认环境里配置的是 legacy JWT 版 service_role key。
//
// ── 权限模型 ────────────────────────────────────────────
// 小程序走自家 API（不是浏览器直连），因此不依赖 RLS：
// 每支 route 先用 requireMember() 验自家 JWT，拿到 member.id，
// 再用本 client 以该 id 为过滤条件操作数据。
// 权限判断在我们这一层，不在数据库那一层。

import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

// ── 变量名优先级 ────────────────────────────────────────
// MP_SUPABASE_SERVICE_KEY  小程序专用（推荐线上配置这个）
// SUPABASE_SERVICE_ROLE_KEY  回退：本地开发通常只有这一个
//
// 为什么要分开两个名字：
//   网站自己的 admin.ts / admin API 依赖 SUPABASE_SERVICE_ROLE_KEY，
//   而 Vercel 上那条通常是 legacy JWT 格式（eyJ...），admin.ts 只认这种。
//   小程序这边想用新版 sb_secret_ 格式，若覆盖同名变量会把网站后台打挂，
//   而 Vercel 又不允许同名变量重复添加 → 所以给小程序单开一个键名。
// 注意用 || 而不是 ??：?? 只在 null/undefined 时回退，
// 若变量存在但值为空串（例如 .env 里写了 `MP_SUPABASE_SERVICE_KEY=`），
// ?? 会把回退挡掉，导致明明配了 SUPABASE_SERVICE_ROLE_KEY 却报「未設定」。
const KEY_ =
  process.env.MP_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const KEY_SOURCE = process.env.MP_SUPABASE_SERVICE_KEY
  ? 'MP_SUPABASE_SERVICE_KEY'
  : 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * 识别 key 的形态。目的是把「填错成 anon key」这种情况在启动时就抓出来，
 * 而不是等某个查询回 42501 permission denied 才发现（那个错误指向权限，
 * 不指向环境变量，排查成本极高）。
 *
 * @returns {'sb_secret'|'jwt_service_role'|'jwt_anon'|'jwt_other'|'missing'|'unknown'}
 */
function keyKind(key) {
  if (!key) return 'missing';
  // Supabase 新版 secret key：sb_secret_xxxxxxxx
  if (key.startsWith('sb_secret_')) return 'sb_secret';
  // legacy JWT 格式：尝试读 payload.role
  const seg = key.split('.')[1];
  if (seg) {
    try {
      const json = Buffer.from(
        seg.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf8');
      const role = JSON.parse(json)?.role;
      if (role === 'service_role') return 'jwt_service_role';
      if (role === 'anon') return 'jwt_anon';
      return 'jwt_other';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

const KIND = keyKind(KEY_);

/** 是否可用的高权限凭据（两种合法形态之一，且 URL 已配置） */
export const serviceRoleReady =
  URL_.startsWith('http') && (KIND === 'sb_secret' || KIND === 'jwt_service_role');

/** 仅供诊断，不含密钥内容 */
export const serviceRoleDiagnostic = {
  urlConfigured: URL_.startsWith('http'),
  keySource: KEY_SOURCE,
  keyLength: KEY_.length,
  keyKind: KIND,
  ready: serviceRoleReady,
};

let _client = null;

/**
 * 取得高权限客户端（进程内单例）。
 * @throws 凭据缺失或明显填错时抛出，错误信息直接说明原因
 */
export function db() {
  if (_client) return _client;

  if (!URL_.startsWith('http')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL 未設定，無法連線 Supabase');
  }
  if (KIND === 'missing') {
    throw new Error('服務端金鑰未設定：請配置 MP_SUPABASE_SERVICE_KEY（或 SUPABASE_SERVICE_ROLE_KEY）');
  }
  if (KIND === 'jwt_anon') {
    throw new Error(
      `${KEY_SOURCE} 填成了 anon key（role=anon），請改用 service_role / sb_secret_ key`
    );
  }
  if (KIND === 'unknown' || KIND === 'jwt_other') {
    throw new Error(
      `${KEY_SOURCE} 格式無法辨識（長度 ${KEY_.length}），` +
        '應為 sb_secret_ 開頭或 role=service_role 的 JWT'
    );
  }

  _client = createClient(URL_, KEY_, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
