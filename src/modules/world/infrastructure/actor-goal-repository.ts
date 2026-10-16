import { selectCharacterSource } from '../../settings/infrastructure/publication-event-goal-context.ts';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorContext } from '../application/ports.ts';
import type { ActorEventGoal, EventGoalAssessment, WorldState } from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';
import { validateEventGoalAssessmentQuotes } from '../domain/validation.ts';
import {
  createStoryEventProgress,
  applyStoryProgressSignal,
  nextStoryMove,
  storyPacePolicy,
  ownGoalBrief,
  type StoryEventProgress,
  type StoryProgressDefinition,
} from '../../settings/domain/story-event-progress.ts';
import {
  publicationGoalContexts,
  publicationOwnGoalFrame,
} from '../../settings/infrastructure/publication-event-goal-context.ts';
import { PublicationEventProgressRepository } from '../../settings/infrastructure/publication-event-progress-repository.ts';
import { deriveAndStoreMemories } from '../../memory/infrastructure/memory-store.ts';

export const PRIVATE_GOAL_MEMORY_PREFIX = 'actor_event_progress_v1:';
type GeneralGoal = {
  frame: ActorEventGoal;
  definition: StoryProgressDefinition;
  progress: StoryEventProgress;
};
function persona(value: string) {
  try {
    const p = JSON.parse(value);
    return {
      want: typeof p.motivation === 'string' ? p.motivation : value,
      stance: typeof p.boundaries === 'string' ? p.boundaries : value,
    };
  } catch {
    return { want: value, stance: value };
  }
}
const cacheKey = (key: string) =>
  PRIVATE_GOAL_MEMORY_PREFIX + createHash('sha256').update(key).digest('hex').slice(0, 32);
const definitionHash = (d: StoryProgressDefinition) =>
  createHash('sha256').update(JSON.stringify(d)).digest('hex');

