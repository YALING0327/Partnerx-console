import { NextResponse } from 'next/server';
import { authenticate, getVisibleEmployees, type ChatAuthBody } from '@/lib/chat-auth';

// 返回当前账号可见的、可查聊天的师傅(员工)列表。
// 只返回有 inviter_id 的（没有 inviter_id 无法在 e_immsg 里定位该师傅）。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatAuthBody;
    const auth = await authenticate(body);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const emps = await getVisibleEmployees(auth.companyId, auth.role, body.userId!);
    const list = emps
      .filter((e) => String(e.inviter_id ?? '').trim())
      .map((e) => ({
        employeeId: e.id,
        name: e.employee_name,
        inviteCode: e.invite_code,
        inviterId: String(e.inviter_id),
        status: e.status
      }));

    return NextResponse.json({ employees: list });
  } catch (error) {
    console.error('chat/employees 异常', error);
    return NextResponse.json({ error: '服务器出了点问题，请稍后再试' }, { status: 500 });
  }
}
