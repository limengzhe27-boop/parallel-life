import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSource } from '../domain/agent-runtime.ts';
import type { SceneEntry } from '../domain/experience-rules.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';
import { scenePresent, scenePrivateThought } from '../domain/scene-runtime.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { loadScene } from './scene-repository.ts';

export type ActorSceneObservationFrame = {
  worldId: string;
  actorId: string;
  sceneId: string;
  worldVersion: number;
  storyAt: string;
  /** Full packets count towards the budget; text is never truncated. */
  maxBytes?: number;
  maxEntries?: number;
};
export type ActorSceneObservation = {
  sourceId: string;
  text: string;
  kind: 'speech' | 'result' | 'fact';
  evidenceKind: 'player_report' | 'actor_report' | 'scene_record' | 'adjudicated_result';
  /** Original committed event's wall time, not a claimed physical occurrence in the prose. */
  eventOccurredAt: string;
  /** Story time of the original record, also when this proved hearer acquired it. */
  storyAt: string;
  learnedAt: string;
  /** Retrieval is not a fresh observation and cannot acknowledge model consumption. */
  retrievedAt: string;
};
export type ActorSceneObservationSources = {
  status: 'complete' | 'budget_limited';
  sources: AgentSource[];
  observations: ActorSceneObservation[];
  /** Only authorized sources omitted for capacity; never hidden actors' source identities. */
  omittedSourceIds: string[];
};

const reject = (code: string): never => {
  throw Object.assign(Error(code), { code });
};

/**
 * Owner-scoped read adapter over actual scene records. It grants no new channel disclosure,
 * room/line-of-sight coverage, knowledge writes, wake permission or evaluated-source receipt.
 * Callers must keep these actor-owned records private or reauthorize the actual destination.
 */
