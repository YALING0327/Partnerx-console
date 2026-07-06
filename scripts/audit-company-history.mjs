import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

const cwd = process.cwd();
const envLocalPath = path.join(cwd, '.env.local');
const envPath = path.join(cwd, '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function normalize(value) {
  return String(value ?? '').trim();
}

function parseArgs(argv) {
  const result = {
    companyId: '',
    pageSize: 500,
    windowDays: 7,
    outFile: '',
    progressFile: '',
    startOffset: 0,
    startBindTime: '',
    startUserId: ''
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === '--company-id' && next) {
      result.companyId = next;
      index += 1;
    } else if (current === '--page-size' && next) {
      result.pageSize = Math.max(Number(next) || 500, 100);
      index += 1;
    } else if (current === '--window-days' && next) {
      result.windowDays = Math.max(Number(next) || 7, 1);
      index += 1;
    } else if (current === '--out' && next) {
      result.outFile = next;
      index += 1;
    } else if (current === '--progress' && next) {
      result.progressFile = next;
      index += 1;
    } else if (current === '--start-offset' && next) {
      result.startOffset = Math.max(Number(next) || 0, 0);
      index += 1;
    } else if (current === '--start-bind-time' && next) {
      result.startBindTime = next;
      index += 1;
    } else if (current === '--start-user-id' && next) {
      result.startUserId = next;
      index += 1;
    }
  }

  if (!result.companyId) {
    throw new Error('Usage: node scripts/audit-company-history.mjs --company-id <companyId> [--page-size 500] [--out audit.json] [--progress progress.json]');
  }

  if (!result.outFile) {
    result.outFile = path.join(cwd, `audit-company-history-${result.companyId}.json`);
  }
  if (!result.progressFile) {
    result.progressFile = path.join(cwd, `audit-company-history-${result.companyId}.progress.json`);
  }

  return result;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function buildKeysetWhere(bindTime, platformUserId) {
  if (!bindTime) return { sql: '', params: [] };
  return {
    sql: `
      AND (
        CAST(event_created_time AS STRING) > ?
        OR (
          CAST(event_created_time AS STRING) = ?
          AND CAST(account_id AS STRING) > ?
        )
      )
    `,
    params: [bindTime, bindTime, platformUserId || '']
  };
}

function toSelectDbTime(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * 24 * 60 * 60 * 1000);
}

