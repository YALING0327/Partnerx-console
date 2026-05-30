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

export async function fetchAll<T = any>(query: any): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const allData: T[] = [];
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
