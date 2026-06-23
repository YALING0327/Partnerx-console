import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}

const connection = await mysql.createConnection({
  host: process.env.SELECTDB_HOST,
  port: Number(process.env.SELECTDB_PORT || 9030),
  user: process.env.SELECTDB_USER,
  password: process.env.SELECTDB_PASSWORD,
  database: process.env.SELECTDB_DATABASE
});

const inviterId = '250194588';
const attributionKey = 'EN_dico_smt_444_tt_referral_ins_ins_all_260617';

async function query(label, sql) {
  const [rows] = await connection.query(sql);
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(rows, null, 2));
}

try {
  await query(
    'raw_counts',
    `
      SELECT
        SUM(CASE WHEN CAST(properties['sponsor'] AS STRING) = '${inviterId}' THEN 1 ELSE 0 END) AS sponsor_total,
        SUM(CASE WHEN CAST(properties['campaign'] AS STRING) = '${attributionKey}' THEN 1 ELSE 0 END) AS campaign_total,
        SUM(
          CASE
            WHEN CAST(properties['sponsor'] AS STRING) = '${inviterId}'
              OR CAST(properties['campaign'] AS STRING) = '${attributionKey}'
            THEN 1 ELSE 0
          END
        ) AS either_total
      FROM \`user\`
    `
  );

  await query(
    'raw_today_counts',
    `
      SELECT
        SUM(
          CASE
            WHEN CAST(properties['sponsor'] AS STRING) = '${inviterId}'
             AND COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) >= '2026-06-18 00:00:00'
             AND COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) < '2026-06-19 00:00:00'
            THEN 1 ELSE 0
          END
        ) AS sponsor_today,
        SUM(
          CASE
            WHEN CAST(properties['campaign'] AS STRING) = '${attributionKey}'
             AND COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) >= '2026-06-18 00:00:00'
             AND COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) < '2026-06-19 00:00:00'
            THEN 1 ELSE 0
          END
        ) AS campaign_today,
        SUM(
          CASE
            WHEN (CAST(properties['sponsor'] AS STRING) = '${inviterId}' OR CAST(properties['campaign'] AS STRING) = '${attributionKey}')
             AND COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) >= '2026-06-18 00:00:00'
             AND COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) < '2026-06-19 00:00:00'
            THEN 1 ELSE 0
          END
        ) AS either_today
      FROM \`user\`
    `
  );

  await query(
    'raw_latest_matches',
    `
      SELECT
        account_id,
        CAST(properties['campaign'] AS STRING) AS campaign,
        CAST(properties['sponsor'] AS STRING) AS sponsor,
        COALESCE(CAST(properties['register_time'] AS STRING), CAST(event_created_time AS STRING)) AS bind_time
      FROM \`user\`
      WHERE CAST(properties['sponsor'] AS STRING) = '${inviterId}'
         OR CAST(properties['campaign'] AS STRING) = '${attributionKey}'
      ORDER BY bind_time DESC
      LIMIT 30
    `
  );
} finally {
  await connection.end();
}
