import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const connection = await mysql.createConnection({
  host: process.env.SELECTDB_HOST,
  port: Number(process.env.SELECTDB_PORT),
  user: process.env.SELECTDB_USER,
  password: process.env.SELECTDB_PASSWORD,
  database: process.env.SELECTDB_DATABASE,
});

const [rows] = await connection.execute("SELECT event, properties['status'] as status, COUNT(*) as c, SUM(CAST(COALESCE(properties['amount'], properties['money'], properties['price'], properties['pay_amount'], properties['usd_amount'], '0') AS DECIMAL)) as amt FROM recharge GROUP BY event, properties['status'] LIMIT 50");
console.log('Events in SelectDB:', rows);

await connection.end();
