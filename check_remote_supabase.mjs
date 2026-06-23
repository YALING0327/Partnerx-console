import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase.from('recharge_orders').select('status, amount').limit(100);
  console.log('Unique statuses in Supabase:', [...new Set(data?.map(d => d.status))]);
  console.log('Sample amounts:', data.slice(0, 5).map(d => d.amount));
  
  const { data: sumData } = await supabase.from('recharge_orders').select('amount').eq('status', 'success');
  const sum = sumData?.reduce((acc, curr) => acc + curr.amount, 0);
  console.log('Total amount of success orders:', sum);
}
check();
