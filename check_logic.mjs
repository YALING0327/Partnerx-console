import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey);

async function fetchAll(query) {
  const pageSize = 1000;
  let from = 0;
  const allData = [];
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await query.range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

function buildSummary(attributions, recharges) {
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
  let rechargeQuery = supabaseServer
    .from('recharge_orders')
    .select('employee_id, platform_user_id, amount, pay_time, status')
    .eq('company_id', companyId);

  let attributionQuery = supabaseServer
    .from('attribution_users')
    .select('employee_id, platform_user_id, invite_code, bind_time')
    .eq('company_id', companyId);

  const attributions = await fetchAll(attributionQuery.order('bind_time', { ascending: false }));
  const recharges = await fetchAll(rechargeQuery.order('pay_time', { ascending: false }));

  console.log('Attributions:', attributions.length);
  console.log('Recharges:', recharges.length);

  const validUserIds = new Set(attributions.map(a => a.platform_user_id));
  const filteredRecharges = false // simulate hasDateFilter = false
    ? recharges.filter(r => validUserIds.has(r.platform_user_id))
    : recharges;

  const summary = buildSummary(attributions, filteredRecharges);
  console.log('Global Summary:', summary);
  
  // now by employee
  const { data: employees } = await supabaseServer.from('employees').select('id, employee_name').eq('company_id', companyId);
  for (const emp of employees) {
    const eAttr = attributions.filter(a => a.employee_id === emp.id);
    const eRech = filteredRecharges.filter(r => r.employee_id === emp.id);
    console.log(`Employee ${emp.employee_name} (${emp.id}):`, buildSummary(eAttr, eRech));
  }
}
run();
