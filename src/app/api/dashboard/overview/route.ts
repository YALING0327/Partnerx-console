import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { supabaseServer, fetchAll } from '@/lib/supabase-server';
import { querySelectDB } from '@/lib/selectdb';
import { getOverviewCache, setOverviewCache } from '@/lib/dashboard-overview-cache';

type LoginRole = 'boss' | 'staff';

type DashboardRequest = {
  userId?: string;
  companyId?: string;
  role?: LoginRole;
  username?: string;
  startDate?: string;
  endDate?: string;
  metricStartDate?: string;
  metricEndDate?: string;
  forceRefresh?: boolean;
  page?: number;
  pageSize?: number;
  filterEmployee?: string;
  userIdKeyword?: string;
  // CSV 导出用：返回筛选后的全部用户（不分页）
  includeAllUsers?: boolean;
};

type EmployeeRow = {
  id: string;
  account_id: string;
  employee_name: string;
  invite_code: string;
  inviter_id?: string | null;
  attribution_key?: string | null;
  status: string;
};

type AttributionRow = {
  employee_id: string;
  platform_user_id: string;
  invite_code: string;
  bind_time: string;
  app_platform?: string | null;
};

type RechargeRow = {
  employee_id: string;
  platform_user_id: string;
  amount: number;
  pay_time: string;
  status: string;
};

type SelectDbIncomeRow = {
  platform_user_id: string;
  pay_time: string;
  income_dollar: number | string | null;
};

type PlatformType = 'android' | 'ios' | 'unknown';

// 该公司员工端的充值口径特殊（按 SelectDB income_dollar 实时计算），可用环境变量覆盖。
const LEADPULSE_COMPANY_ID = process.env.LEADPULSE_COMPANY_ID || 'd542e5ce-ed3c-4416-bd43-282152d2ef09';
const SYNC_CURSOR_FILE = path.resolve(process.cwd(), '.selectdb-sync-cursor.json');

type SyncCursorFile = {
  attribution?: {
    bind_time?: string;
  } | null;
  recharge?: {
    pay_time?: string;
    pay_created_time?: string;
  } | null;
};

function normalizeCursorTimeValue(value?: string | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw
    .replace('T', ' ')
    .replace(/\.\d+/, '')
    .replace(/Z$/, '')
    .replace(/[+-]\d{2}:\d{2}$/, '')
    .trim();
}

function readLastSyncTime() {
  try {
    if (!fs.existsSync(SYNC_CURSOR_FILE)) return null;
    const cursor = JSON.parse(fs.readFileSync(SYNC_CURSOR_FILE, 'utf8')) as SyncCursorFile;
    const values = [
      normalizeCursorTimeValue(cursor.attribution?.bind_time),
      normalizeCursorTimeValue(cursor.recharge?.pay_time),
      normalizeCursorTimeValue(cursor.recharge?.pay_created_time)
    ].filter(Boolean);
    if (values.length === 0) return null;
    values.sort((a, b) => a.localeCompare(b));
    return values[values.length - 1] ?? null;
  } catch {
    return null;
  }
}

function normalizeYmd(value?: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/\//g, '-');
}

