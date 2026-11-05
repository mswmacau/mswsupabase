// app/api/mp/pay-create-order/route.js
// 下单 —— 双模式
//
// WECHAT_PAY_DEMO=true  → 演示模式：只建单，返回 mode:'demo'，前端弹自制支付面板
// WECHAT_PAY_DEMO=false → 正式模式：调微信支付 V3 JSAPI 统一下单，返回 payParams
//
// ⚠️ 安全铁律：paySign 只能在服务端用商戶私鑰生成，前端永不接触私鑰（E-04）
// 官方文档：https://pay.weixin.qq.com/docs/merchant/apis/mini-program-payment/direct-jsons/jsapi-prepay.html
// 需以微信支付商户平台最新文档核实

import crypto from 'node:crypto';
import { requireMember } from '@/lib/mp/auth.js';
import { db } from '@/lib/mp/db.js';
import { T, F, toEvent } from '@/lib/mp/schema.js';
import { createOrder } from '@/lib/mp/orders.js';
import { ok, fail, failFromError, bizError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isDemoMode = () => String(process.env.WECHAT_PAY_DEMO || 'true') === 'true';

export async function POST(request) {
  try {
    const { member, row } = await requireMember(request);
    const body = await request.json().catch(() => ({}));
    const { eventId, requestId, orderId: existOrderId } = body || {};

    const sb = db();
    let order = null;
    let subject = 'MSW 活動報名費';
    let amount = 0;

    // ---------- 情况一：已有订单（报名后再来支付）----------
    if (existOrderId) {
      const { data } = await sb.from('mp_orders').select('*').eq('id', existOrderId).maybeSingle();
      if (!data) throw bizError('INVALID_PARAM', '訂單不存在', 404);
      if (String(data.member_id) !== String(member.id)) {
        throw bizError('UNAUTHORIZED', '無權操作此訂單', 403);
      }
      if (data.status === 'paid') throw bizError('INVALID_PARAM', '此訂單已支付', 400);
      order = data;
      subject = data.subject || subject;
      amount = data.amount;
    } else {
      // ---------- 情况二：按活动下单 ----------
      if (!eventId) throw bizError('INVALID_PARAM', '缺少 eventId 或 orderId');

      const { data: ev, error: eErr } = await sb
        .from(T.events)
        .select('*')
        .eq(F.event.id, eventId)
        .maybeSingle();
      if (eErr) throw eErr;
      if (!ev) throw bizError('INVALID_PARAM', '活動不存在', 404);

      const event = toEvent(ev);
      if (event.capacity > 0 && event.registeredCount >= event.capacity) {
        throw bizError('EVENT_FULL', '名額已滿', 409);
      }

      order = await createOrder({
        memberId: member.id,
        eventId: String(eventId),
        amount: event.fee,
        subject: `${event.title} 報名費`,
        requestId: requestId || `pay_${member.id}_${eventId}`,
      });
      subject = order.subject;
      amount = order.amount;
    }

    // ---------- 演示模式 ----------
    if (isDemoMode()) {
      return ok({
        mode: 'demo',
        orderId: order.id,
        amount,
        subject,
      });
    }

    // ---------- 正式模式：微信支付 V3 JSAPI ----------
    const cfg = readPayConfig();
    const openid = row[F.member.openid];
    if (!openid) {
      throw bizError('INVALID_PARAM', '缺少 openid，請重新登入後再試', 400);
    }

    const outTradeNo = String(order.id).replace(/-/g, '').slice(0, 32);
    const path = '/v3/pay/transactions/jsapi';
    const reqBody = {
      appid: cfg.appid,
      mchid: cfg.mchid,
      description: subject.slice(0, 127),
      out_trade_no: outTradeNo,
      notify_url: cfg.notifyUrl,
      amount: { total: amount, currency: 'CNY' },
      payer: { openid },
    };
    const bodyStr = JSON.stringify(reqBody);

    const authHeader = buildAuthHeader({
      method: 'POST',
      path,
      body: bodyStr,
      mchid: cfg.mchid,
      serialNo: cfg.serialNo,
      privateKey: cfg.privateKey,
    });

    const wxRes = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: bodyStr,
    });

    const wxData = await wxRes.json();
    if (!wxData.prepay_id) {
      console.error('[mp-pay] 統一下單失敗', wxData);
      return fail('INTERNAL', `下單失敗：${wxData.message || wxData.code || '未知錯誤'}`, 400);
    }

    // 生成前端调起支付所需参数
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const pkg = `prepay_id=${wxData.prepay_id}`;
    const paySign = rsaSign(
      `${cfg.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`,
      cfg.privateKey
    );

    // 记录 prepay_id，便于对账
    await sb.from('mp_orders').update({ transaction_id: wxData.prepay_id }).eq('id', order.id);

    return ok({
      mode: 'real',
      orderId: order.id,
      amount,
      subject,
      payParams: {
        timeStamp,
        nonceStr,
        package: pkg,
        signType: 'RSA',
        paySign,
      },
    });
  } catch (e) {
    return failFromError(e);
  }
}

// ---------- 微信支付 V3 签名工具 ----------

function readPayConfig() {
  const env = process.env;
  const missing = [];
  if (!env.MP_APPID) missing.push('MP_APPID');
  if (!env.WXPAY_MCHID) missing.push('WXPAY_MCHID');
  if (!env.WXPAY_SERIAL_NO) missing.push('WXPAY_SERIAL_NO');
  if (!env.WXPAY_PRIVATE_KEY) missing.push('WXPAY_PRIVATE_KEY');
  if (!env.WXPAY_NOTIFY_URL) missing.push('WXPAY_NOTIFY_URL');
  if (missing.length) {
    throw bizError('INTERNAL', `支付設定未完成：缺少 ${missing.join('、')}`, 500);
  }
  return {
    appid: env.MP_APPID,
    mchid: env.WXPAY_MCHID,
    serialNo: env.WXPAY_SERIAL_NO,
    notifyUrl: env.WXPAY_NOTIFY_URL,
    privateKey: String(env.WXPAY_PRIVATE_KEY).replace(/\\n/g, '\n'),
  };
}

function rsaSign(message, privateKey) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  return sign.sign(privateKey, 'base64');
}

function buildAuthHeader({ method, path, body, mchid, serialNo, privateKey }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = rsaSign(message, privateKey);
  return (
    'WECHATPAY2-SHA256-RSA2048 ' +
    `mchid="${mchid}",` +
    `nonce_str="${nonceStr}",` +
    `signature="${signature}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${serialNo}"`
  );
}
