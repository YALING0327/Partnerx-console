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

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function stripTrailingSemicolon(sql) {
  return String(sql ?? '').trim().replace(/;+\s*$/g, '');
}

function parseArgs(argv) {
  const options = {
    companyId: '',
    diffOnly: false,
    limit: 100,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--company' && argv[index + 1]) {
      options.companyId = argv[index + 1];
      index += 1;
    } else if (arg === '--diff-only') {
      options.diffOnly = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--limit' && argv[index + 1]) {
      options.limit = Number(argv[index + 1]) || options.limit;
      index += 1;
    }
  }

  return options;
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

function extractRechargeAmount(row) {
  for (const candidate of [row.amount, row.money, row.price, row.pay_amount]) {
    const numeric = toFiniteNumber(candidate);
    if (numeric != null) return numeric;
  }
  const usdAmount = parseJsonObject(row.usd_amount);
  if (usdAmount) {
    for (const candidate of [usdAmount.amount, usdAmount.pay_amount, usdAmount.order_amount]) {
      const numeric = toFiniteNumber(candidate);
      if (numeric != null) return numeric;
    }
  }
  return 0;
}

function extractRechargeStatus(row) {
  const usdAmount = parseJsonObject(row.usd_amount);
  return normalizeStatus(row.status ?? row.pay_status ?? usdAmount?.pay_status ?? 'success');
}

function summarizeSet(set) {
  return set.size;
}

