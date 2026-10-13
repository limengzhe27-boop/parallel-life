import { AuthoredSocialSchema } from '../../../contracts/authored-social.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
/** Reads only the immutable, player-visible edition bound to the authorized world. */
export function readPublicationSocial(db: PostgresDatabase, ownerId: string, worldId: string) {
  return db.transaction(ownerId, async (sql) => {
    const result = await sql.query(
      'SELECT parallel_life.publication_social_opening($1) AS document',
      [worldId],
    );
    return AuthoredSocialSchema.parse(result.rows[0].document);
  });
}
