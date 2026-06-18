import { fetchAll, supabaseServer } from './src/lib/supabase-server';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

type AttributionRow = {
  employee_id: string;
  platform_user_id: string;
  invite_code: string;
  bind_time: string;
};

type RechargeRow = {
  employee_id: string;
  platform_user_id: string;
  amount: number;
  pay_time: string;
  status: string;
};

type EmployeeRow = {
  id: string;
  employee_name: string;
};

function buildSummary(attributions: AttributionRow[], recharges: RechargeRow[]) {
  const attributedUserIds = new Set(attributions.map((item) => item.platform_user_id));
  const paidUserIds = new Set(
    recharges.filter((item) => item.status === 'success').map((item) => item.platform_user_id)
  );
  const totalAmount = recharges
    .filter((item) => item.status === 'success')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    newUsers: attributedUserIds.size,
    paidUsers: paidUserIds.size,
    totalAmount,
    arppu: paidUserIds.size > 0 ? totalAmount / paidUserIds.size : 0
  };
}

async function run() {
  const companyId = '00000000-0000-0000-0000-000000000001';

  const rechargeQuery = supabaseServer
    .from('recharge_orders')
    .select('employee_id, platform_user_id, amount, pay_time, status')
    .eq('company_id', companyId);

  const attributionQuery = supabaseServer
    .from('attribution_users')
    .select('employee_id, platform_user_id, invite_code, bind_time')
    .eq('company_id', companyId);

  const attributions = await fetchAll<AttributionRow>(attributionQuery.order('bind_time', { ascending: false }));
  const recharges = await fetchAll<RechargeRow>(rechargeQuery.order('pay_time', { ascending: false }));

  console.log('Attributions:', attributions.length);
  console.log('Recharges:', recharges.length);

  const filteredRecharges = recharges;
  const summary = buildSummary(attributions, filteredRecharges);
  console.log('Global Summary:', summary);

  const { data: employees } = await supabaseServer
    .from('employees')
    .select('id, employee_name')
    .eq('company_id', companyId);

  for (const emp of ((employees ?? []) as EmployeeRow[])) {
    const employeeAttributions = attributions.filter((item) => item.employee_id === emp.id);
    const employeeRecharges = filteredRecharges.filter((item) => item.employee_id === emp.id);
    console.log(`Employee ${emp.employee_name} (${emp.id}):`, buildSummary(employeeAttributions, employeeRecharges));
  }
}

void run();
