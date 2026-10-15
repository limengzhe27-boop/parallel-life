import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import {
  applyStoryProgressSignal,
  storyPacePolicy,
  createStoryEventProgress,
  type CommittedProgressObservation,
  type ProgressSignal,
  type StoryEventProgress,
  type StoryProgressDefinition,
} from '../domain/story-event-progress.ts';
import type { PublicationEventProgressSpec } from '../domain/publication-content.ts';

export type PersistedStoryEventProgress = StoryEventProgress & {
  revision: number;
  segmentIndex: number;
  segmentStartBeat: number;
  cursorVersion: number;
  lastSourceEventId: string | null;
};
export type ProgressLedgerDefinition = {
  definition: StoryProgressDefinition;
  spec: PublicationEventProgressSpec;
  actorIdsByKey: ReadonlyMap<string, string>;
  /** Verified live opening deliveries, not ordinary follow-up progress beats. */
  openingPresentationEventIds?: string[];
  /** Trusted current-node fragment from the scoped SQL reader; never a model field. */
  boundNode?: {
    actorId: string;
    sourceEventId: string;
    sourceMessageId: string;
    invitationId: string | null;
    expectedVersion: number;
    placeIds: string[];
  };
};
export type RecentStoryWorldInput = {
  sourceEventId: string;
  version: number;
  storyAt: string;
} & (
  | { kind: 'arrival'; fromPlaceId: string; placeId: string }
  | { kind: 'invitation_response'; invitationId: string; operation: string }
  | { kind: 'scene_result'; sceneId: string; outcome: string | null }
);
function hashDefinition(value: ProgressLedgerDefinition) {
  return createHash('sha256')
    .update(JSON.stringify([value.definition, value.spec, [...value.actorIdsByKey].sort()]))
    .digest('hex');
}
/** A private projection of successful world records. No model call and no raw client write port. */
export class PublicationEventProgressRepository {
  private async authoredPlaces(sql: SqlClient, value: ProgressLedgerDefinition) {
    if (value.boundNode) return value.boundNode.placeIds;
    const d = value.definition;
    const plan = (
      await sql.query(
        'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1 AND owner_id=$2',
        [d.worldId, d.ownerId],
      )
    ).rows[0]?.document;
    const authored = plan?.nodes?.find(
      (candidate: { key?: string }) => candidate.key === d.nodeKey,
    );
    if (!authored) throw new TaskError('INVALID_STATE');
    return [
      authored.placeKey,
      authored.settingPlaceKey,
      ...(authored.scenePlaceKeys ?? []),
      ...(authored.intent?.kind === 'offer_invitation' ? [authored.intent.placeKey] : []),
    ].filter((key): key is string => typeof key === 'string');
  }
  /** Director-only real changes, without private thoughts, dialogue or inferred NPC knowledge. */
  async recentWorldInputs(sql: SqlClient, ownerId: string, worldId: string, worldVersion: number) {
    const rows = (
      await sql.query(
        "SELECT e.id,e.version,e.payload FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 AND c.status='succeeded' AND c.result_event_id=e.id AND e.payload->>'type' IN ('travel.completed','invitation.responded','scene.opened','scene.action_resolved','scene.reaction_recorded') ORDER BY e.version DESC LIMIT 8",
        [worldId, ownerId, worldVersion],
      )
    ).rows;
    const inputs: RecentStoryWorldInput[] = [];
    for (const row of rows.reverse()) {
      const payload = row.payload,
        data = payload.data;
      const storyAt = payload.storyAt ?? payload.storyTime;
      if (typeof storyAt !== 'string' || !Number.isFinite(Date.parse(storyAt))) continue;
      const source = { sourceEventId: row.id as string, version: row.version as number, storyAt };
      if (
        payload.type === 'travel.completed' &&
        typeof data?.fromPlaceId === 'string' &&
        typeof data.toPlaceId === 'string'
      )
        inputs.push({
          ...source,
          kind: 'arrival',
          fromPlaceId: data.fromPlaceId,
          placeId: data.toPlaceId,
        });
      else if (
        payload.type === 'invitation.responded' &&
        typeof data?.id === 'string' &&
        ['accept', 'cancel', 'attend', 'miss', 'reschedule'].includes(data.operation)
      )
        inputs.push({
          ...source,
          kind: 'invitation_response',
          invitationId: data.id,
          operation: data.operation,
        });
      else if (typeof data?.sceneId === 'string')
        inputs.push({
          ...source,
          kind: 'scene_result',
          sceneId: data.sceneId,
          outcome: ['succeeded', 'partial', 'failed'].includes(data.proposal?.outcome)
            ? data.proposal.outcome
            : null,
        });
    }
    return inputs;
  }

