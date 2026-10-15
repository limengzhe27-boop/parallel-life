import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { createHash } from 'node:crypto';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import type { ActorEventGoal, EventGoalAssessment } from '../../world/domain/types.ts';
import type { StoryNode, StoryOrigin } from '../domain/publication-story.ts';
import { nextStoryMove, ownGoalBrief } from '../domain/story-event-progress.ts';
import {
  PublicationEventProgressRepository,
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
/** Pick intact authored units for context; the full source remains stored unchanged. */
export function selectCharacterSource(
  value: string | undefined,
  query: string,
  limit = 1200,
): string {
  if (!value?.trim()) return '';
  if (value.length <= limit) return value;
  const units = value
    .split(/\n\s*\n|\n/u)
    .flatMap((unit) => (unit.length > limit ? unit.split(/(?<=[。！？；])/u) : [unit]))
    .map((unit) => unit.trim())
    .filter(Boolean);
  const words = query.match(/[\p{Script=Han}]{2,}|[a-zA-Z]{3,}/gu) ?? [];
  const ranked = units
    .map((unit, index) => ({
      unit,
      index,
      score: words.reduce((n, word) => n + (unit.includes(word) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: typeof ranked = [];
  let size = 0;
  for (const item of ranked) {
    if (size + item.unit.length > limit) continue;
    picked.push(item);
    size += item.unit.length;
    if (picked.length === 4) break;
  }
  // Never show a cut sentence as a complete authored statement.
  if (!picked.length) return units[0] ?? '';
  return picked
    .sort((a, b) => a.index - b.index)
    .map((x) => x.unit)
    .join('\n');
}
export function publicationGoalDefinition(
  ownerId: string,
  worldId: string,
  row: PublicationGoalRecord,
): ProgressLedgerDefinition {
  const ids = new Map(Object.entries(row.actorIdsByKey));
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
    ...Object.keys(row.openingActors ?? {}),
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
          row.openingActors?.[actorId]?.direction ??
          (actorId === owner ? `${motivation}；当前事情：${row.node.title}` : row.node.title),
        stance: row.openingActors?.[actorId]
          ? selectCharacterSource(
              row.openingActors[actorId].persona.modules?.traits ??
                row.openingActors[actorId].persona.boundaries,
              '',
              1000,
            )
          : actorId === owner
            ? stance
            : '参与由本人实际回应确定',
        boundaries: row.openingActors?.[actorId]
          ? [row.openingActors[actorId].persona.boundaries]
          : actorId === owner
            ? [row.persona.boundaries]
            : [],
        authoredSourceId: `publication:${row.origin.workId}:${row.origin.contentHash}:${row.node.key}`,
        anchorSourceIds: row.openingActors?.[actorId]
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

/** Enrich only a completed live batch, preserving a stable common goal-definition hash. */
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
  if (batch.status !== 'complete') return false;
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
  const actorIds = ordered
    .filter((a: { id: string }) => rows.some((r) => r.actor_id === a.id))
    .map((a: { id: string }) => a.id);
  const count = (
    await sql.query(
      'SELECT count(*)::int AS count FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId],
    )
  ).rows[0].count;
  if (
    rows.length !== count ||
    createHash('sha256')
      .update(JSON.stringify([record.origin, record.node.key, actorIds]))
      .digest('hex') !== batch.source_hash
  )
    throw new TaskError('INVALID_STATE');
  const result: NonNullable<PublicationGoalRecord['openingActors']> = {};
  for (const r of rows) {
    const modules = (
      await sql.query('SELECT parallel_life.publication_actor_life_modules($1,$2) AS document', [
        worldId,
        r.actor_id,
      ])
    ).rows[0]?.document;
    result[r.actor_id] = {
      direction: r.brief,
      state: {
        actorId: r.actor_id,
        sourceEventId: r.event_id,
        sourceMessageId: r.message_id,
        expectedVersion: r.expected_version,
        storyAt: r.at,
        invitationId: null,
        status: 'presented',
      },
      persona: {
        motivation: r.brief,
        voice: '',
        boundaries:
          selectCharacterSource(modules?.behavior, '', 1000) ||
          'Respect established character boundaries',
        modules,
      },
    };
  }
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
    const value = publicationGoalDefinition(ownerId, worldId, record);
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
    phase:
      progress.phase === 'resolved'
        ? 'resolved'
        : progress.phase === 'engaged'
          ? 'engaged'
          : visible.phase,
    status: own.status ?? 'active',
    participation: own.participation ?? 'unknown',
    refusalScope: 'current_player_request',
    mayPursueOwnGoalWithoutPlayer: true,
    actualMovesRequireRuntimeAuthorization: true,
    pace: value.definition.pace,
    productiveBeats,
    segmentIndex: visibleSegment,
    nextMove: progress.phase === 'resolved' ? 'finished' : move === 'introduce' ? 'wait' : move,
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
