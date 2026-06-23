import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

async function run() {
  const empId = '20f2a9f7-5b08-4935-817d-4e42afba9e3a'; // lzp
  
  let attributionQuery = supabase
    .from('attribution_users')
    .select('platform_user_id, invite_code')
    .eq('employee_id', empId);

  let rechargeQuery = supabase
    .from('recharge_orders')
    .select('platform_user_id, amount, status')
    .eq('employee_id', empId);

  const attributions = await fetchAll(attributionQuery);
  const recharges = await fetchAll(rechargeQuery);

  const validUserIds = new Set(attributions.map(a => String(a.platform_user_id)));
  const successRecharges = recharges.filter(r => r.status === 'success');
  
  console.log('Total attributions for lzp:', validUserIds.size);
  console.log('Total success recharges for lzp:', successRecharges.length);
  
  const validRecharges = successRecharges.filter(r => validUserIds.has(String(r.platform_user_id)));
  console.log('Success recharges that match an attribution:', validRecharges.length);
  
  const invalidRecharges = successRecharges.filter(r => !validUserIds.has(String(r.platform_user_id)));
  console.log('Success recharges that DO NOT match an attribution:', invalidRecharges.length);
  
  const sumValid = validRecharges.reduce((acc, c) => acc + c.amount, 0);
  const sumInvalid = invalidRecharges.reduce((acc, c) => acc + c.amount, 0);
  console.log('Sum valid:', sumValid);
  console.log('Sum invalid:', sumInvalid);
  console.log('Total sum:', sumValid + sumInvalid);
}
run();