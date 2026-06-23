import mysql from 'mysql2/promise';

// SelectDB（阿里云，mysql2 协议）运行时查询工具。
// 注意：SelectDB 只对生产服务器出口 IP 放行，本地连不上属正常。
// IM 查询低频，按需建连后立即关闭，不做长连接池，避免 serverless/常驻进程连接泄漏。

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

export async function querySelectDB<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  // 重要：不自定义 typeCast。所有查询的 variant/JSON 列都用 CAST(... AS STRING) 取出，
  // mysql2 默认即返回纯字符串。一旦自定义 typeCast 调 field.string()，在 Next.js 打包后的
  // 运行时会返回 String 包装对象(typeof==='object')，导致 JSON.parse 取不到字段、聊天解析为空。
  const connection = await mysql.createConnection({
    host: required('SELECTDB_HOST'),
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: required('SELECTDB_USER'),
    password: required('SELECTDB_PASSWORD'),
    database: required('SELECTDB_DATABASE'),
    connectTimeout: 15000
  });
  try {
    const [rows] = await connection.query(sql, params);
    return (Array.isArray(rows) ? rows : []) as T[];
  } finally {
    await connection.end().catch(() => {});
  }
}
