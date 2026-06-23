import { NextResponse } from 'next/server';
import { authenticate, assertInviterVisible, type ChatAuthBody } from '@/lib/chat-auth';
import { querySelectDB, toBufferString } from '@/lib/selectdb';
import { parseImMsg, safeJson } from '@/lib/chat-parse';

type Body = ChatAuthBody & { inviterId?: string; peerId?: string; days?: number };

// 某师傅 ↔ 某用户的完整对话（截图右侧聊天区）。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const auth = await authenticate(body);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const inviterId = String(body.inviterId ?? '').trim();
    const peerId = String(body.peerId ?? '').trim();
    if (!inviterId || !peerId) return NextResponse.json({ error: '缺少 inviterId 或 peerId' }, { status: 400 });

    // 归属鉴权
    const emp = await assertInviterVisible(inviterId, auth.companyId, auth.role, body.userId!);
    if (!emp) return NextResponse.json({ error: '无权查看该师傅' }, { status: 403 });

    const days = Math.min(Math.max(Number(body.days || 30), 1), 365);

    // 双向：师傅↔该用户。时间正序展示，限量保护。
    const rows = await querySelectDB<any>(
      `SELECT account_id AS sender,
              CONCAT('', CAST(properties AS STRING)) AS props,
              CONCAT('', CAST(user AS STRING)) AS usr,
              CONCAT('', CAST(event_created_time AS STRING)) AS t
       FROM e_immsg
       WHERE event_created_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND ((account_id = ? AND CAST(properties['target_id'] AS STRING) = ?)
           OR (account_id = ? AND CAST(properties['target_id'] AS STRING) = ?))
       ORDER BY event_created_time ASC
       LIMIT 5000`,
      [days, inviterId, peerId, peerId, inviterId]
    );

    let peer = { peerId, nickname: '', country: '', gender: '', firstRecharge: '' };
    const messages = [] as Array<{ dir: 'out' | 'in'; text: string; kind: string; violation: string | 0; time: string }>;
    for (const r of rows) {
      const m = parseImMsg(r.props);
      if (!m) continue;
      const dir = m.sender === inviterId ? 'out' : 'in';
      messages.push({ dir, text: m.text, kind: m.kind, violation: m.violation, time: toBufferString(r.t) });
      if (dir === 'in' && !peer.nickname) {
        const u = safeJson(r.usr);
        if (u) {
          peer.nickname = u.nickname ?? '';
          peer.country = u.country ?? '';
          peer.gender = u.gender ?? '';
          peer.firstRecharge = u.first_recharge_time ?? '';
        }
      }
    }

    return NextResponse.json({
      employee: { inviterId, name: emp.employee_name, inviteCode: emp.invite_code },
      peer,
      days,
      messages
    });
  } catch (error) {
    console.error('chat/messages 异常', error);
    return NextResponse.json({ error: '读取聊天记录失败' }, { status: 500 });
  }
}
