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

async function fetchAllEmployees(supabase, companyId) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let query = supabase
      .from('employees')
      .select('id, company_id, employee_name, invite_code, inviter_id, attribution_key, status')
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
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let query = supabase
      .from('attribution_users')
      .select('company_id, employee_id, platform_user_id, bind_status')
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

  const rawAttributionSql = stripTrailingSemicolon(
    process.env.SELECTDB_ATTRIBUTION_RAW_SQL || `
      SELECT
        CAST(properties['campaign'] AS STRING) AS campaign_key,
        CAST(properties['sponsor'] AS STRING) AS sponsor_key,
        account_id AS platform_user_id,
        COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) AS bind_time
      FROM \`user\`
      WHERE (properties['campaign'] IS NOT NULL AND properties['campaign'] != '')
         OR (properties['sponsor'] IS NOT NULL AND properties['sponsor'] != '')
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

    const employeeById = new Map();
    const employeeByDirectKey = new Map();
    const employeeByAdjustKey = new Map();

    for (const employee of employees) {
      employeeById.set(employee.id, employee);
      const inviteCodeKey = normalizeKey(employee.invite_code);
      const inviterIdKey = normalizeKey(employee.inviter_id);
      const attributionKey = normalizeKey(employee.attribution_key);
      if (inviteCodeKey) employeeByDirectKey.set(inviteCodeKey, employee);
      if (inviterIdKey) employeeByDirectKey.set(inviterIdKey, employee);
      if (attributionKey) employeeByAdjustKey.set(attributionKey, employee);
    }

    const allKnownKeys = [...new Set([
      ...employeeByDirectKey.keys(),
      ...employeeByAdjustKey.keys()
    ])];

    const rawRowsByEmployeeId = new Map();
    for (const employee of employees) {
      rawRowsByEmployeeId.set(employee.id, {
        rawInviteUsers: new Set(),
        rawAdjustUsers: new Set(),
        rawOverlapUsers: new Set(),
        rawMergedUsers: new Set(),
        dbInviteUsers: new Set(),
        dbAdjustUsers: new Set(),
        dbMergedUsers: new Set()
      });
    }

    for (const item of attributions) {
      const bucket = rawRowsByEmployeeId.get(item.employee_id);
      if (!bucket) continue;
      bucket.dbMergedUsers.add(String(item.platform_user_id));
      if (item.bind_status === 'adjust') {
        bucket.dbAdjustUsers.add(String(item.platform_user_id));
      } else {
        bucket.dbInviteUsers.add(String(item.platform_user_id));
      }
    }

    const batchSize = Number(process.env.SELECTDB_BATCH_SIZE || 5000);
    const keyChunks = chunkArray(allKnownKeys, 200);

    for (const keyChunk of keyChunks) {
      let offset = 0;
      const inSql = keyChunk.map((item) => connection.escape(item)).join(', ');
      while (true) {
        const sql = `
          SELECT t.campaign_key, t.sponsor_key, t.platform_user_id
          FROM (${rawAttributionSql}) t
          WHERE LOWER(TRIM(CAST(t.campaign_key AS STRING))) IN (${inSql})
             OR LOWER(TRIM(CAST(t.sponsor_key AS STRING))) IN (${inSql})
          ORDER BY t.bind_time ASC, t.platform_user_id ASC
          LIMIT ${batchSize} OFFSET ${offset}
        `;
        const [rowsRaw] = await connection.query(sql);
        const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
        if (rows.length === 0) break;

        for (const row of rows) {
          const userId = normalizeText(row.platform_user_id);
          if (!userId) continue;

          const sponsorEmployee = employeeByDirectKey.get(normalizeKey(row.sponsor_key));
          if (sponsorEmployee) {
            const bucket = rawRowsByEmployeeId.get(sponsorEmployee.id);
            bucket?.rawInviteUsers.add(userId);
            bucket?.rawMergedUsers.add(userId);
          }

          const campaignEmployee = employeeByAdjustKey.get(normalizeKey(row.campaign_key));
          if (campaignEmployee) {
            const bucket = rawRowsByEmployeeId.get(campaignEmployee.id);
            bucket?.rawAdjustUsers.add(userId);
            bucket?.rawMergedUsers.add(userId);
          }

          if (sponsorEmployee && campaignEmployee && sponsorEmployee.id === campaignEmployee.id) {
            const bucket = rawRowsByEmployeeId.get(sponsorEmployee.id);
            bucket?.rawOverlapUsers.add(userId);
          }
        }

        offset += rows.length;
        if (rows.length < batchSize) break;
      }
    }

    const rows = employees.map((employee) => {
      const bucket = rawRowsByEmployeeId.get(employee.id);
      const rawInviteUsers = bucket?.rawInviteUsers ?? new Set();
      const rawAdjustUsers = bucket?.rawAdjustUsers ?? new Set();
      const rawOverlapUsers = bucket?.rawOverlapUsers ?? new Set();
      const rawMergedUsers = bucket?.rawMergedUsers ?? new Set();
      const dbInviteUsers = bucket?.dbInviteUsers ?? new Set();
      const dbAdjustUsers = bucket?.dbAdjustUsers ?? new Set();
      const dbMergedUsers = bucket?.dbMergedUsers ?? new Set();
      const expectedDbInviteUsers = Math.max(0, summarizeSet(rawInviteUsers) - summarizeSet(rawOverlapUsers));

      const row = {
        companyId: employee.company_id,
        employeeId: employee.id,
        employeeName: employee.employee_name,
        inviteCode: employee.invite_code,
        inviterId: employee.inviter_id ?? '',
        attributionKey: employee.attribution_key ?? '',
        rawInviteUsers: summarizeSet(rawInviteUsers),
        rawAdjustUsers: summarizeSet(rawAdjustUsers),
        rawOverlapUsers: summarizeSet(rawOverlapUsers),
        rawMergedUsers: summarizeSet(rawMergedUsers),
        expectedDbInviteUsers,
        dbInviteUsers: summarizeSet(dbInviteUsers),
        dbAdjustUsers: summarizeSet(dbAdjustUsers),
        dbMergedUsers: summarizeSet(dbMergedUsers),
        diffInviteUsers: expectedDbInviteUsers - summarizeSet(dbInviteUsers),
        diffAdjustUsers: summarizeSet(rawAdjustUsers) - summarizeSet(dbAdjustUsers),
        diffMergedUsers: summarizeSet(rawMergedUsers) - summarizeSet(dbMergedUsers),
        missingMergedSamples: takeSamples(rawMergedUsers, dbMergedUsers),
        extraMergedSamples: takeSamples(dbMergedUsers, rawMergedUsers)
      };
      return row;
    });

    const sortedRows = rows.sort((left, right) => {
      const leftScore = Math.abs(left.diffMergedUsers) + Math.abs(left.diffInviteUsers) + Math.abs(left.diffAdjustUsers);
      const rightScore = Math.abs(right.diffMergedUsers) + Math.abs(right.diffInviteUsers) + Math.abs(right.diffAdjustUsers);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return left.employeeName.localeCompare(right.employeeName);
    });

    const hasDiff = (row) => row.diffMergedUsers !== 0 || row.diffInviteUsers !== 0 || row.diffAdjustUsers !== 0;
    const filteredRows = options.diffOnly
      ? sortedRows.filter(hasDiff)
      : sortedRows;

    const limitedRows = filteredRows.slice(0, options.limit);
    const summary = {
      companyId: options.companyId || 'ALL',
      employeeCount: employees.length,
      diffEmployeeCount: rows.filter(hasDiff).length,
      totalRawMergedUsers: rows.reduce((sum, row) => sum + row.rawMergedUsers, 0),
      totalDbMergedUsers: rows.reduce((sum, row) => sum + row.dbMergedUsers, 0)
    };

    if (options.json) {
      console.log(JSON.stringify({ summary, rows: limitedRows }, null, 2));
      return;
    }

    console.log('=== Attribution Reconciliation Summary ===');
    console.table([summary]);
    console.log(`显示前 ${limitedRows.length} 条员工对账结果${options.diffOnly ? '（仅差异）' : ''}`);
    console.table(limitedRows.map((row) => ({
      employeeName: row.employeeName,
      inviteCode: row.inviteCode,
      inviterId: row.inviterId,
      rawInviteUsers: row.rawInviteUsers,
      dbInviteUsers: row.dbInviteUsers,
      diffInviteUsers: row.diffInviteUsers,
      rawAdjustUsers: row.rawAdjustUsers,
      dbAdjustUsers: row.dbAdjustUsers,
      diffAdjustUsers: row.diffAdjustUsers,
      rawMergedUsers: row.rawMergedUsers,
      dbMergedUsers: row.dbMergedUsers,
      diffMergedUsers: row.diffMergedUsers
    })));

    const rowsWithSamples = limitedRows.filter((row) => row.missingMergedSamples.length || row.extraMergedSamples.length);
    if (rowsWithSamples.length > 0) {
      console.log('=== Diff Samples ===');
      for (const row of rowsWithSamples) {
        console.log(`[${row.employeeName}] missing=${row.missingMergedSamples.join(', ') || '-'} extra=${row.extraMergedSamples.join(', ') || '-'}`);
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('归因对账失败');
  console.error(error);
  process.exit(1);
});
