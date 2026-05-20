import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// key: username, value: { count, lockedUntil }
const failMap = new Map<string, { count: number; lockedUntil: number }>();

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 分钟

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: '账号和密码不能为空' }, { status: 400 });
    }

    const now = Date.now();
    const record = failMap.get(username);

    if (record && record.lockedUntil > now) {
      const remaining = Math.ceil((record.lockedUntil - now) / 60000);
      return NextResponse.json({ error: `账号已锁定，请 ${remaining} 分钟后再试` }, { status: 429 });
    }

    const { data: user, error } = await supabaseServer
      .from('company_accounts')
      .select('id, company_id, role, username, password_hash, name, status')
      .eq('username', username)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: '账号不存在或密码错误' }, { status: 401 });
    }

    if (user.status !== 'active') {
      return NextResponse.json({ error: '该账号已被停用，请联系管理员' }, { status: 403 });
    }

    if (user.password_hash !== password) {
      const prev = failMap.get(username) ?? { count: 0, lockedUntil: 0 };
      const count = prev.count + 1;
      failMap.set(username, { count, lockedUntil: count >= MAX_FAILS ? now + LOCK_MS : 0 });
      const left = MAX_FAILS - count;
      return NextResponse.json(
        { error: left > 0 ? `密码错误，还可尝试 ${left} 次` : `密码错误次数过多，账号已锁定 15 分钟` },
        { status: 401 }
      );
    }

    failMap.delete(username);

    return NextResponse.json({
      message: '登录成功',
      user: { id: user.id, companyId: user.company_id, role: user.role, username: user.username, name: user.name }
    });
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器出了点问题，请稍后再试' }, { status: 500 });
  }
}

