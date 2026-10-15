import { authoredSourceExcerpt } from '../../world/domain/authored-source-excerpt.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { createHash } from 'node:crypto';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import type { ActorEventGoal, EventGoalAssessment } from '../../world/domain/types.ts';
import type { StoryNode, StoryOrigin } from '../domain/publication-story.ts';
import { nextStoryMove, ownGoalBrief } from '../domain/story-event-progress.ts';
import {
  PublicationEventProgressRepository,
  hashDefinition,
  type ProgressLedgerDefinition,
  type PersistedStoryEventProgress,
} from './publication-event-progress-repository.ts';

/** Exact, current-node-only shape supplied by the scoped SQL reader. No future library. */
export type PublicationGoalRecord = {
  node: StoryNode;
  origin: StoryOrigin;
  actorIdsByKey: Record<string, string>;
  persona: {
    motivation: string;
    voice: string;
    boundaries: string;
    modules?: Partial<
      Record<'lifeContext' | 'traits' | 'drives' | 'behavior' | 'relationships', string>
    >;
  };
  state: {
    actorId: string;
    sourceEventId: string;
    sourceMessageId: string;
    status: string;
    invitationId: string | null;
    expectedVersion: number;
    storyAt: string;
  };
  /** Authorized immutable intent only; never proof that a speaker has delivered. */
  openingPlan?: Record<string, { direction: string; persona: PublicationGoalRecord['persona'] }>;
  /** Validated live opening participants; private per-speaker direction, one shared definition. */
  openingActors?: Record<
    string,
    {
      direction: string;
      state: PublicationGoalRecord['state'];
      persona: PublicationGoalRecord['persona'];
    }
  >;
};
export type PublicationGoalContext = {
  record: PublicationGoalRecord;
  value: ProgressLedgerDefinition;
  progress: PersistedStoryEventProgress;
};
/** Budgeted source excerpts only; full authored modules remain unchanged in storage. */
export function selectCharacterSource(
  value: string | undefined,
  query: string,
  limit = 1200,
): string {
  return value ? authoredSourceExcerpt(value, query, limit, 4) : '';
}
export function publicationGoalDefinition(
  ownerId: string,
  worldId: string,
  row: PublicationGoalRecord,
): ProgressLedgerDefinition {
  const ids = new Map(Object.entries(row.actorIdsByKey));
  const planned = row.openingPlan ?? row.openingActors;
  const spec = row.node.direction?.progress ?? {};
  const owner = row.state.actorId;
  const goalTopic = `${row.node.title}\n${row.node.editorialIntent}`;
  const motivation =
    selectCharacterSource(row.persona.modules?.drives, goalTopic) || row.persona.motivation;
  const stance =
    selectCharacterSource(
      row.persona.modules?.traits ??
        row.persona.modules?.behavior ??
        row.persona.modules?.relationships,
      goalTopic,
      1000,
    ) || row.persona.boundaries;
  if (
    !owner ||
    !row.state.sourceEventId ||
    !row.state.sourceMessageId ||
    ![...ids.values()].includes(owner)
  )
    throw new TaskError('INVALID_STATE');
  const criteria = (spec.completion?.criteria ?? []).map((c) => ({
    id: c.key,
    basis:
      c.kind === 'npc_exact_message'
        ? ('actual_npc_message' as const)
        : ('explicit_player_decision' as const),
    purpose: 'conversation' as const,
    actorId: c.kind === 'npc_exact_message' ? ids.get(c.actorKey) : owner,
  }));
  if (criteria.some((c) => !c.actorId)) throw new TaskError('INVALID_STATE');
  const involved = new Set([
    owner,
    ...criteria.map((c) => c.actorId!),
    ...Object.keys(planned ?? {}),
  ]);
  return {
    spec,
    actorIdsByKey: ids,
    openingPresentationEventIds: Object.values(row.openingActors ?? {}).map(
      (actor) => actor.state.sourceEventId,
    ),
    boundNode: {
      ...row.state,
      placeIds: [
        row.node.placeKey,
        row.node.settingPlaceKey,
        ...(row.node.scenePlaceKeys ?? []),
        ...(row.node.intent.kind === 'offer_invitation' ? [row.node.intent.placeKey] : []),
      ].filter((p): p is string => typeof p === 'string'),
    },
    definition: {
      ownerId,
      worldId,
      nodeKey: row.node.key,
      pace: spec.pace ?? 'standard',
      refusal: spec.refusal ?? 'defer',
      completion: spec.completion ? { mode: spec.completion.mode, criteria } : null,
      goals: [...involved].map((actorId) => ({
        actorId,
        // Secondary criterion participants stay private/unactivated. Only the actual
        // node speaker receives a frame, with that speaker's own authored motivation.
        want:
          planned?.[actorId]?.direction ??
          (actorId === owner ? `${motivation}；当前事情：${row.node.title}` : row.node.title),
        stance: planned?.[actorId]
          ? selectCharacterSource(
              planned[actorId].persona.modules?.traits ?? planned[actorId].persona.boundaries,
              '',
              1000,
            )
          : actorId === owner
            ? stance
            : '参与由本人实际回应确定',
        boundaries: planned?.[actorId]
          ? [planned[actorId].persona.boundaries]
          : actorId === owner
            ? [row.persona.boundaries]
            : [],
        authoredSourceId: `publication:${row.origin.workId}:${row.origin.contentHash}:${row.node.key}`,
        anchorSourceIds: row.openingPlan
          ? []
          : row.openingActors?.[actorId]
            ? [
                row.openingActors[actorId].state.sourceEventId,
                row.openingActors[actorId].state.sourceMessageId,
              ]
            : [row.state.sourceEventId, row.state.sourceMessageId],
        completionCriterionIds: criteria.filter((c) => c.actorId === actorId).map((c) => c.id),
      })),
    },
  };
}

