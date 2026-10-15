import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { AgentSource } from '../domain/agent-runtime.ts';
import type { DirectorDecision, DirectorSnapshot } from '../domain/director-runtime.ts';
import type { WorldState } from '../domain/types.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';
import {
  ACTOR_EPISODE_INTENT_PREFIX,
  projectActorEpisodeDirective,
} from '../domain/actor-episode-intent.ts';
import { readAuthoredAgentMaterialCatalog } from './authored-agent-material-repository.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { parseEpisodeConsiderationIntent } from './agent-narrative-repository.ts';

export type ActorEpisodeIntentView = {
  source: AgentSource;
  observation: AgentSnapshot['observations'][number];
};
const conflict = (): never => {
  throw Object.assign(Error('AGENT_REVISION_CONFLICT'), { code: 'AGENT_REVISION_CONFLICT' });
};

/** Batch read of the immutable author fields explicitly addressed to this NPC. No writes. */
export async function readActorEpisodeIntentsInTransaction(
  sql: SqlClient,
  ownerId: string,
  frame: { worldId: string; actorId: string; worldVersion: number; storyAt: string },
  requestIds: string[],
): Promise<Map<string, ActorEpisodeIntentView | null>> {
  const result = new Map<string, ActorEpisodeIntentView | null>();
  if (!requestIds.length) return result;
  const ids = [...new Set(requestIds)];
  if (ids.length > 128 || ids.some((id) => !id || id.length > 240)) return conflict();
  const worldRow = (
    await sql.query(
      `SELECT w.state,w.version,c.engine_epoch FROM parallel_life.worlds w
       JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
       WHERE w.id=$1 AND w.owner_id=$2`,
      [frame.worldId, ownerId],
    )
  ).rows[0];
  if (!worldRow || worldRow.version !== frame.worldVersion || worldRow.engine_epoch < 2)
    return conflict();
  const world = worldRow.state as WorldState;
  if (!world.actors.some((actor) => actor.id === frame.actorId)) return conflict();
  const requests = (
    await sql.query(
      `SELECT r.*,d.document AS decision,a.snapshot AS director_snapshot
       FROM parallel_life.agent_episode_requests r
       JOIN parallel_life.director_decisions d ON d.world_id=r.world_id AND d.owner_id=r.owner_id
         AND d.id=r.origin_decision_id AND d.engine_epoch=r.engine_epoch AND d.world_version=r.created_at_version
       JOIN parallel_life.director_runtime_attempts a ON a.world_id=d.world_id AND a.owner_id=d.owner_id
         AND a.id=d.attempt_id AND a.decision_id=d.id AND a.input_hash=d.input_hash AND a.status='committed'
       JOIN parallel_life.shared_episodes e ON e.world_id=r.world_id AND e.owner_id=r.owner_id
         AND e.id=r.episode_id AND e.origin_decision_id=d.id
       WHERE r.world_id=$1 AND r.owner_id=$2 AND r.actor_id=$3 AND r.id=ANY($4::text[])
         AND r.engine_epoch=$5 AND r.created_at_version<=$6`,
      [frame.worldId, ownerId, frame.actorId, ids, worldRow.engine_epoch, frame.worldVersion],
    )
  ).rows;
  const addressed = requests.map((request) => {
    const decision = request.decision as DirectorDecision;
    const opportunities = decision.opportunities.filter(
      (opportunity) =>
        opportunity.id === request.episode_id &&
        opportunity.participantActorIds.includes(frame.actorId) &&
        opportunity.activity === request.activity,
    );
    if (opportunities.length !== 1) return conflict();
    result.set(request.id, null);
    return {
      request,
      opportunity: opportunities[0]!,
      saved: request.director_snapshot as DirectorSnapshot,
    };
  });
  if (!addressed.some(({ opportunity }) => opportunity.authoredEventKey)) return result;
  // Full server-side retrieval is not NPC disclosure. Only the directive whitelist below leaves here.
  const current = await readAuthoredAgentMaterialCatalog(sql, ownerId, {
    worldId: frame.worldId,
    expectedEngineEpoch: worldRow.engine_epoch,
    expectedWorldVersion: frame.worldVersion,
    maxBytes: 2_000_000,
  });
  if (current.status !== 'complete') return conflict();
  const blocked = await forgottenAgentSourceIds(sql, ownerId, frame.worldId, frame.actorId);
  for (const { request, opportunity, saved } of addressed) {
    if (!opportunity.authoredEventKey) continue;
    const original = saved.authoredMaterials?.materials.filter(
      (material) => material.ref.nodeKey === opportunity.authoredEventKey,
    );
    const actual = current.catalog.materials.filter(
      (material) => material.ref.nodeKey === opportunity.authoredEventKey,
    );
    if (
      original?.length !== 1 ||
      actual.length !== 1 ||
      !isDeepStrictEqual(original[0]!.ref, actual[0]!.ref)
    )
      return conflict();
    const material = actual[0]!;
    const directive = projectActorEpisodeDirective(
      material,
      frame.actorId,
      world.space?.places ?? [],
    );
    if (!directive) continue;
    if (
      !Number.isFinite(Date.parse(saved.storyAt)) ||
      Date.parse(saved.storyAt) > Date.parse(frame.storyAt)
    )
      return conflict();
    const id = ACTOR_EPISODE_INTENT_PREFIX + request.id;
    if (
      [id, request.id, request.origin_decision_id, material.ref.nodeHash].some((key) =>
        blocked.has(key),
      )
    )
      continue;
    const contentHash = createHash('sha256')
      .update(
        authoredMaterialCanonicalJson({
          worldId: frame.worldId,
          actorId: frame.actorId,
          requestId: request.id,
          ref: material.ref,
          path: 'intent',
          directive,
        }),
      )
      .digest('hex');
    result.set(request.id, {
      source: {
        id,
        kind: 'authored',
        recordId: request.id,
        worldVersion: request.created_at_version,
        at: saved.storyAt,
        contentHash,
      },
      observation: {
        sourceId: id,
        kind: 'plan',
        text:
          'Author suggestion addressed only to you. Consider it using your own position; it is not an event, verified fact, obligation, deadline or player agreement: ' +
          JSON.stringify(directive),
      },
    });
  }
  return result;
}

