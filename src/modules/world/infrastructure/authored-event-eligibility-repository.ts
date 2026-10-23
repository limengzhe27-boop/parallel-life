import { readEpisodeOutcomeProgress } from './episode-outcome-repository.ts';
import { deriveAuthoredStageProgress } from '../domain/authored-stage-progress.ts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  bindAuthoredHistoryFacts,
  type StorySource,
} from '../../settings/domain/publication-story.ts';
import { DomainError } from '../domain/errors.ts';
import type { WorldState } from '../domain/types.ts';
import {
  AuthoredMaterialError,
  type AuthoredAgentMaterialCatalog,
} from '../domain/authored-agent-material.ts';
import {
  evaluateAuthoredEventEligibility,
  type AuthoredEligibilityEvidence,
  type AuthoredEventEligibility,
} from '../domain/authored-event-eligibility.ts';
import { readAuthoredAgentMaterialCatalog } from './authored-agent-material-repository.ts';

export type AuthoredEligibilityView = {
  catalog: AuthoredAgentMaterialCatalog;
  eligibility: AuthoredEventEligibility[];
  /** An existing opportunity is not proof that its authored incident actually occurred. */
  occupiedEventKeys: string[];
};
export function authoredEligibilitySummary(view: AuthoredEligibilityView) {
  return view.eligibility.map((item) => ({
    nodeKey: item.ref.nodeKey,
    nodeHash: item.ref.nodeHash,
    status: item.status,
    reasons: [...item.reasons],
    basisSourceIds: [...item.basisSourceIds],
    qualificationKey: item.qualificationKey,
  }));
}
/** Read-only director evidence. Never initializes a legacy plan or promotes dialogue into a fact. */
export async function readAuthoredEligibilityInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: { worldId: string; engineEpoch: number; worldVersion: number; storyAt: string },
): Promise<AuthoredEligibilityView> {
  const material = await readAuthoredAgentMaterialCatalog(sql, ownerId, {
    worldId: input.worldId,
    expectedEngineEpoch: input.engineEpoch,
    expectedWorldVersion: input.worldVersion,
  });
  if (material.status !== 'complete')
    throw new AuthoredMaterialError('DIRECTOR_AUTHORED_MATERIAL_BUDGET');
  const catalog = material.catalog;
  if (!catalog.source) return { catalog, eligibility: [], occupiedEventKeys: [] };
  const row = (
    await sql.query(
      `SELECT w.state,w.version,i.state initial_state,parallel_life.publication_story_source(w.id) source
       FROM parallel_life.worlds w JOIN parallel_life.world_initial_snapshots i
       ON i.world_id=w.id AND i.owner_id=w.owner_id WHERE w.id=$1 AND w.owner_id=$2`,
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (!row || row.version !== input.worldVersion) throw new DomainError('VERSION_CONFLICT');
  const initial = row.initial_state as WorldState;
  const world = { ...row.state, version: row.version } as WorldState;
  const source = row.source as StorySource | null;
  if (
    !source ||
    !isDeepStrictEqual(source.origin, catalog.source.origin) ||
    !isDeepStrictEqual(source.initialFacts, initial.facts) ||
    source.genesisSource !== `publication-genesis:${world.id}`
  )
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_AUTHORED_GENESIS_EVIDENCE');
  const proof = (
    sourceId: string,
    worldVersion: number,
    at: string,
  ): AuthoredEligibilityEvidence => ({
    worldId: world.id,
    engineEpoch: input.engineEpoch,
    worldVersion,
    sourceId,
    sourceHash: catalog.source!.sourceHash,
    at,
  });
  const historyFacts = bindAuthoredHistoryFacts(source).flatMap((binding) => {
    const factId = binding.factIds[0];
    if (!factId) return [];
    const entry = source.history.find((h) => h.key === binding.key)!;
    return [{ ...proof(`fact:${factId}`, 0, entry.occurredAt), factKey: binding.key }];
  });
  const actual = (
    await sql.query(
      `SELECT p.document,e.payload FROM parallel_life.world_authoritative_positions p
       JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.owner_id=p.owner_id
        AND e.id=p.source_event_id AND e.version=p.source_version
       JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id
        AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
       WHERE p.world_id=$1 AND p.owner_id=$2 AND p.subject_key='player' AND p.source_version<=$3`,
      [world.id, ownerId, world.version],
    )
  ).rows[0];
  let playerPlaceId: string | null = null;
  let playerPositionProof: AuthoredEligibilityEvidence | null = null;
  if (actual) {
    const position = actual.document;
    if (
      position.worldId !== world.id ||
      position.subject?.kind !== 'player' ||
      position.sourceEventId !== actual.payload.id ||
      position.worldVersion !== actual.payload.version
    )
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_PLAYER_POSITION_EVIDENCE');
    if (position.status === 'at') {
      playerPlaceId = position.placeId;
      playerPositionProof = proof(
        'actual-position:player',
        position.worldVersion,
        position.occurredAt,
      );
    }
  } else if (
    initial.space?.currentPlaceId &&
    world.space?.currentPlaceId === initial.space.currentPlaceId &&
    !(
      await sql.query(
        `SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version<=$3
         AND payload->>'type' IN ('travel.completed','scene.entered','scene.opened','scene.action_resolved') LIMIT 1`,
        [world.id, ownerId, world.version],
      )
    ).rowCount
  ) {
    // Explicit immutable starting position, never an inference from a contact's address.
    playerPlaceId = initial.space.currentPlaceId;
    playerPositionProof = proof(`setting:${world.id}`, 0, initial.time);
  }
  const occupied = (
    await sql.query(
      `SELECT o->>'authoredEventKey' key FROM parallel_life.shared_episodes ep
       JOIN parallel_life.director_decisions d ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id
        AND d.id=ep.origin_decision_id, LATERAL jsonb_array_elements(d.document->'opportunities') o
       WHERE ep.world_id=$1 AND ep.owner_id=$2 AND o->>'id'=ep.id
        AND ep.document->>'status' IN ('proposed','active','withdrawn') AND o ? 'authoredEventKey' ORDER BY key`,
      [world.id, ownerId],
    )
  ).rows;
  const priorNodes = (
    await sql.query(
      `SELECT n.node_key key FROM parallel_life.publication_story_nodes n JOIN parallel_life.publication_story_receipts r ON r.id=n.latest_receipt_id AND r.world_id=n.world_id AND r.owner_id=n.owner_id JOIN parallel_life.legacy_engine_checkpoints m ON m.world_id=n.world_id AND m.owner_id=n.owner_id WHERE n.world_id=$1 AND n.owner_id=$2 AND n.status IN ('presented','offered','committed','declined','skipped','expired')`,
      [world.id, ownerId],
    )
  ).rows;
  occupied.push(...priorNodes);
  const nodeProgress = await readEpisodeOutcomeProgress(sql, ownerId, catalog);
  return {
    catalog,
    eligibility: evaluateAuthoredEventEligibility(
      {
        catalog,
        storyAt: input.storyAt,
        playerPlaceId,
        playerPositionProof,
        historyFacts,
        // A consideration receipt or any number of messages proves neither incident
        // presentation nor resolution. These require their own actual world evidence.
        nodeProgress,
        stageProgress: deriveAuthoredStageProgress(catalog, nodeProgress),
      },
      (value) => createHash('sha256').update(value).digest('hex'),
    ),
    occupiedEventKeys: [...new Set(occupied.map((r) => String(r.key)))].sort(),
  };
}