/** Immutable authorized intents define identity; only verified deliveries activate an own frame. */
async function openingParticipants(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  worldVersion: number,
  record: PublicationGoalRecord,
) {
  const batch = (
    await sql.query(
      'SELECT source_hash,node_key,status FROM parallel_life.publication_opening_batches WHERE world_id=$1 AND owner_id=$2 AND node_key=$3',
      [worldId, ownerId, record.node.key],
    )
  ).rows[0];
  if (!batch) return true;
  const rows = (
    await sql.query(
      `SELECT d.actor_id,d.brief,d.expected_version,e.id AS event_id,m.id AS message_id,m.document->>'at' AS at
    FROM parallel_life.publication_opening_deliveries d
    JOIN parallel_life.world_events e ON e.world_id=d.world_id AND e.owner_id=d.owner_id AND e.id=d.source_event_id
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=d.command_id::text AND c.result_event_id=e.id AND c.status='succeeded' AND e.command_id=c.id
    JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.id=d.source_message_id AND m.actor_id=d.actor_id
    WHERE d.world_id=$1 AND d.owner_id=$2 AND d.status='delivered' AND e.version<=$3 AND e.version=d.expected_version+1 AND c.expected_version=d.expected_version
    AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'origin'='director' AND e.payload->'data'->>'actorId'=d.actor_id
    AND m.document->>'role'='assistant' AND m.document->>'actorId'=d.actor_id AND m.document->>'sourceEventId'=e.id AND m.document->'sourceVersion'=to_jsonb(e.version)
    AND NOT(m.document ? 'history') AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'effects') x WHERE x->>'type'='message.received' AND x->>'id'=m.id AND x->>'actorId'=d.actor_id AND x->>'text'=m.document->>'text')`,
      [worldId, ownerId, worldVersion],
    )
  ).rows;
  const plan = (
    await sql.query(
      'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId],
    )
  ).rows[0]?.document;
  if (!plan || JSON.stringify(plan.origin) !== JSON.stringify(record.origin))
    throw new TaskError('INVALID_STATE');
  const ordered = record.node.actorKeys.length
    ? record.node.actorKeys.flatMap((key) =>
        plan.actors.filter((a: { key: string }) => a.key === key),
      )
    : plan.actors;
  const deliveries = (
    await sql.query(
      'SELECT actor_id,brief,status FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId],
    )
  ).rows;
  const actorIds = ordered
    .filter((a: { id: string }) => deliveries.some((d) => d.actor_id === a.id))
    .map((a: { id: string }) => a.id);
  if (
    deliveries.length !== actorIds.length ||
    new Set(actorIds).size !== actorIds.length ||
    deliveries.some((d) => !actorIds.includes(d.actor_id)) ||
    rows.length !== deliveries.filter((d) => d.status === 'delivered').length ||
    (batch.status === 'complete' && rows.length !== deliveries.length) ||
    createHash('sha256')
      .update(JSON.stringify([record.origin, record.node.key, actorIds]))
      .digest('hex') !== batch.source_hash
  )
    throw new TaskError('INVALID_STATE');
  // The shared event is anchored by the first actual delivery, never by an unsent plan.
  if (
    !rows.some(
      (r) =>
        r.actor_id === record.state.actorId &&
        r.event_id === record.state.sourceEventId &&
        r.message_id === record.state.sourceMessageId,
    )
  )
    return false;
  const result: NonNullable<PublicationGoalRecord['openingActors']> = {};
  const intents: NonNullable<PublicationGoalRecord['openingPlan']> = {};
  for (const actorId of actorIds) {
    const delivery = deliveries.find((d) => d.actor_id === actorId)!;
    const modules = (
      await sql.query('SELECT parallel_life.publication_actor_life_modules($1,$2) AS document', [
        worldId,
        actorId,
      ])
    ).rows[0]?.document;
    const persona = {
      motivation: delivery.brief,
      voice: '',
      boundaries:
        selectCharacterSource(modules?.behavior, '', 1000) ||
        'Respect established character boundaries',
      modules,
    };
    intents[actorId] = { direction: delivery.brief, persona };
  }
  // Preserve the original verified SQL row insertion order for legacy hash compatibility.
  // New immutable intent order lives separately in openingPlan.
  for (const r of rows) {
    const actorId = r.actor_id;
    result[actorId] = {
      ...intents[actorId]!,
      state: {
        actorId,
        sourceEventId: r.event_id,
        sourceMessageId: r.message_id,
        expectedVersion: r.expected_version,
        storyAt: r.at,
        invitationId: null,
        status: 'presented',
      },
    };
  }
  record.openingPlan = intents;
  record.openingActors = result;
  return true;
}

