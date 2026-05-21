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

function normalizeInviteCode(value) {
  return normalizeText(value).toLowerCase();
}

function stripTrailingSemicolon(sql) {
  return String(sql ?? '').trim().replace(/;+\s*$/g, '');
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  const text = JSON.stringify(value, null, 2);
  fs.writeFileSync(filePath, text, 'utf8');
}

async function fetchAllEmployees(supabase) {
  const pageSize = 1000;
  const employees = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('employees')
      .select('id, company_id, invite_code')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;
    employees.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return employees;
}

function chunkArray(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const batchSize = Number(process.env.SELECTDB_BATCH_SIZE || 5000);
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error('SELECTDB_BATCH_SIZE 必须是正整数');
  }

  const realtimeOptions = {};
  if (typeof globalThis.WebSocket === 'undefined') {
    const { default: WebSocket } = await import('ws');
    realtimeOptions.transport = WebSocket;
  }

  const supabase = createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      realtime: realtimeOptions
    }
  );

  const attributionSql = stripTrailingSemicolon(
    process.env.SELECTDB_ATTRIBUTION_SQL || required('SELECTDB_REGISTER_SQL')
  );
  const rechargeSql = stripTrailingSemicolon(required('SELECTDB_RECHARGE_SQL'));

  const cursorFilePath = path.resolve(process.cwd(), '.selectdb-sync-cursor.json');
  const resetCursor = process.env.SELECTDB_CURSOR_RESET === '1';
  const cursor = resetCursor
    ? { attribution: null, recharge: null }
    : (readJsonFile(cursorFilePath) ?? { attribution: null, recharge: null });

  const connection = await mysql.createConnection({
    host: required('SELECTDB_HOST'),
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: required('SELECTDB_USER'),
    password: required('SELECTDB_PASSWORD'),
    database: required('SELECTDB_DATABASE')
  });

  try {
    console.log('开始读取 SelectDB 数据...');

    const employees = await fetchAllEmployees(supabase);
    const employeeByInviteCode = new Map(
      (employees ?? []).map((item) => [normalizeInviteCode(item.invite_code), item])
    );

    const attributionCache = new Map();

    const attributionKeyset = cursor.attribution ?? {
      bind_time: process.env.SELECTDB_ATTRIBUTION_START_TIME || '1970-01-01 00:00:00',
      platform_user_id: ''
    };

    let attributionRead = 0;
    let attributionHit = 0;
    while (true) {
      const sql = `
        SELECT t.invite_code, t.platform_user_id, t.bind_time
        FROM (${attributionSql}) t
        WHERE (t.bind_time > ?) OR (t.bind_time = ? AND t.platform_user_id > ?)
        ORDER BY t.bind_time ASC, t.platform_user_id ASC
        LIMIT ${batchSize}
      `;
      const [rowsRaw] = await connection.query(sql, [
        attributionKeyset.bind_time,
        attributionKeyset.bind_time,
        attributionKeyset.platform_user_id
      ]);
      const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
      if (rows.length === 0) break;

      attributionRead += rows.length;
      console.log(`归因批次读取: ${rows.length} 条（累计 ${attributionRead}）`);

      const batchUpserts = [];
      for (const row of rows) {
        const inviteCode = normalizeInviteCode(row.invite_code);
        const platformUserId = normalizeText(row.platform_user_id);
        if (!inviteCode || !platformUserId) continue;

        const employee = employeeByInviteCode.get(inviteCode);
        if (!employee) continue;

        attributionHit += 1;
        batchUpserts.push({
          company_id: employee.company_id,
          employee_id: employee.id,
          platform_user_id: platformUserId,
          invite_code: inviteCode,
          bind_time: toIso(row.bind_time),
          bind_status: 'bound'
        });
      }

      for (const chunk of chunkArray(batchUpserts, 1000)) {
        if (!dryRun && chunk.length > 0) {
          const { error } = await supabase
            .from('attribution_users')
            .upsert(chunk, { onConflict: 'company_id,platform_user_id' });
          if (error) throw error;
        }
        for (const item of chunk) {
          attributionCache.set(String(item.platform_user_id), {
            company_id: item.company_id,
            employee_id: item.employee_id,
            platform_user_id: item.platform_user_id
          });
        }
      }

      const last = rows[rows.length - 1];
      attributionKeyset.bind_time = normalizeText(last.bind_time) || attributionKeyset.bind_time;
      attributionKeyset.platform_user_id = normalizeText(last.platform_user_id) || attributionKeyset.platform_user_id;

      if (!dryRun) {
        cursor.attribution = { ...attributionKeyset };
        writeJsonFile(cursorFilePath, cursor);
      }
    }

    console.log(`归因读取完成：读取 ${attributionRead} 条，命中邀请码 ${attributionHit} 条`);

    const rechargeKeyset = cursor.recharge ?? {
      pay_time: process.env.SELECTDB_RECHARGE_START_TIME || '1970-01-01 00:00:00',
      order_no: ''
    };

    let rechargeRead = 0;
    let rechargeHit = 0;
    while (true) {
      const sql = `
        SELECT t.order_no, t.platform_user_id, t.invite_code, t.amount, t.pay_time, t.status
        FROM (${rechargeSql}) t
        WHERE (t.pay_time > ?) OR (t.pay_time = ? AND t.order_no > ?)
        ORDER BY t.pay_time ASC, t.order_no ASC
        LIMIT ${batchSize}
      `;
      const [rowsRaw] = await connection.query(sql, [
        rechargeKeyset.pay_time,
        rechargeKeyset.pay_time,
        rechargeKeyset.order_no
      ]);
      const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
      if (rows.length === 0) break;

      rechargeRead += rows.length;
      console.log(`充值批次读取: ${rows.length} 条（累计 ${rechargeRead}）`);

      const platformUserIds = [...new Set(rows.map((r) => normalizeText(r.platform_user_id)).filter(Boolean))];
      const missingUserIds = platformUserIds.filter((id) => !attributionCache.has(id));
      for (const group of chunkArray(missingUserIds, 200)) {
        const { data, error } = await supabase
          .from('attribution_users')
          .select('company_id, employee_id, platform_user_id')
          .in('platform_user_id', group);
        if (error) throw error;
        for (const item of data ?? []) {
          attributionCache.set(String(item.platform_user_id), item);
        }
      }

      const batchRechargeUpserts = [];
      for (const row of rows) {
        const platformUserId = normalizeText(row.platform_user_id);
        const orderNo = normalizeText(row.order_no);
        const inviteCode = normalizeInviteCode(row.invite_code);
        if (!platformUserId || !orderNo) continue;

        const attribution = attributionCache.get(platformUserId);
        const employee = inviteCode ? employeeByInviteCode.get(inviteCode) : null;
        const companyId = attribution?.company_id ?? employee?.company_id;
        const employeeId = attribution?.employee_id ?? employee?.id;
        if (!companyId || !employeeId) continue;

        rechargeHit += 1;
        batchRechargeUpserts.push({
          company_id: companyId,
          employee_id: employeeId,
          platform_user_id: platformUserId,
          order_no: orderNo,
          amount: Number(row.amount ?? 0),
          status: normalizeStatus(row.status),
          pay_time: toIso(row.pay_time),
          is_first_recharge: false
        });
      }

      for (const chunk of chunkArray(batchRechargeUpserts, 1000)) {
        if (!dryRun && chunk.length > 0) {
          const { error } = await supabase
            .from('recharge_orders')
            .upsert(chunk, { onConflict: 'order_no' });
          if (error) throw error;
        }
      }

      const last = rows[rows.length - 1];
      rechargeKeyset.pay_time = normalizeText(last.pay_time) || rechargeKeyset.pay_time;
      rechargeKeyset.order_no = normalizeText(last.order_no) || rechargeKeyset.order_no;

      if (!dryRun) {
        cursor.recharge = { ...rechargeKeyset };
        writeJsonFile(cursorFilePath, cursor);
      }
    }

    console.log(`充值读取完成：读取 ${rechargeRead} 条，命中归因 ${rechargeHit} 条`);

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
