import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

type AuthBody = {
  requesterId?: string;
  requesterCompanyId?: string;
  requesterRole?: string;
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

// POST /api/employees — create employee
export async function POST(request: Request) {
  try {
    const body = await request.json() as AuthBody & {
      employeeName?: string;
      username?: string;
      password?: string;
      inviteCode?: string;
    };

    const { requesterId, requesterCompanyId, requesterRole, employeeName, username, password, inviteCode } = body;

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

    const passwordHash = password;

    const { data: newAccount, error: accountError } = await supabaseServer
      .from('company_accounts')
      .insert({
        company_id: requesterCompanyId,
        role: 'staff',
        username,
        password_hash: passwordHash,
        name: employeeName,
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

// PATCH /api/employees — toggle employee status
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