export async function publicationGoalContexts(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  worldVersion: number,
  actorId: string | null = null,
  initialAssessments: readonly EventGoalAssessment[] = [],
  initialSourceEventId?: string,
) {
  const rows = (
    await sql.query('SELECT parallel_life.publication_active_event_goals($1,$2) AS items', [
      worldId,
      null,
    ])
  ).rows[0]?.items as PublicationGoalRecord[] | undefined;
  if (!Array.isArray(rows)) throw new TaskError('INVALID_STATE');
  const ledger = new PublicationEventProgressRepository();
  const contexts: PublicationGoalContext[] = [];
  for (const record of rows) {
    if (!(await openingParticipants(sql, ownerId, worldId, worldVersion, record))) continue;
    if (actorId && record.state.actorId !== actorId && !record.openingActors?.[actorId]) continue;
    // Immutable own modules must participate in the very first definition hash.
    // The leased worker reader exposes only this actual/candidate speaker.
    if (!record.persona.modules) {
      const own = (
        await sql.query('SELECT parallel_life.publication_actor_life_modules($1,$2) AS document', [
          worldId,
          record.state.actorId,
        ])
      ).rows[0]?.document;
      if (own) record.persona.modules = own;
    }
    let value = publicationGoalDefinition(ownerId, worldId, record);
    const existing = (
      await sql.query(
        'SELECT definition_hash FROM parallel_life.publication_story_progress WHERE world_id=$1 AND owner_id=$2 AND node_key=$3',
        [worldId, ownerId, record.node.key],
      )
    ).rows[0];
    if (existing && existing.definition_hash !== hashDefinition(value)) {
      // Older complete-only ledgers keep their exact definition and all recorded state.
      const batch = (
        await sql.query(
          'SELECT status FROM parallel_life.publication_opening_batches WHERE world_id=$1 AND owner_id=$2 AND node_key=$3',
          [worldId, ownerId, record.node.key],
        )
      ).rows[0];
      if (batch?.status !== 'complete') throw new TaskError('INVALID_STATE');
      const legacy = publicationGoalDefinition(ownerId, worldId, {
        ...record,
        openingPlan: undefined,
      });
      if (existing.definition_hash !== hashDefinition(legacy)) throw new TaskError('INVALID_STATE');
      value = legacy;
    }
    let progress = await ledger.load(sql, value);
    if (!progress) {
      const closure =
        record.state.sourceEventId === initialSourceEventId
          ? initialAssessments.find(
              (a) =>
                a.goalKey === `publication:${record.node.key}` &&
                a.target === 'npc' &&
                a.kind === 'closure',
            )
          : undefined;
      progress = await ledger.apply(
        sql,
        value,
        {
          signal: {
            kind: closure ? 'closure' : 'introduced',
            sourceEventId: record.state.sourceEventId,
            sourceRecordId: record.state.sourceMessageId,
            ...(closure?.closure ? { closure: closure.closure } : {}),
          },
          ...(closure ? { quote: closure.quote } : {}),
        },
        worldVersion,
      );
    }
    for (const actor of Object.values(record.openingActors ?? {}).sort(
      (a, b) => a.state.expectedVersion - b.state.expectedVersion,
    )) {
      if (
        progress.phase === 'resolved' ||
        actor.state.sourceEventId === record.state.sourceEventId ||
        actor.state.expectedVersion + 1 < progress.cursorVersion
      )
        continue;
      const text = (
        await sql.query(
          "SELECT document->>'text' AS text FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2 AND id=$3",
          [worldId, ownerId, actor.state.sourceMessageId],
        )
      ).rows[0]?.text;
      if (typeof text !== 'string' || !text.trim()) throw new TaskError('INVALID_STATE');
      progress = await ledger.apply(
        sql,
        value,
        {
          signal: {
            kind: 'npc_progress',
            sourceEventId: actor.state.sourceEventId,
            sourceRecordId: actor.state.sourceMessageId,
          },
          quote: text.slice(0, 240),
        },
        worldVersion,
      );
    }
    for (const input of await ledger.recentWorldInputs(sql, ownerId, worldId, worldVersion)) {
      if (
        input.version < progress.cursorVersion ||
        input.version <= record.state.expectedVersion ||
        progress.phase === 'resolved'
      )
        continue;
      if (input.kind === 'arrival' && value.boundNode?.placeIds.includes(input.placeId))
        progress = await ledger.apply(
          sql,
          value,
          {
            signal: {
              kind: 'npc_progress',
              sourceEventId: input.sourceEventId,
              sourceRecordId: `travel:${input.sourceEventId}:${input.placeId}`,
            },
          },
          worldVersion,
        );
      if (
        input.kind === 'invitation_response' &&
        input.invitationId === record.state.invitationId &&
        ['accept', 'cancel'].includes(input.operation)
      )
        progress = await ledger.apply(
          sql,
          value,
          {
            signal: {
              kind:
                input.operation === 'cancel'
                  ? 'declined'
                  : progress.participation === 'declined'
                    ? 'reopened'
                    : 'engaged',
              sourceEventId: input.sourceEventId,
              sourceRecordId: `invitation:${input.invitationId}:${input.operation}`,
            },
          },
          worldVersion,
        );
    }
    contexts.push({ record, value, progress });
  }
  return contexts;
}

