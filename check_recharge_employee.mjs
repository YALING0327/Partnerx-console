import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase.from('recharge_orders').select('employee_id, platform_user_id, status, amount').limit(10);
  console.log('Sample recharges:', data);
  
  const { data: employees } = await supabase.from('employees').select('id, invite_code');
  console.log('Employees:', employees);
}
check();
