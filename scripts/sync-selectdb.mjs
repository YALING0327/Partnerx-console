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

function toKeysetTime(value) {
  if (!value) return '1970-01-01 00:00:00';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    return raw.slice(0, 19);
  }
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
  return time.toISOString().slice(0, 19).replace('T', ' ');
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

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeInviteCode(value) {
  return normalizeText(value).toLowerCase();
}

// 按 app_name(包名) 后缀判定用户来源平台：android / ios / unknown。
// 安卓包：含 .android / .gp / dico；苹果包：含 .ios / mitu。channel 作兜底(dcg=安卓, mitu=苹果)。
function detectPlatform(appName, channel) {
  const a = normalizeText(appName).toLowerCase();
  const c = normalizeText(channel).toLowerCase();
  if (/\.ios\b|ios$|mitu/.test(a) || /ios|mitu/.test(c)) return 'ios';
  if (/\.android\b|android$|\.gp\b|dico|dcg/.test(a) || /android|\bgp\b|dcg/.test(c)) return 'android';
  return 'unknown';
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

// 返回充值金额，单位「美元分」(前端 fmt() 会 ÷100 显示，历史数据存的也是分)。
// 源表 properties 是 variant：内层 amount 即「美元分」(== price_dollar × 100)。
// 缺失时再从美元字段折算为分，避免把 2.99 直接当成 2.99 分写入。
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

function extractRechargeStatus(row) {
  const usdAmount = parseJsonObject(row.usd_amount);
  const topLevelStatus = row.status ?? row.pay_status ?? '';
  const nestedStatus = usdAmount?.pay_status ?? '';
  // 顶层 pay_status 缺失时回退到 usd_amount 内嵌的 pay_status，避免成功单被误判。
  const effectiveStatus = normalizeText(topLevelStatus) ? topLevelStatus : nestedStatus;
  return normalizeStatus(effectiveStatus || 'success');
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

function pickPreferredAttribution(current, next) {
  if (!current) return next;
  if (current.source === 'invite') return current;
  if (next.source === 'invite') return next;
  return current;
}

function pickPreferredRecharge(current, next) {
  if (!current) return next;
  const currentPayTime = String(current.pay_time ?? '');
  const nextPayTime = String(next.pay_time ?? '');
  if (nextPayTime > currentPayTime) return next;
  if (nextPayTime === currentPayTime && String(next.status ?? '') === 'success' && String(current.status ?? '') !== 'success') {
    return next;
  }
  return current;
}

function buildKeysetPaginationSql(timeExpr, idExpr, keysetTime, keysetId) {
  const normalizedTime = normalizeText(keysetTime);
  if (!normalizedTime) return '';
  const normalizedId = normalizeText(keysetId);
  return ` AND (
    ${timeExpr} > ${mysql.escape(normalizedTime)}
    OR (${timeExpr} = ${mysql.escape(normalizedTime)} AND ${idExpr} > ${mysql.escape(normalizedId)})
  )`;
}

function chunkArray(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function buildAttributionCacheItem(item) {
  return {
    company_id: item.company_id,
    employee_id: item.employee_id,
    platform_user_id: item.platform_user_id
  };
}

function isFilledAttributionSnapshot(item) {
  if (!item) return false;
  const bindTime = normalizeText(item.bind_time);
  const bindStatus = normalizeText(item.bind_status);
  const appPlatform = normalizeText(item.app_platform).toLowerCase();
  return !!bindTime && !!bindStatus && !!appPlatform && appPlatform !== 'unknown';
}

function mergeAttributionSnapshot(existing, next) {
  if (!existing) return next;
  const existingPlatform = normalizeText(existing.app_platform).toLowerCase();
  return {
    company_id: existing.company_id ?? next.company_id,
    employee_id: existing.employee_id ?? next.employee_id,
    platform_user_id: next.platform_user_id,
    invite_code: normalizeText(existing.invite_code) || next.invite_code,
    bind_time: normalizeText(existing.bind_time) || next.bind_time,
    bind_status: normalizeText(existing.bind_status) || next.bind_status,
    app_platform: existingPlatform && existingPlatform !== 'unknown'
      ? existing.app_platform
      : next.app_platform
  };
}

function isSameAttributionSnapshot(left, right) {
  if (!left || !right) return false;
  return String(left.company_id ?? '') === String(right.company_id ?? '')
    && String(left.employee_id ?? '') === String(right.employee_id ?? '')
    && normalizeText(left.platform_user_id) === normalizeText(right.platform_user_id)
    && normalizeText(left.invite_code) === normalizeText(right.invite_code)
    && normalizeText(left.bind_time) === normalizeText(right.bind_time)
    && normalizeText(left.bind_status) === normalizeText(right.bind_status)
    && normalizeText(left.app_platform).toLowerCase() === normalizeText(right.app_platform).toLowerCase();
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
    process.env.SELECTDB_ATTRIBUTION_RAW_SQL || `
      SELECT
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign') AS campaign_key,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor') AS sponsor_key,
        account_id AS platform_user_id,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.app_name') AS app_name,
        json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.channel') AS channel,
        COALESCE(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.register_time'), CAST(event_created_time AS STRING)) AS bind_time
      FROM \`user\`
      WHERE (json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign') IS NOT NULL AND json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign') != '')
         OR (json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor') IS NOT NULL AND json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor') != '')
    `
  );
  const rechargeSql = stripTrailingSemicolon(`
      SELECT
        r.id AS order_no,
        r.account_id AS platform_user_id,
        CAST(NULL AS STRING) AS campaign_key,
        CAST(NULL AS STRING) AS sponsor_key,
        CAST(r.properties['price_dollar'] AS STRING) AS price_dollar,
        CAST(r.properties['goods_amount'] AS STRING) AS goods_amount,
        CAST(r.properties['income_dollar'] AS STRING) AS income_dollar,
        CAST(r.properties['amount'] AS STRING) AS amount,
        r.properties['money'] AS money,
        r.properties['price'] AS price,
        r.properties['pay_amount'] AS pay_amount,
        CAST(r.properties['usd_amount'] AS STRING) AS usd_amount,
        CAST(r.properties['pay_status'] AS STRING) AS pay_status,
        -- SelectDB 的 recharge.event_created_time 表示订单创建时间；当前 Supabase 仍沿用 pay_time 列名承载它。
        r.event_created_time AS pay_time,
        r.event_created_time AS pay_created_time
      FROM recharge r
    `);
  const filteredRechargeSql = stripTrailingSemicolon(
    process.env.SELECTDB_RECHARGE_RAW_SQL || `
      SELECT
        r.id AS order_no,
        r.account_id AS platform_user_id,
        CAST(u.campaign AS STRING) AS campaign_key,
        CAST(u.sponsor AS STRING) AS sponsor_key,
        CAST(r.properties['price_dollar'] AS STRING) AS price_dollar,
        CAST(r.properties['goods_amount'] AS STRING) AS goods_amount,
        CAST(r.properties['income_dollar'] AS STRING) AS income_dollar,
        CAST(r.properties['amount'] AS STRING) AS amount,
        r.properties['money'] AS money,
        r.properties['price'] AS price,
        r.properties['pay_amount'] AS pay_amount,
        CAST(r.properties['usd_amount'] AS STRING) AS usd_amount,
        CAST(r.properties['pay_status'] AS STRING) AS pay_status,
        -- SelectDB 的 recharge.event_created_time 表示订单创建时间；当前 Supabase 仍沿用 pay_time 列名承载它。
        r.event_created_time AS pay_time,
        r.event_created_time AS pay_created_time
      FROM recharge r
      JOIN (
        SELECT
          account_id,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.campaign')) AS campaign,
          TRIM(json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.sponsor')) AS sponsor
        FROM \`user\`
      ) u ON r.account_id = u.account_id
      WHERE (u.campaign IS NOT NULL AND u.campaign != '')
         OR (u.sponsor IS NOT NULL AND u.sponsor != '')
    `
  );

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
      const employeeByDirectKey = new Map();
      const employeeByAttributionKey = new Map();
      for (const employee of employees ?? []) {
        const inviteCodeKey = normalizeInviteCode(employee.invite_code);
        if (inviteCodeKey) employeeByDirectKey.set(inviteCodeKey, employee);
        const inviterIdKey = normalizeInviteCode(employee.inviter_id);
        if (inviterIdKey) employeeByDirectKey.set(inviterIdKey, employee);
        const attributionKey = normalizeInviteCode(employee.attribution_key);
        if (attributionKey) employeeByAttributionKey.set(attributionKey, employee);
      }
      const employeeInviteKeys = [...new Set([
        ...employeeByDirectKey.keys(),
        ...employeeByAttributionKey.keys()
      ].filter(Boolean))];

      function resolveEmployeeAttribution(rawKey) {
        const normalizedKey = normalizeInviteCode(rawKey);
        if (!normalizedKey) return null;
        const directEmployee = employeeByDirectKey.get(normalizedKey);
        if (directEmployee) return { employee: directEmployee, source: 'invite' };
        const attributionEmployee = employeeByAttributionKey.get(normalizedKey);
        if (attributionEmployee) return { employee: attributionEmployee, source: 'adjust' };
        return null;
      }

      async function loadExistingAttributionSnapshots(platformUserIds) {
        const existing = new Map();
        for (const group of chunkArray(platformUserIds, 200)) {
          if (group.length === 0) continue;
          const { data, error } = await supabase
            .from('attribution_users')
            .select('company_id, employee_id, platform_user_id, invite_code, bind_time, bind_status, app_platform')
            .in('platform_user_id', group);
          if (error) throw error;
          for (const item of data ?? []) {
            existing.set(String(item.platform_user_id), item);
          }
        }
        return existing;
      }

      async function hydrateAttributionCache(platformUserIds, attributionCache) {
        const missingUserIds = [...new Set(platformUserIds.filter((id) => id && !attributionCache.has(id)))];
        if (missingUserIds.length === 0) return;

        for (const group of chunkArray(missingUserIds, 200)) {
          const { data, error } = await supabase
            .from('attribution_users')
            .select('company_id, employee_id, platform_user_id')
            .in('platform_user_id', group);
          if (error) throw error;
          for (const item of data ?? []) {
            attributionCache.set(String(item.platform_user_id), buildAttributionCacheItem(item));
          }
        }

        const unresolvedUserIds = missingUserIds.filter((id) => !attributionCache.has(id));
        if (unresolvedUserIds.length === 0) return;

        const selectdbAttributionByUser = new Map();
        for (const group of chunkArray(unresolvedUserIds, 200)) {
          const sql = `
            SELECT t.campaign_key, t.sponsor_key, t.platform_user_id, t.app_name, t.channel, t.bind_time
            FROM (${attributionSql}) t
            WHERE CAST(t.platform_user_id AS STRING) IN (${group.map((id) => mysql.escape(id)).join(',')})
          `;
          const [rowsRaw] = await connection.query(sql);
          const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
          for (const row of rows) {
            const platformUserId = normalizeText(row.platform_user_id);
            if (!platformUserId) continue;
            const campaignResolved = resolveEmployeeAttribution(row.campaign_key);
            const sponsorResolved = resolveEmployeeAttribution(row.sponsor_key);
            const resolved = campaignResolved ?? sponsorResolved;
            if (!resolved) continue;

            const nextAttribution = {
              company_id: resolved.employee.company_id,
              employee_id: resolved.employee.id,
              platform_user_id: platformUserId,
              invite_code: resolved.employee.invite_code,
              bind_time: toIso(row.bind_time),
              bind_status: resolved.source,
              app_platform: detectPlatform(row.app_name, row.channel)
            };
            selectdbAttributionByUser.set(
              platformUserId,
              pickPreferredAttribution(selectdbAttributionByUser.get(platformUserId), nextAttribution)
            );
          }
        }
        const backfillRows = [...selectdbAttributionByUser.values()];
        if (!dryRun) {
          for (const group of chunkArray(backfillRows, 1000)) {
            if (group.length === 0) continue;
            const { error } = await supabase
              .from('attribution_users')
              .upsert(group, { onConflict: 'company_id,platform_user_id' });
            if (error) throw error;
          }
        }

        for (const item of backfillRows) {
          attributionCache.set(String(item.platform_user_id), buildAttributionCacheItem(item));
        }
      }

      const newKeys = employeeInviteKeys.filter(k => !cursor.synced_keys.includes(k));
      if (newKeys.length > 0 && !resetCursor) {
        console.log(`发现新添加的邀请码/ID: ${newKeys.join(', ')}，准备为其进行历史数据回溯...`);
      }

      // 提取核心的归因同步逻辑为一个函数，方便复用
      async function syncAttributionLoop(targetKeys, startKeyset, isCatchUp = false) {
        if (targetKeys.length === 0) return { keyset: startKeyset, cache: new Map(), read: 0, hit: 0 };
        const inviteFilterKeys = targetKeys;
        const keyset = { ...startKeyset };
        let read = 0;
        let hit = 0;
        const cache = new Map();

        while (true) {
          const normalizedCampaignExpr = `LOWER(TRIM(CAST(t.campaign_key AS STRING)))`;
          const normalizedSponsorExpr = `LOWER(TRIM(CAST(t.sponsor_key AS STRING)))`;
          const bindTimeExpr = `CAST(t.bind_time AS STRING)`;
          const platformUserExpr = `CAST(t.platform_user_id AS STRING)`;
          const inviteMatchSql = inviteFilterKeys.length === 1
            ? `(${normalizedCampaignExpr} = ${mysql.escape(inviteFilterKeys[0])} OR ${normalizedSponsorExpr} = ${mysql.escape(inviteFilterKeys[0])})`
            : `(${normalizedCampaignExpr} IN (${inviteFilterKeys.map(k => mysql.escape(k)).join(',')}) OR ${normalizedSponsorExpr} IN (${inviteFilterKeys.map(k => mysql.escape(k)).join(',')}))`;
          const inviteFilterSql = ` AND ${inviteMatchSql}`;
          const keysetFilterSql = buildKeysetPaginationSql(bindTimeExpr, platformUserExpr, keyset.bind_time, keyset.platform_user_id);
          const sql = `
            SELECT t.campaign_key, t.sponsor_key, t.platform_user_id, t.app_name, t.channel, t.bind_time
            FROM (${attributionSql}) t
            WHERE 1=1
            ${inviteFilterSql}
            ${keysetFilterSql}
            ORDER BY t.bind_time ASC, t.platform_user_id ASC
            LIMIT ${batchSize}
          `;
          const [rowsRaw] = await connection.query(sql);
          const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
          if (rows.length === 0) break;

          read += rows.length;
          if (!isCatchUp) console.log(`归因批次读取: ${rows.length} 条（累计 ${read}）`);

          const attributionByUser = new Map();
          for (const row of rows) {
            const platformUserId = normalizeText(row.platform_user_id);
            if (!platformUserId) continue;

            const campaignResolved = resolveEmployeeAttribution(row.campaign_key);
            const sponsorResolved = resolveEmployeeAttribution(row.sponsor_key);
            const resolved = campaignResolved ?? sponsorResolved;
            if (!resolved) continue;

            hit += 1;
            const nextAttribution = {
              company_id: resolved.employee.company_id,
              employee_id: resolved.employee.id,
              platform_user_id: platformUserId,
              invite_code: resolved.employee.invite_code,
              bind_time: toIso(row.bind_time),
              bind_status: resolved.source,
              app_platform: detectPlatform(row.app_name, row.channel)
            };
            attributionByUser.set(
              platformUserId,
              pickPreferredAttribution(attributionByUser.get(platformUserId), nextAttribution)
            );
          }

          const candidateRows = [...attributionByUser.values()];
          const existingSnapshots = await loadExistingAttributionSnapshots(
            candidateRows.map((item) => String(item.platform_user_id))
          );
          const batchUpserts = [];

          for (const item of candidateRows) {
            const existing = existingSnapshots.get(String(item.platform_user_id));
            if (!existing) {
              batchUpserts.push(item);
              cache.set(String(item.platform_user_id), buildAttributionCacheItem(item));
              continue;
            }

            const merged = mergeAttributionSnapshot(existing, item);
            cache.set(String(item.platform_user_id), buildAttributionCacheItem(merged));
            if (isFilledAttributionSnapshot(existing)) continue;
            if (!isSameAttributionSnapshot(existing, merged)) {
              batchUpserts.push(merged);
            }
          }

          for (const chunk of chunkArray(batchUpserts, 1000)) {
            if (!dryRun && chunk.length > 0) {
              const { error } = await supabase
                .from('attribution_users')
                .upsert(chunk, { onConflict: 'company_id,platform_user_id' });
              if (error) throw error;
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
        const inviteFilterKeys = targetKeys;
        const keyset = { ...startKeyset };
        let read = 0;
        let hit = 0;
        // 始终使用带 user JOIN + campaign/sponsor 过滤的查询：只遍历"有归因的充值"，
        // 而不是全量扫描 700 亿行的 recharge 表。此前全量键增量会走无过滤全表扫描，
        // 在 timeout 前无法提交任何批次，导致 recharge 游标长期停滞。
        const useFilteredRechargeQuery = true;

        while (true) {
          const normalizedCampaignExpr = `LOWER(TRIM(CAST(t.campaign_key AS STRING)))`;
          const normalizedSponsorExpr = `LOWER(TRIM(CAST(t.sponsor_key AS STRING)))`;
          const payTimeExpr = `CAST(t.pay_created_time AS STRING)`;
          const orderNoExpr = `CAST(t.order_no AS STRING)`;
          const inviteMatchSql = inviteFilterKeys.length === 1
            ? `(${normalizedCampaignExpr} = ${mysql.escape(inviteFilterKeys[0])} OR ${normalizedSponsorExpr} = ${mysql.escape(inviteFilterKeys[0])})`
            : `(${normalizedCampaignExpr} IN (${inviteFilterKeys.map(k => mysql.escape(k)).join(',')}) OR ${normalizedSponsorExpr} IN (${inviteFilterKeys.map(k => mysql.escape(k)).join(',')}))`;
          const inviteFilterSql = useFilteredRechargeQuery ? ` AND ${inviteMatchSql}` : '';
          const keysetFilterSql = buildKeysetPaginationSql(payTimeExpr, orderNoExpr, keyset.pay_time, keyset.order_no);
          const sql = `
            SELECT t.order_no, t.platform_user_id, t.campaign_key, t.sponsor_key, t.price_dollar, t.goods_amount, t.income_dollar, t.amount, t.money, t.price, t.pay_amount, t.usd_amount, t.pay_status, t.pay_created_time
            FROM (${useFilteredRechargeQuery ? filteredRechargeSql : rechargeSql}) t
            WHERE 1=1
            ${inviteFilterSql}
            ${keysetFilterSql}
            ORDER BY t.pay_created_time ASC, t.order_no ASC
            LIMIT ${batchSize}
          `;
          const [rowsRaw] = await connection.query(sql);
          const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
          if (rows.length === 0) break;

          read += rows.length;
          if (!isCatchUp) console.log(`充值批次读取: ${rows.length} 条（累计 ${read}）`);

          const platformUserIds = [...new Set(rows.map((r) => normalizeText(r.platform_user_id)).filter(Boolean))];
          await hydrateAttributionCache(platformUserIds, attributionCache);

          const rechargeByOrder = new Map();
          for (const row of rows) {
            const platformUserId = normalizeText(row.platform_user_id);
            const orderNo = normalizeText(row.order_no);
            if (!platformUserId || !orderNo) continue;

            const attribution = attributionCache.get(platformUserId);
            const campaignResolved = resolveEmployeeAttribution(row.campaign_key);
            const sponsorResolved = resolveEmployeeAttribution(row.sponsor_key);
            const resolved = campaignResolved ?? sponsorResolved;
            const employee = resolved?.employee ?? null;
            const companyId = attribution?.company_id ?? employee?.company_id;
            const employeeId = attribution?.employee_id ?? employee?.id;
            if (!companyId || !employeeId) continue;

            hit += 1;
            const nextRecharge = {
              company_id: companyId,
              employee_id: employeeId,
              platform_user_id: platformUserId,
              order_no: orderNo,
              amount: extractRechargeAmount(row) / amountDivisor,
              status: extractRechargeStatus(row),
              pay_time: toIso(row.pay_created_time),
              is_first_recharge: false
            };
            rechargeByOrder.set(orderNo, pickPreferredRecharge(rechargeByOrder.get(orderNo), nextRecharge));
          }

          const batchRechargeUpserts = [...rechargeByOrder.values()];

          for (const chunk of chunkArray(batchRechargeUpserts, 1000)) {
            if (!dryRun && chunk.length > 0) {
              const { error } = await supabase.from('recharge_orders').upsert(chunk, { onConflict: 'order_no' });
              if (error) throw error;
            }
          }

          const last = rows[rows.length - 1];
          keyset.pay_time = toKeysetTime(last.pay_created_time);
          keyset.pay_created_time = keyset.pay_time;
          keyset.order_no = normalizeText(last.order_no) || keyset.order_no;

          if (!dryRun && !isCatchUp) {
            cursor.recharge = { ...keyset };
            writeJsonFile(cursorFilePath, cursor);
          }
        }
        return { keyset, read, hit };
      }

      const globalAttributionCache = new Map();

      // 阶段 1：对新增的邀请码进行历史数据追溯 (从 1970 开始)。
      // 逐个 key 处理并即时持久化 synced_keys：即使进程被 timeout 杀掉，
      // 已完成的 key 也不会在下次运行时被重复全量回溯。
      if (newKeys.length > 0 && !resetCursor) {
        for (const key of newKeys) {
          const catchUpAttribution = await syncAttributionLoop([key], { bind_time: '1970-01-01 00:00:00', platform_user_id: '' }, true);
          for (const [k, v] of catchUpAttribution.cache) globalAttributionCache.set(k, v);
          const catchUpRecharge = await syncRechargeLoop([key], { pay_time: '1970-01-01 00:00:00', order_no: '' }, globalAttributionCache, true);
          cursor.synced_keys.push(key);
          if (!dryRun) writeJsonFile(cursorFilePath, cursor);
          console.log(`历史追溯完成（${key}）：追溯归因 ${catchUpAttribution.hit} 条，追溯充值 ${catchUpRecharge.hit} 条`);
        }
      }

      // 阶段 2：对所有当前邀请码执行增量同步
      const inviteFilterKeys = onlyInviteKey ? [onlyInviteKey] : (employeeInviteKeys.length > 0 && employeeInviteKeys.length <= inviteFilterLimit ? employeeInviteKeys : []);
      
      const attributionKeyset = cursor.attribution ?? { bind_time: process.env.SELECTDB_ATTRIBUTION_START_TIME || '1970-01-01 00:00:00', platform_user_id: '' };
      const incrementalAttribution = await syncAttributionLoop(inviteFilterKeys, attributionKeyset, false);
      for (const [k, v] of incrementalAttribution.cache) globalAttributionCache.set(k, v);
      console.log(`增量归因读取完成：读取 ${incrementalAttribution.read} 条，命中 ${incrementalAttribution.hit} 条`);

      const rechargeCursor = cursor.recharge
        ? {
          pay_time: cursor.recharge.pay_time ?? cursor.recharge.pay_created_time ?? '',
          order_no: cursor.recharge.order_no ?? ''
        }
        : null;
      const rechargeKeyset = rechargeCursor ?? { pay_time: process.env.SELECTDB_RECHARGE_START_TIME || '1970-01-01 00:00:00', order_no: '' };
      const incrementalRecharge = await syncRechargeLoop(inviteFilterKeys, rechargeKeyset, globalAttributionCache, false);
      console.log(`增量充值读取完成：读取 ${incrementalRecharge.read} 条，命中 ${incrementalRecharge.hit} 条`);

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
