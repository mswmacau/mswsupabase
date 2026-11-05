// app/api/mp/merchants/route.js
// 合作商户列表

import { db } from '@/lib/mp/db.js';
import { T, toMerchant } from '@/lib/mp/schema.js';
import { ok, failFromError } from '@/lib/mp/respond.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sb = db();
    const { data, error } = await sb
      .from(T.merchants)
      .select('*')
      .limit(100);

    if (error) throw error;

    return ok({ list: (data || []).map(toMerchant) });
  } catch (e) {
    return failFromError(e);
  }
}
