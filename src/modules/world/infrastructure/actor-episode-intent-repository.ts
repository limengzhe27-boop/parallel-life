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
  isActorEpisodeConsiderationInput,
  projectActorEpisodeDirective,
} from '../domain/actor-episode-intent.ts';
import { readAuthoredAgentMaterialCatalog } from './authored-agent-material-repository.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { readActorKnownTopicsInTransaction } from './actor-known-topic-repository.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import { parseEpisodeConsiderationIntent } from './agent-narrative-repository.ts';
import {
  projectActorManuscriptHint,
  type ManuscriptHintIdentity,
} from '../domain/actor-manuscript-hint.ts';

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
  options: { historical?: boolean } = {},
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
  const blocked = await forgottenAgentSourceIds(sql, ownerId, frame.worldId, frame.actorId);
  if (addressed.some(({ opportunity }) => opportunity.actorTopics)) {
    const state = (
      await sql.query(
        'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
        [frame.worldId, ownerId, frame.actorId],
      )
    ).rows[0]?.document as ActorAgentState | undefined;
    if (!state) return conflict();
    const topics = options.historical
      ? []
      : await readActorKnownTopicsInTransaction(
          sql,
          ownerId,
          state,
          frame.worldVersion,
          frame.storyAt,
        );
    for (const { request, opportunity, saved } of addressed) {
      const selection = opportunity.actorTopics?.filter((s) => s.actorId === frame.actorId);
      if (!selection) continue;
      if (selection.length !== 1) return conflict();
      const captured = selection[0]!.refs.map((ref) => {
        const entries = saved.actorKnownTopics?.filter(
          (t) =>
            t.actorId === frame.actorId && t.id === ref.id && t.contentHash === ref.contentHash,
        );
        if (entries?.length !== 1) return conflict();
        return entries[0]!;
      });
      if (
        !captured.length ||
        captured.some(
          (t) =>
            t.proofSourceIds.some((id) => blocked.has(id)) ||
            (!options.historical && !topics.some((now) => isDeepStrictEqual(now, t))),
        )
      )
        continue;
      const id = ACTOR_EPISODE_INTENT_PREFIX + request.id;
      if ([id, request.id, request.origin_decision_id].some((key) => blocked.has(key))) continue;
      const directive = captured.map(({ proofSourceIds: _proof, ...topic }) => topic);
      result.set(request.id, {
        source: {
          id,
          kind: 'director_intent',
          recordId: request.id,
          worldVersion: request.created_at_version,
          at: saved.storyAt,
          contentHash: createHash('sha256')
            .update(
              authoredMaterialCanonicalJson({
                worldId: frame.worldId,
                actorId: frame.actorId,
                requestId: request.id,
                decisionId: request.origin_decision_id,
                directive,
              }),
            )
            .digest('hex'),
        },
        observation: {
          sourceId: id,
          kind: 'plan',
          text:
            '导演建议你自行考虑跟进以下本人已知事项。它不是命令、已经发生的事实或玩家同意；你可以调整、暂缓或不参与：' +
            JSON.stringify(directive),
        },
      });
    }
  }
  if (!addressed.some(({ opportunity }) => opportunity.authoredEventKey)) return result;
  // Full server-side retrieval is not NPC disclosure. Only the directive whitelist below leaves here.
  const current = await readAuthoredAgentMaterialCatalog(sql, ownerId, {
    worldId: frame.worldId,
    expectedEngineEpoch: worldRow.engine_epoch,
    expectedWorldVersion: frame.worldVersion,
    maxBytes: 2_000_000,
  });
  if (current.status !== 'complete') return conflict();
  const initialActors = ((
    await sql.query(
      "SELECT (SELECT jsonb_agg(jsonb_build_object('id',a->>'id','name',a->>'name')) FROM jsonb_array_elements(state->'actors') a) AS actors FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2",
      [frame.worldId, ownerId],
    )
  ).rows[0]?.actors ?? []) as ManuscriptHintIdentity[];
  for (const { request, opportunity, saved } of addressed) {
    if (result.get(request.id)) continue;
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
    const manuscriptHint = projectActorManuscriptHint(
      material,
      frame.actorId,
      initialActors,
      world.actors,
    );
    const directive =
      manuscriptHint?.directive ??
      projectActorEpisodeDirective(material, frame.actorId, world.space?.places ?? []);
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
          path: manuscriptHint?.provenance ?? 'intent',
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
  const incoming = isActorEpisodeConsiderationInput(snapshot.input)
    ? parseEpisodeConsiderationIntent(snapshot.input.text)
    : snapshot.episodeManifest
      ? { requestId: snapshot.episodeManifest.requestId }
      : null;
  if (!sources.length && !incoming) return;
  const frame = {
    worldId: snapshot.state.worldId,
    actorId: snapshot.state.actorId,
    worldVersion: snapshot.worldVersion,
    storyAt: snapshot.storyAt,
  };
  const views = await readActorEpisodeIntentsInTransaction(sql, ownerId, frame, [
    ...sources
      .filter((source) => source.usage !== 'private_strategy')
      .map((source) => source.id.slice(ACTOR_EPISODE_INTENT_PREFIX.length)),
    ...(incoming ? [incoming.requestId] : []),
  ]);
  const history = await readActorEpisodeIntentsInTransaction(
    sql,
    ownerId,
    frame,
    sources
      .filter((source) => source.usage === 'private_strategy')
      .map((source) => source.id.slice(ACTOR_EPISODE_INTENT_PREFIX.length)),
    { historical: true },
  );
  if (incoming) {
    if (snapshot.channel.kind !== 'private' || !views.has(incoming.requestId)) return conflict();
    const expected = views.get(incoming.requestId);
    if (
      expected &&
      !sources.some(
        (source) => source.id === expected.source.id && source.usage !== 'private_strategy',
      )
    )
      return conflict();
  }
  for (const source of sources) {
    const id = source.id.slice(ACTOR_EPISODE_INTENT_PREFIX.length);
    const view = (source.usage === 'private_strategy' ? history : views).get(id);
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
    if (
      snapshot.channel.kind !== 'private' ||
      (snapshot.input.origin !== 'coordination' &&
        !(snapshot.input.origin === 'player' && snapshot.episodeManifest))
    )
      return conflict();
    const intent =
      snapshot.input.origin === 'player'
        ? snapshot.episodeManifest!
        : parseEpisodeConsiderationIntent(snapshot.input.text);
    if (
      intent.requestId !== id ||
      observations.length !== 1 ||
      !isDeepStrictEqual(observations[0], view.observation)
    )
      return conflict();
  }
}
