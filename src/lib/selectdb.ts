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
    // variant/JSON/BLOB 列统一转成字符串再交给上层 JSON.parse。
    // 注意：必须用 field.string() 不带编码参数 —— 带 'utf8' 参数时 mysql2 在大结果集下
    // 会返回不一致的类型(有时是已解析对象/String 包装)，导致 JSON.parse 解析不到字段。
    typeCast: (field: any, next: any) => {
      if (field.type === 'JSON' || field.type === 'BLOB' || field.type === 'LONG_BLOB' || field.type === 'VAR_STRING' || field.type === 'STRING') {
        return field.string();
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
