import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { createClient } from '@supabase/supabase-js';

const cwd = process.cwd();
const envLocalPath = path.resolve(cwd, '.env.local');
const envPath = path.resolve(cwd, '.env');
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });
else if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function parseArgs(argv) {
  const options = {
    mode: 'non-success',
    days: Number(process.env.REPAIR_RECENT_DAYS || 30),
    verifyOnly: process.env.VERIFY_ONLY === '1'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode' && argv[index + 1]) {
      options.mode = String(argv[index + 1]).trim();
      index += 1;
    } else if (arg === '--days' && argv[index + 1]) {
      const days = Number(argv[index + 1]);
      if (Number.isFinite(days) && days > 0) options.days = days;
      index += 1;
    } else if (arg === '--verify-only') {
      options.verifyOnly = true;
    }
  }

  if (!['non-success', 'full'].includes(options.mode)) {
    throw new Error(`不支持的 mode: ${options.mode}`);
  }

  return options;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toFiniteNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function usdToCents(usd) {
  return Math.round(usd * 100);
}

function pickUsdCentsFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const inner = toFiniteNumber(obj.amount);
  if (inner != null && inner > 0) return inner;
  for (const candidate of [obj.price_dollar, obj.goods_amount, obj.income_dollar]) {
    const numeric = toFiniteNumber(candidate);
    if (numeric != null && numeric > 0) return usdToCents(numeric);
  }
  return null;
}

function extractRechargeAmount(row) {
  const amountObj = parseJsonObject(row.amount);
  if (amountObj) {
    const cents = pickUsdCentsFromObject(amountObj);
    if (cents != null) return cents;
  }

  const scalarCents = toFiniteNumber(row.amount);
  if (scalarCents != null && scalarCents > 0) return scalarCents;

  for (const candidate of [row.price_dollar, row.goods_amount, row.income_dollar]) {
    const numeric = toFiniteNumber(candidate);
    if (numeric != null && numeric > 0) return usdToCents(numeric);
  }

  const usdAmount = parseJsonObject(row.usd_amount);
  if (usdAmount) {
    const cents = pickUsdCentsFromObject(usdAmount);
    if (cents != null) return cents;
  }

  return 0;
}

function normalizeStatus(value) {
  const raw = String(value ?? '').toLowerCase();
  if (['success', 'paid', 'pay_success', 'completed', 'finish', 'finished', '1', '3'].includes(raw)) {
    return 'success';
  }
  if (['failed', 'fail', '0', 'closed', 'cancel'].includes(raw)) {
    return 'failed';
  }
  return raw || 'unknown';
}

function extractRechargeStatus(row) {
  const usdAmount = parseJsonObject(row.usd_amount);
  return normalizeStatus(row.pay_status ?? usdAmount?.pay_status ?? 'success');
}

function detectPlatform(appName, channel) {
  const a = normalizeText(appName).toLowerCase();
  const c = normalizeText(channel).toLowerCase();
  if (/\.ios\b|ios$|mitu/.test(a) || /ios|mitu/.test(c)) return 'ios';
  if (/\.android\b|android$|\.gp\b|dico|dcg/.test(a) || /android|\bgp\b|dcg/.test(c)) return 'android';
  return 'unknown';
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const raw = String(value).trim();
  const numericValue = Number(raw);
  const normalizedValue = /^\d{13}$/.test(raw)
    ? numericValue
    : /^\d{10}$/.test(raw)
      ? numericValue * 1000
      : value;
  const time = new Date(normalizedValue);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`时间字段格式不正确: ${value}`);
  }
  return time.toISOString();
}

function toSelectDbTime(value) {
  return String(value).slice(0, 19).replace('T', ' ');
}

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function createSupabaseClient() {
  const realtimeOptions = {};
  if (typeof globalThis.WebSocket === 'undefined') {
    const { default: WebSocket } = await import('ws');
    realtimeOptions.transport = WebSocket;
  }
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false }, realtime: realtimeOptions }
  );
}

async function createSelectDbConnection() {
  return mysql.createConnection({
    host: required('SELECTDB_HOST'),
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: required('SELECTDB_USER'),
    password: required('SELECTDB_PASSWORD'),
    database: required('SELECTDB_DATABASE'),
    connectTimeout: 15000
  });
}

