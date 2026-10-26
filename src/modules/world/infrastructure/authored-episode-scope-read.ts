import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';
import { validAuthoredOpportunityCast } from '../domain/authored-opportunity-cast.ts';
import type { DirectorDecision, DirectorSnapshot } from '../domain/director-runtime.ts';
import { readAuthoredAgentMaterialCatalog } from './authored-agent-material-repository.ts';
import { DomainError } from '../domain/errors.ts';

/** Certifies only an original/current author cast mismatch, never reclassifies
 * missing evidence or DB failure as an invalid episode. Does not consume work.
 */
export async function readInvalidAuthoredEpisodeIds(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; engineEpoch: number },
  episodeIds?: readonly string[],
  onlyUnperformedProposals = false,
): Promise<Set<string>> {
  const invalid = new Set<string>();
  if (episodeIds && !episodeIds.length) return invalid;
  const rows = (
    await sql.query(
      `SELECT ep.id,a.id AS attempt_id,d.document,a.snapshot,a.input_hash,a.response_hash,w.version,ARRAY(SELECT actor->>'id' FROM jsonb_array_elements(w.state->'actors') actor) AS actor_ids
     FROM parallel_life.shared_episodes ep
     JOIN parallel_life.director_decisions d ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id AND d.id=ep.origin_decision_id AND d.engine_epoch=$3
     JOIN parallel_life.director_runtime_attempts a ON a.world_id=d.world_id AND a.owner_id=d.owner_id AND a.id=d.attempt_id AND a.decision_id=d.id AND a.input_hash=d.input_hash AND a.engine_epoch=d.engine_epoch AND a.expected_world_version=d.world_version AND a.status='committed' AND a.response_hash IS NOT NULL
     JOIN parallel_life.worlds w ON w.id=ep.world_id AND w.owner_id=ep.owner_id
     WHERE ep.world_id=$1 AND ep.owner_id=$2 AND ($4::text[] IS NULL OR ep.id=ANY($4::text[]))
       AND ($4::text[] IS NOT NULL OR ep.document->>'status'='proposed')
       AND (NOT $5::boolean OR (
         ep.document->>'status'='proposed' AND COALESCE(ep.document->'resultIds','[]'::jsonb)='[]'::jsonb
         AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts r WHERE r.world_id=ep.world_id AND r.owner_id=ep.owner_id AND r.episode_id=ep.id AND (r.choice NOT IN ('quiet','unassessed') OR r.presented_message_ids<>'[]'::jsonb))
         AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_evidence e WHERE e.world_id=ep.world_id AND e.owner_id=ep.owner_id AND e.episode_id=ep.id)
         AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_outcomes o WHERE o.world_id=ep.world_id AND o.owner_id=ep.owner_id AND o.episode_id=ep.id)
         AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_requests q
           JOIN parallel_life.actor_agent_states s ON s.world_id=q.world_id AND s.owner_id=q.owner_id AND s.actor_id=q.actor_id
           WHERE q.world_id=ep.world_id AND q.owner_id=ep.owner_id AND q.episode_id=ep.id AND (
             EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'goals','[]'::jsonb)||COALESCE(s.document->'plans','[]'::jsonb)||COALESCE(s.document->'actions','[]'::jsonb)||COALESCE(s.document->'responsibilities','[]'::jsonb)) item
               WHERE item->>'status' NOT IN ('fulfilled','withdrawn','finished','expired') AND (item->'sourceIds' ? ('episode-intent:'||q.id) OR (item->'subject'->>'kind'='episode' AND item->'subject'->>'id'=ep.id))) OR
             EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'questions','[]'::jsonb)) question WHERE question->>'status'='open' AND question->>'sourceId'='episode-intent:'||q.id)
           ))
       ))`,
      [
        frame.worldId,
        owner,
        frame.engineEpoch,
        episodeIds ? [...episodeIds] : null,
        onlyUnperformedProposals,
      ],
    )
  ).rows;
  const authored = rows.filter((r) =>
    (r.document as DirectorDecision).opportunities.some(
      (o) => o.id === r.id && o.authoredEventKey !== undefined,
    ),
  );
  if (!authored.length) return invalid;
  const current = await readAuthoredAgentMaterialCatalog(sql, owner, {
    worldId: frame.worldId,
    expectedEngineEpoch: frame.engineEpoch,
    expectedWorldVersion: Number(authored[0]!.version),
    maxBytes: 2_000_000,
  });
  if (current.status !== 'complete')
    throw new DomainError('INVALID_PROPOSAL', 'EPISODE_SCOPE_SOURCE_UNAVAILABLE');
  const verifiedFrames = new Set<string>();
  for (const row of authored) {
    const decision = row.document as DirectorDecision,
      snapshot = row.snapshot as DirectorSnapshot;
    if (
      snapshot.worldId !== frame.worldId ||
      snapshot.engineEpoch !== frame.engineEpoch ||
      decision.worldId !== frame.worldId ||
      decision.engineEpoch !== frame.engineEpoch ||
      (!verifiedFrames.has(row.attempt_id) &&
        createHash('sha256').update(authoredMaterialCanonicalJson(snapshot)).digest('hex') !==
          row.input_hash)
    )
      throw new DomainError('INVALID_PROPOSAL', 'EPISODE_SCOPE_AUTHORITY_CONFLICT');
    verifiedFrames.add(row.attempt_id);
    const opportunities = decision.opportunities.filter((o) => o.id === row.id);
    if (opportunities.length !== 1)
      throw new DomainError('INVALID_PROPOSAL', 'EPISODE_SCOPE_AUTHORITY_CONFLICT');
    const opportunity = opportunities[0]!,
      old =
        snapshot.authoredMaterials?.materials.filter(
          (m) => m.ref.nodeKey === opportunity.authoredEventKey,
        ) ?? [],
      now = current.catalog.materials.filter((m) => m.ref.nodeKey === opportunity.authoredEventKey);
    // Unknown or changed author authority remains subject to the existing source
    // failure path; it is not silently hidden as a cast mismatch.
    if (old.length !== 1 || now.length !== 1 || !isDeepStrictEqual(old[0]!.ref, now[0]!.ref))
      continue;
    const cast = row.actor_ids as string[];
    if (
      !validAuthoredOpportunityCast(old, cast, opportunity) ||
      !validAuthoredOpportunityCast(now, cast, opportunity)
    )
      invalid.add(String(row.id));
  }
  return invalid;
}
