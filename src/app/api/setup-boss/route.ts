import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const { username, password, name, passcode } = await request.json();

    // 简单的安全校验，防止外人知道网址后随意创建老板账号
    const SUPER_PASSCODE = process.env.SUPER_ADMIN_PASSCODE || 'partnerx888';
    
    if (passcode !== SUPER_PASSCODE) {
      return NextResponse.json({ error: '安全授权码错误，拒绝访问' }, { status: 403 });
    }

    if (!username || !password) {
      return NextResponse.json({ error: '账号和密码不能为空' }, { status: 400 });
    }

    const companyId = '00000000-0000-0000-0000-000000000001';

    // 检查账号是否已存在
    const { data: existing } = await supabaseServer
      .from('company_accounts')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: '该账号已被使用，请换一个' }, { status: 409 });
    }

    // 插入账号
    const { error: insertError } = await supabaseServer
      .from('company_accounts')
      .insert({
        company_id: companyId,
        role: 'boss',
        username: username.trim(),
        password_hash: password.trim(),
        name: (name || '老板').trim(),
        status: 'active'
      });

    if (insertError) {
      return NextResponse.json({ error: '数据库写入失败' }, { status: 500 });
    }

    return NextResponse.json({ message: '老板账号创建成功！' });

  } catch (err) {
    console.error('创建老板账号异常', err);
    return NextResponse.json({ error: '服务器出了点问题，请稍后再试' }, { status: 500 });
  }
}
