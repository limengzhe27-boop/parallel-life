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
      'SELECT parallel_life.publication_actor_life_modules($1,$2) AS document, parallel_life.publication_actor_moment_confirmations($1,$2) AS statements',
      [worldId, actorId],
    );
    const document = result.rows[0].document;
    const modules = document === null ? undefined : AuthoredLifeModulesSchema.parse(document);
    const statements = result.rows[0].statements;
    if (!Array.isArray(statements) || !statements.length) return modules;
    const note =
      '\n编剧身份确认规则：仅在你确实向主角确认相应身份、且剧情或对话需要告知时，单独完整发送下列原句。不要为了开启照片主动剧透，也不要把它们作为引用、猜测或假设。\n' +
      statements.join('\n');
    const behavior = (modules?.behavior ?? '') + note;
    if (behavior.length > 16384) return modules;
    return AuthoredLifeModulesSchema.parse({ ...modules, behavior });
  });
}
