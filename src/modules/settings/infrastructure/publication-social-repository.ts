import {
  AuthoredSocialSchema,
  AuthoredLifeModulesSchema,
} from '../../../contracts/authored-social.ts';
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

/** Only the requested fictional speaker's own modules; no world manuscript or other actors. */
export function readPublicationActorModules(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  actorId: string,
) {
  return db.transaction(ownerId, async (sql) => {
    const result = await sql.query(
      'SELECT parallel_life.publication_actor_life_modules($1,$2) AS document',
      [worldId, actorId],
    );
    const document = result.rows[0].document;
    return document === null ? undefined : AuthoredLifeModulesSchema.parse(document);
  });
}