function takeSamples(sourceSet, compareSet, limit = 5) {
  const samples = [];
  for (const item of sourceSet) {
    if (!compareSet.has(item)) {
      samples.push(item);
      if (samples.length >= limit) break;
    }
  }
  return samples;
}

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function fetchAllEmployees(supabase, companyId) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let query = supabase
      .from('employees')
      .select('id, company_id, employee_name, invite_code, inviter_id, attribution_key')
      .order('created_at', { ascending: true })
      .range(from, to);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchAllAttributions(supabase, companyId) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let query = supabase
      .from('attribution_users')
      .select('company_id, employee_id, platform_user_id')
      .order('employee_id', { ascending: true })
      .range(from, to);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchAllRechargeOrders(supabase, companyId) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let query = supabase
      .from('recharge_orders')
      .select('company_id, employee_id, platform_user_id, order_no, amount, status')
      .order('employee_id', { ascending: true })
      .range(from, to);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
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

  const rawRechargeSql = stripTrailingSemicolon(
    process.env.SELECTDB_RECHARGE_RAW_SQL || `
      SELECT
        r.id AS order_no,
        r.account_id AS platform_user_id,
        CAST(u.campaign AS STRING) AS campaign_key,
        CAST(u.sponsor AS STRING) AS sponsor_key,
        r.properties['amount'] AS amount,
        r.properties['money'] AS money,
        r.properties['price'] AS price,
        r.properties['pay_amount'] AS pay_amount,
        r.properties['usd_amount'] AS usd_amount,
        CAST(r.properties['pay_status'] AS STRING) AS pay_status,
        r.event_created_time AS pay_time
      FROM recharge r
      JOIN (
        SELECT
          account_id,
          TRIM(CAST(properties['campaign'] AS STRING)) AS campaign,
          TRIM(CAST(properties['sponsor'] AS STRING)) AS sponsor
        FROM \`user\`
      ) u ON r.account_id = u.account_id
      WHERE (u.campaign IS NOT NULL AND u.campaign != '')
         OR (u.sponsor IS NOT NULL AND u.sponsor != '')
    `
  );

  const connection = await mysql.createConnection({
    host: required('SELECTDB_HOST'),
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: required('SELECTDB_USER'),
    password: required('SELECTDB_PASSWORD'),
    database: required('SELECTDB_DATABASE')
  });

  try {
    const employees = await fetchAllEmployees(supabase, options.companyId);
    const attributions = await fetchAllAttributions(supabase, options.companyId);
    const rechargeOrders = await fetchAllRechargeOrders(supabase, options.companyId);

    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const employeeByDirectKey = new Map();
    const employeeByAdjustKey = new Map();
    const attributionByUserId = new Map();
    const allKnownKeys = [];

    for (const employee of employees) {
      const directKeys = [
        normalizeKey(employee.invite_code),
        normalizeKey(employee.inviter_id)
      ].filter(Boolean);
      const adjustKey = normalizeKey(employee.attribution_key);
      for (const key of directKeys) {
        employeeByDirectKey.set(key, employee);
        allKnownKeys.push(key);
      }
      if (adjustKey) {
        employeeByAdjustKey.set(adjustKey, employee);
        allKnownKeys.push(adjustKey);
      }
    }

    for (const item of attributions) {
      attributionByUserId.set(String(item.platform_user_id), item);
    }

    const orderSetsByEmployeeId = new Map();
    for (const employee of employees) {
      orderSetsByEmployeeId.set(employee.id, {
        rawOrderNos: new Set(),
        rawPaidOrderNos: new Set(),
        rawAmountSum: 0,
        dbOrderNos: new Set(),
        dbPaidOrderNos: new Set(),
        dbAmountSum: 0
      });
    }

    for (const order of rechargeOrders) {
      const bucket = orderSetsByEmployeeId.get(order.employee_id);
      if (!bucket) continue;
      const orderNo = String(order.order_no);
      bucket.dbOrderNos.add(orderNo);
      if (String(order.status) === 'success') {
        bucket.dbPaidOrderNos.add(orderNo);
        bucket.dbAmountSum += Number(order.amount || 0);
      }
    }

    const keyChunks = chunkArray([...new Set(allKnownKeys)], 200);
    const batchSize = Number(process.env.SELECTDB_BATCH_SIZE || 5000);

    for (const keyChunk of keyChunks) {
      let offset = 0;
      const inSql = keyChunk.map((item) => connection.escape(item)).join(', ');
      while (true) {
        const sql = `
          SELECT t.order_no, t.platform_user_id, t.campaign_key, t.sponsor_key, t.amount, t.money, t.price, t.pay_amount, t.usd_amount, t.pay_status
          FROM (${rawRechargeSql}) t
          WHERE LOWER(TRIM(CAST(t.campaign_key AS STRING))) IN (${inSql})
             OR LOWER(TRIM(CAST(t.sponsor_key AS STRING))) IN (${inSql})
          ORDER BY t.pay_time ASC, t.order_no ASC
          LIMIT ${batchSize} OFFSET ${offset}
        `;
        const [rowsRaw] = await connection.query(sql);
        const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
        if (rows.length === 0) break;

        for (const row of rows) {
          const orderNo = normalizeText(row.order_no);
          const platformUserId = normalizeText(row.platform_user_id);
          if (!orderNo || !platformUserId) continue;

          const attribution = attributionByUserId.get(platformUserId);
          const campaignEmployee = employeeByAdjustKey.get(normalizeKey(row.campaign_key));
          const sponsorEmployee = employeeByDirectKey.get(normalizeKey(row.sponsor_key));
          const employee = attribution
            ? employeeById.get(attribution.employee_id)
            : (campaignEmployee ?? sponsorEmployee ?? null);
          if (!employee) continue;

          const bucket = orderSetsByEmployeeId.get(employee.id);
          if (!bucket) continue;

          bucket.rawOrderNos.add(orderNo);
          if (extractRechargeStatus(row) === 'success') {
            bucket.rawPaidOrderNos.add(orderNo);
            bucket.rawAmountSum += extractRechargeAmount(row);
          }
        }

        offset += rows.length;
        if (rows.length < batchSize) break;
      }
    }

    const rows = employees.map((employee) => {
      const bucket = orderSetsByEmployeeId.get(employee.id);
      const rawOrderNos = bucket?.rawOrderNos ?? new Set();
      const rawPaidOrderNos = bucket?.rawPaidOrderNos ?? new Set();
      const dbOrderNos = bucket?.dbOrderNos ?? new Set();
      const dbPaidOrderNos = bucket?.dbPaidOrderNos ?? new Set();
      const rawAmountSum = Number(bucket?.rawAmountSum ?? 0);
      const dbAmountSum = Number(bucket?.dbAmountSum ?? 0);

      return {
        companyId: employee.company_id,
        employeeId: employee.id,
        employeeName: employee.employee_name,
        inviteCode: employee.invite_code,
        inviterId: employee.inviter_id ?? '',
        attributionKey: employee.attribution_key ?? '',
        rawRechargeOrders: summarizeSet(rawOrderNos),
        dbRechargeOrders: summarizeSet(dbOrderNos),
        diffRechargeOrders: summarizeSet(rawOrderNos) - summarizeSet(dbOrderNos),
        rawPaidOrders: summarizeSet(rawPaidOrderNos),
        dbPaidOrders: summarizeSet(dbPaidOrderNos),
        diffPaidOrders: summarizeSet(rawPaidOrderNos) - summarizeSet(dbPaidOrderNos),
        rawAmountSum,
        dbAmountSum,
        diffAmountSum: rawAmountSum - dbAmountSum,
        missingOrderSamples: takeSamples(rawOrderNos, dbOrderNos),
        extraOrderSamples: takeSamples(dbOrderNos, rawOrderNos)
      };
    });

    const hasDiff = (row) =>
      row.diffRechargeOrders !== 0 ||
      row.diffPaidOrders !== 0 ||
      row.diffAmountSum !== 0;

    const sortedRows = rows.sort((left, right) => {
      const leftScore = Math.abs(left.diffRechargeOrders) + Math.abs(left.diffPaidOrders) + Math.abs(left.diffAmountSum);
      const rightScore = Math.abs(right.diffRechargeOrders) + Math.abs(right.diffPaidOrders) + Math.abs(right.diffAmountSum);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return left.employeeName.localeCompare(right.employeeName);
    });

    const filteredRows = options.diffOnly ? sortedRows.filter(hasDiff) : sortedRows;
    const limitedRows = filteredRows.slice(0, options.limit);
    const summary = {
      companyId: options.companyId || 'ALL',
      employeeCount: employees.length,
      diffEmployeeCount: rows.filter(hasDiff).length,
      totalRawPaidOrders: rows.reduce((sum, row) => sum + row.rawPaidOrders, 0),
      totalDbPaidOrders: rows.reduce((sum, row) => sum + row.dbPaidOrders, 0),
      totalRawAmount: rows.reduce((sum, row) => sum + row.rawAmountSum, 0),
      totalDbAmount: rows.reduce((sum, row) => sum + row.dbAmountSum, 0)
    };

    if (options.json) {
      console.log(JSON.stringify({ summary, rows: limitedRows }, null, 2));
      return;
    }

    console.log('=== Recharge Reconciliation Summary ===');
    console.table([summary]);
    console.log(`显示前 ${limitedRows.length} 条员工充值对账结果${options.diffOnly ? '（仅差异）' : ''}`);
    console.table(limitedRows.map((row) => ({
      employeeName: row.employeeName,
      inviteCode: row.inviteCode,
      inviterId: row.inviterId,
      rawRechargeOrders: row.rawRechargeOrders,
      dbRechargeOrders: row.dbRechargeOrders,
      diffRechargeOrders: row.diffRechargeOrders,
      rawPaidOrders: row.rawPaidOrders,
      dbPaidOrders: row.dbPaidOrders,
      diffPaidOrders: row.diffPaidOrders,
      rawAmountSum: row.rawAmountSum,
      dbAmountSum: row.dbAmountSum,
      diffAmountSum: row.diffAmountSum
    })));

    const rowsWithSamples = limitedRows.filter((row) => row.missingOrderSamples.length || row.extraOrderSamples.length);
    if (rowsWithSamples.length > 0) {
      console.log('=== Recharge Diff Samples ===');
      for (const row of rowsWithSamples) {
        console.log(`[${row.employeeName}] missing=${row.missingOrderSamples.join(', ') || '-'} extra=${row.extraOrderSamples.join(', ') || '-'}`);
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('充值对账失败');
  console.error(error);
  process.exit(1);
});
