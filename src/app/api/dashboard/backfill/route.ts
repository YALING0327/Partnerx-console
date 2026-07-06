import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { querySelectDB } from '@/lib/selectdb';
import { clearOverviewCache } from '@/lib/dashboard-overview-cache';
import { authenticate, type ChatAuthBody } from '@/lib/chat-auth';

type BackfillMode = 'employee' | 'user' | 'order';

type BackfillBody = ChatAuthBody & {
  mode?: BackfillMode;
  employeeId?: string;
  targetUserId?: string;
  orderNo?: string;
  recentMinutes?: number;
};

type EmployeeRow = {
  id: string;
  company_id: string;
  account_id: string;
  employee_name: string;
  invite_code: string;
  inviter_id?: string | null;
  attribution_key?: string | null;
  status: string;
};

type UserSelectRow = {
  platform_user_id: string | number;
  campaign_key?: string | null;
  sponsor_key?: string | null;
  app_name?: string | null;
  channel?: string | null;
  bind_time?: string | null;
};

type RechargeSelectRow = {
  order_no: string;
  platform_user_id: string | number;
  campaign_key?: string | null;
  sponsor_key?: string | null;
  price_dollar?: string | null;
  goods_amount?: string | null;
  income_dollar?: string | null;
  amount?: unknown;
  usd_amount?: unknown;
  pay_status?: string | null;
  // SelectDB recharge.event_created_time is order creation time; we keep the historical
  // pay_created_time field name here because the downstream Supabase column is still pay_time.
  pay_created_time?: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeInviteCode(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function toIso(value: unknown) {
  if (!value) return new Date().toISOString();
  const raw = String(value).trim();
  const numericValue = Number(raw);
  const normalizedValue = /^\d{13}$/.test(raw)
    ? numericValue
    : /^\d{10}$/.test(raw)
      ? numericValue * 1000
      : value;
  const time = new Date(normalizedValue as string | number | Date);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`时间字段格式不正确: ${value}`);
  }
  return time.toISOString();
}

function normalizeStatus(value: unknown) {
  const raw = String(value ?? '').toLowerCase();
  if (['success', 'paid', 'pay_success', 'completed', 'finish', 'finished', '1', '3'].includes(raw)) {
    return 'success';
  }
  if (['failed', 'fail', '0', 'closed', 'cancel'].includes(raw)) {
    return 'failed';
  }
  return raw || 'unknown';
}

function detectPlatform(appName: unknown, channel: unknown) {
  const a = normalizeText(appName).toLowerCase();
  const c = normalizeText(channel).toLowerCase();
  if (/\.ios\b|ios$|mitu/.test(a) || /ios|mitu/.test(c)) return 'ios';
  if (/\.android\b|android$|\.gp\b|dico|dcg/.test(a) || /android|\bgp\b|dcg/.test(c)) return 'android';
  return 'unknown';
}

function parseJsonObject(value: unknown) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function usdToCents(usd: number) {
  return Math.round(usd * 100);
}

function pickUsdCentsFromObject(obj: any) {
  if (!obj || typeof obj !== 'object') return null;
  const inner = toFiniteNumber(obj.amount);
  if (inner != null && inner > 0) return inner;
  for (const candidate of [obj.price_dollar, obj.goods_amount, obj.income_dollar]) {
    const numeric = toFiniteNumber(candidate);
    if (numeric != null && numeric > 0) return usdToCents(numeric);
  }
  return null;
}

function extractRechargeAmount(row: RechargeSelectRow) {
  const amountObj = parseJsonObject(row.amount);
  if (amountObj) {
    const cents = pickUsdCentsFromObject(amountObj);
    if (cents != null) return cents;
  }
  const scalarCents = toFiniteNumber(row.amount);
  if (scalarCents != null && scalarCents > 0) return scalarCents;
  for (const candidate of [row.price_dollar, row.goods_amount, row.income_dollar]) {
    const numeric = toFiniteNumber(candidate);
    if (numeric != null && numeric > 0) return usdToCents(numeric);
  }
  const usdAmount = parseJsonObject(row.usd_amount);
  if (usdAmount) {
    const cents = pickUsdCentsFromObject(usdAmount);
    if (cents != null) return cents;
  }
  return 0;
}