/** General goals use real, self-issued invitations or matters, never fake publication nodes. */
async function generalGoals(
  sql: SqlClient,
  context: ActorContext,
  ownerId: string,
  blocked: ReadonlySet<string>,
): Promise<GeneralGoal[]> {
  const initial = (
    await sql.query(
      'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
      [context.worldId, ownerId],
    )
  ).rows[0]?.state as WorldState | undefined;
  const candidates: (ActorEventGoal & { startedAt: string })[] = [];
  const p = persona(context.actor.persona);
  const modules = (
    await sql.query('SELECT parallel_life.publication_actor_life_modules($1,$2) AS document', [
      context.worldId,
      context.actor.id,
    ])
  ).rows[0]?.document;
  if (modules?.drives) p.want = selectCharacterSource(modules.drives, '', 1200);
  if (modules?.traits || modules?.behavior)
    p.stance = selectCharacterSource(modules.traits || modules.behavior, '', 1000);
  for (const appointment of context.appointments) {
    if (
      appointment.participantIds.length !== 1 ||
      appointment.participantIds[0] !== context.actor.id ||
      blocked.has(appointment.id) ||
      blocked.has(appointment.sourceEventId)
    )
      continue;
    const source = (
      await sql.query(
        "SELECT m.id,e.payload FROM parallel_life.world_messages m JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.id=m.document->>'sourceEventId' JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=$3 AND m.document->>'role'='assistant' AND e.id=$4",
        [context.worldId, ownerId, context.actor.id, appointment.sourceEventId],
      )
    ).rows[0];
    const historical = initial?.appointments.find(
      (a) =>
        a.id === appointment.id &&
        a.sourceEventId === appointment.sourceEventId &&
        a.participantIds.length === 1 &&
        a.participantIds[0] === context.actor.id,
    );
    if (!source && !historical) continue;
    const recordId = source?.id ?? appointment.sourceMessageId ?? appointment.id;
    if (blocked.has(recordId)) continue;
    candidates.push({
      startedAt:
        source?.payload?.storyAt ??
        initial?.messages.find((m) => m.id === appointment.sourceMessageId)?.at ??
        initial?.time ??
        context.time,
      goalKey: `invitation:${appointment.id}`,
      actorId: context.actor.id,
      source: {
        kind: 'director_event',
        sourceEventId: appointment.sourceEventId,
        sourceRecordId: recordId,
      },
      want: `${p.want}；本人已经提出的见面安排：${appointment.title}`,
      stance: p.stance,
      boundaries: [],
      phase: 'introduced',
      status:
        appointment.status === 'cancelled' || appointment.status === 'missed'
          ? 'deferred'
          : 'active',
      participation:
        appointment.status === 'cancelled'
          ? 'declined'
          : appointment.status === 'confirmed' || appointment.status === 'attended'
            ? 'engaged'
            : 'unknown',
      refusalScope: 'current_player_request',
      mayPursueOwnGoalWithoutPlayer: true,
      actualMovesRequireRuntimeAuthorization: true,
      pace: 'standard',
      productiveBeats: 1,
      segmentIndex: 0,
      nextMove: 'wait',
    });
  }
  for (const matter of context.matters ?? []) {
    const row = (
      await sql.query(
        `SELECT m AS document FROM parallel_life.worlds w
         CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.state->'matters','[]'::jsonb)) m
         WHERE w.id=$1 AND w.owner_id=$2 AND m->>'id'=$3`,
        [context.worldId, ownerId, matter.id],
      )
    ).rows[0]?.document;
    if (
      !row ||
      !['actor_proposal', 'director_proposal'].includes(row.source?.kind) ||
      !row.relatedActorIds?.includes(context.actor.id) ||
      blocked.has(row.source.eventId)
    )
      continue;
    const source = (
      await sql.query(
        "SELECT m.id,e.payload FROM parallel_life.world_messages m JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.id=m.document->>'sourceEventId' JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=$3 AND m.document->>'role'='assistant' AND e.id=$4 AND e.payload->'data'->>'actorId'=$3",
        [context.worldId, ownerId, context.actor.id, row.source.eventId],
      )
    ).rows[0];
    if (!source || blocked.has(source.id)) continue;
    candidates.push({
      startedAt: source.payload.storyAt ?? context.time,
      goalKey: `matter:${matter.id}:actor:${context.actor.id}`,
      actorId: context.actor.id,
      source: {
        kind: 'matter',
        matterId: matter.id,
        sourceEventId: row.source.eventId,
        sourceRecordId: source.id,
      },
      want: `${p.want}；本人提出的事项：${matter.title}`,
      stance: p.stance,
      boundaries: [],
      phase: 'introduced',
      status: 'active',
      participation: 'unknown',
      refusalScope: 'current_player_request',
      mayPursueOwnGoalWithoutPlayer: true,
      actualMovesRequireRuntimeAuthorization: true,
      pace: row.span === 'pursuit' ? 'extended' : 'standard',
      productiveBeats: 1,
      segmentIndex: 0,
      nextMove: 'wait',
    });
  }
  const results: GeneralGoal[] = [];
  for (const frame of candidates.slice(-4)) {
    const definition: StoryProgressDefinition = {
      ownerId,
      worldId: context.worldId,
      nodeKey: frame.goalKey,
      pace: frame.pace,
      refusal: 'defer',
      completion: null,
      goals: [
        {
          actorId: frame.actorId,
          want: frame.want,
          stance: frame.stance,
          boundaries: frame.boundaries,
          authoredSourceId: frame.source.sourceEventId,
          anchorSourceIds: [frame.source.sourceEventId, frame.source.sourceRecordId],
          completionCriterionIds: [],
        },
      ],
    };
    let progress: StoryEventProgress = {
      ...createStoryEventProgress(definition),
      phase: 'introduced',
      productiveBeats: 1,
      lastRelevantAt: frame.startedAt,
      participation: frame.participation,
      actorParticipation: { [frame.actorId]: frame.participation },
      actorGoalStatus: { [frame.actorId]: frame.status },
    };
    const memo = (
      await sql.query(
        "SELECT text,source_ids FROM parallel_life.memory_records WHERE owner_id=$1 AND scope_type='character' AND scope_id=$2 AND branch_id=$3 AND key=$4 AND status='active' AND source_type='agent_inference' ORDER BY created_at DESC LIMIT 1",
        [ownerId, frame.actorId, context.worldId, cacheKey(frame.goalKey)],
      )
    ).rows[0];
    if (memo && !memo.source_ids.some((id: string) => blocked.has(id))) {
      try {
        const saved = JSON.parse(memo.text);
        if (
          saved.schemaVersion === 1 &&
          saved.definitionHash === definitionHash(definition) &&
          saved.progress.nodeKey === frame.goalKey
        )
          progress = saved.progress;
      } catch {
        /* Unrecognized memory is never execution state. */
      }
    }
    if (frame.goalKey.startsWith('invitation:') && progress.phase !== 'resolved') {
      const appointmentId = frame.goalKey.slice('invitation:'.length);
      const response = (
        await sql.query(
          "SELECT e.id,e.command_id,e.version,e.payload FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 AND e.payload->>'type'='invitation.responded' AND e.payload->'data'->>'id'=$4 AND e.payload->'data'->>'operation' IN ('accept','cancel') ORDER BY e.version DESC LIMIT 1",
          [context.worldId, ownerId, context.worldVersion, appointmentId],
        )
      ).rows[0];
      if (response && !blocked.has(response.id)) {
        const kind =
          response.payload.data.operation === 'cancel'
            ? 'declined'
            : progress.participation === 'declined'
              ? 'reopened'
              : 'engaged';
        const recordId = `invitation:${appointmentId}:${response.payload.data.operation}`;
        progress = applyStoryProgressSignal({
          definition,
          progress,
          signal: { sourceEventId: response.id, sourceRecordId: recordId, kind },
          observations: [
            {
              id: response.id,
              recordId,
              commandId: response.command_id,
              ownerId,
              worldId: context.worldId,
              version: response.version,
              storyAt: response.payload.storyTime ?? response.payload.storyAt,
              nodeKey: frame.goalKey,
              actorId: frame.actorId,
              observableActorIds: [frame.actorId],
              kind: 'player_decision',
              criterionIds: [],
            },
          ],
          receipts: [
            {
              commandId: response.command_id,
              ownerId,
              worldId: context.worldId,
              status: 'succeeded',
              resultEventId: response.id,
              resultVersion: response.version,
            },
          ],
          currentWorldVersion: context.worldVersion,
        });
      }
    }
    if (frame.source.kind === 'matter') {
      const matterId = frame.source.matterId;
      const matter = context.matters?.find((m) => m.id === matterId);
      // Only a runtime-verified scene result can fulfill a physical goal.
      if (matter?.status === 'completed' && matter.assertion === 'world_verified') {
        const proof = (
          await sql.query(
            "SELECT e.id FROM parallel_life.worlds w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.state->'matters','[]'::jsonb)) m JOIN parallel_life.world_events e ON e.world_id=w.id AND e.owner_id=w.owner_id AND e.id=m->'evidence'->>'eventId' AND e.version=(m->'evidence'->>'eventVersion')::int JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id JOIN parallel_life.scene_items i ON i.world_id=e.world_id AND i.source_event_id=e.id AND i.kind='entry' WHERE w.id=$1 AND w.owner_id=$2 AND m->>'id'=$3 AND m->>'status'='completed' AND m->>'assertion'='world_verified' AND m->'evidence'->>'kind' IN ('scene_action','scene_steps') AND e.version<=$4 AND e.payload->>'type'='scene.action_resolved' AND e.payload->'data'->'worldResults'->'updates' @> $5::jsonb AND i.document->'observableTo' @> $6::jsonb LIMIT 1",
            [
              context.worldId,
              ownerId,
              matterId,
              context.worldVersion,
              JSON.stringify([{ matterId, status: 'completed' }]),
              JSON.stringify([{ kind: 'actor', actorId: frame.actorId }]),
            ],
          )
        ).rows[0];
        if (proof && !blocked.has(proof.id))
          progress = {
            ...progress,
            phase: 'resolved',
            resolution: 'fulfilled',
            actorGoalStatus: { ...progress.actorGoalStatus, [frame.actorId]: 'fulfilled' },
            actorGoalStatusSources: {
              ...progress.actorGoalStatusSources,
              [frame.actorId]: [proof.id],
            },
          };
      }
    }
    const own = ownGoalBrief(definition, progress, frame.actorId, blocked);
    if (!own) continue;
    frame.sharedEventPhase = progress.phase === 'pending' ? 'introduced' : progress.phase;
    frame.phase =
      own.status === 'fulfilled' || own.status === 'withdrawn'
        ? 'resolved'
        : own.participation === 'engaged'
          ? 'engaged'
          : 'introduced';
    frame.status = own.status ?? 'active';
    frame.participation = own.participation ?? 'unknown';
    frame.productiveBeats = progress.productiveBeats;
    const move = nextStoryMove({
      definition,
      progress,
      storyNow: context.time,
      autonomousActionAvailable: true,
    });
    frame.nextMove =
      frame.phase === 'resolved' || progress.phase === 'resolved'
        ? 'finished'
        : own.status === 'deferred'
          ? 'wait'
          : move === 'introduce'
            ? 'wait'
            : move;
    const { startedAt: _startedAt, ...visibleFrame } = frame;
    results.push({ frame: visibleFrame, definition, progress });
  }
  return results;
}