/** Frame counters only include records this speaker actually saw. Remote travel is director-only. */
export async function publicationOwnGoalFrame(
  sql: SqlClient,
  context: PublicationGoalContext,
  actorId: string,
  storyNow: string,
  blockedSources: ReadonlySet<string> = new Set(),
): Promise<ActorEventGoal | null> {
  const { record: originalRecord, value, progress } = context;
  const record = originalRecord.openingActors?.[actorId]
    ? { ...originalRecord, state: originalRecord.openingActors[actorId].state }
    : originalRecord;
  if (
    record.state.actorId !== actorId ||
    blockedSources.has(record.state.sourceEventId) ||
    blockedSources.has(record.state.sourceMessageId)
  )
    return null;
  const own = ownGoalBrief(value.definition, progress, actorId, blockedSources);
  if (!own) return null;
  const evidence = (
    await sql.query(
      "SELECT e.source_event_id,e.source_record_id,e.signal_kind,w.payload,m.document message,i.document entry FROM parallel_life.publication_story_progress_evidence e JOIN parallel_life.world_events w ON w.world_id=e.world_id AND w.id=e.source_event_id LEFT JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.id=e.source_record_id LEFT JOIN parallel_life.scene_items i ON i.world_id=e.world_id AND i.id=e.source_record_id AND i.kind='entry' WHERE e.world_id=$1 AND e.owner_id=$2 AND e.node_key=$3 ORDER BY e.world_version DESC LIMIT 64",
      [value.definition.worldId, value.definition.ownerId, value.definition.nodeKey],
    )
  ).rows.filter(
    (e) =>
      !blockedSources.has(e.source_event_id) &&
      !blockedSources.has(e.source_record_id) &&
      (e.message?.actorId === actorId ||
        e.entry?.observableTo?.some(
          (p: { kind: string; actorId?: string }) => p.kind === 'actor' && p.actorId === actorId,
        ) ||
        (e.payload?.type === 'invitation.responded' &&
          e.payload.data?.id === record.state.invitationId)),
  );
  const productiveBeats = evidence.filter(
    (e) => !['unrelated', 'declined', 'nudge'].includes(e.signal_kind),
  ).length;
  const last = evidence.find((e) => e.signal_kind !== 'unrelated');
  const visible = {
    ...progress,
    participation: own.participation ?? 'unknown',
    productiveBeats,
    nudges: evidence.filter((e) => e.signal_kind === 'nudge').length,
    unrelatedInputs: evidence.slice(
      0,
      evidence.findIndex((e) => e.signal_kind !== 'unrelated') < 0
        ? evidence.length
        : evidence.findIndex((e) => e.signal_kind !== 'unrelated'),
    ).length,
    lastRelevantAt: last?.payload?.storyAt ?? last?.payload?.storyTime ?? record.state.storyAt,
    phase:
      own.status === 'fulfilled' || own.status === 'withdrawn'
        ? ('resolved' as const)
        : own.participation === 'engaged'
          ? ('engaged' as const)
          : ('introduced' as const),
  };
  const visibleSegment =
    value.definition.pace === 'extended' ? Math.floor(Math.max(0, productiveBeats - 1) / 7) : 0;
  const move = nextStoryMove({
    definition: value.definition,
    progress:
      value.definition.pace === 'extended'
        ? { ...visible, productiveBeats: Math.max(0, visible.productiveBeats - visibleSegment * 7) }
        : visible,
    storyNow,
    autonomousActionAvailable: true,
  });
  return {
    goalKey: `publication:${record.node.key}`,
    actorId,
    source: {
      kind: 'publication_node',
      nodeKey: record.node.key,
      sourceEventId: record.state.sourceEventId,
      sourceRecordId: record.state.sourceMessageId,
    },
    want: own.want,
    stance: own.stance,
    boundaries: own.boundaries,
    phase: visible.phase,
    sharedEventPhase: progress.phase === 'pending' ? 'introduced' : progress.phase,
    status: own.status ?? 'active',
    participation: own.participation ?? 'unknown',
    refusalScope: 'current_player_request',
    mayPursueOwnGoalWithoutPlayer: true,
    actualMovesRequireRuntimeAuthorization: true,
    pace: value.definition.pace,
    productiveBeats,
    segmentIndex: visibleSegment,
    nextMove:
      visible.phase === 'resolved' || progress.phase === 'resolved'
        ? 'finished'
        : own.status === 'deferred'
          ? 'wait'
          : move === 'introduce'
            ? 'wait'
            : move,
  };
}

/** A button press is not a world change. Only the latest validated external input wakes a goal. */
export async function publicationProgressTrigger(
  sql: SqlClient,
  context: PublicationGoalContext,
): Promise<'idle' | 'world_change'> {
  if (!context.progress.lastSourceEventId) return 'idle';
  const row = (
    await sql.query(
      'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND version<=$4',
      [
        context.value.definition.worldId,
        context.value.definition.ownerId,
        context.progress.lastSourceEventId,
        context.progress.cursorVersion,
      ],
    )
  ).rows[0];
  return row && ['travel.completed', 'invitation.responded'].includes(row.payload.type)
    ? 'world_change'
    : 'idle';
}
