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

async function check() {
  const { data: empData } = await supabase.from('employees').select('id, employee_name, invite_code');
  const empMap = new Map(empData.map(e => [e.id, e.employee_name]));
  
  const allOrders = await fetchAll(supabase.from('recharge_orders').select('employee_id, status'));
  const counts = {};
  for (const o of allOrders) {
    const name = empMap.get(o.employee_id);
    if (!counts[name]) counts[name] = {};
    if (!counts[name][o.status]) counts[name][o.status] = 0;
    counts[name][o.status]++;
  }
  console.log('Status counts by employee:', counts);
}
check();