function addDaysYmd(ymd: string, days: number) {
  const [year, month, day] = normalizeYmd(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function toBeijingUtcStart(ymd: string) {
  return new Date(`${normalizeYmd(ymd)}T00:00:00+08:00`).toISOString();
}

function applyBeijingBindDateRange<T extends { gte: Function; lt: Function }>(query: T, startDate?: string, endDate?: string) {
  let nextQuery = query;
  const normalizedStart = normalizeYmd(startDate);
  const normalizedEnd = normalizeYmd(endDate);
  if (normalizedStart) nextQuery = nextQuery.gte('bind_time', toBeijingUtcStart(normalizedStart));
  if (normalizedEnd) nextQuery = nextQuery.lt('bind_time', toBeijingUtcStart(addDaysYmd(normalizedEnd, 1)));
  return nextQuery;
}

function applyBeijingPayDateRange<T extends { gte: Function; lt: Function }>(query: T, startDate?: string, endDate?: string) {
  let nextQuery = query;
  const normalizedStart = normalizeYmd(startDate);
  const normalizedEnd = normalizeYmd(endDate);
  if (normalizedStart) nextQuery = nextQuery.gte('pay_time', toBeijingUtcStart(normalizedStart));
  if (normalizedEnd) nextQuery = nextQuery.lt('pay_time', toBeijingUtcStart(addDaysYmd(normalizedEnd, 1)));
  return nextQuery;
}

function normalizePlatform(value?: string | null): PlatformType {
  const v = String(value ?? '').toLowerCase();
  if (v === 'android' || v === 'ios') return v;
  return 'unknown';
}

function getAttributionSource(inviteCode: string | null | undefined, campaignKeys?: Set<string>) {
  const normalized = String(inviteCode ?? '').trim();
  return campaignKeys && normalized && campaignKeys.has(normalized) ? 'adjust' : 'invite';
}

function formatDashboardUser(
  userId: string,
  inviteCode: string,
  employeeName: string,
  bindTime: string | null,
  orders: RechargeRow[],
  campaignKeys?: Set<string>,
  appPlatform?: string | null
) {
  const paidOrders = orders.filter((item) => item.status === 'success');
  const totalAmount = paidOrders.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const sortedTimes = paidOrders
    .map((item) => item.pay_time)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return {
    platformUserId: userId,
    employeeName,
    inviteCode,
    bindTime,
    source: getAttributionSource(inviteCode, campaignKeys),
    appPlatform: normalizePlatform(appPlatform),
    firstRechargeAt: sortedTimes[0] ?? null,
    lastRechargeAt: sortedTimes[sortedTimes.length - 1] ?? null,
    rechargeCount: paidOrders.length,
    totalAmount
  };
}

function buildSummary(attributions: AttributionRow[], recharges: RechargeRow[], campaignKeys?: Set<string>) {
  const attributedUserIds = new Set(attributions.map((item) => item.platform_user_id));
  const inviteUserIds = new Set<string>();
  const adjustUserIds = new Set<string>();

  for (const item of attributions) {
    const source = getAttributionSource(item.invite_code, campaignKeys);
    if (source === 'adjust') adjustUserIds.add(item.platform_user_id);
    else inviteUserIds.add(item.platform_user_id);
  }

  const paidUserIds = new Set(
    recharges.filter((item) => item.status === 'success').map((item) => item.platform_user_id)
  );
  const totalAmount = recharges
    .filter((item) => item.status === 'success')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const platformByUser = new Map<string, PlatformType>();
  for (const item of attributions) {
    if (!platformByUser.has(item.platform_user_id)) {
      platformByUser.set(item.platform_user_id, normalizePlatform(item.app_platform));
    }
  }

  let androidUsers = 0;
  let iosUsers = 0;
  for (const platform of platformByUser.values()) {
    if (platform === 'android') androidUsers += 1;
    if (platform === 'ios') iosUsers += 1;
  }

  return {
    newUsers: attributedUserIds.size,
    mergedUsers: attributedUserIds.size,
    inviteUsers: inviteUserIds.size,
    adjustUsers: adjustUserIds.size,
    paidUsers: paidUserIds.size,
    androidUsers,
    iosUsers,
    totalAmount,
    arppu: paidUserIds.size ? totalAmount / paidUserIds.size : 0
  };
}

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

async function buildLeadPulseIncomeRecharges(
  attributions: AttributionRow[],
  options: { payStartIso?: string; payEndIso?: string } = {}
): Promise<RechargeRow[]> {
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

  const rows: RechargeRow[] = [];
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

type DashboardUserItem = ReturnType<typeof formatDashboardUser>;

// 用户明细在服务端做筛选+分页，避免把整个公司的用户数组一次性发给前端。
function selectUsersPage(allUsers: DashboardUserItem[], body: DashboardRequest) {
  const keyword = String(body.userIdKeyword ?? '').trim();
  const employeeName = String(body.filterEmployee ?? '').trim();
  let users = allUsers;
  if (employeeName) users = users.filter((item) => item.employeeName === employeeName);
  if (keyword) users = users.filter((item) => String(item.platformUserId).includes(keyword));
  const totalUsers = users.length;
  if (body.includeAllUsers) {
    return { users, totalUsers };
  }
  const pageSize = Math.min(Math.max(Math.trunc(Number(body.pageSize) || 20), 1), 200);
  const page = Math.max(Math.trunc(Number(body.page) || 1), 1);
  return { users: users.slice((page - 1) * pageSize, page * pageSize), totalUsers };
}

function getTodayBeijingYmd() {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(new Date());
}

// 员工端「团队今日数据」排行榜：同公司活跃员工今天(北京时区)的付费人数与充值总额，按金额降序。
async function buildTodayTeamStats(companyId: string) {
  const { data: allEmployees, error: employeesError } = await supabaseServer
    .from('employees')
    .select('id, employee_name, status')
    .eq('company_id', companyId);
  if (employeesError || !allEmployees || allEmployees.length === 0) return [];

  const activeEmployees = allEmployees.filter((item) => item.status === 'active');
  if (activeEmployees.length === 0) return [];
  const activeEmployeeIds = activeEmployees.map((item) => item.id);

  const today = getTodayBeijingYmd();
  let todayRechargeQuery = supabaseServer
    .from('recharge_orders')
    .select('employee_id, platform_user_id, amount, status')
    .eq('company_id', companyId)
    .in('employee_id', activeEmployeeIds);
  todayRechargeQuery = applyBeijingPayDateRange(todayRechargeQuery, today, today);

  const todayRecharges = await fetchAll<RechargeRow>(todayRechargeQuery);

  const statsByEmployee = new Map<string, { paidUserIds: Set<string>; totalAmount: number }>();
  for (const order of todayRecharges) {
    if (order.status !== 'success') continue;
    let stats = statsByEmployee.get(order.employee_id);
    if (!stats) {
      stats = { paidUserIds: new Set(), totalAmount: 0 };
      statsByEmployee.set(order.employee_id, stats);
    }
    stats.paidUserIds.add(order.platform_user_id);
    stats.totalAmount += Number(order.amount || 0);
  }

  return activeEmployees
    .map((item) => {
      const stats = statsByEmployee.get(item.id);
      return {
        name: item.employee_name,
        paidUsers: stats?.paidUserIds.size ?? 0,
        totalAmount: stats?.totalAmount ?? 0
      };
    })
    .filter((item) => item.paidUsers > 0 || item.totalAmount > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DashboardRequest;
    const { companyId, role, userId, username, startDate, endDate, metricStartDate, metricEndDate, forceRefresh } = body;
    const lastSyncTime = readLastSyncTime();

    if (!companyId || !role || !userId || !username) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const { data: account, error: accountError } = await supabaseServer
      .from('company_accounts')
      .select('id, company_id, role, username, name, status')
      .eq('id', userId)
      .eq('company_id', companyId)
      .eq('username', username)
      .single();

    if (accountError || !account) {
      return NextResponse.json({ error: '登录信息无效，请重新登录' }, { status: 401 });
    }

    if (account.status !== 'active') {
      return NextResponse.json({ error: '账号已停用' }, { status: 403 });
    }

    if (account.role !== role) {
      return NextResponse.json({ error: '角色信息不匹配' }, { status: 403 });
    }

    const { data: company } = await supabaseServer
      .from('companies')
      .select('company_name')
      .eq('id', companyId)
      .single();
    const companyName = company?.company_name ?? null;

    const cacheKey = JSON.stringify([
      companyId,
      role,
      userId,
      normalizeYmd(startDate),
      normalizeYmd(endDate),
      normalizeYmd(metricStartDate),
      normalizeYmd(metricEndDate)
    ]);
    const respond = (payload: { users: DashboardUserItem[] } & Record<string, unknown>) =>
      NextResponse.json({ ...payload, companyName, ...selectUsersPage(payload.users, body), lastSyncTime });

    if (!forceRefresh) {
      const cached = getOverviewCache(cacheKey);
      if (cached) {
        return respond(cached);
      }
    }

    if (role === 'boss') {
      let summaryRechargeQuery = supabaseServer
        .from('recharge_orders')
        .select('employee_id, platform_user_id, amount, pay_time, status')
        .eq('company_id', companyId);

      let summaryAttributionQuery = supabaseServer
        .from('attribution_users')
        .select('employee_id, platform_user_id, invite_code, bind_time, app_platform')
        .eq('company_id', companyId);

      summaryAttributionQuery = applyBeijingBindDateRange(summaryAttributionQuery, metricStartDate, metricEndDate);
      summaryRechargeQuery = applyBeijingPayDateRange(summaryRechargeQuery, metricStartDate, metricEndDate);

      let userRechargeQuery = supabaseServer
        .from('recharge_orders')
        .select('employee_id, platform_user_id, amount, pay_time, status')
        .eq('company_id', companyId);

      let userAttributionQuery = supabaseServer
        .from('attribution_users')
        .select('employee_id, platform_user_id, invite_code, bind_time, app_platform')
        .eq('company_id', companyId);

      userAttributionQuery = applyBeijingBindDateRange(userAttributionQuery, startDate, endDate);

      // 默认无筛选时，用户明细范围与指标范围一致，此时避免对 attribution_users /
      // recharge_orders 各拉两遍相同全量数据（summary 与 user 复用同一结果集）。
      const sameAttributionRange = normalizeYmd(metricStartDate) === normalizeYmd(startDate)
        && normalizeYmd(metricEndDate) === normalizeYmd(endDate);
      const metricRangeEmpty = !normalizeYmd(metricStartDate) && !normalizeYmd(metricEndDate);

      const [employeesResult, summaryAttributions, summaryRecharges, userAttributionsRaw, userRechargesRaw] = await Promise.all([
        supabaseServer
          .from('employees')
          .select('id, account_id, employee_name, invite_code, inviter_id, attribution_key, status')
          .eq('company_id', companyId)
          .order('created_at', { ascending: true }),
        fetchAll<AttributionRow>(summaryAttributionQuery.order('bind_time', { ascending: false })),
        fetchAll<RechargeRow>(summaryRechargeQuery.order('pay_time', { ascending: false })),
        sameAttributionRange
          ? Promise.resolve(null)
          : fetchAll<AttributionRow>(userAttributionQuery.order('bind_time', { ascending: false })),
        // userRecharge 不做日期过滤（按用户 LTV 全量）；metric 范围为空时与 summaryRecharge 相同，可复用。
        metricRangeEmpty
          ? Promise.resolve(null)
          : fetchAll<RechargeRow>(userRechargeQuery.order('pay_time', { ascending: false }))
      ]);

      const userAttributions = userAttributionsRaw ?? summaryAttributions;
      const userRecharges = userRechargesRaw ?? summaryRecharges;

      if (employeesResult.error) {
        return NextResponse.json({ error: '读取控制台数据失败' }, { status: 500 });
      }

      const employees = (employeesResult.data ?? []) as EmployeeRow[];
      const campaignKeys = new Set(employees.map((e) => String(e.attribution_key ?? '').trim()).filter(Boolean));
      const summary = buildSummary(summaryAttributions, summaryRecharges, campaignKeys);

      const { data: accountsData } = await supabaseServer
        .from('company_accounts')
        .select('id, username')
        .eq('company_id', companyId);
      const accountMap = new Map(accountsData?.map((a) => [a.id, a.username]) || []);

      // 按 employee_id 一次分组，避免对每个员工都做整表 filter（O(员工数×数据量)）。
      const attributionsByEmployee = new Map<string, AttributionRow[]>();
      for (const item of summaryAttributions) {
        const list = attributionsByEmployee.get(item.employee_id);
        if (list) list.push(item);
        else attributionsByEmployee.set(item.employee_id, [item]);
      }
      const rechargesByEmployee = new Map<string, RechargeRow[]>();
      for (const item of summaryRecharges) {
        const list = rechargesByEmployee.get(item.employee_id);
        if (list) list.push(item);
        else rechargesByEmployee.set(item.employee_id, [item]);
      }

      const employeeRows = employees.map((employee) => {
        const employeeUsers = attributionsByEmployee.get(employee.id) ?? [];
        const employeeOrders = rechargesByEmployee.get(employee.id) ?? [];
        const employeeCampaignKeys = new Set([String(employee.attribution_key ?? '').trim()].filter(Boolean));
        return {
          id: employee.id,
          name: employee.employee_name,
          username: accountMap.get(employee.account_id) ?? '',
          inviteCode: employee.invite_code,
          inviterId: employee.inviter_id ?? null,
          status: employee.status,
          ...buildSummary(employeeUsers, employeeOrders, employeeCampaignKeys)
        };
      });

      const hasDateFilter = !!startDate || !!endDate;
      const validUserIds = new Set(userAttributions.map((item) => item.platform_user_id));
      const filteredRecharges = hasDateFilter
        ? userRecharges.filter((item) => validUserIds.has(item.platform_user_id))
        : userRecharges;

      const employeeMap = new Map(employees.map((item) => [item.id, item]));
      const ordersByUser = new Map<string, RechargeRow[]>();
      for (const order of filteredRecharges) {
        const current = ordersByUser.get(order.platform_user_id) ?? [];
        current.push(order);
        ordersByUser.set(order.platform_user_id, current);
      }

      const attributionMap = new Map<string, AttributionRow>();
      for (const item of userAttributions) {
        if (!attributionMap.has(item.platform_user_id)) attributionMap.set(item.platform_user_id, item);
      }

      const allUserIds = hasDateFilter
        ? new Set(userAttributions.map((item) => item.platform_user_id))
        : new Set([
            ...userAttributions.map((item) => item.platform_user_id),
            ...filteredRecharges.map((item) => item.platform_user_id)
          ]);

      const users = Array.from(allUserIds).map((platformUserId) => {
        const attr = attributionMap.get(platformUserId);
        const userOrders = ordersByUser.get(platformUserId) ?? [];
        const employeeId = attr?.employee_id ?? userOrders[0]?.employee_id;
        const emp = employeeId ? employeeMap.get(employeeId) : undefined;
        return formatDashboardUser(
          platformUserId,
          attr?.invite_code ?? emp?.invite_code ?? '-',
          emp?.employee_name ?? '未知员工',
          attr?.bind_time ?? null,
          userOrders,
          campaignKeys,
          attr?.app_platform ?? null
        );
      });

      const bossPayload = {
        role,
        currentUser: { name: account.name, username: account.username },
        summary: { ...summary, employeeCount: employees.length },
        employees: employeeRows,
        users
      };
      setOverviewCache(cacheKey, bossPayload);
      return respond(bossPayload);
    }

    const { data: employee, error: employeeError } = await supabaseServer
      .from('employees')
      .select('id, account_id, employee_name, invite_code, inviter_id, attribution_key, status')
      .eq('company_id', companyId)
      .eq('account_id', userId)
      .single();

    if (employeeError || !employee) {
      return NextResponse.json({ error: '未找到员工资料' }, { status: 404 });
    }

    const staffCampaignKeys = new Set([String((employee as EmployeeRow).attribution_key ?? '').trim()].filter(Boolean));
    const isLeadPulseStaff = companyId === LEADPULSE_COMPANY_ID;

    let summaryRechargeQuery = supabaseServer
      .from('recharge_orders')
      .select('employee_id, platform_user_id, amount, pay_time, status')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    let summaryAttributionQuery = supabaseServer
      .from('attribution_users')
      .select('employee_id, platform_user_id, invite_code, bind_time, app_platform')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    summaryAttributionQuery = applyBeijingBindDateRange(summaryAttributionQuery, metricStartDate, metricEndDate);
    summaryRechargeQuery = applyBeijingPayDateRange(summaryRechargeQuery, metricStartDate, metricEndDate);

    let rechargeQuery = supabaseServer
      .from('recharge_orders')
      .select('employee_id, platform_user_id, amount, pay_time, status')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    let attributionQuery = supabaseServer
      .from('attribution_users')
      .select('employee_id, platform_user_id, invite_code, bind_time, app_platform')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    attributionQuery = applyBeijingBindDateRange(attributionQuery, startDate, endDate);

    const [summaryAttributions, summaryRechargesRaw, attributions, rechargesRaw] = await Promise.all([
      fetchAll<AttributionRow>(summaryAttributionQuery.order('bind_time', { ascending: false })),
      fetchAll<RechargeRow>(summaryRechargeQuery.order('pay_time', { ascending: false })),
      fetchAll<AttributionRow>(attributionQuery.order('bind_time', { ascending: false })),
      fetchAll<RechargeRow>(rechargeQuery.order('pay_time', { ascending: false }))
    ]);

    const summaryRecharges = isLeadPulseStaff
      ? await buildLeadPulseIncomeRecharges(summaryAttributions, {
          payStartIso: metricStartDate ? toBeijingUtcStart(metricStartDate) : undefined,
          payEndIso: metricEndDate ? toBeijingUtcStart(addDaysYmd(metricEndDate, 1)) : undefined
        })
      : summaryRechargesRaw;

    const recharges = isLeadPulseStaff
      ? await buildLeadPulseIncomeRecharges(attributions)
      : rechargesRaw;

    const hasDateFilter = !!startDate || !!endDate;
    const validUserIds = new Set(attributions.map((item) => item.platform_user_id));
    const filteredRecharges = hasDateFilter
      ? recharges.filter((item) => validUserIds.has(item.platform_user_id))
      : recharges;

    const summary = buildSummary(summaryAttributions, summaryRecharges, staffCampaignKeys);
    const ordersByUser = new Map<string, RechargeRow[]>();
    for (const order of filteredRecharges) {
      const current = ordersByUser.get(order.platform_user_id) ?? [];
      current.push(order);
      ordersByUser.set(order.platform_user_id, current);
    }

    const attributionMap = new Map<string, AttributionRow>();
    for (const item of attributions) {
      if (!attributionMap.has(item.platform_user_id)) attributionMap.set(item.platform_user_id, item);
    }

    const allUserIds = hasDateFilter
      ? new Set(attributions.map((item) => item.platform_user_id))
      : new Set([
          ...attributions.map((item) => item.platform_user_id),
          ...filteredRecharges.map((item) => item.platform_user_id)
        ]);

    const users = Array.from(allUserIds).map((platformUserId) => {
      const attr = attributionMap.get(platformUserId);
      const userOrders = ordersByUser.get(platformUserId) ?? [];
      return formatDashboardUser(
        platformUserId,
        attr?.invite_code ?? employee.invite_code,
        employee.employee_name,
        attr?.bind_time ?? null,
        userOrders,
        staffCampaignKeys,
        attr?.app_platform ?? null
      );
    });

    const todayTeamStats = await buildTodayTeamStats(companyId);

    const staffPayload = {
      role,
      currentUser: { name: account.name, username: account.username },
      summary,
      profile: {
        name: employee.employee_name,
        inviteCode: employee.invite_code,
        inviterId: employee.inviter_id ?? null,
        status: employee.status
      },
      todayTeamStats,
      users
    };
    setOverviewCache(cacheKey, staffPayload);
    return respond(staffPayload);
  } catch (error) {
    console.error('读取控制台概览失败', error);
    return NextResponse.json({ error: '服务器出了点问题，请稍后重试' }, { status: 500 });
  }
}