  async load(sql: SqlClient, value: ProgressLedgerDefinition) {
    const d = value.definition;
    const row = (
      await sql.query(
        'SELECT definition_hash,revision,state FROM parallel_life.publication_story_progress WHERE world_id=$1 AND owner_id=$2 AND node_key=$3 FOR UPDATE',
        [d.worldId, d.ownerId, d.nodeKey],
      )
    ).rows[0];
    if (!row) return null;
    if (row.definition_hash !== hashDefinition(value)) throw new TaskError('INVALID_STATE');
    return { ...row.state, revision: row.revision } as PersistedStoryEventProgress;
  }

  async initialize(sql: SqlClient, value: ProgressLedgerDefinition, worldVersion: number) {
    const existing = await this.load(sql, value);
    if (existing) return existing;
    const d = value.definition;
    const initial: PersistedStoryEventProgress = {
      ...createStoryEventProgress(d),
      revision: 0,
      segmentIndex: 0,
      segmentStartBeat: 0,
      cursorVersion: 0,
      lastSourceEventId: null,
    };
    await sql.query(
      'INSERT INTO parallel_life.publication_story_progress(world_id,owner_id,node_key,definition_hash,revision,world_version,state) VALUES($1,$2,$3,$4,0,$5,$6)',
      [d.worldId, d.ownerId, d.nodeKey, hashDefinition(value), worldVersion, initial],
    );
    return initial;
  }

