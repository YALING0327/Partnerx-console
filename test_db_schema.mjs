import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.SELECTDB_HOST,
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: process.env.SELECTDB_USER,
    password: process.env.SELECTDB_PASSWORD,
    database: process.env.SELECTDB_DATABASE
  });

  const [tables] = await connection.query('SHOW TABLES');
  console.log("Tables:", tables);
  
  // Look at 'user' table schema
  const [userCols] = await connection.query('DESCRIBE `user`');
  console.log("User cols:", userCols.map(c => c.Field));

  await connection.end();
}
run().catch(console.error);
