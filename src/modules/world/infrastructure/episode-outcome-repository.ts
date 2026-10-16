import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { invitationOutcomeEvidence } from '../domain/episode-outcome.ts';
import type { EpisodeEvidenceRecord } from '../domain/episode-evidence.ts';
import type { AuthoredAgentMaterialCatalog } from '../domain/authored-agent-material.ts';
import type { AuthoredNodeProgress } from '../domain/authored-event-eligibility.ts';
import type { SharedEpisode } from '../domain/director-runtime.ts';
import { readAuthoredAgentMaterialCatalog } from './authored-agent-material-repository.ts';

/** Called in the original successful effect transaction, after its bounded evidence projection. */
export async function projectEpisodeOutcomesInTransaction(
  sql: SqlClient,
  owner: string,
  worldId: string,
  eventId: string,
) {
  const affected = (
    await sql.query(
      `SELECT DISTINCT v.episode_id FROM parallel_life.agent_episode_evidence v
 JOIN parallel_life.shared_episodes ep ON ep.world_id=v.world_id AND ep.owner_id=v.owner_id AND ep.id=v.episode_id
 JOIN parallel_life.director_decisions d ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id AND d.id=ep.origin_decision_id,
 LATERAL jsonb_array_elements(d.document->'opportunities') o,
 LATERAL jsonb_array_elements(parallel_life.publication_story_source(v.world_id)->'nodes') n
 WHERE v.world_id=$1 AND v.owner_id=$2 AND v.source_event_id=$3 AND v.kind IN ('invitation_accepted','invitation_declined')
 AND o->>'id'=ep.id AND o->>'authoredEventKey'=n->>'key'
 AND n->'direction'->'progress'->'completion'->>'scope'='invitation_response'`,
      [worldId, owner, eventId],
    )
  ).rows;
  if (!affected.length) return;
  const header = (
    await sql.query(
      `SELECT w.version,r.engine_epoch,e.payload FROM parallel_life.worlds w
   JOIN parallel_life.agent_runtime_worlds r ON r.world_id=w.id AND r.owner_id=w.owner_id
   JOIN parallel_life.world_events e ON e.world_id=w.id AND e.owner_id=w.owner_id AND e.id=$3 AND e.version=w.version
   JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
   WHERE w.id=$1 AND w.owner_id=$2`,
      [worldId, owner, eventId],
    )
  ).rows[0];
  if (!header || header.engine_epoch < 2) throw Error('EPISODE_OUTCOME_SOURCE_REQUIRED');
  const read = await readAuthoredAgentMaterialCatalog(sql, owner, {
    worldId,
    expectedEngineEpoch: header.engine_epoch,
    expectedWorldVersion: header.version,
    maxBytes: 2000000,
  });
  // Model input budgets must never invalidate a legitimate calendar response.
  if (read.status !== 'complete') return;
  const catalog = read.catalog;
  if (!catalog.source) return;
  for (const affectedRow of affected) {
    const row = (
      await sql.query(
        `SELECT ep.document,d.document AS decision FROM parallel_life.shared_episodes ep
      JOIN parallel_life.director_decisions d ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id AND d.id=ep.origin_decision_id AND d.engine_epoch=$4
      WHERE ep.world_id=$1 AND ep.owner_id=$2 AND ep.id=$3 FOR UPDATE OF ep`,
        [worldId, owner, affectedRow.episode_id, header.engine_epoch],
      )
    ).rows[0];
    if (!row) throw Error('EPISODE_OUTCOME_EPISODE_REQUIRED');
    const ep = row.document as SharedEpisode;
    if (ep.status === 'resolved' || ep.status === 'withdrawn') continue;
    const opportunity = row.decision.opportunities.find((o: { id: string }) => o.id === ep.id);
    const material = catalog.materials.find((m) => m.ref.nodeKey === opportunity?.authoredEventKey);
    if (!material) continue;
    const evidenceRows = (
      await sql.query(
        `SELECT id,document FROM parallel_life.agent_episode_evidence WHERE world_id=$1 AND owner_id=$2 AND episode_id=$3 AND engine_epoch=$4 AND world_version<=$5 ORDER BY world_version,id`,
        [worldId, owner, ep.id, header.engine_epoch, header.version],
      )
    ).rows;
    const selected = invitationOutcomeEvidence(
      material.node,
      evidenceRows.map((r) => r.document as EpisodeEvidenceRecord),
    );
    if (!selected || !selected.some((e) => e.eventId === eventId)) continue;
    const ids = selected.map((e) => evidenceRows.find((r) => isDeepStrictEqual(r.document, e))!.id);
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          'episode-outcome-v1',
          worldId,
          header.engine_epoch,
          ep.id,
          material.ref.nodeHash,
        ]),
      )
      .digest('hex');
    await sql.query(
      `INSERT INTO parallel_life.agent_episode_outcomes
      (world_id,owner_id,id,episode_id,engine_epoch,node_key,source_origin,node_document,policy,evidence_ids,source_event_id,world_version,story_at,scope,outcome)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'invitation_response','committed')`,
      [
        worldId,
        owner,
        id,
        ep.id,
        header.engine_epoch,
        material.node.key,
        catalog.source.origin,
        material.node,
        material.node.direction!.progress!.completion,
        JSON.stringify(ids),
        eventId,
        header.version,
        header.payload.storyAt ?? header.payload.storyTime,
      ],
    );
    const next: SharedEpisode = {
      ...ep,
      revision: ep.revision + 1,
      status: 'resolved',
      resultIds: [id],
      endReason: 'author_completion_criteria_met',
      sourceEventIds: [...new Set([...ep.sourceEventIds, eventId])],
    };
    const changed = await sql.query(
      `UPDATE parallel_life.shared_episodes SET document=$4 WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND (document->>'revision')::integer=$5`,
      [worldId, owner, ep.id, next, ep.revision],
    );
    if (changed.rowCount !== 1) throw Error('EPISODE_OUTCOME_REVISION_CONFLICT');
  }
}

