import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function run(label, query) {
  const { data, error } = await query;
  console.log(`\n[${label}]`);
  if (error) {
    console.log(error);
    return null;
  }
  console.log(JSON.stringify(data, null, 2));
  return data;
}

const target = '250194588';
const today = '2026-06-18';
const screenshotUserIds = ['251129411', '251126926', '251126174', '251117132', '251085805'];

function toBeijingUtcStart(ymd) {
  return new Date(`${ymd}T00:00:00+08:00`).toISOString();
}

async function fetchAll(query) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

await run(
  'employees.id',
  supabase
    .from('employees')
    .select('id, company_id, account_id, employee_name, invite_code, inviter_id, attribution_key, status, created_at')
    .eq('id', target)
);

await run(
  'employees.account_id',
  supabase
    .from('employees')
    .select('id, company_id, account_id, employee_name, invite_code, inviter_id, attribution_key, status, created_at')
    .eq('account_id', target)
);

await run(
  'employees.inviter_id',
  supabase
    .from('employees')
    .select('id, company_id, account_id, employee_name, invite_code, inviter_id, attribution_key, status, created_at')
    .eq('inviter_id', target)
);

await run(
  'company_accounts.id',
  supabase
    .from('company_accounts')
    .select('id, company_id, role, username, name, status, created_at')
    .eq('id', target)
);

const employeesByInviter = await run(
  'employees.by_inviter_id',
  supabase
    .from('employees')
    .select('id, company_id, account_id, employee_name, invite_code, inviter_id, attribution_key, status, created_at')
    .eq('inviter_id', target)
);

const employee = employeesByInviter?.[0];

if (employee) {
  await run(
    'company_accounts.by_account_id',
    supabase
      .from('company_accounts')
      .select('id, company_id, role, username, name, status, created_at')
      .eq('id', employee.account_id)
  );

  const allAttributions = await fetchAll(
    supabase
      .from('attribution_users')
      .select('company_id, employee_id, platform_user_id, invite_code, bind_time, bind_status')
      .eq('company_id', employee.company_id)
      .eq('employee_id', employee.id)
      .order('bind_time', { ascending: false })
  );
  console.log('\n[attribution_users.total]');
  console.log(JSON.stringify({
    count: allAttributions.length,
    byStatus: allAttributions.reduce((acc, item) => {
      const key = item.bind_status || 'null';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    latest: allAttributions.slice(0, 20)
  }, null, 2));

  const start = toBeijingUtcStart(today);
  const end = toBeijingUtcStart('2026-06-19');
  const todayAttributions = await fetchAll(
    supabase
      .from('attribution_users')
      .select('company_id, employee_id, platform_user_id, invite_code, bind_time, bind_status')
      .eq('company_id', employee.company_id)
      .eq('employee_id', employee.id)
      .gte('bind_time', start)
      .lt('bind_time', end)
      .order('bind_time', { ascending: false })
  );
  console.log('\n[attribution_users.today]');
  console.log(JSON.stringify({
    day: today,
    start,
    end,
    count: todayAttributions.length,
    rows: todayAttributions
  }, null, 2));

  const screenshotAttributions = await fetchAll(
    supabase
      .from('attribution_users')
      .select('company_id, employee_id, platform_user_id, invite_code, bind_time, bind_status')
      .in('platform_user_id', screenshotUserIds)
      .order('bind_time', { ascending: false })
  );
  console.log('\n[screenshot_user_attributions]');
  console.log(JSON.stringify(screenshotAttributions, null, 2));

  const screenshotRecharges = await fetchAll(
    supabase
      .from('recharge_orders')
      .select('company_id, employee_id, platform_user_id, order_no, amount, pay_time, status')
      .in('platform_user_id', screenshotUserIds)
      .order('pay_time', { ascending: false })
  );
  console.log('\n[screenshot_user_recharges]');
  console.log(JSON.stringify(screenshotRecharges, null, 2));

  const companyEmployees = await fetchAll(
    supabase
      .from('employees')
      .select('id, employee_name, invite_code, inviter_id, attribution_key, account_id, status')
      .eq('company_id', employee.company_id)
      .order('created_at', { ascending: true })
  );
  console.log('\n[company_employees]');
  console.log(JSON.stringify(companyEmployees, null, 2));
}
