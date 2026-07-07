import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseServer, fetchAll } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEADPULSE_COMPANY_ID = process.env.LEADPULSE_COMPANY_ID || 'd542e5ce-ed3c-4416-bd43-282152d2ef09';
const FEISHU_WEBHOOK =
  process.env.FEISHU_LEADPULSE_WEBHOOK ||
  'https://open.feishu.cn/open-apis/bot/v2/hook/1f54818f-68f4-4530-b9ce-c97d32ff45b7';
const FEISHU_SECRET = process.env.FEISHU_LEADPULSE_SECRET || '1kcMh0S8MKYSyb2ycV9xog';

type AttrRow = { employee_id: string; platform_user_id: string; bind_time: string };
type RechargeRow = { employee_id: string; platform_user_id: string; amount: number; status: string };
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
  // 注意：SelectDB 用北京时间(UTC+8)，同步脚本把「北京墙上时间」当成 UTC 存成了带 Z 的字符串，
  // 所以库里的 bind_time/pay_time 实际是北京墙上时间(尾巴写了Z)。按北京自然日过滤时边界要用同一约定：
  // 直接取该日 00:00 的 Z 串，不能再 +08:00，否则会二次偏移 8 小时。
  return `${normalizeYmd(ymd)}T00:00:00.000Z`;
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
  const allEmployees = (employeeRows as EmployeeRow[] | null ?? []);
  const nameById = new Map<string, string>(allEmployees.map((e) => [e.id, e.employee_name]));
  const activeEmployeeIds = allEmployees.filter((e) => e.status === 'active').map((e) => e.id);

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

  // 充值：以「老板端」口径为准——直接读 recharge_orders 全量成功订单（未扣手续费、无60天窗口），
  // pay_time 落在区间内。区别于员工端(income_dollar，近60天且扣费)。
  const recharges = await fetchAll<RechargeRow>(
    supabaseServer
      .from('recharge_orders')
      .select('employee_id, platform_user_id, amount, status')
      .eq('company_id', LEADPULSE_COMPANY_ID)
      .gte('pay_time', toBeijingUtcStart(startYmd))
      .lt('pay_time', toBeijingUtcStart(addDaysYmd(endYmd, 1)))
  );

  const paidByEmployee = new Map<string, Set<string>>();
  const amountByEmployee = new Map<string, number>();
  for (const r of recharges) {
    if (r.status !== 'success') continue;
    let set = paidByEmployee.get(r.employee_id);
    if (!set) paidByEmployee.set(r.employee_id, (set = new Set()));
    set.add(r.platform_user_id);
    amountByEmployee.set(r.employee_id, (amountByEmployee.get(r.employee_id) ?? 0) + Number(r.amount || 0));
  }

  // 列出全部在职员工（含当期零数据者），再并入任何有数据但已停用的员工，保证合计对得上。
  const employeeIds = new Set<string>([
    ...activeEmployeeIds,
    ...newByEmployee.keys(),
    ...paidByEmployee.keys()
  ]);
  const employees: EmployeeStat[] = Array.from(employeeIds).map((id) => ({
    employeeId: id,
    name: nameById.get(id) ?? '未知员工',
    newUsers: newByEmployee.get(id)?.size ?? 0,
    paidUsers: paidByEmployee.get(id)?.size ?? 0,
    amountCents: amountByEmployee.get(id) ?? 0
  }));

  employees.sort(
    (a, b) =>
      b.amountCents - a.amountCents ||
      b.newUsers - a.newUsers ||
      b.paidUsers - a.paidUsers ||
      a.name.localeCompare(b.name)
  );

  const totalNew = employees.reduce((s, e) => s + e.newUsers, 0);
  const totalPaid = employees.reduce((s, e) => s + e.paidUsers, 0);
  const totalCents = employees.reduce((s, e) => s + e.amountCents, 0);

  return { employees, totalNew, totalPaid, totalCents };
}

// 计数环比：🔺+N / 🔻-N / ➖
function deltaCount(cur: number, prev: number) {
  const d = cur - prev;
  if (d > 0) return ` 🔺${d}`;
  if (d < 0) return ` 🔻${-d}`;
  return ' ➖';
}

// 金额环比（分）：🔺+$X / 🔻-$X / ➖
function deltaUsd(curCents: number, prevCents: number) {
  const d = curCents - prevCents;
  if (d > 0) return ` 🔺$${fmtUsd(d)}`;
  if (d < 0) return ` 🔻$${fmtUsd(-d)}`;
  return ' ➖';
}

function buildCard(params: {
  mode: 'daily' | 'weekly';
  rangeLabel: string;
  stats: Awaited<ReturnType<typeof computeRangeStats>>;
  prev: Awaited<ReturnType<typeof computeRangeStats>>;
}) {
  const { mode, rangeLabel, stats, prev } = params;
  const isWeekly = mode === 'weekly';
  const compareLabel = isWeekly ? '上周' : '前一天';
  const title = isWeekly ? `🏆 LeadPulse 上周汇总 · ${rangeLabel}` : `📊 LeadPulse 每日战报 · ${rangeLabel}`;

  const prevById = new Map(prev.employees.map((e) => [e.employeeId, e]));

  const summary =
    `**合计**　拉新 **${stats.totalNew}**${deltaCount(stats.totalNew, prev.totalNew)}　·　` +
    `付费 **${stats.totalPaid}**${deltaCount(stats.totalPaid, prev.totalPaid)}　·　` +
    `充值 **$${fmtUsd(stats.totalCents)}**${deltaUsd(stats.totalCents, prev.totalCents)}`;

  const medals = ['🥇', '🥈', '🥉'];
  const lines =
    stats.employees.length === 0
      ? '_本区间暂无员工数据_'
      : stats.employees
          .map((e, i) => {
            const hasActivity = e.newUsers > 0 || e.paidUsers > 0 || e.amountCents > 0;
            const rank = hasActivity && i < 3 ? medals[i] : `**${i + 1}.**`;
            const p = prevById.get(e.employeeId);
            const prevAmount = p?.amountCents ?? 0;
            const amtDelta = e.amountCents === 0 && prevAmount === 0 ? '' : deltaUsd(e.amountCents, prevAmount);
            return `${rank} ${e.name}　拉新 ${e.newUsers} · 付费 ${e.paidUsers} · $${fmtUsd(e.amountCents)}${amtDelta}`;
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
        elements: [{ tag: 'plain_text', content: `北京时间 ${rangeLabel}　·　环比${compareLabel}（🔺升 🔻降）` }]
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
    let prevStartYmd: string;
    let prevEndYmd: string;
    let rangeLabel: string;
    if (mode === 'weekly') {
      const thisMonday = mondayOf(refYmd);
      startYmd = addDaysYmd(thisMonday, -7); // 上周一
      endYmd = addDaysYmd(thisMonday, -1); // 上周日
      prevStartYmd = addDaysYmd(startYmd, -7); // 上上周一
      prevEndYmd = addDaysYmd(endYmd, -7); // 上上周日
      rangeLabel = `${startYmd} ~ ${endYmd}`;
    } else {
      startYmd = addDaysYmd(refYmd, -1); // 前一天
      endYmd = startYmd;
      prevStartYmd = addDaysYmd(startYmd, -1); // 前两天
      prevEndYmd = prevStartYmd;
      rangeLabel = startYmd;
    }

    const [stats, prev] = await Promise.all([
      computeRangeStats(startYmd, endYmd),
      computeRangeStats(prevStartYmd, prevEndYmd)
    ]);
    const card = buildCard({ mode, rangeLabel, stats, prev });

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, mode, startYmd, endYmd, stats, prev, card });
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
