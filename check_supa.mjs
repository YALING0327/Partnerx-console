import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supabase.rpc('get_schema');
// or just query a row
const { data: row } = await supabase.from('attribution_users').select('*').limit(1);
console.log("attribution_users:", row);
