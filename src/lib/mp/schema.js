// lib/mp/schema.js
// 表名 / 字段名映射层：所有 /api/mp/* 都从这里取值，改这一处全部对齐。
//
// ✅ 2026-11-04 已按真实 Supabase 结构校正两次：
//    第 1 次来源：网站 repo 的 lib/rewards.ts、lib/assets.ts、schema.sql
//    第 2 次来源：线上 API 实测 + Supabase 后台 redeem_reward 函数定义
//
//    真实表名：profiles / rewards / reward_redemptions / point_transactions / events
//    真实字段（已核实）：
//      profiles            : id(FK auth.users) display_name avatar_url phone role points total_km created_at
//      rewards             : id name description image_path points_cost stock_total stock_remaining
//                            per_user_limit merchant_id status('active'|'inactive') sort_order created_at
//      reward_redemptions  : id reward_id user_id points_spent status pickup_code merchant_id
//                            expires_at created_at decided_at merchant_verified_at
//                            ⚠️ 没有 reward_name / reward_image_path，商品名要 join rewards
//      point_transactions  : id user_id delta reason ref_type ref_id created_at
//                            ⚠️ 没有 balance_after / remark / type
//      events              : event_date(date) + start_time(text) 拼时间；封面 cover_path

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');

// 素材 bucket：与网站 lib/assets.ts 的 publicAssetUrl() 口径一致
// https://{project}.supabase.co/storage/v1/object/public/site-assets/{path}
const ASSET_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/site-assets/`
  : '';

/**
 * bucket 内路径 → 可公开访问的完整 URL。
 * 兼容三种输入：完整 http(s) URL 原样返回；以 / 开头的路径；纯相对路径。
 */
export function assetUrl(path) {
  if (!path) return '';
  const p = String(path).trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (!ASSET_BASE) return p; // 未配 NEXT_PUBLIC_SUPABASE_URL 时降级，避免拼出半截 URL
  return ASSET_BASE + p.replace(/^\/+/, '');
}

// ---------- 表名（键名保持不变，只改右边的真实表名）----------
export const T = {
  members: 'profiles', // 会员资料（id uuid → FK auth.users）
  products: 'rewards', // 可兑换商品/礼品
  redemptions: 'reward_redemptions', // 兑换记录
  ledger: 'point_transactions', // 积分流水
  events: 'events', // 活动
  registrations: 'event_registrations', // 活动报名
  merchants: 'merchants', // 合作商户
  settings: 'app_settings', // 系统开关（rewards_enabled 止血开关）
  orders: 'mp_orders', // 小程序订单（支付用，002 迁移新建）
};

// ---------- 字段名 ----------
// 左边是代码里的逻辑名（不要改），右边是数据库真实列名（可改）。
export const F = {
  member: {
    id: 'id',
    // ⚠️ profiles 原本没有 openid 列，由 003 迁移新增
    openid: 'wechat_openid',
    nickname: 'display_name',
    avatar: 'avatar_url',
    phone: 'phone',
    points: 'points',
    totalKm: 'total_km',
    role: 'role',
    createdAt: 'created_at',
  },
  product: {
    id: 'id',
    name: 'name',
    description: 'description',
    points: 'points_cost', // 注意：不是 points
    cover: 'image_path', // bucket 内路径，出参时用 assetUrl() 拼
    stock: 'stock_remaining', // 注意：不是 stock
    stockTotal: 'stock_total',
    perUserLimit: 'per_user_limit',
    merchantId: 'merchant_id',
    status: 'status', // 'active' | 'inactive'  ← 不是 active: boolean
    sortOrder: 'sort_order',
    createdAt: 'created_at',
  },
  redemption: {
    id: 'id',
    memberId: 'user_id', // 已核实
    productId: 'reward_id',
    points: 'points_spent', // 注意：不是 points
    status: 'status', // pending | pending_approval | completed | cancelled
    couponCode: 'pickup_code', // 注意：叫提货码
    merchantId: 'merchant_id',
    expiresAt: 'expires_at',
    decidedAt: 'decided_at',
    verifiedAt: 'merchant_verified_at',
    createdAt: 'created_at',
    // ⚠️ 本表没有 reward_name / reward_image_path，商品信息必须从 rewards join
  },
  ledger: {
    // ✅ 已核实：point_transactions 只有这 7 列
    id: 'id',
    memberId: 'user_id',
    delta: 'delta',
    reason: 'reason', // 不是 remark
    refType: 'ref_type',
    refId: 'ref_id',
    createdAt: 'created_at',
    // ⚠️ 没有 balance_after，余额只能取 profiles.points 或按 delta 累加
  },
  event: {
    id: 'id',
    title: 'title',
    subtitle: 'subtitle',
    // ⚠️ events 没有 type 列，分类放在 003 新增的 category（可空）
    type: 'category',
    body: 'body',
    cover: 'cover_path', // bucket 内路径（events/xxx.jpg）
    date: 'event_date', // date 类型，不是 timestamptz
    endDate: 'end_date',
    startTime: 'start_time', // 文字，如 "20:00"
    endTime: 'end_time',
    location: 'location',
    capacity: 'capacity',
    registrationUrl: 'registration_url',
    registrationNote: 'registration_note',
    status: 'status', // draft | published | archived
    fee: 'fee_cents', // ⚠️ 由 003 迁移新增，单位「分」
    sortOrder: 'sort_order',
  },
  merchant: {
    id: 'id',
    name: 'name',
    logo: 'logo_path',
    category: 'category',
    description: 'description',
    address: 'address',
    openingHours: 'opening_hours',
  },
};

/** 兑换状态 → 中文（与网站 lib/rewards.ts 的 REDEMPTION_STATUS_LABEL 一致） */
export const REDEMPTION_STATUS_LABEL = {
  pending: '待領取',
  pending_approval: '待審批',
  completed: '已領取',
  cancelled: '已取消',
};

/** 数据库里的 date + "20:00" 拼成一个可被前端格式化的 ISO 串（澳门时区） */
function composeDateTime(date, time) {
  if (!date) return null;
  const t = (time || '00:00').slice(0, 5);
  return `${date}T${t}:00+08:00`;
}

// ---------- 出参映射：DB row → API 对象（统一 camelCase）----------
export function toMember(row) {
  if (!row) return null;
  return {
    id: row[F.member.id],
    nickname: row[F.member.nickname] || '街健新手',
    avatarUrl: row[F.member.avatar] || '',
    phone: row[F.member.phone] || '',
    points: row[F.member.points] ?? 0,
    totalKm: Number(row[F.member.totalKm] ?? 0),
    joinedAt: row[F.member.createdAt] || null,
    // ⚠️ profiles 没有等级字段，等级制度也还没有定义。
    //    这里不编造数字，前端只显示「會員」。
  };
}

export function toProduct(row, memberPoints = 0) {
  if (!row) return null;
  const cost = row[F.product.points] ?? 0;
  const stock = row[F.product.stock];
  return {
    id: row[F.product.id],
    name: row[F.product.name],
    description: row[F.product.description] || '',
    points: cost,
    cover: assetUrl(row[F.product.cover]),
    stock: stock === null || stock === undefined ? null : stock, // null = 不限量
    perUserLimit: row[F.product.perUserLimit] ?? null,
    merchantName: row.merchant_name || 'MSW 街健館',
    affordable: memberPoints >= cost,
  };
}

/**
 * 兑换记录。
 * 商品名与图片不在 reward_redemptions 表里，必须由调用方 join rewards 后传进来：
 * @param {object} row         reward_redemptions 的一行
 * @param {object} [product]   { name, image_path }，可缺
 */
export function toRedemption(row, product) {
  if (!row) return null;
  const status = row[F.redemption.status] || 'pending';
  return {
    id: row[F.redemption.id],
    productName: product?.name || '兌換商品',
    cover: assetUrl(product?.image_path),
    points: row[F.redemption.points] ?? 0,
    status,
    statusText: REDEMPTION_STATUS_LABEL[status] || status,
    couponCode: row[F.redemption.couponCode] || '',
    expiresAt: row[F.redemption.expiresAt] || null,
    createdAt: row[F.redemption.createdAt],
  };
}

export function toEvent(row) {
  if (!row) return null;
  const feeCents = row[F.event.fee] ?? 0;
  return {
    id: row[F.event.id],
    title: row[F.event.title],
    subtitle: row[F.event.subtitle] || '',
    type: row[F.event.type] || 'general', // general = 未分类
    body: row[F.event.body] || '',
    cover: assetUrl(row[F.event.cover]),
    // 用 event_date + start_time 拼，前端统一吃 startAt
    startAt: composeDateTime(row[F.event.date], row[F.event.startTime]),
    endAt: composeDateTime(row[F.event.endDate] || row[F.event.date], row[F.event.endTime]),
    location: row[F.event.location] || '',
    fee: feeCents, // 单位：分
    capacity: row[F.event.capacity] ?? 0,
    registeredCount: row.registered_count ?? 0, // 由报名表聚合后注入
    needPay: feeCents > 0,
    registered: !!row.registered,
  };
}

export function toMerchant(row) {
  if (!row) return null;
  return {
    id: row[F.merchant.id],
    name: row[F.merchant.name],
    logo: assetUrl(row[F.merchant.logo]),
    category: row[F.merchant.category] || '',
    description: row[F.merchant.description] || '',
    address: row[F.merchant.address] || '',
    openingHours: row[F.merchant.openingHours] || '',
    productCount: row.product_count ?? 0,
  };
}
