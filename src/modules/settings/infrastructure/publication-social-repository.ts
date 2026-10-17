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

/** Merges dynamic in-world moments with static authored social moments, sorted by at DESC. */
export function mergeSocialMoments(
  authoredSocial: import('../../../contracts/authored-social.ts').AuthoredSocial,
  worldMoments?: {
    key: string;
    actorId: string;
    name: string;
    text: string;
    at: string;
    image?: string;
    images?: string[];
  }[],
  interactions?: {
    id: string;
    momentKey: string;
    actorId: string;
    kind: 'like' | 'comment';
    comment?: string;
    at: string;
  }[],
  actors?: { id: string; name: string }[],
) {
  const dynamicMoments = (worldMoments ?? []).map((m) => ({
    key: m.key,
    actorId: m.actorId,
    name: m.name,
    text: m.text,
    at: m.at,
    ...(m.image ? { image: m.image } : {}),
    ...(m.images && m.images.length ? { images: m.images } : {}),
  }));

  const combined = [...dynamicMoments, ...authoredSocial.moments];
  const seen = new Set<string>();
  const uniqueMoments = combined.filter((m) => {
    if (seen.has(m.key)) return false;
    seen.add(m.key);
    return true;
  });
  uniqueMoments.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const momentsWithInteractions = uniqueMoments.slice(0, 48).map((m) => {
    const matchingInteractions = (interactions ?? []).filter((i) => i.momentKey === m.key);
    const likes = matchingInteractions
      .filter((i) => i.kind === 'like')
      .map((i) => ({
        actorId: i.actorId,
        name: actors?.find((a) => a.id === i.actorId)?.name || i.actorId,
      }));
    const comments = matchingInteractions
      .filter((i) => i.kind === 'comment')
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((i) => ({
        id: i.id,
        actorId: i.actorId,
        name: actors?.find((a) => a.id === i.actorId)?.name || i.actorId,
        text: i.comment ?? '',
        at: i.at,
      }));
    return {
      ...m,
      ...(likes.length ? { likes } : {}),
      ...(comments.length ? { comments } : {}),
    };
  });

  return AuthoredSocialSchema.parse({
    ...authoredSocial,
    moments: momentsWithInteractions,
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
