import { langLocale, type Lang } from '@/lib/i18n';

export function fmt(value: number, lang: Lang) {
  const dollars = (Number(value || 0) || 0) / 100;
  return new Intl.NumberFormat(langLocale(lang), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(dollars);
}

export function platformLabel(p: 'android' | 'ios' | 'unknown' | undefined, lang: Lang) {
  if (p === 'android') return lang === 'zh' ? '🤖 安卓' : '🤖 Android';
  if (p === 'ios') return lang === 'zh' ? '🍎 苹果' : '🍎 iOS';
  return '—';
}

export function fmtDate(value: string | null) {
  if (!value) return '-';
  const raw = String(value).trim();
  return raw
    .replace('T', ' ')
    .replace(/\.\d+/, '')
    .replace(/(?:Z|[+-]\d{2}:\d{2})$/, '')
    .replace(/-/g, '/');
}

export function formatLastSyncTime(value: string | null, lang: Lang) {
  if (!value) return lang === 'zh' ? '暂无' : 'N/A';
  return fmtDate(value);
}

// 北京时区今天的 YYYY-MM-DD
export function beijingTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 最近 N 天（含今天）的北京时区日期范围
export function recentRangeYmd(days: number): { start: string; end: string } {
  const end = beijingTodayYmd();
  const start = addDaysYmd(end, -(Math.max(days, 1) - 1));
  return { start, end };
}

export function genderText(g: string, lang: Lang) {
  if (g === '1') return lang === 'zh' ? '男' : 'M';
  if (g === '2') return lang === 'zh' ? '女' : 'F';
  return '-';
}

export function exportCsv(filename: string, rows: string[][], headers: string[]) {
  // 给形似日期/长数字的单元格加 \t，强制 Excel 按文本处理，避免 ##### 或科学计数法
  const formatCell = (c: string) => {
    const str = String(c).replace(/"/g, '""');
    if (str.includes(':') || str.includes('/') || str.includes('-') || (str.length > 8 && /^\d+$/.test(str))) {
      return `"\t${str}"`;
    }
    return `"${str}"`;
  };

  const lines = [headers.map(formatCell), ...rows.map((r) => r.map(formatCell))].map((r) => r.join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 统一的 POST JSON 请求：识别非 JSON 响应（如网关返回的 HTML 错误页）并给出可读错误
export async function postJson<T = any>(url: string, body: unknown, retryCount = 1): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  const looksLikeHtml = /^\s*</.test(text);

  if ((!contentType.includes('application/json') || looksLikeHtml) && retryCount > 0) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return postJson(url, body, retryCount - 1);
  }

  if (!contentType.includes('application/json') || looksLikeHtml) {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new Error(`接口返回了非 JSON 响应：${snippet || '空响应'}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new Error(`接口 JSON 解析失败：${snippet || '空响应'}`);
  }
}
