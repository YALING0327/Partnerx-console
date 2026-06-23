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
  // 关键：SQL 里取 variant/JSON 列必须用 CONCAT('', CAST(... AS STRING)) 包一层，
  // 让结果列的字段类型是 STRING(VARCHAR) 而非 BLOB —— 否则 mysql2 在 Next.js 打包后的
  // 运行时会把 BLOB 列解码成 null/不可用对象，导致聊天解析全空。用默认 typeCast 即可。
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

// 把 mysql2(typeCast:false) 返回的 Buffer/字符串统一转成字符串
export function toBufferString(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v);
}
