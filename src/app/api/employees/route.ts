import { NextResponse } from 'next/server';
import { supabaseServer, fetchAll } from '@/lib/supabase-server';

type AuthBody = {
  requesterId?: string;
  requesterCompanyId?: string;
  requesterRole?: string;
  requesterUsername?: string;
};

async function verifyBoss(requesterId: string, requesterCompanyId: string, requesterRole: string) {
  if (requesterRole !== 'boss') return false;
  const { data } = await supabaseServer
    .from('company_accounts')
    .select('id')
    .eq('id', requesterId)
    .eq('company_id', requesterCompanyId)
    .eq('role', 'boss')
    .eq('status', 'active')
    .single();
  return !!data;
}

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
};

type RechargeRow = {
  employee_id: string;
  platform_user_id: string;
  amount: number;
  status: string;
};

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requesterId = url.searchParams.get('requesterId') ?? '';
    const requesterCompanyId = url.searchParams.get('requesterCompanyId') ?? '';
    const requesterRole = url.searchParams.get('requesterRole') ?? '';
    const requesterUsername = url.searchParams.get('requesterUsername') ?? '';

    if (!requesterId || !requesterCompanyId || !requesterRole || !requesterUsername) {
      return NextResponse.json({ error: '缺少身份信息' }, { status: 401 });
    }

    const authorized = await verifyBoss(requesterId, requesterCompanyId, requesterRole);
    if (!authorized) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const [employeesResult, attributions, recharges] = await Promise.all([
      supabaseServer
        .from('employees')
        .select('id, account_id, employee_name, invite_code, inviter_id, status')
        .eq('company_id', requesterCompanyId)
        .order('created_at', { ascending: true }),
      fetchAll<AttributionRow>(
        supabaseServer
          .from('attribution_users')
          .select('employee_id, platform_user_id')
          .eq('company_id', requesterCompanyId)
      ),
      fetchAll<RechargeRow>(
        supabaseServer
          .from('recharge_orders')
          .select('employee_id, platform_user_id, amount, status')
          .eq('company_id', requesterCompanyId)
      )
    ]);

    if (employeesResult.error) {
      return NextResponse.json({ error: '读取员工列表失败' }, { status: 500 });
    }

    const employees = (employeesResult.data ?? []) as EmployeeRow[];

    const responseRows = employees.map((employee) => {
      const employeeAttributions = attributions.filter((item) => item.employee_id === employee.id);
      const employeeRecharges = recharges.filter((item) => item.employee_id === employee.id);
      const summary = buildSummary(employeeAttributions, employeeRecharges);

      return {
        id: employee.id,
        name: employee.employee_name,
        inviteCode: employee.invite_code,
        inviterId: employee.inviter_id ?? null,
        status: employee.status,
        ...summary
      };
    });

    return NextResponse.json({
      employees: responseRows
    });
  } catch (err) {
    console.error('读取员工列表失败', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as AuthBody & {
      employeeName?: string;
      username?: string;
      password?: string;
      inviteCode?: string;
      inviterId?: string;
    };

    const { requesterId, requesterCompanyId, requesterRole, employeeName, username, password, inviteCode, inviterId } = body;

    if (!requesterId || !requesterCompanyId || !requesterRole) {
      return NextResponse.json({ error: '缺少身份信息' }, { status: 401 });
    }
    if (!employeeName || !username || !password || !inviteCode) {
      return NextResponse.json({ error: '员工姓名、账号、密码、邀请码均不能为空' }, { status: 400 });
    }

    const authorized = await verifyBoss(requesterId, requesterCompanyId, requesterRole);
    if (!authorized) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    // Check username uniqueness
    const { data: existingAccount } = await supabaseServer
      .from('company_accounts')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (existingAccount) {
      return NextResponse.json({ error: '该账号名已被使用' }, { status: 409 });
    }

    // Check invite code uniqueness
    const { data: existingCode } = await supabaseServer
      .from('employees')
      .select('id')
      .eq('invite_code', inviteCode)
      .maybeSingle();
    if (existingCode) {
      return NextResponse.json({ error: '该邀请码已被使用' }, { status: 409 });
    }

    const inviterIdValue = (inviterId ?? '').trim();
    if (inviterIdValue && !/^\d+$/.test(inviterIdValue)) {
      return NextResponse.json({ error: '邀请人ID 必须是纯数字' }, { status: 400 });
    }
    if (inviterIdValue) {
      const { data: existingInviter } = await supabaseServer
        .from('employees')
        .select('id')
        .eq('company_id', requesterCompanyId)
        .eq('inviter_id', inviterIdValue)
        .maybeSingle();
      if (existingInviter) {
        return NextResponse.json({ error: '该邀请人ID 已被使用' }, { status: 409 });
      }
    }

    const passwordHash = password;

    const { data: newAccount, error: accountError } = await supabaseServer
      .from('company_accounts')
      .insert({
        company_id: requesterCompanyId,
        role: 'staff',
        username: username.trim(),
        password_hash: passwordHash,
        name: employeeName.trim(),
        status: 'active'
      })
      .select('id')
      .single();

    if (accountError || !newAccount) {
      return NextResponse.json({ error: '创建账号失败' }, { status: 500 });
    }

    const { error: employeeError } = await supabaseServer
      .from('employees')
      .insert({
        company_id: requesterCompanyId,
        account_id: newAccount.id,
        employee_name: employeeName,
        invite_code: inviteCode,
        inviter_id: inviterIdValue || null,
        status: 'active'
      });

    if (employeeError) {
      // Rollback account
      await supabaseServer.from('company_accounts').delete().eq('id', newAccount.id);
      return NextResponse.json({ error: '创建员工资料失败' }, { status: 500 });
    }

    return NextResponse.json({ message: '员工创建成功' });
  } catch (err) {
    console.error('创建员工失败', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as AuthBody & {
      employeeId?: string;
      action?: 'enable' | 'disable';
    };

    const { requesterId, requesterCompanyId, requesterRole, employeeId, action } = body;

    if (!requesterId || !requesterCompanyId || !requesterRole) {
      return NextResponse.json({ error: '缺少身份信息' }, { status: 401 });
    }
    if (!employeeId || !action) {
      return NextResponse.json({ error: '缺少员工 ID 或操作类型' }, { status: 400 });
    }

    const authorized = await verifyBoss(requesterId, requesterCompanyId, requesterRole);
    if (!authorized) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const newStatus = action === 'enable' ? 'active' : 'disabled';

    const { data: employee, error: fetchError } = await supabaseServer
      .from('employees')
      .select('id, account_id')
      .eq('id', employeeId)
      .eq('company_id', requesterCompanyId)
      .single();

    if (fetchError || !employee) {
      return NextResponse.json({ error: '员工不存在' }, { status: 404 });
    }

    await Promise.all([
      supabaseServer.from('employees').update({ status: newStatus }).eq('id', employeeId),
      supabaseServer.from('company_accounts').update({ status: newStatus }).eq('id', employee.account_id)
    ]);

    return NextResponse.json({ message: action === 'enable' ? '已启用' : '已停用' });
  } catch (err) {
    console.error('更新员工状态失败', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
