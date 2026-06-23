import { NextResponse } from 'next/server';
import { authenticate, assertInviterVisible, type ChatAuthBody } from '@/lib/chat-auth';
import { querySelectDB } from '@/lib/selectdb';

type Body = ChatAuthBody & { inviterId?: string; days?: number };

// SelectDB variant 列在 Next 打包运行时无法被 mysql2 直接读取，必须用
// json_extract_string 在 SQL 里抽成标量(VARCHAR)。WHERE 只用 account_id(有索引)，
// 否则在 e_immsg(700亿行) 上会全表扫描超时。
const P = `CONCAT('', CAST(properties AS STRING))`;
const U = `CONCAT('', CAST(\`user\` AS STRING))`;

// 某师傅的「对话用户列表」（截图中间的消息列表）：按对方用户聚合，最近消息倒序。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const auth = await authenticate(body);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const inviterId = String(body.inviterId ?? '').trim();
    if (!inviterId) return NextResponse.json({ error: '缺少 inviterId' }, { status: 400 });

    const emp = await assertInviterVisible(inviterId, auth.companyId, auth.role, body.userId!);
    if (!emp) return NextResponse.json({ error: '无权查看该师傅' }, { status: 403 });

    const days = Math.min(Math.max(Number(body.days || 30), 1), 180);

    // 师傅发出的消息(account_id=师傅，走索引)：聚合出对话用户 + 最后一条预览
    const sent = await querySelectDB<any>(
      `SELECT json_extract_string(${P}, '$.target_id') AS peer,
              json_extract_string(${P}, '$.im_msg_info.content.content_value') AS content,
              json_extract_string(${P}, '$.im_msg_info.message_type') AS mtype,
              CONCAT('', CAST(event_created_time AS STRING)) AS t
       FROM e_immsg
       WHERE account_id = ? AND event_created_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY event_created_time DESC
       LIMIT 20000`,
      [inviterId, days]
    );

    type Sess = { peerId: string; nickname: string; country: string; gender: string; lastTime: string; lastText: string; msgCount: number };
    const map = new Map<string, Sess>();
    for (const r of sent) {
      const peer = String(r.peer ?? '');
      if (!peer || peer === 'null' || peer === inviterId) continue;
      const t = String(r.t ?? '');
      const text = previewText(r.content, r.mtype);
      let s = map.get(peer);
      if (!s) { s = { peerId: peer, nickname: '', country: '', gender: '', lastTime: t, lastText: text, msgCount: 0 }; map.set(peer, s); }
      s.msgCount += 1;
      if (t > s.lastTime) { s.lastTime = t; s.lastText = text; }
    }

    // 补对方资料(昵称/国家/性别)：对方作为 account_id 时，user 字段是对方本人。
    // 仅查这些 peer（account_id IN，走索引），取每人一条。
    const peers = [...map.keys()];
    if (peers.length > 0) {
      for (let i = 0; i < peers.length; i += 200) {
        const chunk = peers.slice(i, i + 200);
        const ph = chunk.map(() => '?').join(',');
        const infoRows = await querySelectDB<any>(
          `SELECT account_id AS uid,
                  json_extract_string(${U}, '$.nickname') AS nickname,
                  json_extract_string(${U}, '$.country') AS country,
                  json_extract_string(${U}, '$.gender') AS gender
           FROM e_immsg
           WHERE account_id IN (${ph}) AND event_created_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
           ORDER BY event_created_time DESC
           LIMIT 20000`,
          [...chunk, days]
        );
        for (const r of infoRows) {
          const s = map.get(String(r.uid));
          if (s && !s.nickname) {
            s.nickname = r.nickname ?? '';
            s.country = r.country ?? '';
            s.gender = r.gender ?? '';
          }
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

function previewText(content: any, mtype: any): string {
  const type = String(mtype ?? '');
  if (type === '6') return '🎁 [礼物]';
  if (type === '1' || type === '2') return '[图片]';
  const c = String(content ?? '');
  if (!c) return type && type !== '0' ? `[消息类型 ${type}]` : '';
  if (/^\{.*\}$/.test(c.trim())) return '[系统/互动消息]';
  return c;
}