export async function readActorSceneObservationSourcesInTransaction(
  sql: SqlClient,
  ownerId: string,
  frame: ActorSceneObservationFrame,
): Promise<ActorSceneObservationSources> {
  const maxBytes = frame.maxBytes ?? 16000;
  const maxEntries = frame.maxEntries ?? 80;
  if (
    ![ownerId, frame.worldId, frame.actorId, frame.sceneId].every((s) => s.trim()) ||
    !Number.isSafeInteger(frame.worldVersion) ||
    frame.worldVersion < 0 ||
    !Number.isFinite(Date.parse(frame.storyAt)) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > 1_000_000 ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 0 ||
    maxEntries > 500
  )
    reject('ACTOR_SCENE_OBSERVATION_INVALID_FRAME');
  const world = (
    await sql.query(
      'SELECT owner_id,version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2',
      [frame.worldId, ownerId],
    )
  ).rows[0];
  if (
    !world ||
    world.owner_id !== ownerId ||
    world.state.ownerId !== ownerId ||
    world.state.id !== frame.worldId ||
    !world.state.actors.some((a: { id: string }) => a.id === frame.actorId)
  )
    reject('ACTOR_SCENE_OBSERVATION_FORBIDDEN');
  if (
    world.version !== frame.worldVersion ||
    Date.parse(frame.storyAt) < Date.parse(world.state.time)
  )
    reject('ACTOR_SCENE_OBSERVATION_VERSION_CONFLICT');
  const read = await loadScene(sql, frame.worldId, frame.sceneId);
  if (read.scene.ownerId !== ownerId || read.scene.worldId !== frame.worldId)
    reject('ACTOR_SCENE_OBSERVATION_FORBIDDEN');
  const blocked = await forgottenAgentSourceIds(sql, ownerId, frame.worldId, frame.actorId);
  // Authenticate before budgeting. Presence alone is never sufficient: observableTo is mandatory.
  const visible = read.entries.filter(
    (entry) =>
      entry.ownerId === ownerId &&
      entry.worldId === frame.worldId &&
      entry.sceneId === frame.sceneId &&
      entry.sourceVersion <= frame.worldVersion &&
      'text' in entry &&
      entry.observableTo.some((p) => p.kind === 'actor' && p.actorId === frame.actorId) &&
      scenePresent(read.scene, entry.sourceVersion).some(
        (p) => p.kind === 'actor' && p.actorId === frame.actorId,
      ) &&
      ![entry.id, 'scene:' + entry.id, entry.sourceEventId].some((id) => blocked.has(id)),
  );
  const events = new Map(
    (
      await sql.query(
        `SELECT e.id,e.version,e.payload FROM parallel_life.world_events e
         JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id
           AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
         WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=ANY($3::text[])`,
        [frame.worldId, ownerId, [...new Set(visible.map((e) => e.sourceEventId))]],
      )
    ).rows.map((row) => [row.id as string, row]),
  );
  const authorized: { source: AgentSource; observation: ActorSceneObservation }[] = [];
  for (const entry of visible) {
    if (!('text' in entry)) continue;
    const row = events.get(entry.sourceEventId);
    const event = row?.payload;
    if (
      !row ||
      row.version !== entry.sourceVersion ||
      event?.id !== row.id ||
      event.version !== row.version ||
      event.worldId !== frame.worldId ||
      event.data?.sceneId !== frame.sceneId ||
      !Number.isFinite(Date.parse(event.storyAt)) ||
      !Number.isFinite(Date.parse(event.occurredAt)) ||
      Date.parse(event.storyAt) > Date.parse(frame.storyAt)
    )
      continue;
    const original = event.data;
    const proposal = original.proposal;
    const sceneProducer = [
      'scene.opened',
      'scene.reaction_recorded',
      'scene.action_resolved',
    ].includes(event.type);
    let matches = false;
    let kind: ActorSceneObservation['kind'] = 'speech';
    let evidenceKind: ActorSceneObservation['evidenceKind'] = 'actor_report';
    if (entry.kind === 'user_action') {
      const action = read.actions.find((a) => a.id === entry.actionId);
      matches =
        event.type === 'scene.input_recorded' &&
        original.privateThought === false &&
        !scenePrivateThought(entry.text) &&
        event.playerInput?.text === entry.text &&
        !!action &&
        action.worldId === frame.worldId &&
        action.ownerId === ownerId &&
        action.sceneId === frame.sceneId &&
        action.commandId === event.commandId &&
        action.sourceEventId === row.id &&
        action.sourceVersion === row.version &&
        action.text === entry.text;
      evidenceKind = 'player_report';
    } else if (entry.kind === 'dialogue') {
      matches =
        sceneProducer &&
        entry.speaker.kind === 'actor' &&
        (original.agentRuntime
          ? Array.isArray(original.dialogues) &&
            original.dialogues.some((d: SceneEntry) => isDeepStrictEqual(d, entry))
          : Array.isArray(proposal?.dialogues) &&
            proposal.dialogues.some(
              (d: { actorId: string; text: string }) =>
                entry.speaker.kind === 'actor' &&
                d.actorId === entry.speaker.actorId &&
                d.text === entry.text,
            ));
    } else if (entry.kind === 'narration') {
      matches = sceneProducer && proposal?.narration === entry.text;
      kind = 'fact';
      evidenceKind = 'scene_record';
    } else if (entry.kind === 'adjudicated_result') {
      const action = read.actions.find((a) => a.id === entry.actionId);
      matches =
        event.type === 'scene.action_resolved' &&
        proposal?.observation === entry.text &&
        proposal?.outcome === entry.outcome &&
        action?.intent === 'attempt' &&
        action.status === 'resolved' &&
        action.resolution?.sourceEventId === row.id &&
        action.resolution?.sourceVersion === row.version &&
        action.resolution?.outcome === entry.outcome &&
        action.resolution?.observation === entry.text;
      kind = 'result';
      evidenceKind = 'adjudicated_result';
    }
    if (!matches) continue;
    const id = 'scene:' + entry.id;
    authorized.push({
      source: {
        id,
        kind: 'scene_entry',
        recordId: entry.id,
        worldVersion: entry.sourceVersion,
        at: event.storyAt,
        contentHash: createHash('sha256')
          .update(
            authoredMaterialCanonicalJson({ entry, eventId: row.id, eventVersion: row.version }),
          )
          .digest('hex'),
      },
      observation: {
        sourceId: id,
        text: entry.text,
        kind,
        evidenceKind,
        eventOccurredAt: event.occurredAt,
        storyAt: event.storyAt,
        learnedAt: event.storyAt,
        retrievedAt: frame.storyAt,
      },
    });
  }
  const selected: typeof authorized = [];
  const omittedSourceIds: string[] = [];
  let bytes = 0;
  // Prefer recent authorized entries, but an oversized record must not hide earlier fitting records.
  for (const item of [...authorized].reverse()) {
    const size = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (selected.length >= maxEntries || bytes + size > maxBytes) {
      omittedSourceIds.unshift(item.source.id);
      continue;
    }
    bytes += size;
    selected.unshift(item);
  }
  return {
    status: omittedSourceIds.length ? 'budget_limited' : 'complete',
    sources: selected.map((item) => item.source),
    observations: selected.map((item) => item.observation),
    omittedSourceIds,
  };
}
