import { NextResponse } from 'next/server';
import { authenticate, assertInviterVisible, type ChatAuthBody } from '@/lib/chat-auth';
import { querySelectDB } from '@/lib/selectdb';

type Body = ChatAuthBody & { inviterId?: string; peerId?: string; days?: number };

const P = `CONCAT('', CAST(properties AS STRING))`;
const U = `CONCAT('', CAST(\`user\` AS STRING))`;

// 某师傅 ↔ 某用户的完整对话（截图右侧聊天区）。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const auth = await authenticate(body, { requireBoss: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const inviterId = String(body.inviterId ?? '').trim();
    const peerId = String(body.peerId ?? '').trim();
    if (!inviterId || !peerId) return NextResponse.json({ error: '缺少 inviterId 或 peerId' }, { status: 400 });

    const emp = await assertInviterVisible(inviterId, auth.companyId, auth.role, body.userId!);
    if (!emp) return NextResponse.json({ error: '无权查看该师傅' }, { status: 403 });

    const days = Math.min(Math.max(Number(body.days || 30), 1), 365);

    // 直接在 SQL 里收窄到这一对的双向消息，避免高活跃师傅被 8000 条截断后前端显示“暂无消息”。
    const rows = await querySelectDB<any>(
      `SELECT *
       FROM (
         SELECT account_id AS sender,
                json_extract_string(${P}, '$.target_id') AS target_id,
                json_extract_string(${P}, '$.im_msg_info.content.content_value') AS content,
                json_extract_string(${P}, '$.im_msg_info.message_type') AS mtype,
                json_extract_string(${P}, '$.violation') AS violation,
                json_extract_string(${P}, '$.violation_word') AS violation_word,
                json_extract_string(${U}, '$.nickname') AS nickname,
                json_extract_string(${U}, '$.country') AS country,
                json_extract_string(${U}, '$.gender') AS gender,
                CONCAT('', CAST(event_created_time AS STRING)) AS t
         FROM e_immsg
         WHERE account_id = ?
           AND json_extract_string(${P}, '$.target_id') = ?
           AND event_created_time >= DATE_SUB(NOW(), INTERVAL ? DAY)

         UNION ALL

         SELECT account_id AS sender,
                json_extract_string(${P}, '$.target_id') AS target_id,
                json_extract_string(${P}, '$.im_msg_info.content.content_value') AS content,
                json_extract_string(${P}, '$.im_msg_info.message_type') AS mtype,
                json_extract_string(${P}, '$.violation') AS violation,
                json_extract_string(${P}, '$.violation_word') AS violation_word,
                json_extract_string(${U}, '$.nickname') AS nickname,
                json_extract_string(${U}, '$.country') AS country,
                json_extract_string(${U}, '$.gender') AS gender,
                CONCAT('', CAST(event_created_time AS STRING)) AS t
         FROM e_immsg
         WHERE account_id = ?
           AND json_extract_string(${P}, '$.target_id') = ?
           AND event_created_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ) chat_pair
       ORDER BY t ASC
       LIMIT 8000`,
      [inviterId, peerId, days, peerId, inviterId, days]
    );

    const peer = { peerId, nickname: '', country: '', gender: '' };
    const messages: Array<{ dir: 'out' | 'in'; text: string; kind: string; imageUrl?: string; violation: string | 0; time: string }> = [];
    for (const r of rows) {
      const sender = String(r.sender ?? '');
      const target = String(r.target_id ?? '');
      const isOut = sender === inviterId && target === peerId;
      const isIn = sender === peerId && target === inviterId;
      const rendered = renderMsg(r.content, r.mtype);
      messages.push({
        dir: isOut ? 'out' : 'in',
        text: rendered.text,
        kind: rendered.kind,
        imageUrl: rendered.imageUrl,
        violation: String(r.violation ?? '') === '1' ? (r.violation_word || '违规') : 0,
        time: String(r.t ?? '')
      });
      if (isIn && !peer.nickname) {
        peer.nickname = r.nickname ?? '';
        peer.country = r.country ?? '';
        peer.gender = r.gender ?? '';
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

function renderMsg(content: any, mtype: any): { text: string; kind: string; imageUrl?: string } {
  const type = String(mtype ?? '');
  const c = String(content ?? '');
  // 礼物
  if (type === '6') {
    let t = '🎁 [礼物]';
    try { const g = JSON.parse(c); t = `🎁 ${g?.name ?? '礼物'} ×${g?.num ?? 1}`; } catch { /* keep */ }
    return { text: t, kind: 'gift' };
  }
  // 图片：content_value 是直链 URL（type 1/2）
  if (type === '1' || type === '2') {
    const imageUrl = extractImageUrl(c);
    if (imageUrl) return { text: '【图片】', kind: 'image', imageUrl };
    return { text: '【图片】', kind: 'image' };
  }
  // type 0/12 等都是普通文本
  if (!c) return { text: type && type !== '0' && type !== '12' ? `[消息类型 ${type}]` : '', kind: 'other' };
  if (/^\{.*\}$/.test(c.trim())) return { text: '[系统/互动消息]', kind: 'other' };
  return { text: c, kind: 'text' };
}

function extractImageUrl(raw: string): string | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text;

  try {
    const parsed = JSON.parse(text);
    const candidates = [
      parsed?.url,
      parsed?.src,
      parsed?.image,
      parsed?.imageUrl,
      parsed?.originUrl,
      parsed?.origin_url,
      parsed?.downloadUrl,
      parsed?.download_url,
      parsed?.fileUrl,
      parsed?.file_url,
      parsed?.contentUrl,
      parsed?.content_url,
      parsed?.data?.url,
      parsed?.data?.src,
      parsed?.data?.origin_url,
      parsed?.data?.download_url,
      parsed?.data?.file_url
    ];
    const match = candidates.find((item) => /^https?:\/\//i.test(String(item ?? '').trim()));
    return match ? String(match).trim() : undefined;
  } catch {
    return undefined;
  }
}
