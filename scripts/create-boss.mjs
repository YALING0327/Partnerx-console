import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createBoss() {
  const username = process.argv[2];
  const password = process.argv[3];
  const name = process.argv[4] || '老板';
  
  if (!username || !password) {
    console.log("❌ 缺少参数！");
    console.log("👉 使用方法: node scripts/create-boss.mjs <登录账号> <登录密码> [老板姓名]");
    console.log("👉 示例: node scripts/create-boss.mjs admin123 888888 李总");
    process.exit(1);
  }

  // 获取现有的 company_id (默认使用 00000000-0000-0000-0000-000000000001)
  const companyId = '00000000-0000-0000-0000-000000000001';

  // 检查账号是否已存在
  const { data: existing } = await supabase
    .from('company_accounts')
    .select('id')
    .eq('username', username)
    .single();

  if (existing) {
    console.error(`❌ 账号 "${username}" 已存在，请换一个账号名。`);
    process.exit(1);
  }

  // 插入新的老板账号
  const { data, error } = await supabase.from('company_accounts').insert({
    company_id: companyId,
    role: 'boss',
    username: username,
    password_hash: password,
    name: name,
    status: 'active'
  }).select('username, name, role').single();

  if (error) {
    console.error("❌ 创建失败:", error.message);
  } else {
    console.log("✅ 老板账号创建成功！");
    console.log("-----------------------");
    console.log(`姓名: ${data.name}`);
    console.log(`账号: ${data.username}`);
    console.log(`密码: ${password}`);
    console.log(`权限: ${data.role}`);
    console.log("-----------------------");
    console.log("现在你可以使用这个账号登录控制台了。");
  }
}

createBoss();
