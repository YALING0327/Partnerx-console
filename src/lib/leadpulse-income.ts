import { querySelectDB } from '@/lib/selectdb';

// LeadPulse 公司的充值口径特殊：不用 recharge_orders 表，而是按 SelectDB 的
// income_dollar 实时计算，且每个用户只统计其绑定后 2 个月窗口内的充值。
// 该逻辑同时被看板(overview/route.ts)与飞书日报(reports)复用，保证数字一致。

export type IncomeAttribution = {
  employee_id: string;
  platform_user_id: string;
  bind_time: string;
};

export type IncomeRecharge = {
  employee_id: string;
  platform_user_id: string;
  amount: number; // 单位：分
  pay_time: string;
  status: string;
};

type SelectDbIncomeRow = {
  platform_user_id: string;
  pay_time: string;
  income_dollar: number | string | null;
};

function addMonthsIso(value: string, months: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString();
}

function toSelectDbDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function usdToCents(usd: number) {
  return Math.round(usd * 100);
}

export async function buildLeadPulseIncomeRecharges(
  attributions: IncomeAttribution[],
  options: { payStartIso?: string; payEndIso?: string } = {}
): Promise<IncomeRecharge[]> {
  const userMeta = new Map<string, { employeeId: string; bindStart: string; bindEnd: string }>();
  let globalStart = '';
  let globalEnd = '';

  for (const item of attributions) {
    const userId = String(item.platform_user_id || '').trim();
    if (!userId) continue;
    const bindStart = toSelectDbDateTime(item.bind_time);
    const bindEnd = toSelectDbDateTime(addMonthsIso(item.bind_time, 2));
    if (!bindStart || !bindEnd) continue;
    userMeta.set(userId, { employeeId: item.employee_id, bindStart, bindEnd });
    globalStart = !globalStart || bindStart < globalStart ? bindStart : globalStart;
    globalEnd = !globalEnd || bindEnd > globalEnd ? bindEnd : globalEnd;
  }

  if (!userMeta.size || !globalStart || !globalEnd) return [];

  const payStart = options.payStartIso ? toSelectDbDateTime(options.payStartIso) : '';
  const payEnd = options.payEndIso ? toSelectDbDateTime(options.payEndIso) : '';
  const effectiveStart = payStart && payStart > globalStart ? payStart : globalStart;
  const effectiveEnd = payEnd && payEnd < globalEnd ? payEnd : globalEnd;
  if (effectiveStart && effectiveEnd && effectiveStart >= effectiveEnd) return [];

  const rows: IncomeRecharge[] = [];
  const userIds = Array.from(userMeta.keys());

  for (let i = 0; i < userIds.length; i += 200) {
    const chunk = userIds.slice(i, i + 200);
    const placeholders = chunk.map(() => '?').join(',');
    const incomeRows = await querySelectDB<SelectDbIncomeRow>(
      `SELECT
         CAST(account_id AS STRING) AS platform_user_id,
         CAST(event_created_time AS STRING) AS pay_time,
         CAST(properties['income_dollar'] AS DOUBLE) AS income_dollar
       FROM recharge
       WHERE CAST(account_id AS STRING) IN (${placeholders})
         AND CAST(properties['pay_status'] AS STRING) IN ('1', '3')
         AND event_created_time >= ?
         AND event_created_time < ?`,
      [...chunk, effectiveStart || globalStart, effectiveEnd || globalEnd]
    );

    for (const row of incomeRows) {
      const userId = String(row.platform_user_id || '').trim();
      const meta = userMeta.get(userId);
      if (!meta) continue;
      const payTime = String(row.pay_time || '').trim();
      if (!payTime || payTime < meta.bindStart || payTime >= meta.bindEnd) continue;
      const income = Number(row.income_dollar || 0);
      if (!Number.isFinite(income) || income <= 0) continue;
      rows.push({
        employee_id: meta.employeeId,
        platform_user_id: userId,
        amount: usdToCents(income),
        pay_time: payTime,
        status: 'success'
      });
    }
  }

  return rows;
}