async function fetchAllRows(supabase, table, select, companyId) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('company_id', companyId)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: WebSocket }
    }
  );

  const employees = await fetchAllRows(
    supabase,
    'employees',
    'id, employee_name, invite_code, inviter_id, attribution_key, created_at',
    args.companyId
  );

  const employeeScopes = employees
    .map((employee) => ({
      employee,
      keys: [...new Set([employee.invite_code, employee.inviter_id, employee.attribution_key]
        .map((item) => normalize(item).toLowerCase())
        .filter(Boolean))]
    }))
    .filter((item) => item.keys.length > 0);

  if (employeeScopes.length === 0) {
    throw new Error(`No employee keys found for company ${args.companyId}`);
  }

  const connection = await mysql.createConnection({
    host: required('SELECTDB_HOST'),
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: required('SELECTDB_USER'),
    password: required('SELECTDB_PASSWORD'),
    database: required('SELECTDB_DATABASE'),
    connectTimeout: 15000
  });

  const sourceByUser = new Map();
  const progress = {
    companyId: args.companyId,
    pageSize: args.pageSize,
    windowDays: args.windowDays,
    offset: args.startOffset,
    bindTime: args.startBindTime,
    platformUserId: args.startUserId,
    employeeIndex: 0,
    employeeId: '',
    employeeName: '',
    windowStart: '',
    windowEnd: '',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pagesProcessed: 0,
    sourceUsers: 0,
    done: false
  };
  writeJson(args.progressFile, progress);

  try {
    let totalOffset = 0;
    let cursorBindTime = '';
    let cursorUserId = '';
    const now = new Date();

    for (let employeeIndex = 0; employeeIndex < employeeScopes.length; employeeIndex += 1) {
      const { employee, keys } = employeeScopes[employeeIndex];
      const inClause = keys.map(() => '?').join(',');
      let windowStart = new Date(employee.created_at || '1970-01-01T00:00:00.000Z');
      if (Number.isNaN(windowStart.getTime())) {
        windowStart = new Date('1970-01-01T00:00:00.000Z');
      }

      while (windowStart < now) {
        const windowEnd = addDays(windowStart, args.windowDays);
        const boundedWindowEnd = windowEnd < now ? windowEnd : now;
        cursorBindTime = employeeIndex === 0 && progress.pagesProcessed === 0 ? args.startBindTime : '';
        cursorUserId = employeeIndex === 0 && progress.pagesProcessed === 0 ? args.startUserId : '';

        while (true) {
          const keyset = buildKeysetWhere(cursorBindTime, cursorUserId);
          const [rows] = await connection.query(
            `
              SELECT
                json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign') AS campaign_key,
                json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor') AS sponsor_key,
                CAST(account_id AS STRING) AS platform_user_id,
                json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.app_name') AS app_name,
                json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.channel') AS channel,
                COALESCE(
                  json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.register_time'),
                  CAST(event_created_time AS STRING)
                ) AS bind_time,
                CAST(event_created_time AS STRING) AS event_time,
                CAST(properties['total_recharge_amount'] AS DOUBLE) AS total_recharge
              FROM \`user\`
              WHERE (
                LOWER(TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign'))) IN (${inClause})
                OR LOWER(TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor'))) IN (${inClause})
              )
                AND event_created_time >= ?
                AND event_created_time < ?
              ${keyset.sql}
              ORDER BY event_time ASC, platform_user_id ASC
              LIMIT ${args.pageSize}
            `,
            [...keys, ...keys, toSelectDbTime(windowStart), toSelectDbTime(boundedWindowEnd), ...keyset.params]
          );

          if (!rows || rows.length === 0) {
            break;
          }

          for (const row of rows) {
            const platformUserId = normalize(row.platform_user_id);
            if (!platformUserId) continue;
            sourceByUser.set(platformUserId, {
              platform_user_id: platformUserId,
              employee_name: employee.employee_name,
              invite_code: employee.invite_code,
              bind_time: row.bind_time,
              total_recharge: row.total_recharge ?? 0
            });
          }

          const lastRow = rows[rows.length - 1];
          cursorBindTime = normalize(lastRow.event_time);
          cursorUserId = normalize(lastRow.platform_user_id);
          totalOffset += rows.length;
          progress.offset = totalOffset;
          progress.bindTime = cursorBindTime;
          progress.platformUserId = cursorUserId;
          progress.employeeIndex = employeeIndex;
          progress.employeeId = employee.id;
          progress.employeeName = employee.employee_name;
          progress.windowStart = toSelectDbTime(windowStart);
          progress.windowEnd = toSelectDbTime(boundedWindowEnd);
          progress.pagesProcessed += 1;
          progress.sourceUsers = sourceByUser.size;
          progress.updatedAt = new Date().toISOString();
          writeJson(args.progressFile, progress);

          if (rows.length < args.pageSize) {
            break;
          }
        }

        windowStart = boundedWindowEnd;
      }

      progress.employeeIndex = employeeIndex + 1;
      progress.employeeId = '';
      progress.employeeName = '';
      progress.bindTime = '';
      progress.platformUserId = '';
      progress.windowStart = '';
      progress.windowEnd = '';
      progress.updatedAt = new Date().toISOString();
      writeJson(args.progressFile, progress);
    }

    const attributionRows = await fetchAllRows(
      supabase,
      'attribution_users',
      'platform_user_id, employee_id, bind_time',
      args.companyId
    );

    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const partnerxByUser = new Map(
      attributionRows.map((row) => [
        normalize(row.platform_user_id),
        {
          platform_user_id: normalize(row.platform_user_id),
          employee_name: employeeById.get(row.employee_id)?.employee_name ?? '',
          invite_code: employeeById.get(row.employee_id)?.invite_code ?? '',
          bind_time: row.bind_time
        }
      ])
    );

    const sourceIds = [...sourceByUser.keys()];
    const missing = sourceIds.filter((id) => !partnerxByUser.has(id)).map((id) => sourceByUser.get(id));
    const mismatched = sourceIds
      .filter((id) => partnerxByUser.has(id) && sourceByUser.get(id).invite_code !== partnerxByUser.get(id).invite_code)
      .map((id) => ({ source: sourceByUser.get(id), target: partnerxByUser.get(id) }));

    const missingByEmployee = new Map();
    for (const item of missing) {
      const key = `${item.employee_name}__${item.invite_code}`;
      missingByEmployee.set(key, (missingByEmployee.get(key) ?? 0) + 1);
    }

    const result = {
      companyId: args.companyId,
      pageSize: args.pageSize,
      sourceCount: sourceIds.length,
      partnerxCount: partnerxByUser.size,
      missingCount: missing.length,
      missingByEmployee: [...missingByEmployee.entries()]
        .map(([key, count]) => {
          const [employee_name, invite_code] = key.split('__');
          return { employee_name, invite_code, count };
        })
        .sort((left, right) => right.count - left.count),
      missing,
      mismatchedCount: mismatched.length,
      mismatched
    };

    writeJson(args.outFile, result);
    progress.done = true;
    progress.updatedAt = new Date().toISOString();
    progress.sourceUsers = sourceByUser.size;
    progress.bindTime = '';
    progress.platformUserId = '';
    progress.employeeIndex = employeeScopes.length;
    progress.employeeId = '';
    progress.employeeName = '';
    progress.windowStart = '';
    progress.windowEnd = '';
    writeJson(args.progressFile, progress);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