export async function readActorEventGoals(
  sql: SqlClient,
  context: ActorContext,
  ownerId: string,
  blocked: ReadonlySet<string>,
) {
  const published = await publicationGoalContexts(
    sql,
    ownerId,
    context.worldId,
    context.worldVersion,
    context.actor.id,
  );
  const frames: ActorEventGoal[] = [];
  for (const p of published) {
    const frame = await publicationOwnGoalFrame(sql, p, context.actor.id, context.time, blocked);
    if (frame) frames.push(frame);
  }
  for (const g of await generalGoals(sql, context, ownerId, blocked)) {
    // An authored node's actual invitation already has a stronger scoped frame.
    if (
      published.some(
        (p) =>
          p.record.state.invitationId &&
          g.frame.goalKey === `invitation:${p.record.state.invitationId}`,
      )
    )
      continue;
    frames.push(g.frame);
  }
  return frames
    .sort((a, b) => Number(a.phase === 'resolved') - Number(b.phase === 'resolved'))
    .slice(0, 4);
}

/** Called after successful world projections/receipt, within that same SQL transaction. */
export async function applyActorEventAssessments(
  sql: SqlClient,
  ownerId: string,
  context: ActorContext,
  sourceEventId: string,
  assessments: EventGoalAssessment[],
  goalKeys: readonly string[],
  userText?: string,
  director = false,
  blocked: ReadonlySet<string> = new Set(),
) {
  const messages = (
    await sql.query(
      "SELECT id,document FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND document->>'sourceEventId'=$4 ORDER BY ordinal",
      [context.worldId, ownerId, context.actor.id, sourceEventId],
    )
  ).rows;
  validateEventGoalAssessmentQuotes(assessments, {
    goalKeys,
    userText,
    npcTexts: messages.filter((m) => m.document.role === 'assistant').map((m) => m.document.text),
    director,
  });
  const published = await publicationGoalContexts(
    sql,
    ownerId,
    context.worldId,
    context.worldVersion,
    context.actor.id,
    assessments,
    sourceEventId,
  );
  const ledger = new PublicationEventProgressRepository();
  const general = await generalGoals(sql, context, ownerId, blocked);
  const event = (
    await sql.query(
      "SELECT e.version,e.command_id,e.payload FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3",
      [context.worldId, ownerId, sourceEventId],
    )
  ).rows[0];
  if (!event) throw new DomainError('INVALID_PROPOSAL');
  for (const a of assessments) {
    const message = messages.find(
      (m) =>
        m.document.role === (a.target === 'user' ? 'user' : 'assistant') &&
        m.document.text.includes(a.quote),
    );
    if (!message) throw new DomainError('INVALID_PROPOSAL');
    const pub = published.find((p) => `publication:${p.record.node.key}` === a.goalKey);
    if (pub) {
      if (
        blocked.has(pub.record.state.sourceEventId) ||
        blocked.has(pub.record.state.sourceMessageId)
      )
        throw new DomainError('INVALID_PROPOSAL');
      await ledger.apply(
        sql,
        pub.value,
        {
          signal: {
            sourceEventId,
            sourceRecordId: message.id,
            kind: a.kind,
            ...(a.closure ? { closure: a.closure } : {}),
          },
          quote: a.quote,
        },
        context.worldVersion,
      );
      continue;
    }
    const g = general.find((g) => g.frame.goalKey === a.goalKey);
    if (!g) throw new DomainError('INVALID_PROPOSAL');
    const next = applyStoryProgressSignal({
      definition: g.definition,
      progress: g.progress,
      signal: {
        sourceEventId,
        sourceRecordId: message.id,
        kind: a.kind,
        ...(a.closure ? { closure: a.closure } : {}),
      },
      observations: [
        {
          id: sourceEventId,
          recordId: message.id,
          commandId: event.command_id,
          ownerId,
          worldId: context.worldId,
          version: event.version,
          storyAt: event.payload.storyAt,
          nodeKey: a.goalKey,
          actorId: context.actor.id,
          observableActorIds: [context.actor.id],
          kind: a.target === 'user' ? 'player_decision' : 'npc_message',
          criterionIds: [],
        },
      ],
      receipts: [
        {
          commandId: event.command_id,
          ownerId,
          worldId: context.worldId,
          status: 'succeeded',
          resultEventId: sourceEventId,
          resultVersion: event.version,
        },
      ],
      currentWorldVersion: context.worldVersion,
    });
    await saveGeneralProgress(sql, ownerId, context, g, next, sourceEventId, a.quote);
    g.progress = next;
  }
}

