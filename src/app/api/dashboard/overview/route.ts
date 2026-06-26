import { NextResponse } from 'next/server';
import { supabaseServer, fetchAll } from '@/lib/supabase-server';

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
  bind_status?: string | null;
  app_platform?: string | null;
};

type RechargeRow = {
  employee_id: string;
  platform_user_id: string;
  amount: number;
  pay_time: string;
  status: string;
};

type AttributionSource = 'invite' | 'adjust';

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

function getTodayBeijing() {
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toBeijingUtcStart(ymd: string) {
  return new Date(`${normalizeYmd(ymd)}T00:00:00+08:00`).toISOString();
}

function applyBeijingBindDateRange<T extends { gte: Function; lt: Function }>(
  query: T,
  startDate?: string,
  endDate?: string
) {
  let nextQuery = query;
  const normalizedStart = normalizeYmd(startDate);
  const normalizedEnd = normalizeYmd(endDate);

  if (normalizedStart) {
    nextQuery = nextQuery.gte('bind_time', toBeijingUtcStart(normalizedStart));
  }
  if (normalizedEnd) {
    nextQuery = nextQuery.lt('bind_time', toBeijingUtcStart(addDaysYmd(normalizedEnd, 1)));
  }

  return nextQuery;
}

function applyBeijingPayDateRange<T extends { gte: Function; lt: Function }>(
  query: T,
  startDate?: string,
  endDate?: string
) {
  let nextQuery = query;
  const normalizedStart = normalizeYmd(startDate);
  const normalizedEnd = normalizeYmd(endDate);

  if (normalizedStart) {
    nextQuery = nextQuery.gte('pay_time', toBeijingUtcStart(normalizedStart));
  }
  if (normalizedEnd) {
    nextQuery = nextQuery.lt('pay_time', toBeijingUtcStart(addDaysYmd(normalizedEnd, 1)));
  }

  return nextQuery;
}

function normalizePlatform(value?: string | null): 'android' | 'ios' | 'unknown' {
  const v = String(value ?? '').toLowerCase();
  if (v === 'android' || v === 'ios') return v;
  return 'unknown';
}

function formatDashboardUser(
  userId: string,
  inviteCode: string,
  employeeName: string,
  bindTime: string | null,
  orders: RechargeRow[],
  campaignKeys?: Set<string>,
  bindStatus?: string | null,
  appPlatform?: string | null
) {
  const paidOrders = orders.filter((item) => item.status === 'success');
  const totalAmount = paidOrders.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const sortedTimes = paidOrders
    .map((item) => item.pay_time)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  const source = getAttributionSource(bindStatus, inviteCode, campaignKeys);

  return {
    platformUserId: userId,
    employeeName,
    inviteCode,
    bindTime,
    source,
    appPlatform: normalizePlatform(appPlatform),
    firstRechargeAt: sortedTimes[0] ?? null,
    lastRechargeAt: sortedTimes[sortedTimes.length - 1] ?? null,
    rechargeCount: paidOrders.length,
    totalAmount
  };
}

function getAttributionSource(
  bindStatus?: string | null,
  inviteCode?: string | null,
  campaignKeys?: Set<string>
): AttributionSource {
  if (bindStatus === 'adjust') return 'adjust';
  if (bindStatus === 'invite' || bindStatus === 'bound') return 'invite';
  const normalizedInviteCode = String(inviteCode ?? '').trim();
  return campaignKeys && normalizedInviteCode && campaignKeys.has(normalizedInviteCode) ? 'adjust' : 'invite';
}

function buildSummary(
  attributions: AttributionRow[],
  recharges: RechargeRow[],
  campaignKeys?: Set<string>
) {
  const attributedUserIds = new Set(attributions.map((item) => item.platform_user_id));
  const inviteUserIds = new Set<string>();
  const adjustUserIds = new Set<string>();
  for (const item of attributions) {
    const source = getAttributionSource(item.bind_status, item.invite_code, campaignKeys);
    if (source === 'adjust') {
      adjustUserIds.add(item.platform_user_id);
    } else {
      inviteUserIds.add(item.platform_user_id);
    }
  }
  const paidUserIds = new Set(
    recharges.filter((item) => item.status === 'success').map((item) => item.platform_user_id)
  );
  const totalAmount = recharges
    .filter((item) => item.status === 'success')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  // 按用户统计来源平台（每个用户取其归因记录的 app_platform，去重计数）
  const platformByUser = new Map<string, string>();
  for (const item of attributions) {
    if (!platformByUser.has(item.platform_user_id)) {
      platformByUser.set(item.platform_user_id, normalizePlatform(item.app_platform));
    }
  }
  let androidUsers = 0, iosUsers = 0;
  for (const p of platformByUser.values()) {
    if (p === 'android') androidUsers++;
    else if (p === 'ios') iosUsers++;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DashboardRequest;
    const { companyId, role, userId, username, startDate, endDate, metricStartDate, metricEndDate } = body;

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

    if (role === 'boss') {
      let summaryRechargeQuery = supabaseServer
        .from('recharge_orders')
        .select('employee_id, platform_user_id, amount, pay_time, status')
        .eq('company_id', companyId);

      let summaryAttributionQuery = supabaseServer
        .from('attribution_users')
        .select('employee_id, platform_user_id, invite_code, bind_time, bind_status, app_platform')
        .eq('company_id', companyId);

      summaryAttributionQuery = applyBeijingBindDateRange(summaryAttributionQuery, metricStartDate, metricEndDate);
      summaryRechargeQuery = applyBeijingPayDateRange(summaryRechargeQuery, metricStartDate, metricEndDate);

      // ⚠️ 重要约束：用户的「充值金额 / 充值笔数」必须查全量（LTV 语义），
      // 绝对不能给 userRechargeQuery 加 pay_time 过滤，否则会把历史充值切掉。
      // 只有 userAttributionQuery 受 startDate/endDate 影响（用于按归因期筛用户）。
      let userRechargeQuery = supabaseServer
        .from('recharge_orders')
        .select('employee_id, platform_user_id, amount, pay_time, status')
        .eq('company_id', companyId);

      let userAttributionQuery = supabaseServer
        .from('attribution_users')
        .select('employee_id, platform_user_id, invite_code, bind_time, bind_status, app_platform')
        .eq('company_id', companyId);

      userAttributionQuery = applyBeijingBindDateRange(userAttributionQuery, startDate, endDate);
      // 注意：userRechargeQuery 故意不调 applyBeijingPayDateRange，保持全量。

      const [employeesResult, summaryAttributions, summaryRecharges, userAttributions, userRecharges] = await Promise.all([
        supabaseServer
          .from('employees')
          .select('id, account_id, employee_name, invite_code, inviter_id, attribution_key, status')
          .eq('company_id', companyId)
          .order('created_at', { ascending: true }),
        fetchAll<AttributionRow>(summaryAttributionQuery.order('bind_time', { ascending: false })),
        fetchAll<RechargeRow>(summaryRechargeQuery.order('pay_time', { ascending: false })),
        fetchAll<AttributionRow>(userAttributionQuery.order('bind_time', { ascending: false })),
        fetchAll<RechargeRow>(userRechargeQuery.order('pay_time', { ascending: false }))
      ]);

      if (employeesResult.error) {
        return NextResponse.json({ error: '读取控制台数据失败' }, { status: 500 });
      }

      const employees = (employeesResult.data ?? []) as EmployeeRow[];
      // 所有员工的 attribution_key（campaign）集合，用于判断用户来源
      const campaignKeys = new Set(
        employees.map((e) => (e.attribution_key ?? '').trim()).filter(Boolean)
      );

      // If a date filter is applied, we only want to consider users who bound in this period
      const hasDateFilter = !!startDate || !!endDate;
      const validUserIds = new Set(userAttributions.map(a => a.platform_user_id));
      
      // Filter recharges to only include valid users (if date filter applied)
      // If no date filter, validUserIds contains all attributions. We might still want to include recharges for users with no attribution.
      const filteredRecharges = hasDateFilter 
        ? userRecharges.filter(r => validUserIds.has(r.platform_user_id))
        : userRecharges;

      const summary = buildSummary(summaryAttributions, summaryRecharges, campaignKeys);

      const { data: accountsData } = await supabaseServer
        .from('company_accounts')
        .select('id, username')
        .eq('company_id', companyId);
      const accountMap = new Map(accountsData?.map(a => [a.id, a.username]) || []);

      const employeeRows = employees.map((employee) => {
        const employeeUsers = summaryAttributions.filter((item) => item.employee_id === employee.id);
        const employeeOrders = summaryRecharges.filter((item) => item.employee_id === employee.id);
        const employeeCampaignKeys = new Set(
          [String(employee.attribution_key ?? '').trim()].filter(Boolean)
        );
        const employeeSummary = buildSummary(employeeUsers, employeeOrders, employeeCampaignKeys);
        return { 
          id: employee.id, 
          name: employee.employee_name, 
          username: accountMap.get(employee.account_id) ?? '',
          inviteCode: employee.invite_code, 
          inviterId: employee.inviter_id ?? null, 
          status: employee.status, 
          ...employeeSummary 
        };
      });

      const employeeMap = new Map(employees.map((item) => [item.id, item]));
      const ordersByUser = new Map<string, RechargeRow[]>();
      for (const order of filteredRecharges) {
        const current = ordersByUser.get(order.platform_user_id) ?? [];
        current.push(order);
        ordersByUser.set(order.platform_user_id, current);
      }

      const attributionMap = new Map<string, AttributionRow>();
      for (const a of userAttributions) {
        attributionMap.set(a.platform_user_id, a);
      }

      const allUserIds = hasDateFilter 
        ? new Set(userAttributions.map((a) => a.platform_user_id))
        : new Set([
            ...userAttributions.map((a) => a.platform_user_id),
            ...filteredRecharges.map((r) => r.platform_user_id)
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
          attr?.bind_status ?? null,
          attr?.app_platform ?? null
        );
      });

      return NextResponse.json({
        role,
        currentUser: { name: account.name, username: account.username },
        summary: { ...summary, employeeCount: employees.length },
        employees: employeeRows,
        users
      });
    }

    // staff
    const { data: employee, error: employeeError } = await supabaseServer
      .from('employees')
      .select('id, account_id, employee_name, invite_code, inviter_id, attribution_key, status')
      .eq('company_id', companyId)
      .eq('account_id', userId)
      .single();

    if (employeeError || !employee) {
      return NextResponse.json({ error: '未找到员工资料' }, { status: 404 });
    }

    // 该员工的 attribution_key（campaign）集合
    const staffCampaignKeys = new Set(
      [String((employee as EmployeeRow).attribution_key ?? '').trim()].filter(Boolean)
    );

    let summaryRechargeQuery = supabaseServer
      .from('recharge_orders')
      .select('employee_id, platform_user_id, amount, pay_time, status')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    let summaryAttributionQuery = supabaseServer
      .from('attribution_users')
      .select('employee_id, platform_user_id, invite_code, bind_time, bind_status, app_platform')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    summaryAttributionQuery = applyBeijingBindDateRange(summaryAttributionQuery, metricStartDate, metricEndDate);
    summaryRechargeQuery = applyBeijingPayDateRange(summaryRechargeQuery, metricStartDate, metricEndDate);

        // ⚠️ 重要约束：员工端的「充值金额 / 充值笔数」也必须查全量（LTV 语义），
    // 绝对不能给 rechargeQuery 加 pay_time 过滤，否则会把历史充值切掉。
    let rechargeQuery = supabaseServer
      .from('recharge_orders')
      .select('employee_id, platform_user_id, amount, pay_time, status')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    let attributionQuery = supabaseServer
      .from('attribution_users')
      .select('employee_id, platform_user_id, invite_code, bind_time, bind_status, app_platform')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    attributionQuery = applyBeijingBindDateRange(attributionQuery, startDate, endDate);

    // 查询今天的团队数据（所有同公司员工的今日付费数据）
    const today = getTodayBeijing();
    const { data: allEmployees } = await supabaseServer
      .from('employees')
      .select('id, employee_name, status')
      .eq('company_id', companyId);

    const activeEmployeeIds = (allEmployees ?? [])
      .filter((e: { status: string }) => e.status === 'active')
      .map((e: { id: string }) => e.id);

    let todayTeamRechargeQuery = supabaseServer
      .from('recharge_orders')
      .select('employee_id, platform_user_id, amount, status')
      .eq('company_id', companyId)
      .in('employee_id', activeEmployeeIds);

    todayTeamRechargeQuery = applyBeijingPayDateRange(todayTeamRechargeQuery, today, today);

    const [summaryAttributions, summaryRecharges, attributions, recharges, todayTeamRecharges] = await Promise.all([
      fetchAll<AttributionRow>(summaryAttributionQuery.order('bind_time', { ascending: false })),
      fetchAll<RechargeRow>(summaryRechargeQuery.order('pay_time', { ascending: false })),
      fetchAll<AttributionRow>(attributionQuery.order('bind_time', { ascending: false })),
      fetchAll<RechargeRow>(rechargeQuery.order('pay_time', { ascending: false })),
      fetchAll<RechargeRow>(todayTeamRechargeQuery.order('pay_time', { ascending: false }))
    ]);

    const hasDateFilter = !!startDate || !!endDate;
    const validUserIds = new Set(attributions.map(a => a.platform_user_id));

    const filteredRecharges = hasDateFilter
      ? recharges.filter(r => validUserIds.has(r.platform_user_id))
      : recharges;

    const summary = buildSummary(summaryAttributions, summaryRecharges, staffCampaignKeys);
    const ordersByUser = new Map<string, RechargeRow[]>();
    for (const order of filteredRecharges) {
      const current = ordersByUser.get(order.platform_user_id) ?? [];
      current.push(order);
      ordersByUser.set(order.platform_user_id, current);
    }

    const attributionMap = new Map<string, AttributionRow>();
    for (const a of attributions) {
      attributionMap.set(a.platform_user_id, a);
    }

    const allUserIds = hasDateFilter
      ? new Set(attributions.map((a) => a.platform_user_id))
      : new Set([
          ...attributions.map((a) => a.platform_user_id),
          ...filteredRecharges.map((r) => r.platform_user_id)
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
        attr?.bind_status ?? null,
        attr?.app_platform ?? null
      );
    });

    // 构建今天的团队数据
    const employeeMap = new Map((allEmployees ?? []).map((e: { id: string; employee_name: string }) => [e.id, e.employee_name]));
    const todayTeamStatsMap = new Map<string, { paidUserIds: Set<string>; totalAmount: number }>();

    for (const order of todayTeamRecharges) {
      if (order.status !== 'success') continue;
      const empId = order.employee_id;
      if (!todayTeamStatsMap.has(empId)) {
        todayTeamStatsMap.set(empId, { paidUserIds: new Set(), totalAmount: 0 });
      }
      const stats = todayTeamStatsMap.get(empId)!;
      stats.paidUserIds.add(order.platform_user_id);
      stats.totalAmount += Number(order.amount || 0);
    }

    const todayTeamStats = Array.from(todayTeamStatsMap.entries())
      .map(([empId, stats]) => ({
        name: employeeMap.get(empId) ?? '未知',
        paidUsers: stats.paidUserIds.size,
        totalAmount: stats.totalAmount
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount); // 按充值金额降序

    return NextResponse.json({
      role,
      currentUser: { name: account.name, username: account.username },
      summary,
      profile: { name: employee.employee_name, inviteCode: employee.invite_code, inviterId: employee.inviter_id ?? null, status: employee.status },
      todayTeamStats,
      users
    });
  } catch (error) {
    console.error('读取控制台概览失败', error);
    return NextResponse.json({ error: '服务器出了点问题，请稍后重试' }, { status: 500 });
  }
}
