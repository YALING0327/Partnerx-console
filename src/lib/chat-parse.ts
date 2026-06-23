// 解析 e_immsg.properties(variant JSON 字符串) 为可展示的消息对象。

export type ParsedMsg = {
  sender: string;
  target: string;
  text: string;
  kind: 'text' | 'gift' | 'image' | 'other';
  violation: string | 0;
  sendTime: string | null;
};

export function parseImMsg(propsStr: string): ParsedMsg | null {
  let p: any;
  try { p = JSON.parse(propsStr); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  const info = p.im_msg_info || {};
  const type = info.message_type;
  let raw = info?.content?.content_value ?? '';
  let kind: ParsedMsg['kind'] = 'text';
  let text = String(raw ?? '');

  if (type === 6) {
    kind = 'gift';
    try {
      const g = JSON.parse(text);
      text = `🎁 ${g?.name ?? '礼物'} ×${g?.num ?? 1}${g?.price ? ` (${g.price})` : ''}`;
    } catch { text = '🎁 [礼物]'; }
  } else if (type === 1 || type === 2) {
    // 1/2 常见为图片/媒体类
    kind = 'image';
    text = '[图片]';
  } else if (type !== 0 && type !== undefined) {
    kind = 'other';
    // 残留的系统 JSON（如 {"type":1}）转成占位
    if (typeof text === 'string' && /^\{.*\}$/.test(text.trim())) {
      text = '[系统/互动消息]';
    } else if (!text) {
      text = `[消息类型 ${type}]`;
    }
  } else {
    // 文本：偶尔 content_value 也会是 {"type":..} 这种非文本
    if (typeof text === 'string' && /^\{.*\}$/.test(text.trim())) {
      try {
        const o = JSON.parse(text);
        if (o && o.type !== undefined && Object.keys(o).length <= 2) { kind = 'other'; text = '[系统/互动消息]'; }
      } catch { /* keep as text */ }
    }
  }

  return {
    sender: String(p.account_id ?? ''),
    target: String(p.target_id ?? ''),
    text,
    kind,
    violation: p.violation === 1 ? (p.violation_word || '违规') : 0,
    sendTime: p.send_time || null
  };
}
