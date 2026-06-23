import { NextResponse } from 'next/server';
import { authenticate, assertInviterVisible, type ChatAuthBody } from '@/lib/chat-auth';
import { querySelectDB } from '@/lib/selectdb';
import { parseImMsg, safeJson } from '@/lib/chat-parse';

type Body = ChatAuthBody & { inviterId?: string; days?: number };

// 某师傅的「对话用户列表」（截图中间的消息列表）：按对方用户聚合，最近消息倒序。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const auth = await authenticate(body);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const inviterId = String(body.inviterId ?? '').trim();
    if (!inviterId) return NextResponse.json({ error: '缺少 inviterId' }, { status: 400 });

    // 归属鉴权：该师傅必须在当前账号可见范围内
    const emp = await assertInviterVisible(inviterId, auth.companyId, auth.role, body.userId!);
    if (!emp) return NextResponse.json({ error: '无权查看该师傅' }, { status: 403 });

    const days = Math.min(Math.max(Number(body.days || 30), 1), 180);

    // 取该师傅近 N 天双向消息（发出 or 收到），按时间倒序，限量保护
    const rows = await querySelectDB<any>(
      `SELECT account_id AS sender,
              CAST(properties AS STRING) AS props,
              CAST(user AS STRING) AS usr,
              CAST(event_created_time AS STRING) AS t
       FROM e_immsg
       WHERE event_created_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND (account_id = ? OR CAST(properties['target_id'] AS STRING) = ?)
       ORDER BY event_created_time DESC
       LIMIT 20000`,
      [days, inviterId, inviterId]
    );

    if (process.env.CHAT_DEBUG === '1') {
      const sample = rows[0];
      console.log('[chat/sessions DEBUG] rows=', rows.length, 'propsType=', typeof sample?.props, 'parse=', JSON.stringify(parseImMsg(sample?.props)), 'inviterId=', inviterId);
    }

    type Sess = { peerId: string; nickname: string; country: string; gender: string; firstRecharge: string; lastTime: string; lastText: string; msgCount: number };
    const map = new Map<string, Sess>();
    for (const r of rows) {
      const m = parseImMsg(r.props);
      if (!m) continue;
      const peer = m.sender === inviterId ? m.target : m.sender;
      if (!peer || peer === inviterId) continue;

      let s = map.get(peer);
      if (!s) {
        s = { peerId: peer, nickname: '', country: '', gender: '', firstRecharge: '', lastTime: r.t, lastText: m.text, msgCount: 0 };
        map.set(peer, s);
      }
      s.msgCount += 1;
      // rows 已按时间倒序，首次遇到即最新一条
      if (r.t > s.lastTime) { s.lastTime = r.t; s.lastText = m.text; }

      // 对方资料：当这条由对方发出(sender=peer)，user 字段是对方
      if (m.sender === peer && !s.nickname) {
        const u = safeJson(r.usr);
        if (u) {
          s.nickname = u.nickname ?? '';
          s.country = u.country ?? '';
          s.gender = u.gender ?? '';
          s.firstRecharge = u.first_recharge_time ?? '';
        }
      }
    }

    const sessions = [...map.values()].sort((a, b) => (a.lastTime < b.lastTime ? 1 : -1));
    return NextResponse.json({
      employee: { inviterId, name: emp.employee_name, inviteCode: emp.invite_code },
      days,
      sessions
    });
  } catch (error) {
    console.error('chat/sessions 异常', error);
    return NextResponse.json({ error: '读取会话列表失败' }, { status: 500 });
  }
}
