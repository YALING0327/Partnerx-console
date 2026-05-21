import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`时间字段格式不正确: ${value}`);
  }
  return time.toISOString();
}

function normalizeStatus(value) {
  const raw = String(value ?? '').toLowerCase();
  if (['success', 'paid', 'pay_success', 'completed', 'finish', 'finished', '1'].includes(raw)) {
    return 'success';
  }
  if (['failed', 'fail', '0', 'closed', 'cancel'].includes(raw)) {
    return 'failed';
  }
  return raw || 'unknown';
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';

  const supabase = createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  const registerSql = process.env.SELECTDB_ATTRIBUTION_SQL || required('SELECTDB_REGISTER_SQL');
  const rechargeSql = required('SELECTDB_RECHARGE_SQL');

  const connection = await mysql.createConnection({
    host: required('SELECTDB_HOST'),
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: required('SELECTDB_USER'),
    password: required('SELECTDB_PASSWORD'),
    database: required('SELECTDB_DATABASE')
  });

  try {
    console.log('开始读取 SelectDB 数据...');

    const [registerRowsRaw] = await connection.query(registerSql);
    const [rechargeRowsRaw] = await connection.query(rechargeSql);

    const registerRows = Array.isArray(registerRowsRaw) ? registerRowsRaw : [];
    const rechargeRows = Array.isArray(rechargeRowsRaw) ? rechargeRowsRaw : [];

    console.log(`邀请码归因记录: ${registerRows.length} 条`);
    console.log(`充值记录: ${rechargeRows.length} 条`);

    const inviteCodes = [...new Set(
      [...registerRows, ...rechargeRows]
        .map((item) => normalizeText(item.invite_code))
        .filter(Boolean)
    )];

    if (inviteCodes.length === 0) {
      throw new Error('归因查询没有返回邀请码字段，请检查 SELECTDB_ATTRIBUTION_SQL 或 SELECTDB_REGISTER_SQL 的别名是否正确');
    }

    const { data: employees, error: employeeError } = await supabase
      .from('employees')
      .select('id, company_id, invite_code')
      .in('invite_code', inviteCodes);

    if (employeeError) {
      throw employeeError;
    }

    const employeeByInviteCode = new Map(
      (employees ?? []).map((item) => [String(item.invite_code).trim(), item])
    );

    const attributionRows = [];
    for (const row of registerRows) {
      const inviteCode = normalizeText(row.invite_code);
      const platformUserId = normalizeText(row.platform_user_id);
      if (!inviteCode || !platformUserId) continue;

      const employee = employeeByInviteCode.get(inviteCode);
      if (!employee) continue;

      attributionRows.push({
        company_id: employee.company_id,
        employee_id: employee.id,
        platform_user_id: platformUserId,
        invite_code: inviteCode,
        bind_time: toIso(row.bind_time),
        bind_status: 'bound'
      });
    }

    const dedupAttributions = [...new Map(
      attributionRows.map((item) => [`${item.company_id}:${item.platform_user_id}`, item])
    ).values()];

    console.log(`命中本控制台邀请码的归因记录: ${dedupAttributions.length} 条`);

    if (!dryRun && dedupAttributions.length > 0) {
      const { error } = await supabase
        .from('attribution_users')
        .upsert(dedupAttributions, { onConflict: 'company_id,platform_user_id' });
      if (error) throw error;
    }

    const platformUserIds = [...new Set(dedupAttributions.map((item) => item.platform_user_id))];
    const attributionMap = new Map(
      dedupAttributions.map((item) => [String(item.platform_user_id), item])
    );

    if (platformUserIds.length > 0) {
      const { data: currentAttributions, error: attributionError } = await supabase
        .from('attribution_users')
        .select('company_id, employee_id, platform_user_id')
        .in('platform_user_id', platformUserIds);

      if (attributionError) {
        throw attributionError;
      }

      for (const item of currentAttributions ?? []) {
        attributionMap.set(String(item.platform_user_id), item);
      }
    }

    const firstPayTimeByUser = new Map();
    for (const row of rechargeRows) {
      const status = normalizeStatus(row.status);
      if (status !== 'success') continue;
      const userId = normalizeText(row.platform_user_id);
      if (!userId) continue;
      const payTime = toIso(row.pay_time);
      const existing = firstPayTimeByUser.get(userId);
      if (!existing || new Date(payTime).getTime() < new Date(existing).getTime()) {
        firstPayTimeByUser.set(userId, payTime);
      }
    }

    const rechargeUpserts = [];
    for (const row of rechargeRows) {
      const platformUserId = normalizeText(row.platform_user_id);
      const orderNo = normalizeText(row.order_no);
      const inviteCode = normalizeText(row.invite_code);
      if (!platformUserId || !orderNo) continue;

      const attribution = attributionMap.get(platformUserId);
      const employee = inviteCode ? employeeByInviteCode.get(inviteCode) : null;
      const companyId = attribution?.company_id ?? employee?.company_id;
      const employeeId = attribution?.employee_id ?? employee?.id;
      if (!companyId || !employeeId) continue;

      const payTime = toIso(row.pay_time);
      rechargeUpserts.push({
        company_id: companyId,
        employee_id: employeeId,
        platform_user_id: platformUserId,
        order_no: orderNo,
        amount: Number(row.amount ?? 0),
        status: normalizeStatus(row.status),
        pay_time: payTime,
        is_first_recharge: firstPayTimeByUser.get(platformUserId) === payTime
      });
    }

    console.log(`命中已归因用户的充值记录: ${rechargeUpserts.length} 条`);

    if (!dryRun && rechargeUpserts.length > 0) {
      const { error } = await supabase
        .from('recharge_orders')
        .upsert(rechargeUpserts, { onConflict: 'order_no' });
      if (error) throw error;
    }

    console.log(dryRun ? 'Dry Run 完成，没有写入 Supabase' : '同步完成，已写入 Supabase');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('SelectDB 同步失败');
  console.error(error);
  process.exit(1);
});
