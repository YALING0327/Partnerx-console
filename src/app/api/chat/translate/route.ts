import { NextResponse } from 'next/server';
import { authenticate, type ChatAuthBody } from '@/lib/chat-auth';

type Body = ChatAuthBody & { texts?: string[]; target?: string };

// 用免费的 Google 翻译公共端点（无需 key）批量翻译为目标语言（默认中文）。
// 注意：非官方接口，量大可能不稳；失败时该条返回原文。
async function translateOne(text: string, target: string): Promise<string> {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(t)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return text;
    const data = await res.json();
    // data[0] 是分段数组，每段 [译文, 原文, ...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((seg: any) => (Array.isArray(seg) ? seg[0] : '')).join('');
    }
    return text;
  } catch {
    return text;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const auth = await authenticate(body, { requireBoss: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const texts = Array.isArray(body.texts) ? body.texts.slice(0, 200) : [];
    const target = String(body.target || 'zh-CN');
    if (texts.length === 0) return NextResponse.json({ translations: [] });

    // 适度并发，避免被限流
    const out: string[] = new Array(texts.length).fill('');
    const concurrency = 6;
    let idx = 0;
    async function worker() {
      while (idx < texts.length) {
        const i = idx++;
        out[i] = await translateOne(texts[i], target);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()));

    return NextResponse.json({ translations: out });
  } catch (error) {
    console.error('chat/translate 异常', error);
    return NextResponse.json({ error: '翻译失败' }, { status: 500 });
  }
}