async function saveGeneralProgress(
  sql: SqlClient,
  ownerId: string,
  context: ActorContext,
  g: GeneralGoal,
  next: StoryEventProgress,
  sourceEventId: string,
  quote: string,
) {
  next.sourceEventIds = next.sourceEventIds.slice(-3);
  next.sourceRecordKeys = next.sourceRecordKeys.slice(-3);
  await sql.query(
    "UPDATE parallel_life.memory_records SET status='superseded' WHERE owner_id=$1 AND scope_type='character' AND scope_id=$2 AND branch_id=$3 AND key=$4 AND status='active'",
    [ownerId, context.actor.id, context.worldId, cacheKey(g.frame.goalKey)],
  );
  await deriveAndStoreMemories(sql, [
    {
      ownerId,
      scopeType: 'character',
      scopeId: context.actor.id,
      branchId: context.worldId,
      characterId: context.actor.id,
      kind: 'belief',
      key: cacheKey(g.frame.goalKey),
      text: JSON.stringify({
        schemaVersion: 1,
        definitionHash: definitionHash(g.definition),
        progress: next,
      }),
      sourceType: 'agent_inference',
      sourceIds: [sourceEventId],
      importance: 3,
      evidence: { [sourceEventId]: { id: sourceEventId, text: quote } },
    },
  ]);
  g.progress = next;
}
