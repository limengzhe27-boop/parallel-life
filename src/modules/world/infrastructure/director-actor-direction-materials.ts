import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { AuthoredLifeModulesSchema } from '../../../contracts/authored-social.ts';
import type { DirectorActorDirectionMaterial } from '../domain/director-runtime.ts';
import { authoredSourceExcerpt } from '../domain/authored-source-excerpt.ts';

/** Per-dimension server evidence budget; no SQL truncation and no model-generated summary. */
export const DIRECTOR_ACTOR_DIRECTION_EXCERPT_LIMIT = 4000;
const dimensions = ['lifeContext', 'traits', 'drives', 'behavior', 'relationships'] as const;
const fail = (): never => {
  throw Object.assign(Error('DIRECTOR_ACTOR_DIRECTION_SCOPE'), {
    code: 'DIRECTOR_ACTOR_DIRECTION_SCOPE',
  });
};

/**
 * Read inside the caller's authenticated snapshot/commit transaction. The
 * existing SQL function binds this world's immutable publication edition and
 * contact.actorKey to each exact actorId. Names and order have no authority.
 * The same helper is usable by the final repository revalidation.
 */
export async function readDirectorActorDirectionMaterials(
  sql: SqlClient,
  worldId: string,
  actorIds: readonly string[],
): Promise<DirectorActorDirectionMaterial[]> {
  if (
    !worldId ||
    actorIds.length > 12 ||
    new Set(actorIds).size !== actorIds.length ||
    actorIds.some((id) => typeof id !== 'string' || !id.trim())
  )
    return fail();
  if (!actorIds.length) return [];
  const ordered = [...actorIds].sort();
  const rows = (
    await sql.query(
      `SELECT actor_id,parallel_life.publication_actor_life_modules($1,actor_id) AS modules
     FROM unnest($2::text[]) AS actor_id ORDER BY actor_id`,
      [worldId, ordered],
    )
  ).rows;
  if (
    rows.length !== ordered.length ||
    new Set(rows.map((row) => row.actor_id)).size !== rows.length ||
    rows.some((row) => !ordered.includes(row.actor_id))
  )
    return fail();
  const result: DirectorActorDirectionMaterial[] = [];
  for (const row of [...rows].sort((a, b) =>
    String(a.actor_id).localeCompare(String(b.actor_id)),
  )) {
    if (row.modules === null) continue; // Non-publication or no authored dimensions: no fabricated fallback.
    const parsed = AuthoredLifeModulesSchema.safeParse(row.modules);
    if (!parsed.success) return fail();
    const modules: DirectorActorDirectionMaterial['modules'] = {};
    for (const key of dimensions)
      if (parsed.data[key] !== undefined)
        modules[key] = authoredSourceExcerpt(
          parsed.data[key],
          '',
          DIRECTOR_ACTOR_DIRECTION_EXCERPT_LIMIT,
        );
    if (Object.keys(modules).length) result.push({ actorId: row.actor_id, modules });
  }
  return result;
}
