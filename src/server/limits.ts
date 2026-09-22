import 'server-only';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { consumeLimit } from '../modules/storage/infrastructure/limits.ts';
export async function requestLimit(db: PostgresDatabase, ownerId: string) {
  await db.transaction(ownerId, (sql) => consumeLimit(sql, ownerId, 'api-minute', 120, 60));
}
