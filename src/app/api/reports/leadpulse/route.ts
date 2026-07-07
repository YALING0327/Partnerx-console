import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseServer, fetchAll } from '@/lib/supabase-server';
import { buildLeadPulseIncomeRecharges } from '@/lib/leadpulse-income';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEADPULSE_COMPANY_ID = process.env.LEADPULSE_COMPANY_ID || 'd542e5ce-ed3c-4416-bd43-282152d2ef09';
const FEISHU_WEBHOOK =
  process.env.FEISHU_LEADPULSE_WEBHOOK ||
  'https://open.feishu.cn/open-apis/bot/v2/hook/1f54818f-68f4-4530-b9ce-c97d32ff45b7';
const FEISHU_SECRET = process.env.FEISHU_LEADPULSE_SECRET || '1kcMh0S8MKYSyb2ycV9xog';

type AttrRow = { employee_id: string; platform_user_id: string; bind_time: string };
type EmployeeRow = { id: string; employee_name: string; status: string };

type EmployeeStat = {
  employeeId: string;
  name: string;
  newUsers: number;
  paidUsers: number;
  amountCents: number;
};

function normalizeYmd(value?: string) {
  return String(value ?? '').trim().replace(/\//g, '-');
}

function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = normalizeYmd(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function beijingTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

// 返回 ymd 所在自然周的周一（北京时区语义，用 UTC 正午避开时区误差）
function mondayOf(ymd: string) {
  const [y, m, d] = normalizeYmd(ymd).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日
  const back = (dow + 6) % 7; // 距离本周一的天数
  return addDaysYmd(ymd, -back);
}

function toBeijingUtcStart(ymd: string) {
  return new Date(`${normalizeYmd(ymd)}T00:00:00+08:00`).toISOString();
}

function feishuSign(secret: string, timestampSec: number) {
  const stringToSign = `${timestampSec}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
}

function fmtUsd(cents: number) {
  const usd = cents / 100;
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function computeRangeStats(startYmd: string, endYmd: string): Promise<{
  employees: EmployeeStat[];
  totalNew: number;
  totalPaid: number;
  totalCents: number;
}> {
  const { data: employeeRows } = await supabaseServer
    .from('employees')
    .select('id, employee_name, status')
    .eq('company_id', LEADPULSE_COMPANY_ID);
  const nameById = new Map<string, string>(
    (employeeRows as EmployeeRow[] | null ?? []).map((e) => [e.id, e.employee_name])
  );

  // 拉新：bind_time 落在 [start, end] 当日区间（北京时区）
  const newAttrs = await fetchAll<AttrRow>(
    supabaseServer
      .from('attribution_users')
      .select('employee_id, platform_user_id, bind_time')
      .eq('company_id', LEADPULSE_COMPANY_ID)
      .gte('bind_time', toBeijingUtcStart(startYmd))
      .lt('bind_time', toBeijingUtcStart(addDaysYmd(endYmd, 1)))
  );

  const newByEmployee = new Map<string, Set<string>>();
  for (const row of newAttrs) {
    let set = newByEmployee.get(row.employee_id);
    if (!set) newByEmployee.set(row.employee_id, (set = new Set()));
    set.add(row.platform_user_id);
  }

  // 充值：候选用户 = 绑定时间在 (start-2个月 ~ end] 内的用户（只有其绑定后 2 个月窗口才可能覆盖本区间）
  const candidateAttrs = await fetchAll<AttrRow>(
    supabaseServer
      .from('attribution_users')
      .select('employee_id, platform_user_id, bind_time')
      .eq('company_id', LEADPULSE_COMPANY_ID)
      .gte('bind_time', toBeijingUtcStart(addDaysYmd(startYmd, -70)))
      .lt('bind_time', toBeijingUtcStart(addDaysYmd(endYmd, 1)))
  );

  const recharges = await buildLeadPulseIncomeRecharges(candidateAttrs, {
    payStartIso: toBeijingUtcStart(startYmd),
    payEndIso: toBeijingUtcStart(addDaysYmd(endYmd, 1))
  });

  const paidByEmployee = new Map<string, Set<string>>();
  const amountByEmployee = new Map<string, number>();
  for (const r of recharges) {
    let set = paidByEmployee.get(r.employee_id);
    if (!set) paidByEmployee.set(r.employee_id, (set = new Set()));
    set.add(r.platform_user_id);
    amountByEmployee.set(r.employee_id, (amountByEmployee.get(r.employee_id) ?? 0) + Number(r.amount || 0));
  }

  const employeeIds = new Set<string>([...newByEmployee.keys(), ...paidByEmployee.keys()]);
  const employees: EmployeeStat[] = Array.from(employeeIds).map((id) => ({
    employeeId: id,
    name: nameById.get(id) ?? '未知员工',
    newUsers: newByEmployee.get(id)?.size ?? 0,
    paidUsers: paidByEmployee.get(id)?.size ?? 0,
    amountCents: amountByEmployee.get(id) ?? 0
  }));

  employees.sort((a, b) => b.amountCents - a.amountCents || b.newUsers - a.newUsers);

  const totalNew = employees.reduce((s, e) => s + e.newUsers, 0);
  const totalPaid = employees.reduce((s, e) => s + e.paidUsers, 0);
  const totalCents = employees.reduce((s, e) => s + e.amountCents, 0);

  return { employees, totalNew, totalPaid, totalCents };
}

function buildCard(params: {
  mode: 'daily' | 'weekly';
  rangeLabel: string;
  stats: Awaited<ReturnType<typeof computeRangeStats>>;
}) {
  const { mode, rangeLabel, stats } = params;
  const isWeekly = mode === 'weekly';
  const title = isWeekly ? `🏆 LeadPulse 上周汇总 · ${rangeLabel}` : `📊 LeadPulse 每日战报 · ${rangeLabel}`;

  const summary =
    `**合计**　拉新 **${stats.totalNew}** 人　·　付费 **${stats.totalPaid}** 人　·　充值 **$${fmtUsd(stats.totalCents)}**`;

  const medals = ['🥇', '🥈', '🥉'];
  const lines =
    stats.employees.length === 0
      ? '_本区间暂无拉新与充值数据_'
      : stats.employees
          .map((e, i) => {
            const rank = medals[i] ?? `**${i + 1}.**`;
            return `${rank} ${e.name}　拉新 ${e.newUsers} · 付费 ${e.paidUsers} · $${fmtUsd(e.amountCents)}`;
          })
          .join('\n');

  return {
    config: { wide_screen_mode: true },
    header: {
      template: isWeekly ? 'orange' : 'blue',
      title: { tag: 'plain_text', content: title }
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: summary } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: lines } },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `口径：北京时间 ${rangeLabel}｜充值按 income_dollar 且绑定后2个月内计`
          }
        ]
      }
    ]
  };
}

async function sendToFeishu(card: unknown) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = feishuSign(FEISHU_SECRET, timestamp);
  const res = await fetch(FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp: String(timestamp), sign, msg_type: 'interactive', card })
  });
  const data = await res.json().catch(() => ({}));
  return { httpOk: res.ok, data };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') ?? '';
    const mode = (url.searchParams.get('mode') === 'weekly' ? 'weekly' : 'daily') as 'daily' | 'weekly';
    const dryRun = url.searchParams.get('dryRun') === '1';
    const refYmd = normalizeYmd(url.searchParams.get('date') || '') || beijingTodayYmd();

    const triggerSecret = process.env.REPORT_TRIGGER_SECRET;
    if (!triggerSecret) {
      return NextResponse.json({ error: '服务端未配置 REPORT_TRIGGER_SECRET' }, { status: 500 });
    }
    if (token !== triggerSecret) {
      return NextResponse.json({ error: '无权触发' }, { status: 401 });
    }

    let startYmd: string;
    let endYmd: string;
    let rangeLabel: string;
    if (mode === 'weekly') {
      const thisMonday = mondayOf(refYmd);
      startYmd = addDaysYmd(thisMonday, -7); // 上周一
      endYmd = addDaysYmd(thisMonday, -1); // 上周日
      rangeLabel = `${startYmd} ~ ${endYmd}`;
    } else {
      startYmd = addDaysYmd(refYmd, -1); // 前一天
      endYmd = startYmd;
      rangeLabel = startYmd;
    }

    const stats = await computeRangeStats(startYmd, endYmd);
    const card = buildCard({ mode, rangeLabel, stats });

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, mode, startYmd, endYmd, stats, card });
    }

    const sent = await sendToFeishu(card);
    return NextResponse.json({
      ok: sent.httpOk && (sent.data?.code === 0 || sent.data?.StatusCode === 0),
      mode,
      startYmd,
      endYmd,
      totals: { new: stats.totalNew, paid: stats.totalPaid, amountUsd: fmtUsd(stats.totalCents) },
      feishu: sent.data
    });
  } catch (error) {
    console.error('LeadPulse 日报推送失败', error);
    return NextResponse.json({ error: '推送失败', detail: String(error) }, { status: 500 });
  }
}