function extractRechargeStatus(row: RechargeSelectRow) {
  const usdAmount = parseJsonObject(row.usd_amount) as { pay_status?: unknown } | null;
  const topLevelStatus = normalizeText(row.pay_status);
  const nestedStatus = normalizeText(usdAmount?.pay_status);
  // 顶层 pay_status 缺失时回退到 usd_amount 内嵌的 pay_status，避免成功单被误判。
  return normalizeStatus(topLevelStatus || nestedStatus || 'success');
}

function placeholders(size: number) {
  return new Array(size).fill('?').join(',');
}

function toSelectDbTime(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function getVisibleEmployees(companyId: string, role: 'boss' | 'staff', userId: string) {
  let query = supabaseServer
    .from('employees')
    .select('id, company_id, account_id, employee_name, invite_code, inviter_id, attribution_key, status')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (role === 'staff') {
    query = query.eq('account_id', userId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as EmployeeRow[];
}

function buildEmployeeResolver(employees: EmployeeRow[]) {
  const employeeByDirectKey = new Map<string, EmployeeRow>();
  const employeeByAttributionKey = new Map<string, EmployeeRow>();
  for (const employee of employees) {
    const inviteCodeKey = normalizeInviteCode(employee.invite_code);
    if (inviteCodeKey) employeeByDirectKey.set(inviteCodeKey, employee);
    const inviterIdKey = normalizeInviteCode(employee.inviter_id);
    if (inviterIdKey) employeeByDirectKey.set(inviterIdKey, employee);
    const attributionKey = normalizeInviteCode(employee.attribution_key);
    if (attributionKey) employeeByAttributionKey.set(attributionKey, employee);
  }
  return (campaignKey: unknown, sponsorKey: unknown) => {
    const campaignEmployee = employeeByDirectKey.get(normalizeInviteCode(campaignKey))
      ?? employeeByAttributionKey.get(normalizeInviteCode(campaignKey));
    if (campaignEmployee) return campaignEmployee;
    return employeeByDirectKey.get(normalizeInviteCode(sponsorKey))
      ?? employeeByAttributionKey.get(normalizeInviteCode(sponsorKey))
      ?? null;
  };
}

function pickAttribution(current: any, next: any) {
  if (!current) return next;
  if (String(current.bind_status) === 'invite') return current;
  if (String(next.bind_status) === 'invite') return next;
  return current;
}

function pickRecharge(current: any, next: any) {
  if (!current) return next;
  const currentTime = String(current.pay_time ?? '');
  const nextTime = String(next.pay_time ?? '');
  if (nextTime > currentTime) return next;
  if (nextTime === currentTime && String(next.status) === 'success' && String(current.status) !== 'success') {
    return next;
  }
  return current;
}

async function queryUsersByEmployee(employee: EmployeeRow, recentMinutes: number) {
  const keys = [employee.invite_code, employee.inviter_id, employee.attribution_key]
    .map((item) => normalizeInviteCode(item))
    .filter(Boolean);
  if (keys.length === 0) return [];
  const since = toSelectDbTime(new Date(Date.now() - recentMinutes * 60 * 1000));
  return querySelectDB<UserSelectRow>(
    `
      SELECT
        CAST(account_id AS STRING) AS platform_user_id,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign') AS campaign_key,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor') AS sponsor_key,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.app_name') AS app_name,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.channel') AS channel,
        COALESCE(
          json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.register_time'),
          CAST(event_created_time AS STRING)
        ) AS bind_time
      FROM \`user\`
      WHERE event_created_time >= ?
        AND (
          LOWER(TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign'))) IN (${placeholders(keys.length)})
          OR LOWER(TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor'))) IN (${placeholders(keys.length)})
        )
      ORDER BY event_created_time DESC
      LIMIT 300
    `,
    [since, ...keys, ...keys]
  );
}

async function queryRechargesByEmployee(employee: EmployeeRow, recentMinutes: number) {
  const keys = [employee.invite_code, employee.inviter_id, employee.attribution_key]
    .map((item) => normalizeInviteCode(item))
    .filter(Boolean);
  if (keys.length === 0) return [];
  const since = toSelectDbTime(new Date(Date.now() - recentMinutes * 60 * 1000));
  return querySelectDB<RechargeSelectRow>(
    `
      SELECT
        CAST(r.id AS STRING) AS order_no,
        CAST(r.account_id AS STRING) AS platform_user_id,
        CAST(u.campaign_key AS STRING) AS campaign_key,
        CAST(u.sponsor_key AS STRING) AS sponsor_key,
        CAST(r.properties['price_dollar'] AS STRING) AS price_dollar,
        CAST(r.properties['goods_amount'] AS STRING) AS goods_amount,
        CAST(r.properties['income_dollar'] AS STRING) AS income_dollar,
        CAST(r.properties['amount'] AS STRING) AS amount,
        CAST(r.properties['usd_amount'] AS STRING) AS usd_amount,
        CAST(r.properties['pay_status'] AS STRING) AS pay_status,
        CAST(r.event_created_time AS STRING) AS pay_created_time
      FROM recharge r
      JOIN (
        SELECT
          account_id,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign')) AS campaign_key,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor')) AS sponsor_key
        FROM \`user\`
        WHERE (
          LOWER(TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign'))) IN (${placeholders(keys.length)})
          OR LOWER(TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor'))) IN (${placeholders(keys.length)})
        )
      ) u ON r.account_id = u.account_id
      WHERE r.event_created_time >= ?
      ORDER BY r.event_created_time DESC
      LIMIT 300
    `,
    [...keys, ...keys, since]
  );
}

async function queryUsersByPlatformUserId(platformUserId: string) {
  return querySelectDB<UserSelectRow>(
    `
      SELECT
        CAST(account_id AS STRING) AS platform_user_id,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign') AS campaign_key,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor') AS sponsor_key,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.app_name') AS app_name,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.channel') AS channel,
        COALESCE(
          json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.register_time'),
          CAST(event_created_time AS STRING)
        ) AS bind_time
      FROM \`user\`
      WHERE account_id = ?
      ORDER BY event_created_time DESC
      LIMIT 20
    `,
    [platformUserId]
  );
}

async function queryRechargesByPlatformUserId(platformUserId: string) {
  return querySelectDB<RechargeSelectRow>(
    `
      SELECT
        CAST(r.id AS STRING) AS order_no,
        CAST(r.account_id AS STRING) AS platform_user_id,
        CAST(u.campaign_key AS STRING) AS campaign_key,
        CAST(u.sponsor_key AS STRING) AS sponsor_key,
        CAST(r.properties['price_dollar'] AS STRING) AS price_dollar,
        CAST(r.properties['goods_amount'] AS STRING) AS goods_amount,
        CAST(r.properties['income_dollar'] AS STRING) AS income_dollar,
        CAST(r.properties['amount'] AS STRING) AS amount,
        CAST(r.properties['usd_amount'] AS STRING) AS usd_amount,
        CAST(r.properties['pay_status'] AS STRING) AS pay_status,
        CAST(r.event_created_time AS STRING) AS pay_created_time
      FROM recharge r
      LEFT JOIN (
        SELECT
          account_id,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign')) AS campaign_key,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor')) AS sponsor_key
        FROM \`user\`
      ) u ON r.account_id = u.account_id
      WHERE r.account_id = ?
      ORDER BY r.event_created_time DESC
      LIMIT 50
    `,
    [platformUserId]
  );
}

async function queryRechargeByOrderNo(orderNo: string) {
  const rows = await querySelectDB<RechargeSelectRow>(
    `
      SELECT
        CAST(r.id AS STRING) AS order_no,
        CAST(r.account_id AS STRING) AS platform_user_id,
        CAST(u.campaign_key AS STRING) AS campaign_key,
        CAST(u.sponsor_key AS STRING) AS sponsor_key,
        CAST(r.properties['price_dollar'] AS STRING) AS price_dollar,
        CAST(r.properties['goods_amount'] AS STRING) AS goods_amount,
        CAST(r.properties['income_dollar'] AS STRING) AS income_dollar,
        CAST(r.properties['amount'] AS STRING) AS amount,
        CAST(r.properties['usd_amount'] AS STRING) AS usd_amount,
        CAST(r.properties['pay_status'] AS STRING) AS pay_status,
        CAST(r.event_created_time AS STRING) AS pay_created_time
      FROM recharge r
      LEFT JOIN (
        SELECT
          account_id,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign')) AS campaign_key,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor')) AS sponsor_key
        FROM \`user\`
      ) u ON r.account_id = u.account_id
      WHERE CAST(r.id AS STRING) = ?
      ORDER BY r.event_created_time DESC
      LIMIT 1
    `,
    [orderNo]
  );
  return rows[0] ?? null;
}

function buildAttributionUpserts(userRows: UserSelectRow[], resolveEmployee: (campaignKey: unknown, sponsorKey: unknown) => EmployeeRow | null) {
  const attributionByUser = new Map<string, any>();
  for (const row of userRows) {
    const platformUserId = normalizeText(row.platform_user_id);
    if (!platformUserId) continue;
    const employee = resolveEmployee(row.campaign_key, row.sponsor_key);
    if (!employee) continue;
    const nextItem = {
      company_id: employee.company_id,
      employee_id: employee.id,
      platform_user_id: platformUserId,
      invite_code: employee.invite_code,
      bind_time: toIso(row.bind_time),
      bind_status: 'invite',
      app_platform: detectPlatform(row.app_name, row.channel)
    };
    attributionByUser.set(platformUserId, pickAttribution(attributionByUser.get(platformUserId), nextItem));
  }
  return [...attributionByUser.values()];
}

function buildRechargeUpserts(
  rechargeRows: RechargeSelectRow[],
  resolveEmployee: (campaignKey: unknown, sponsorKey: unknown) => EmployeeRow | null,
  attributionRows: any[]
) {
  const amountDivisor = Number(process.env.SELECTDB_AMOUNT_DIVISOR || 1);
  const attributionByUser = new Map(attributionRows.map((item) => [String(item.platform_user_id), item]));
  const rechargeByOrder = new Map<string, any>();

  for (const row of rechargeRows) {
    const orderNo = normalizeText(row.order_no);
    const platformUserId = normalizeText(row.platform_user_id);
    if (!orderNo || !platformUserId) continue;

    const attributed = attributionByUser.get(platformUserId);
    const employee = resolveEmployee(row.campaign_key, row.sponsor_key);
    const companyId = attributed?.company_id ?? employee?.company_id;
    const employeeId = attributed?.employee_id ?? employee?.id;
    if (!companyId || !employeeId) continue;

    const nextItem = {
      company_id: companyId,
      employee_id: employeeId,
      platform_user_id: platformUserId,
      order_no: orderNo,
      amount: extractRechargeAmount(row) / amountDivisor,
      status: extractRechargeStatus(row),
      pay_time: toIso(row.pay_created_time),
      is_first_recharge: false
    };
    rechargeByOrder.set(orderNo, pickRecharge(rechargeByOrder.get(orderNo), nextItem));
  }

  return [...rechargeByOrder.values()];
}

async function upsertRows(attributionRows: any[], rechargeRows: any[]) {
  for (let index = 0; index < attributionRows.length; index += 1000) {
    const chunk = attributionRows.slice(index, index + 1000);
    if (chunk.length === 0) continue;
    const { error } = await supabaseServer
      .from('attribution_users')
      .upsert(chunk, { onConflict: 'company_id,platform_user_id' });
    if (error) throw error;
  }

  for (let index = 0; index < rechargeRows.length; index += 1000) {
    const chunk = rechargeRows.slice(index, index + 1000);
    if (chunk.length === 0) continue;
    const { error } = await supabaseServer
      .from('recharge_orders')
      .upsert(chunk, { onConflict: 'order_no' });
    if (error) throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BackfillBody;
    const auth = await authenticate(body);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const mode = body.mode ?? 'employee';
    const visibleEmployees = await getVisibleEmployees(auth.companyId, auth.role, body.userId!);
    const resolveEmployee = buildEmployeeResolver(visibleEmployees);

    let attributionRows: any[] = [];
    let rechargeRows: any[] = [];
    let message = '';

    if (mode === 'employee') {
      const recentMinutes = Math.min(Math.max(Number(body.recentMinutes || 15), 1), 60);
      const targetEmployee = auth.role === 'staff'
        ? visibleEmployees[0]
        : visibleEmployees.find((item) => item.id === body.employeeId);
      if (!targetEmployee) {
        return NextResponse.json({ error: '未找到可补查的员工' }, { status: 400 });
      }

      const [userRows, rechargeSelectRows] = await Promise.all([
        queryUsersByEmployee(targetEmployee, recentMinutes),
        queryRechargesByEmployee(targetEmployee, recentMinutes)
      ]);
      attributionRows = buildAttributionUpserts(userRows, resolveEmployee);
      rechargeRows = buildRechargeUpserts(rechargeSelectRows, resolveEmployee, attributionRows);
      message = `已补查 ${targetEmployee.employee_name} 最近 ${recentMinutes} 分钟数据`;
    } else if (mode === 'user') {
      const targetUserId = normalizeText(body.targetUserId);
      if (!targetUserId) {
        return NextResponse.json({ error: '请输入用户ID' }, { status: 400 });
      }
      const [userRows, rechargeSelectRows] = await Promise.all([
        queryUsersByPlatformUserId(targetUserId),
        queryRechargesByPlatformUserId(targetUserId)
      ]);
      if (userRows.length === 0) {
        return NextResponse.json({ error: '未在 SelectDB 中找到该用户' }, { status: 404 });
      }
      attributionRows = buildAttributionUpserts(userRows, resolveEmployee);
      rechargeRows = buildRechargeUpserts(rechargeSelectRows, resolveEmployee, attributionRows);
      message = `已补查用户 ${targetUserId}`;
    } else if (mode === 'order') {
      const orderNo = normalizeText(body.orderNo);
      if (!orderNo) {
        return NextResponse.json({ error: '请输入订单号' }, { status: 400 });
      }
      const rechargeSelectRow = await queryRechargeByOrderNo(orderNo);
      if (!rechargeSelectRow) {
        return NextResponse.json({ error: '未在 SelectDB 中找到该订单' }, { status: 404 });
      }
      const userRows = await queryUsersByPlatformUserId(normalizeText(rechargeSelectRow.platform_user_id));
      attributionRows = buildAttributionUpserts(userRows, resolveEmployee);
      rechargeRows = buildRechargeUpserts([rechargeSelectRow], resolveEmployee, attributionRows);
      message = `已补查订单 ${orderNo}`;
    } else {
      return NextResponse.json({ error: '不支持的补查方式' }, { status: 400 });
    }
    await upsertRows(attributionRows, rechargeRows);
    clearOverviewCache();

    return NextResponse.json({
      ok: true,
      message,
      counts: {
        attribution: attributionRows.length,
        recharge: rechargeRows.length
      }
    });
  } catch (error) {
    console.error('dashboard/backfill 异常', error);
    return NextResponse.json({ error: '临时补查失败，请稍后再试' }, { status: 500 });
  }
}
