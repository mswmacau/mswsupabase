// app/api/mp/wechat-login/route.js
// 微信登入桥接：wx.login() 的 code → openid → 会员身份 → 自家 JWT
//
// ⚠️ 关键结构限制（2026-11-04 核实）：
//   profiles.id 是 FK → auth.users(id)，所以「不能直接 insert 一个会员」。
//   微信 openid 没有 Email，走不了普通注册。
//
// 做法（影子帐号）：
//   1. 用 service_role 建一个 auth.users 影子帐号，email = wx_<openid>@mp.msw.local
//   2. 你数据库既有的 handle_new_user() 触发器会自动建对应的 profiles 行
//   3. 再把 profiles.wechat_openid 填上 openid —— 之后就用这一列认人
//
//   好处：不动你的表结构、不动触发器、不清空任何现有会员。
//   影子帐号只是「让外键有个爹」，会员数据仍然活在 profiles 里。

import { signJwt } from '@/lib/mp/jwt.js';
import { db } from '@/lib/mp/db.js';
import { T, F, toMember } from '@/lib/mp/schema.js';
import { ok, fail, failFromError, bizError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_TTL = 60 * 60 * 24 * 7; // 7 天：小程序重开不用每次重新授权
const SHADOW_DOMAIN = 'mp.msw.local';

/** openid 里可能有 - 和 _，做一次清洗保证 email 合法 */
function shadowEmail(openid) {
  return `wx_${String(openid).replace(/[^a-zA-Z0-9_-]/g, '')}@${SHADOW_DOMAIN}`;
}

/** 建一个不会被别人猜到的随机密码。我们永远不用密码登录，它只是 createUser 的必填项。 */
function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 影子帐号已存在时，把它的 id 捞回来（自愈用，正常流程走不到这里） */
async function findUserIdByEmail(sb, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = body?.code;
    if (!code || typeof code !== 'string') {
      throw bizError('INVALID_PARAM', '缺少登入憑證 code');
    }

    const appid = process.env.MP_APPID;
    const secret = process.env.MP_APPSECRET;
    if (!appid || !secret) {
      console.error('[mp-login] MP_APPID / MP_APPSECRET 未配置');
      return fail('INTERNAL', '登入服務未配置完成，請聯絡管理員', 500);
    }

    // ---------- 1. code → openid ----------
    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';

    const wxRes = await fetch(url, { cache: 'no-store' });
    const wxData = await wxRes.json();

    if (!wxData.openid) {
      console.error('[mp-login] code2Session 失敗', {
        errcode: wxData.errcode,
        errmsg: wxData.errmsg,
      });
      const msgMap = {
        40029: '登入憑證已失效，請重試',
        40163: '登入憑證已被使用，請重試',
        45011: '請求過於頻繁，請稍後再試',
        40125: 'AppSecret 不正確，請檢查環境變數 MP_APPSECRET',
      };
      throw bizError('INVALID_PARAM', msgMap[wxData.errcode] || '微信登入失敗，請重試', 400);
    }

    const openid = wxData.openid;
    const sb = db();
    const maskedOpenid = String(openid).slice(0, 6) + '***';

    // ---------- 2. 用 openid 找会员 ----------
    const { data: existing, error: qErr } = await sb
      .from(T.members)
      .select('*')
      .eq(F.member.openid, openid)
      .maybeSingle();

    if (qErr) {
      // 最常见：003 迁移没跑，profiles 没有 wechat_openid 列
      const noColumn =
        qErr.code === '42703' || /wechat_openid|column .* does not exist/i.test(qErr.message || '');
      console.error('[mp-login] 查詢會員失敗', qErr);
      return fail(
        'INTERNAL',
        noColumn
          ? '資料庫缺少 profiles.wechat_openid，請先執行 db/migrations/003_mp_align.sql'
          : `會員查詢失敗：${qErr.message}`,
        500
      );
    }

    let memberRow = existing;
    let isNewMember = false;

    // ---------- 3. 第一次登入：建影子帐号 + 会员资料 ----------
    if (!memberRow) {
      const email = shadowEmail(openid);

      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { display_name: '街健新手', source: 'wechat_mp' },
      });

      let userId = created?.user?.id || null;

      if (!userId) {
        const alreadyExists =
          cErr?.code === 'email_exists' ||
          /already (been )?registered|already exists/i.test(cErr?.message || '');
        if (alreadyExists) {
          // 自愈：上次建了帐号但没回填 openid
          userId = await findUserIdByEmail(sb, email);
        }
        if (!userId) {
          console.error('[mp-login] 建立影子帳號失敗', cErr);
          return fail('INTERNAL', `建立會員帳號失敗（${cErr?.message || '未知錯誤'}）`, 500);
        }
      }

      // 触发器 handle_new_user() 应该已经建好 profile；没建就补一行
      const { data: profile, error: pErr } = await sb
        .from(T.members)
        .select('*')
        .eq(F.member.id, userId)
        .maybeSingle();

      if (pErr) throw pErr;

      if (!profile) {
        console.warn('[mp-login] handle_new_user 未建 profile，改为手动補建', { userId });
        const { data: inserted, error: iErr } = await sb
          .from(T.members)
          .insert({
            [F.member.id]: userId,
            [F.member.nickname]: '街健新手',
            [F.member.openid]: openid,
            role: 'member',
            points: 0,
            total_km: 0,
          })
          .select()
          .single();
        if (iErr) {
          console.error('[mp-login] 補建 profile 失敗', iErr);
          return fail('INTERNAL', `建立會員資料失敗（${iErr.message}）`, 500);
        }
        memberRow = inserted;
      } else {
        // 回填 openid，这是「以后用 openid 认人」的唯一依据
        const { data: updated, error: uErr } = await sb
          .from(T.members)
          .update({ [F.member.openid]: openid })
          .eq(F.member.id, userId)
          .select()
          .single();
        if (uErr) {
          console.error('[mp-login] 回填 openid 失敗', uErr);
          return fail('INTERNAL', `綁定微信身分失敗（${uErr.message}）`, 500);
        }
        memberRow = updated;
      }

      isNewMember = true;
      console.log('[mp-login] 新會員建立', { openid: maskedOpenid, userId });
    }

    // ---------- 4. 签发自家 JWT ----------
    const token = signJwt(
      { sub: memberRow[F.member.id], client: 'mp' },
      process.env.MP_JWT_SECRET,
      TOKEN_TTL
    );

    return ok({
      token,
      expiresIn: TOKEN_TTL,
      isNewMember,
      member: toMember(memberRow),
    });
  } catch (e) {
    return failFromError(e);
  }
}