/** Revalidate exact source hashes before payment and again in the atomic kernel transaction. */
export async function validateActorEpisodeIntentSnapshotInTransaction(
  sql: SqlClient,
  ownerId: string,
  snapshot: AgentSnapshot,
): Promise<void> {
  const sources = snapshot.sources.filter((source) =>
    source.id.startsWith(ACTOR_EPISODE_INTENT_PREFIX),
  );
  if (!sources.length) return;
  const frame = {
    worldId: snapshot.state.worldId,
    actorId: snapshot.state.actorId,
    worldVersion: snapshot.worldVersion,
    storyAt: snapshot.storyAt,
  };
  const views = await readActorEpisodeIntentsInTransaction(
    sql,
    ownerId,
    frame,
    sources.map((source) => source.id.slice(ACTOR_EPISODE_INTENT_PREFIX.length)),
  );
  for (const source of sources) {
    const id = source.id.slice(ACTOR_EPISODE_INTENT_PREFIX.length);
    const view = views.get(id);
    const { usage, ...identity } = source;
    if (!view || !isDeepStrictEqual(identity, view.source)) return conflict();
    const observations = snapshot.observations.filter(
      (observation) => observation.sourceId === source.id,
    );
    if (observations.some((observation) => observation.kind !== 'plan')) return conflict();
    if (usage === 'private_strategy') {
      if (
        observations.some(
          (observation) =>
            observation.text !== '此来源支持本人已保存的目标、计划或决定；原私聊不在本次上下文中。',
        )
      )
        return conflict();
      continue;
    }
    if (snapshot.channel.kind !== 'private' || snapshot.input.origin !== 'coordination')
      return conflict();
    const intent = parseEpisodeConsiderationIntent(snapshot.input.text);
    if (
      intent.requestId !== id ||
      observations.length !== 1 ||
      !isDeepStrictEqual(observations[0], view.observation)
    )
      return conflict();
  }
}
