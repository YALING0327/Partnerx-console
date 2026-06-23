import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase.from('recharge_orders').select('employee_id, platform_user_id, status, amount');
  const valid = data.filter(d => d.status === 'success');
  console.log('Total orders:', data.length);
  console.log('Success orders:', valid.length);
  console.log('Success sum:', valid.reduce((acc, c) => acc + c.amount, 0));
}
check();
