import 'server-only';
import { ProfileSchema } from '../contracts/api.ts';
import { profilePhotoRoles } from '../modules/discovery/infrastructure/profile-photo-roles.ts';
import { TaskError } from '../modules/tasks/infrastructure/task-repository.ts';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
/** Read-only composition for photo purposes; does not invoke models or change profiles. */
export function readProfilePhotoRoles(db: PostgresDatabase, ownerId: string) {
  return db.transaction(ownerId, async (sql) => {
    const row = (
      await sql.query(
        'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR SHARE',
        [ownerId],
      )
    ).rows[0];
    if (!row) throw new TaskError('NOT_FOUND');
    return profilePhotoRoles(
      sql,
      ownerId,
      ProfileSchema.parse({ ...row.document, version: row.version }),
    );
  });
}
