import { fetchAll, supabaseServer } from './src/lib/supabase-server';

type RechargeRow = {
  employee_id: string;
  platform_user_id: string;
  amount: number;
  pay_time: string;
  status: string;
};

async function run() {
  let rechargeQuery = supabaseServer
    .from('recharge_orders')
    .select('employee_id, platform_user_id, amount, pay_time, status')
    .eq('company_id', '00000000-0000-0000-0000-000000000001');

  const recharges = await fetchAll<RechargeRow>(rechargeQuery.order('pay_time', { ascending: false }));
  console.log('Total recharges fetched:', recharges.length);
  
  const success = recharges.filter((r) => r.status === 'success');
  console.log('Success recharges:', success.length);
}
void run();
