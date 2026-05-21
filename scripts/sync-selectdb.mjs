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

function toKeysetTime(value) {
  if (!value) return '1970-01-01 00:00:00';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 19);
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`时间字段格式不正确: ${value}`);
  }
  return time.toISOString().slice(0, 19).replace('T', ' ');
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
  const selectCandidates = [
    'id, company_id, invite_code, inviter_id, attribution_key',
    'id, company_id, invite_code, inviter_id',
    'id, company_id, invite_code, attribution_key',
    'id, company_id, invite_code'
  ];
  let selectColumns = selectCandidates[0];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let data = null;
    let error = null;

    for (const candidate of [selectColumns, ...selectCandidates.filter((c) => c !== selectColumns)]) {
      selectColumns = candidate;
      ({ data, error } = await supabase
        .from('employees')
        .select(selectColumns)
        .order('id', { ascending: true })
        .range(from, to));
      if (!error) break;
    }

    if (error) {
      throw error;
    }
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
  const amountDivisor = Number(process.env.SELECTDB_AMOUNT_DIVISOR || 1);
  if (!Number.isFinite(amountDivisor) || amountDivisor <= 0) {
    throw new Error('SELECTDB_AMOUNT_DIVISOR 必须是正数');
  }
  const debugInviteKey = normalizeInviteCode(process.env.DEBUG_INVITE_KEY);
  const debugEnabled = process.env.DEBUG_MATCH === '1' && !!debugInviteKey;
  const inviteFilterLimit = Number(process.env.SELECTDB_INVITE_FILTER_LIMIT || 2000);
  const onlyInviteKey = normalizeInviteCode(process.env.SELECTDB_ONLY_INVITE_KEY);

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
      ? { attribution: null, recharge: null, synced_keys: [] }
      : (readJsonFile(cursorFilePath) ?? { attribution: null, recharge: null, synced_keys: [] });

    if (!Array.isArray(cursor.synced_keys)) {
      cursor.synced_keys = [];
    }

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
      const employeeByInviteCode = new Map();
      for (const employee of employees ?? []) {
        const inviteCodeKey = normalizeInviteCode(employee.invite_code);
        if (inviteCodeKey) employeeByInviteCode.set(inviteCodeKey, employee);
        const inviterIdKey = normalizeInviteCode(employee.inviter_id);
        if (inviterIdKey) employeeByInviteCode.set(inviterIdKey, employee);
        const attributionKey = normalizeInviteCode(employee.attribution_key);
        if (attributionKey) employeeByInviteCode.set(attributionKey, employee);
      }
      const employeeInviteKeys = [...new Set([...employeeByInviteCode.keys()].filter(Boolean))];

      const newKeys = employeeInviteKeys.filter(k => !cursor.synced_keys.includes(k));
      if (newKeys.length > 0 && !resetCursor) {
        console.log(`发现新添加的邀请码/ID: ${newKeys.join(', ')}，准备为其进行历史数据回溯...`);
      }

      // 提取核心的归因同步逻辑为一个函数，方便复用
      async function syncAttributionLoop(targetKeys, startKeyset, isCatchUp = false) {
        if (targetKeys.length === 0) return { keyset: startKeyset, cache: new Map(), read: 0, hit: 0 };
        const useInviteFilter = true;
        const inviteFilterKeys = targetKeys;
        const keyset = { ...startKeyset };
        let read = 0;
        let hit = 0;
        const cache = new Map();

        while (true) {
          const inviteFilterSql = inviteFilterKeys.length === 1
            ? ` AND t.invite_code = ${mysql.escape(inviteFilterKeys[0])}`
            : ` AND t.invite_code IN (${inviteFilterKeys.map(k => mysql.escape(k)).join(',')})`;
          
          const sql = `
            SELECT t.invite_code, t.platform_user_id, t.bind_time
            FROM (${attributionSql}) t
            WHERE (t.bind_time > ?) OR (t.bind_time = ? AND t.platform_user_id > ?)
            ${inviteFilterSql}
            ORDER BY t.bind_time ASC, t.platform_user_id ASC
            LIMIT ${batchSize}
          `;
          const [rowsRaw] = await connection.query(sql, [keyset.bind_time, keyset.bind_time, keyset.platform_user_id]);
          const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
          if (rows.length === 0) break;

          read += rows.length;
          if (!isCatchUp) console.log(`归因批次读取: ${rows.length} 条（累计 ${read}）`);

          const batchUpserts = [];
          for (const row of rows) {
            const inviteCode = normalizeInviteCode(row.invite_code);
            const platformUserId = normalizeText(row.platform_user_id);
            if (!inviteCode || !platformUserId) continue;

            const employee = employeeByInviteCode.get(inviteCode);
            if (!employee) continue;

            hit += 1;
            batchUpserts.push({
              company_id: employee.company_id,
              employee_id: employee.id,
              platform_user_id: platformUserId,
              invite_code: employee.invite_code,
              bind_time: toIso(row.bind_time),
              bind_status: 'bound'
            });
          }

          for (const chunk of chunkArray(batchUpserts, 1000)) {
            if (!dryRun && chunk.length > 0) {
              const { error } = await supabase.from('attribution_users').upsert(chunk, { onConflict: 'company_id,platform_user_id' });
              if (error) throw error;
            }
            for (const item of chunk) {
              cache.set(String(item.platform_user_id), {
                company_id: item.company_id,
                employee_id: item.employee_id,
                platform_user_id: item.platform_user_id
              });
            }
          }

          const last = rows[rows.length - 1];
          keyset.bind_time = toKeysetTime(last.bind_time);
          keyset.platform_user_id = normalizeText(last.platform_user_id) || keyset.platform_user_id;

          if (!dryRun && !isCatchUp) {
            cursor.attribution = { ...keyset };
            writeJsonFile(cursorFilePath, cursor);
          }
        }
        return { keyset, cache, read, hit };
      }

      // 提取核心的充值同步逻辑为一个函数，方便复用
      async function syncRechargeLoop(targetKeys, startKeyset, attributionCache, isCatchUp = false) {
        if (targetKeys.length === 0) return { keyset: startKeyset, read: 0, hit: 0 };
        const useInviteFilter = true;
        const inviteFilterKeys = targetKeys;
        const keyset = { ...startKeyset };
        let read = 0;
        let hit = 0;

        while (true) {
          const inviteFilterSql = inviteFilterKeys.length === 1
            ? ` AND t.invite_code = ${mysql.escape(inviteFilterKeys[0])}`
            : ` AND t.invite_code IN (${inviteFilterKeys.map(k => mysql.escape(k)).join(',')})`;
          
          const sql = `
            SELECT t.order_no, t.platform_user_id, t.invite_code, t.amount, t.pay_time, t.status
            FROM (${rechargeSql}) t
            WHERE (t.pay_time > ?) OR (t.pay_time = ? AND t.order_no > ?)
            ${inviteFilterSql}
            ORDER BY t.pay_time ASC, t.order_no ASC
            LIMIT ${batchSize}
          `;
          const [rowsRaw] = await connection.query(sql, [keyset.pay_time, keyset.pay_time, keyset.order_no]);
          const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
          if (rows.length === 0) break;

          read += rows.length;
          if (!isCatchUp) console.log(`充值批次读取: ${rows.length} 条（累计 ${read}）`);

          const platformUserIds = [...new Set(rows.map((r) => normalizeText(r.platform_user_id)).filter(Boolean))];
          const missingUserIds = platformUserIds.filter((id) => !attributionCache.has(id));
          for (const group of chunkArray(missingUserIds, 200)) {
            const { data, error } = await supabase.from('attribution_users').select('company_id, employee_id, platform_user_id').in('platform_user_id', group);
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

            hit += 1;
            batchRechargeUpserts.push({
              company_id: companyId,
              employee_id: employeeId,
              platform_user_id: platformUserId,
              order_no: orderNo,
              amount: Number(row.amount ?? 0) / amountDivisor,
              status: normalizeStatus(row.status),
              pay_time: toIso(row.pay_time),
              is_first_recharge: false
            });
          }

          for (const chunk of chunkArray(batchRechargeUpserts, 1000)) {
            if (!dryRun && chunk.length > 0) {
              const { error } = await supabase.from('recharge_orders').upsert(chunk, { onConflict: 'order_no' });
              if (error) throw error;
            }
          }

          const last = rows[rows.length - 1];
          keyset.pay_time = toKeysetTime(last.pay_time);
          keyset.order_no = normalizeText(last.order_no) || keyset.order_no;

          if (!dryRun && !isCatchUp) {
            cursor.recharge = { ...keyset };
            writeJsonFile(cursorFilePath, cursor);
          }
        }
        return { keyset, read, hit };
      }

      const globalAttributionCache = new Map();

      // 阶段 1：对新增的邀请码进行历史数据追溯 (从 1970 开始)
      if (newKeys.length > 0 && !resetCursor) {
        const catchUpAttribution = await syncAttributionLoop(newKeys, { bind_time: '1970-01-01 00:00:00', platform_user_id: '' }, true);
        for (const [k, v] of catchUpAttribution.cache) globalAttributionCache.set(k, v);
        const catchUpRecharge = await syncRechargeLoop(newKeys, { pay_time: '1970-01-01 00:00:00', order_no: '' }, globalAttributionCache, true);
        console.log(`历史追溯完成：追溯归因 ${catchUpAttribution.hit} 条，追溯充值 ${catchUpRecharge.hit} 条`);
      }

      // 阶段 2：对所有当前邀请码执行增量同步
      const inviteFilterKeys = onlyInviteKey ? [onlyInviteKey] : (employeeInviteKeys.length > 0 && employeeInviteKeys.length <= inviteFilterLimit ? employeeInviteKeys : []);
      
      const attributionKeyset = cursor.attribution ?? { bind_time: process.env.SELECTDB_ATTRIBUTION_START_TIME || '1970-01-01 00:00:00', platform_user_id: '' };
      const incrementalAttribution = await syncAttributionLoop(inviteFilterKeys, attributionKeyset, false);
      for (const [k, v] of incrementalAttribution.cache) globalAttributionCache.set(k, v);
      console.log(`增量归因读取完成：读取 ${incrementalAttribution.read} 条，命中 ${incrementalAttribution.hit} 条`);

      const rechargeKeyset = cursor.recharge ?? { pay_time: process.env.SELECTDB_RECHARGE_START_TIME || '1970-01-01 00:00:00', order_no: '' };
      const incrementalRecharge = await syncRechargeLoop(inviteFilterKeys, rechargeKeyset, globalAttributionCache, false);
      console.log(`增量充值读取完成：读取 ${incrementalRecharge.read} 条，命中 ${incrementalRecharge.hit} 条`);

      // 追溯和增量都成功完成后，更新 synced_keys
      if (!dryRun && newKeys.length > 0 && !resetCursor) {
        cursor.synced_keys.push(...newKeys);
        writeJsonFile(cursorFilePath, cursor);
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
