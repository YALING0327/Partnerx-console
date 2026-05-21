import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

type LoginRole = 'boss' | 'staff';

type DashboardRequest = {
  userId?: string;
  companyId?: string;
  role?: LoginRole;
  username?: string;
  startDate?: string;
  endDate?: string;
};

type EmployeeRow = {
  id: string;
  account_id: string;
  employee_name: string;
  invite_code: string;
  inviter_id?: string | null;
  status: string;
};

type AttributionRow = {
  employee_id: string;
  platform_user_id: string;
  invite_code: string;
  bind_time: string;
};

type RechargeRow = {
  employee_id: string;
  platform_user_id: string;
  amount: number;
  pay_time: string;
  status: string;
};

function formatDashboardUser(
  userId: string,
  inviteCode: string,
  employeeName: string,
  bindTime: string,
  orders: RechargeRow[]
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
    firstRechargeAt: sortedTimes[0] ?? null,
    lastRechargeAt: sortedTimes[sortedTimes.length - 1] ?? null,
    rechargeCount: paidOrders.length,
    totalAmount
  };
}

function buildSummary(attributions: AttributionRow[], recharges: RechargeRow[]) {
  const attributedUserIds = new Set(attributions.map((item) => item.platform_user_id));
  const paidUserIds = new Set(
    recharges.filter((item) => item.status === 'success').map((item) => item.platform_user_id)
  );
  const totalAmount = recharges
    .filter((item) => item.status === 'success')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    newUsers: attributedUserIds.size,
    paidUsers: paidUserIds.size,
    totalAmount,
    arppu: paidUserIds.size ? totalAmount / paidUserIds.size : 0
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DashboardRequest;
    const { companyId, role, userId, username, startDate, endDate } = body;

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
      let rechargeQuery = supabaseServer
        .from('recharge_orders')
        .select('employee_id, platform_user_id, amount, pay_time, status')
        .eq('company_id', companyId);

      if (startDate) rechargeQuery = rechargeQuery.gte('pay_time', startDate);
      if (endDate) rechargeQuery = rechargeQuery.lte('pay_time', endDate + 'T23:59:59Z');

      let attributionQuery = supabaseServer
        .from('attribution_users')
        .select('employee_id, platform_user_id, invite_code, bind_time')
        .eq('company_id', companyId);
        
      if (startDate) attributionQuery = attributionQuery.gte('bind_time', startDate);
      if (endDate) attributionQuery = attributionQuery.lte('bind_time', endDate + 'T23:59:59Z');

      const [employeesResult, attributionsResult, rechargesResult] = await Promise.all([
        supabaseServer
          .from('employees')
          .select('id, account_id, employee_name, invite_code, inviter_id, status')
          .eq('company_id', companyId)
          .order('created_at', { ascending: true }),
        attributionQuery.order('bind_time', { ascending: false }),
        rechargeQuery.order('pay_time', { ascending: false })
      ]);

      if (employeesResult.error || attributionsResult.error || rechargesResult.error) {
        return NextResponse.json({ error: '读取控制台数据失败' }, { status: 500 });
      }

      const employees = (employeesResult.data ?? []) as EmployeeRow[];
      const attributions = (attributionsResult.data ?? []) as AttributionRow[];
      const recharges = (rechargesResult.data ?? []) as RechargeRow[];
      const summary = buildSummary(attributions, recharges);

      const employeeRows = employees.map((employee) => {
        const employeeUsers = attributions.filter((item) => item.employee_id === employee.id);
        const employeeOrders = recharges.filter((item) => item.employee_id === employee.id);
        const employeeSummary = buildSummary(employeeUsers, employeeOrders);
        return { id: employee.id, name: employee.employee_name, inviteCode: employee.invite_code, inviterId: employee.inviter_id ?? null, status: employee.status, ...employeeSummary };
      });

      const employeeMap = new Map(employees.map((item) => [item.id, item]));
      const ordersByUser = new Map<string, RechargeRow[]>();
      for (const order of recharges) {
        const current = ordersByUser.get(order.platform_user_id) ?? [];
        current.push(order);
        ordersByUser.set(order.platform_user_id, current);
      }

      const users = attributions.map((item) => {
        const employee = employeeMap.get(item.employee_id);
        return formatDashboardUser(
          item.platform_user_id,
          item.invite_code,
          employee?.employee_name ?? '未知员工',
          item.bind_time,
          ordersByUser.get(item.platform_user_id) ?? []
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
      .select('id, account_id, employee_name, invite_code, inviter_id, status')
      .eq('company_id', companyId)
      .eq('account_id', userId)
      .single();

    if (employeeError || !employee) {
      return NextResponse.json({ error: '未找到员工资料' }, { status: 404 });
    }

    let rechargeQuery = supabaseServer
      .from('recharge_orders')
      .select('employee_id, platform_user_id, amount, pay_time, status')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    if (startDate) rechargeQuery = rechargeQuery.gte('pay_time', startDate);
    if (endDate) rechargeQuery = rechargeQuery.lte('pay_time', endDate + 'T23:59:59Z');

    let attributionQuery = supabaseServer
      .from('attribution_users')
      .select('employee_id, platform_user_id, invite_code, bind_time')
      .eq('company_id', companyId)
      .eq('employee_id', employee.id);

    if (startDate) attributionQuery = attributionQuery.gte('bind_time', startDate);
    if (endDate) attributionQuery = attributionQuery.lte('bind_time', endDate + 'T23:59:59Z');

    const [attributionsResult, rechargesResult] = await Promise.all([
      attributionQuery.order('bind_time', { ascending: false }),
      rechargeQuery.order('pay_time', { ascending: false })
    ]);

    if (attributionsResult.error || rechargesResult.error) {
      return NextResponse.json({ error: '读取员工数据失败' }, { status: 500 });
    }

    const attributions = (attributionsResult.data ?? []) as AttributionRow[];
    const recharges = (rechargesResult.data ?? []) as RechargeRow[];
    const summary = buildSummary(attributions, recharges);
    const ordersByUser = new Map<string, RechargeRow[]>();
    for (const order of recharges) {
      const current = ordersByUser.get(order.platform_user_id) ?? [];
      current.push(order);
      ordersByUser.set(order.platform_user_id, current);
    }

    const users = attributions.map((item) =>
      formatDashboardUser(
        item.platform_user_id,
        item.invite_code,
        employee.employee_name,
        item.bind_time,
        ordersByUser.get(item.platform_user_id) ?? []
      )
    );

    return NextResponse.json({
      role,
      currentUser: { name: account.name, username: account.username },
      summary,
      profile: { name: employee.employee_name, inviteCode: employee.invite_code, inviterId: employee.inviter_id ?? null, status: employee.status },
      users
    });
  } catch (error) {
    console.error('读取控制台概览失败', error);
    return NextResponse.json({ error: '服务器出了点问题，请稍后重试' }, { status: 500 });
  }
}
