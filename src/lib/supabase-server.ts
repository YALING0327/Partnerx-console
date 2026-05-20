import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL 环境变量');
}

if (!supabaseServiceRoleKey) {
  throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY 环境变量');
}

export const supabaseServer = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