  /** recordId is resolved against actual storage/payload; neither record existence nor criteria are model assertions. */
  async apply(
    sql: SqlClient,
    value: ProgressLedgerDefinition,
    proposal: { signal: ProgressSignal; quote?: string },
    currentWorldVersion: number,
  ) {
    const d = value.definition;
    const signal = proposal.signal;
    if (
      !signal ||
      typeof signal.sourceEventId !== 'string' ||
      !signal.sourceEventId ||
      typeof signal.sourceRecordId !== 'string' ||
      !signal.sourceRecordId ||
      signal.sourceRecordId.length > 256 ||
      ![
        'introduced',
        'engaged',
        'declined',
        'reopened',
        'unrelated',
        'npc_progress',
        'nudge',
        'closure',
      ].includes(signal.kind) ||
      Object.keys(signal).some(
        (key) => !['sourceEventId', 'sourceRecordId', 'kind', 'closure'].includes(key),
      ) ||
      (signal.kind === 'closure'
        ? !['withdrawn', 'missed', 'alternative', 'unresolved'].includes(signal.closure ?? '')
        : signal.closure !== undefined) ||
      (proposal.quote !== undefined &&
        (typeof proposal.quote !== 'string' ||
          !proposal.quote.trim() ||
          proposal.quote.length > 240))
    )
      throw new TaskError('INVALID_INPUT');
    const world = (
      await sql.query(
        'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [d.worldId, d.ownerId],
      )
    ).rows[0];
    if (!world) throw new TaskError('NOT_FOUND');
    if (world.version !== currentWorldVersion) throw new TaskError('VERSION_CONFLICT');
    const old = await this.initialize(sql, value, currentWorldVersion);
    const duplicate =
      (
        await sql.query(
          'SELECT 1 FROM parallel_life.publication_story_progress_evidence WHERE world_id=$1 AND owner_id=$2 AND node_key=$3 AND source_event_id=$4 AND source_record_id=$5',
          [d.worldId, d.ownerId, d.nodeKey, signal.sourceEventId, signal.sourceRecordId],
        )
      ).rows.length > 0;
    if (duplicate) return old;
    const node = value.boundNode
      ? {
          actor_id: value.boundNode.actorId,
          source_event_id: value.boundNode.sourceEventId,
          source_message_id: value.boundNode.sourceMessageId,
          invitation_id: value.boundNode.invitationId,
          expected_version: value.boundNode.expectedVersion,
        }
      : (
          await sql.query(
            'SELECT actor_id,source_event_id,source_message_id,invitation_id,expected_version FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2 AND node_key=$3',
            [d.worldId, d.ownerId, d.nodeKey],
          )
        ).rows[0];
    if (!node?.source_event_id || !node.source_message_id) throw new TaskError('INVALID_STATE');
    if (
      signal.kind === 'introduced' &&
      (signal.sourceEventId !== node.source_event_id ||
        signal.sourceRecordId !== node.source_message_id)
    )
      throw new TaskError('INVALID_STATE');
    const source = (
      await sql.query(
        "SELECT e.id,e.command_id,e.version,e.payload,c.status,c.result_event_id FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3 AND c.status='succeeded' AND c.result_event_id=e.id",
        [d.worldId, d.ownerId, signal.sourceEventId],
      )
    ).rows[0];
    if (
      !source ||
      source.version > currentWorldVersion ||
      source.version < old.cursorVersion ||
      source.version <= node.expected_version
    )
      throw new TaskError('INVALID_STATE');
    const payload = source.payload as Record<string, any>;
    let observation: CommittedProgressObservation | null = null;
    const common = {
      id: source.id as string,
      recordId: signal.sourceRecordId,
      commandId: source.command_id as string,
      ownerId: d.ownerId,
      worldId: d.worldId,
      version: source.version as number,
      nodeKey: d.nodeKey,
      storyAt: payload.storyAt ?? payload.storyTime ?? payload.occurredAt,
      criterionIds: [] as string[],
    };
    if (payload.type === 'turn.resolved') {
      const message = (
        await sql.query(
          "SELECT actor_id,document FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND document->>'sourceEventId'=$4",
          [d.worldId, d.ownerId, signal.sourceRecordId, source.id],
        )
      ).rows[0];
      if (
        !message ||
        message.actor_id !== payload.data?.actorId ||
        message.document?.actorId !== message.actor_id ||
        !d.goals.some((goal) => goal.actorId === message.actor_id)
      )
        throw new TaskError('INVALID_STATE');
      const doc = message.document;
      if (typeof doc.text !== 'string' || !doc.text.trim()) throw new TaskError('INVALID_STATE');
      if (doc.role === 'user') {
        if (payload.data.origin === 'director' || doc.text !== payload.data.userText)
          throw new TaskError('INVALID_STATE');
        observation = {
          ...common,
          actorId: message.actor_id,
          observableActorIds: [message.actor_id],
          kind: 'player_decision',
        };
      } else if (doc.role === 'assistant') {
        if (
          !payload.data.effects?.some(
            (effect: Record<string, unknown>) =>
              effect.type === 'message.received' &&
              effect.id === signal.sourceRecordId &&
              effect.actorId === message.actor_id &&
              effect.text === doc.text,
          )
        )
          throw new TaskError('INVALID_STATE');
        const criterionIds = (value.spec.completion?.criteria ?? [])
          .filter(
            (criterion) =>
              criterion.kind === 'npc_exact_message' &&
              value.actorIdsByKey.get(criterion.actorKey) === message.actor_id &&
              typeof doc.text === 'string' &&
              doc.text.includes(criterion.phrase),
          )
          .map((criterion) => criterion.key);
        observation = {
          ...common,
          actorId: message.actor_id,
          observableActorIds: [message.actor_id],
          kind: 'npc_message',
          criterionIds,
        };
      } else throw new TaskError('INVALID_STATE');
      if (
        signal.kind !== 'introduced' &&
        (!proposal.quote || proposal.quote.length > 240 || !doc.text.includes(proposal.quote))
      )
        throw new TaskError('INVALID_STATE');
    } else if (payload.type === 'travel.completed') {
      const places = await this.authoredPlaces(sql, value);
      const destination = payload.data?.toPlaceId;
      if (
        signal.kind !== 'npc_progress' ||
        proposal.quote !== undefined ||
        typeof destination !== 'string' ||
        !places.includes(destination) ||
        signal.sourceRecordId !== `travel:${source.id}:${destination}`
      )
        throw new TaskError('INVALID_STATE');
      observation = {
        ...common,
        kind: 'verified_world_result',
        // The director knows the actual arrival. NPC knowledge still needs a witness
        // or disclosure; travelling never broadcasts the destination to the cast.
        observableActorIds: [],
        criterionIds: [],
      };
    } else if (
      [
        'scene.input_recorded',
        'scene.opened',
        'scene.action_resolved',
        'scene.reaction_recorded',
      ].includes(payload.type)
    ) {
      const item = (
        await sql.query(
          "SELECT i.document,s.document scene FROM parallel_life.scene_items i JOIN parallel_life.scene_sessions s ON s.world_id=i.world_id AND s.owner_id=i.owner_id AND s.id=i.scene_id WHERE i.world_id=$1 AND i.owner_id=$2 AND i.id=$3 AND i.kind='entry' AND i.source_event_id=$4 AND i.scene_id=$5",
          [d.worldId, d.ownerId, signal.sourceRecordId, source.id, payload.data?.sceneId],
        )
      ).rows[0];
      const entry = item?.document;
      const places = await this.authoredPlaces(sql, value);
      if (
        !entry ||
        entry.sourceEventId !== source.id ||
        entry.sourceVersion !== source.version ||
        typeof entry.text !== 'string' ||
        !proposal.quote ||
        !entry.text.includes(proposal.quote) ||
        (node.invitation_id
          ? item.scene.appointmentId !== node.invitation_id &&
            // A player can walk into the authored place before a proposed invitation.
            // An explicitly different appointment never gains access from location alone.
            !(item.scene.appointmentId == null && places.includes(item.scene.placeId))
          : places.length > 0 && !places.includes(item.scene.placeId))
      )
        throw new TaskError('INVALID_STATE');
      const visible = (entry.observableTo ?? [])
        .filter(
          (p: { kind?: string; actorId?: string }) =>
            p.kind === 'actor' && d.goals.some((g) => g.actorId === p.actorId),
        )
        .map((p: { actorId: string }) => p.actorId);
      if (entry.kind === 'user_action' && payload.type === 'scene.input_recorded') {
        if (payload.data.privateThought || payload.playerInput?.text !== entry.text)
          throw new TaskError('INVALID_STATE');
        observation = { ...common, kind: 'player_decision', observableActorIds: visible };
      } else if (entry.kind === 'dialogue' && entry.speaker?.kind === 'actor') {
        const actorId = entry.speaker.actorId;
        if (
          !d.goals.some((g) => g.actorId === actorId) ||
          !visible.includes(actorId) ||
          !payload.data?.proposal?.dialogues?.some(
            (line: { actorId?: string; text?: string }) =>
              line.actorId === actorId && line.text === entry.text,
          )
        )
          throw new TaskError('INVALID_STATE');
        observation = {
          ...common,
          kind: 'npc_message',
          actorId,
          observableActorIds: visible,
          criterionIds: (value.spec.completion?.criteria ?? [])
            .filter(
              (c) =>
                c.kind === 'npc_exact_message' &&
                value.actorIdsByKey.get(c.actorKey) === actorId &&
                entry.text.includes(c.phrase),
            )
            .map((c) => c.key),
        };
      } else throw new TaskError('INVALID_STATE');
    } else if (payload.type === 'invitation.responded') {
      const response =
        payload.data?.operation === 'accept'
          ? 'accepted'
          : payload.data?.operation === 'cancel'
            ? 'declined'
            : null;
      const expectedRecord = `invitation:${payload.data?.id}:${payload.data?.operation}`;
      if (
        !response ||
        !node?.invitation_id ||
        node.invitation_id !== payload.data?.id ||
        signal.sourceRecordId !== expectedRecord
      )
        throw new TaskError('INVALID_STATE');
      if (
        (response === 'declined' && signal.kind !== 'declined') ||
        (response === 'accepted' && !['engaged', 'reopened'].includes(signal.kind))
      )
        throw new TaskError('INVALID_STATE');
      observation = {
        ...common,
        actorId: node.actor_id,
        observableActorIds: [node.actor_id],
        kind: 'player_decision',
        criterionIds: (value.spec.completion?.criteria ?? [])
          .filter(
            (criterion) =>
              criterion.kind === 'invitation_response' && criterion.response === response,
          )
          .map((criterion) => criterion.key),
      };
    }
    if (!observation) throw new TaskError('INVALID_STATE');
    const next = applyStoryProgressSignal({
      definition: d,
      progress: old,
      signal,
      observations: [observation],
      receipts: [
        {
          commandId: source.command_id,
          ownerId: d.ownerId,
          worldId: d.worldId,
          status: 'succeeded',
          resultEventId: source.result_event_id,
          resultVersion: source.version,
        },
      ],
      currentWorldVersion: currentWorldVersion,
      actualIntroduction:
        observation.kind === 'npc_message' &&
        source.id === node.source_event_id &&
        signal.sourceRecordId === node.source_message_id,
    });
    // A long event can change segment only after an actual bounded follow-up.
    // This is pacing bookkeeping, never a completion criterion or physical outcome.
    const nextSegment =
      d.pace === 'extended' &&
      old.phase !== 'resolved' &&
      next.phase !== 'resolved' &&
      signal.kind === 'npc_progress' &&
      old.productiveBeats - old.segmentStartBeat >= storyPacePolicy(d.pace).targetBeats[1];
    // The immutable SQL ledger, not an ever-growing JSON array, owns replay deduplication.
    const persisted: PersistedStoryEventProgress = {
      ...old,
      ...next,
      productiveBeats:
        signal.kind === 'npc_progress' && value.openingPresentationEventIds?.includes(source.id)
          ? old.productiveBeats
          : next.productiveBeats,
      sourceEventIds: [],
      sourceRecordKeys: [],
      revision: old.revision + 1,
      segmentIndex: nextSegment ? old.segmentIndex + 1 : old.segmentIndex,
      segmentStartBeat: nextSegment ? next.productiveBeats : old.segmentStartBeat,
      cursorVersion: Math.max(old.cursorVersion, observation.version),
      lastSourceEventId: observation.id,
      criterionSources: Object.fromEntries(
        Object.entries(next.criterionSources).map(([key, ids]) => [key, ids.slice(0, 1)]),
      ),
    };
    await sql.query(
      'INSERT INTO parallel_life.publication_story_progress_evidence(world_id,owner_id,node_key,source_event_id,source_record_id,command_id,world_version,signal_kind,criterion_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        d.worldId,
        d.ownerId,
        d.nodeKey,
        source.id,
        signal.sourceRecordId,
        source.command_id,
        source.version,
        signal.kind,
        JSON.stringify(observation.criterionIds),
      ],
    );
    const changed = await sql.query(
      'UPDATE parallel_life.publication_story_progress SET revision=$4,world_version=$5,state=$6,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND node_key=$3 AND revision=$7 AND definition_hash=$8',
      [
        d.worldId,
        d.ownerId,
        d.nodeKey,
        persisted.revision,
        currentWorldVersion,
        persisted,
        old.revision,
        hashDefinition(value),
      ],
    );
    if (changed.rowCount !== 1) throw new TaskError('VERSION_CONFLICT');
    return persisted;
  }
}