async function fetchAllEmployees(supabase) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, company_id, employee_name, invite_code, inviter_id, attribution_key')
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function runNonSuccessRepair({ supabase, connection, startAtIso, verifyOnly }) {
  const recentRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('recharge_orders')
      .select('company_id, employee_id, platform_user_id, order_no, amount, status, pay_time')
      .gte('pay_time', startAtIso)
      .neq('status', 'success')
      .order('pay_time', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    recentRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const fixes = [];
  const samples = [];
  for (const chunk of chunkArray(recentRows, 200)) {
    const placeholders = chunk.map(() => '?').join(',');
    const [sourceRowsRaw] = await connection.query(
      `
        SELECT
          CAST(r.id AS STRING) AS order_no,
          CAST(r.account_id AS STRING) AS platform_user_id,
          CAST(r.properties['price_dollar'] AS STRING) AS price_dollar,
          CAST(r.properties['goods_amount'] AS STRING) AS goods_amount,
          CAST(r.properties['income_dollar'] AS STRING) AS income_dollar,
          CAST(r.properties['amount'] AS STRING) AS amount,
          CAST(r.properties['usd_amount'] AS STRING) AS usd_amount,
          CAST(r.properties['pay_status'] AS STRING) AS pay_status,
          CAST(r.event_created_time AS STRING) AS pay_created_time
        FROM recharge r
        WHERE CAST(r.id AS STRING) IN (${placeholders})
      `,
      chunk.map((item) => String(item.order_no))
    );

    const sourceByOrder = new Map((Array.isArray(sourceRowsRaw) ? sourceRowsRaw : []).map((row) => [String(row.order_no), row]));

    for (const dbRow of chunk) {
      const sourceRow = sourceByOrder.get(String(dbRow.order_no));
      if (!sourceRow) continue;
      const sourceStatus = extractRechargeStatus(sourceRow);
      const sourceAmount = extractRechargeAmount(sourceRow);
      const dbStatus = normalizeStatus(dbRow.status);
      const dbAmount = Number(dbRow.amount || 0);
      if (sourceStatus === dbStatus && sourceAmount === dbAmount) continue;

      fixes.push({
        company_id: dbRow.company_id,
        employee_id: dbRow.employee_id,
        platform_user_id: dbRow.platform_user_id,
        order_no: dbRow.order_no,
        amount: sourceAmount,
        status: sourceStatus,
        pay_time: toIso(sourceRow.pay_created_time),
        is_first_recharge: false
      });

      if (samples.length < 50) {
        samples.push({
          orderNo: dbRow.order_no,
          platformUserId: dbRow.platform_user_id,
          dbStatus,
          sourceStatus,
          dbAmount,
          sourceAmount
        });
      }
    }
  }

  if (!verifyOnly) {
    for (const chunk of chunkArray(fixes, 1000)) {
      if (chunk.length === 0) continue;
      const { error } = await supabase.from('recharge_orders').upsert(chunk, { onConflict: 'order_no' });
      if (error) throw error;
    }
  }

  return {
    mode: 'non-success',
    verifyOnly,
    startAtIso,
    recentNonSuccessCount: recentRows.length,
    fixedCount: fixes.length,
    samples
  };
}

async function runFullRepair({ supabase, connection, startAtIso, verifyOnly }) {
  const employees = await fetchAllEmployees(supabase);
  const employeeById = new Map(employees.map((item) => [item.id, item]));
  const employeeByDirectKey = new Map();
  const employeeByAdjustKey = new Map();
  const allKnownKeys = [];

  for (const employee of employees) {
    for (const key of [employee.invite_code, employee.inviter_id].map(normalizeKey).filter(Boolean)) {
      employeeByDirectKey.set(key, employee);
      allKnownKeys.push(key);
    }
    const adjustKey = normalizeKey(employee.attribution_key);
    if (adjustKey) {
      employeeByAdjustKey.set(adjustKey, employee);
      allKnownKeys.push(adjustKey);
    }
  }

  const uniqueKeys = [...new Set(allKnownKeys)];
  const sourceByOrder = new Map();
  for (const keyChunk of chunkArray(uniqueKeys, 200)) {
    const inSql = keyChunk.map(() => '?').join(',');
    let offset = 0;
    while (true) {
      const [rowsRaw] = await connection.query(
        `
          SELECT
            CAST(r.id AS STRING) AS order_no,
            CAST(r.account_id AS STRING) AS platform_user_id,
            TRIM(json_extract_string(CONCAT('', CAST(u.properties AS STRING)), '$.campaign')) AS campaign_key,
            TRIM(json_extract_string(CONCAT('', CAST(u.properties AS STRING)), '$.sponsor')) AS sponsor_key,
            COALESCE(json_extract_string(CONCAT('', CAST(u.properties AS STRING)), '$.register_time'), CAST(u.event_created_time AS STRING)) AS bind_time,
            json_extract_string(CONCAT('', CAST(u.properties AS STRING)), '$.app_name') AS app_name,
            json_extract_string(CONCAT('', CAST(u.properties AS STRING)), '$.channel') AS channel,
            CAST(r.properties['price_dollar'] AS STRING) AS price_dollar,
            CAST(r.properties['goods_amount'] AS STRING) AS goods_amount,
            CAST(r.properties['income_dollar'] AS STRING) AS income_dollar,
            CAST(r.properties['amount'] AS STRING) AS amount,
            CAST(r.properties['usd_amount'] AS STRING) AS usd_amount,
            CAST(r.properties['pay_status'] AS STRING) AS pay_status,
            CAST(r.event_created_time AS STRING) AS pay_created_time
          FROM recharge r
          JOIN \`user\` u ON r.account_id = u.account_id
          WHERE r.event_created_time >= ?
            AND (
              LOWER(TRIM(json_extract_string(CONCAT('', CAST(u.properties AS STRING)), '$.campaign'))) IN (${inSql})
              OR LOWER(TRIM(json_extract_string(CONCAT('', CAST(u.properties AS STRING)), '$.sponsor'))) IN (${inSql})
            )
          ORDER BY r.event_created_time ASC, r.id ASC
          LIMIT 5000 OFFSET ${offset}
        `,
        [toSelectDbTime(startAtIso), ...keyChunk, ...keyChunk]
      );

      const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const orderNo = normalizeText(row.order_no);
        const platformUserId = normalizeText(row.platform_user_id);
        if (!orderNo || !platformUserId) continue;
        const existing = sourceByOrder.get(orderNo);
        const next = {
          orderNo,
          platformUserId,
          campaignKey: normalizeText(row.campaign_key),
          sponsorKey: normalizeText(row.sponsor_key),
          bindTime: normalizeText(row.bind_time),
          appName: normalizeText(row.app_name),
          channel: normalizeText(row.channel),
          amount: extractRechargeAmount(row),
          status: extractRechargeStatus(row),
          payTime: toIso(row.pay_created_time)
        };
        if (!existing || String(next.payTime) >= String(existing.payTime)) {
          sourceByOrder.set(orderNo, next);
        }
      }
      if (rows.length < 5000) break;
      offset += rows.length;
    }
  }

  const sourceOrders = [...sourceByOrder.values()];
  const platformUserIds = [...new Set(sourceOrders.map((item) => item.platformUserId))];
  const orderNos = [...new Set(sourceOrders.map((item) => item.orderNo))];

  const attributionByUser = new Map();
  for (const chunk of chunkArray(platformUserIds, 200)) {
    const { data, error } = await supabase
      .from('attribution_users')
      .select('company_id, employee_id, platform_user_id, invite_code, bind_time, bind_status, app_platform')
      .in('platform_user_id', chunk);
    if (error) throw error;
    for (const item of data ?? []) {
      attributionByUser.set(String(item.platform_user_id), item);
    }
  }

  const dbRechargeByOrder = new Map();
  for (const chunk of chunkArray(orderNos, 200)) {
    const { data, error } = await supabase
      .from('recharge_orders')
      .select('company_id, employee_id, platform_user_id, order_no, amount, status, pay_time')
      .in('order_no', chunk);
    if (error) throw error;
    for (const item of data ?? []) {
      dbRechargeByOrder.set(String(item.order_no), item);
    }
  }

  const attributionUpserts = new Map();
  const rechargeUpserts = new Map();
  const anomalies = [];

  for (const item of sourceOrders) {
    const existingAttribution = attributionByUser.get(item.platformUserId);
    const directEmployee = employeeByDirectKey.get(normalizeKey(item.sponsorKey)) ?? employeeByDirectKey.get(normalizeKey(item.campaignKey));
    const adjustEmployee = employeeByAdjustKey.get(normalizeKey(item.campaignKey)) ?? employeeByAdjustKey.get(normalizeKey(item.sponsorKey));
    const employee = existingAttribution
      ? employeeById.get(existingAttribution.employee_id)
      : (directEmployee ?? adjustEmployee ?? null);
    const companyId = existingAttribution?.company_id ?? employee?.company_id;
    const employeeId = existingAttribution?.employee_id ?? employee?.id;
    if (!companyId || !employeeId) continue;

    if (!existingAttribution) {
      attributionUpserts.set(item.platformUserId, {
        company_id: companyId,
        employee_id: employeeId,
        platform_user_id: item.platformUserId,
        invite_code: employee?.invite_code ?? '',
        bind_time: toIso(item.bindTime),
        bind_status: directEmployee ? 'invite' : 'adjust',
        app_platform: detectPlatform(item.appName, item.channel)
      });
    }

    const dbOrder = dbRechargeByOrder.get(item.orderNo);
    const dbStatus = normalizeStatus(dbOrder?.status ?? '');
    const dbAmount = Number(dbOrder?.amount ?? 0);
    const needsFix = !dbOrder
      || dbStatus !== item.status
      || dbAmount !== item.amount
      || String(dbOrder.employee_id ?? '') !== String(employeeId)
      || String(dbOrder.company_id ?? '') !== String(companyId);

    if (!needsFix) continue;

    rechargeUpserts.set(item.orderNo, {
      company_id: companyId,
      employee_id: employeeId,
      platform_user_id: item.platformUserId,
      order_no: item.orderNo,
      amount: item.amount,
      status: item.status,
      pay_time: item.payTime,
      is_first_recharge: false
    });

    anomalies.push({
      orderNo: item.orderNo,
      platformUserId: item.platformUserId,
      sourceStatus: item.status,
      dbStatus,
      sourceAmount: item.amount,
      dbAmount,
      companyId,
      employeeId,
      issue: !dbOrder ? 'missing' : 'mismatch'
    });
  }

  const attributionRows = [...attributionUpserts.values()];
  const rechargeRows = [...rechargeUpserts.values()];

  if (!verifyOnly) {
    for (const chunk of chunkArray(attributionRows, 1000)) {
      if (chunk.length === 0) continue;
      const { error } = await supabase.from('attribution_users').upsert(chunk, { onConflict: 'company_id,platform_user_id' });
      if (error) throw error;
    }
    for (const chunk of chunkArray(rechargeRows, 1000)) {
      if (chunk.length === 0) continue;
      const { error } = await supabase.from('recharge_orders').upsert(chunk, { onConflict: 'order_no' });
      if (error) throw error;
    }
  }

  return {
    mode: 'full',
    verifyOnly,
    startAtIso,
    sourceOrderCount: sourceOrders.length,
    attributionFixCount: attributionRows.length,
    rechargeFixCount: rechargeRows.length,
    missingCount: anomalies.filter((item) => item.issue === 'missing').length,
    mismatchCount: anomalies.filter((item) => item.issue === 'mismatch').length,
    samples: anomalies.slice(0, 50)
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startAtIso = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = await createSupabaseClient();
  const connection = await createSelectDbConnection();

  try {
    const result = options.mode === 'full'
      ? await runFullRepair({ supabase, connection, startAtIso, verifyOnly: options.verifyOnly })
      : await runNonSuccessRepair({ supabase, connection, startAtIso, verifyOnly: options.verifyOnly });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await connection.end().catch(() => {});
  }
}

await main();