/** The shared event is terminal only under the exact immutable author completion contract. */
export async function readEpisodeOutcomeProgress(
  sql: SqlClient,
  owner: string,
  catalog: AuthoredAgentMaterialCatalog,
): Promise<AuthoredNodeProgress[]> {
  if (!catalog.source) return [];
  const scope = catalog.source;
  const rows = (
    await sql.query(
      `SELECT r.*,ep.document AS episode FROM parallel_life.agent_episode_outcomes r
    JOIN parallel_life.shared_episodes ep ON ep.world_id=r.world_id AND ep.owner_id=r.owner_id AND ep.id=r.episode_id
    JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=r.world_id AND rw.owner_id=r.owner_id AND rw.engine_epoch=r.engine_epoch
    JOIN parallel_life.world_events e ON e.world_id=r.world_id AND e.owner_id=r.owner_id AND e.id=r.source_event_id AND e.version=r.world_version
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE r.world_id=$1 AND r.owner_id=$2 AND r.world_version<=$3 ORDER BY r.world_version,r.id`,
      [scope.worldId, owner, catalog.world.worldVersion],
    )
  ).rows;
  return rows.map((r) => {
    const material = catalog.materials.find((m) => m.node.key === r.node_key);
    if (
      !material ||
      !isDeepStrictEqual(material.node, r.node_document) ||
      !isDeepStrictEqual(scope.origin, r.source_origin) ||
      r.episode.status !== 'resolved' ||
      !isDeepStrictEqual(r.episode.resultIds, [r.id])
    )
      throw Error('EPISODE_OUTCOME_SOURCE_CONFLICT');
    return {
      worldId: scope.worldId,
      engineEpoch: catalog.world.engineEpoch,
      worldVersion: r.world_version,
      sourceId: 'episode-outcome:' + r.id,
      sourceHash: scope.sourceHash,
      at: r.story_at,
      kind: 'resolved',
      nodeKey: r.node_key,
      nodeHash: material.ref.nodeHash,
      outcome: 'committed',
    };
  });
}
