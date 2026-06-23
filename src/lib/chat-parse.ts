// 解析 e_immsg.properties(variant JSON 字符串) 为可展示的消息对象。

export type ParsedMsg = {
  sender: string;
  target: string;
  text: string;
  kind: 'text' | 'gift' | 'image' | 'other';
  violation: string | 0;
  sendTime: string | null;
};

// 安全解析可能是字符串或已被 mysql2 自动解析成对象的 JSON 列
export function safeJson(v: string | object | null | undefined): any {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}

export function parseImMsg(props: string | object): ParsedMsg | null {
  let p: any;
  if (props && typeof props === 'object') {
    p = props; // mysql2 对 JSON 列可能已自动解析成对象
  } else {
    try { p = JSON.parse(String(props)); } catch { return null; }
  }
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
