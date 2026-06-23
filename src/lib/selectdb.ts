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
  const connection = await mysql.createConnection({
    host: required('SELECTDB_HOST'),
    port: Number(process.env.SELECTDB_PORT || 9030),
    user: required('SELECTDB_USER'),
    password: required('SELECTDB_PASSWORD'),
    database: required('SELECTDB_DATABASE'),
    // variant/JSON 列统一按 utf8 字符串取出，避免 mysql2 把非 JSON 值误当 JSON 解析报错
    typeCast: (field: any, next: any) => {
      if (field.type === 'JSON' || field.type === 'BLOB' || field.type === 'LONG_BLOB') {
        return field.string('utf8');
      }
      return next();
    },
    connectTimeout: 15000
  });
  try {
    const [rows] = await connection.query(sql, params);
    return (Array.isArray(rows) ? rows : []) as T[];
  } finally {
    await connection.end().catch(() => {});
  }
}
