// lib/mp/respond.js
// 统一响应格式，全项目只在这里拼 JSON，避免各路由各写一套。

export function ok(data, init = {}) {
  return Response.json({ ok: true, data }, { status: 200, ...init });
}

export function fail(code, message, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export function failFromError(e) {
  // 已知业务错误
  if (e && e.__biz) return fail(e.code, e.message, e.status || 400);
  console.error('[mp-api]', e);
  return fail('INTERNAL', '服務暫時不可用，請稍後重試', 500);
}

/** 业务异常快捷构造 */
export function bizError(code, message, status = 400) {
  const e = new Error(message);
  e.__biz = true;
  e.code = code;
  e.status = status;
  return e;
}
