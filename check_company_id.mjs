import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: recharges } = await supabase.from('recharge_orders').select('company_id').limit(10);
  console.log('Recharge company_ids:', [...new Set(recharges?.map(r => r.company_id))]);
  
  const { data: employees } = await supabase.from('employees').select('company_id, account_id, employee_name').limit(10);
  console.log('Employees:', employees);
}

check();
