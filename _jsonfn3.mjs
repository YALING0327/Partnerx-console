import mysql from 'mysql2/promise'; import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const conn = await mysql.createConnection({host:process.env.SELECTDB_HOST,port:9030,user:process.env.SELECTDB_USER,password:process.env.SELECTDB_PASSWORD,database:process.env.SELECTDB_DATABASE});
const P=`CONCAT('',CAST(properties AS STRING))`;
const U=`CONCAT('',CAST(user AS STRING))`;
const inviter='250194588';
// 完整 sessions 查询: 全部用 json_extract_string 抽标量
const [rows]=await conn.query(`
  SELECT account_id AS sender,
    json_extract_string(${P}, '$.target_id') AS target_id,
    json_extract_string(${P}, '$.im_msg_info.content.content_value') AS content,
    json_extract_string(${P}, '$.im_msg_info.message_type') AS mtype,
    json_extract_string(${P}, '$.violation') AS violation,
    json_extract_string(${U}, '$.nickname') AS nickname,
    json_extract_string(${U}, '$.country') AS country,
    json_extract_string(${U}, '$.gender') AS gender,
    CONCAT('',CAST(event_created_time AS STRING)) AS t
  FROM e_immsg
  WHERE event_created_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    AND (account_id = ? OR json_extract_string(${P}, '$.target_id') = ?)
  ORDER BY event_created_time DESC LIMIT 3000`, [inviter, inviter]);
console.log('rows:', rows.length);
console.log('sample:', JSON.stringify(rows.slice(0,3)));
const map=new Map();
for(const r of rows){ const peer=String(r.sender)===inviter?String(r.target_id):String(r.sender); if(!peer||peer===inviter||peer==='null')continue; map.set(peer,(map.get(peer)||0)+1); }
console.log('对话用户数:', map.size);
await conn.end(); process.exit(0);
