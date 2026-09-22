import type { SqlClient } from './postgres.ts';
export async function consumeLimit(
  sql: SqlClient,
  ownerId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
) {
  const result = await sql.query(
    `INSERT INTO parallel_life.rate_limits(owner_id,bucket,window_start,count)
 VALUES($1,$2,to_timestamp(floor(extract(epoch from now())/$4)*$4),1)
 ON CONFLICT(owner_id,bucket) DO UPDATE SET count=CASE WHEN rate_limits.window_start<EXCLUDED.window_start THEN 1 ELSE rate_limits.count+1 END,window_start=EXCLUDED.window_start
 WHERE rate_limits.window_start<EXCLUDED.window_start OR rate_limits.count<$3 RETURNING count`,
    [ownerId, bucket, limit, windowSeconds],
  );
  if (!result.rowCount) throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
}
