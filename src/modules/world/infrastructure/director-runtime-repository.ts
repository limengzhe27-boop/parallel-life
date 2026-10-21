import { directorFrameRetirementEvidence } from '../domain/director-frame-retirement.ts';
import { readAuthoredReconsiderationEvidence } from './authored-reconsideration-evidence.ts';
import { ActorContinuationSchema } from './agent-proposal-schema.ts';
import {
  OpeningContextReviewSchema,
  OpeningContextAuthoritySchema,
} from './opening-context-schema.ts';
import { validateOpeningContextReview } from '../domain/narrative-opening-context.ts';
import {
  readOpeningContextAuthority,
  commitOpeningContextInTransaction,
} from './opening-context-repository.ts';
import { validDirectorDeliberationWindow } from '../domain/director-runtime.ts';
import { isVerifiedDirectorPreflightRejection } from './director-preflight-evidence.ts';
import { readDirectorActorDirectionMaterials } from './director-actor-direction-materials.ts';
import { AuthoredLifeModulesSchema } from '../../../contracts/authored-social.ts';
import { revalidateDirectorHandoff } from '../domain/director-handoff-revalidation.ts';
import { parseDirectorDecision } from './director-agent-model.ts';
import { validateNativeDirectorTurn } from './native-director-turn.ts';
import { validActorTopicSelection, validActorStagingIntents } from '../domain/actor-known-topic.ts';
import { readActorKnownTopicsInTransaction } from './actor-known-topic-repository.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { agentScopeBlocks } from '../application/schedule-agents.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type {
  DirectorRecoveryStore,
  DirectorRecoveryPreparation,
} from '../application/director-runtime-ports.ts';
import type {
  DirectorAttempt,
  DirectorDecision,
  DirectorSnapshot,
  SharedEpisode,
} from '../domain/director-runtime.ts';
import {
  canConsiderAuthoredEvent,
  validNativeTurnDecision,
  validDirectorAuthoredAssessments,
} from '../domain/director-runtime.ts';
import type { AgentAttemptStatus, ActorAgentState } from '../domain/agent-runtime.ts';
import { transitionAgentAttempt } from '../domain/agent-runtime.ts';
import { worldBoundary } from '../domain/world-awareness.ts';
import type { WorldState } from '../domain/types.ts';
import { markDirectorEvaluated } from './world-awareness-repository.ts';
import { projectStoryTime } from '../domain/clock.ts';
import { storedActivityClock } from './clock-activity-repository.ts';
import { readWorldAttentionInTransaction } from './world-attention-repository.ts';
import { readAuthoredAgentMaterialCatalog } from './authored-agent-material-repository.ts';
import {
  readAuthoredEligibilityInTransaction,
  authoredEligibilitySummary,
} from './authored-event-eligibility-repository.ts';
import { createEpisodeRequestsInTransaction } from './agent-narrative-repository.ts';
import { projectAuthoredDirectorModelView } from '../domain/authored-agent-material.ts';
import { readDirectorNarrativeWakeInTransaction } from './narrative-wake-repository.ts';
import { requireActiveAgentDeliveryInTransaction } from './agent-delivery-activity.ts';

export class DirectorRuntimePersistenceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
function fail(code: string): never {
  throw new DirectorRuntimePersistenceError(code);
}
const Key = z
  .string()
  .min(1)
  .max(240)
  .refine((v) => v.trim() === v);
const Int = z.number().int().nonnegative();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const keys = z
  .array(Key)
  .max(10000)
  .refine((v) => new Set(v).size === v.length);
const instant = (v: string) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v.slice(0, 19) + 'Z').toISOString().slice(0, 19) === v.slice(0, 19);
const Time = z.string().refine(instant);
const Channel = z.enum(['private', 'group', 'scene']);
const Condition = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('at_or_after'), at: Time, sourceId: Key }).strict(),
  z
    .object({ kind: z.literal('result'), actionId: Key, outcome: z.enum(['succeeded', 'failed']) })
    .strict(),
  z
    .object({
      kind: z.literal('player_decision'),
      responsibilityId: Key,
      decision: z.enum(['accepted', 'declined', 'negotiating', 'deferred', 'undecided']),
    })
    .strict(),
  z.object({ kind: z.literal('at_place'), placeId: Key }).strict(),
  z.object({ kind: z.literal('observation'), sourceId: Key }).strict(),
]);
const Scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('world') }).strict(),
  z.object({ kind: z.literal('actor'), actorId: Key }).strict(),
  z.object({ kind: z.literal('action'), actionId: Key }).strict(),
  z.object({ kind: z.literal('resource'), resourceId: Key }).strict(),
  z.object({ kind: z.literal('episode'), episodeId: Key }).strict(),
  z.object({ kind: z.literal('channel'), channel: Channel, threadId: Key }).strict(),
]);
const Candidate = z
  .object({
    id: Key,
    worldId: Key,
    actorId: Key,
    source: z.enum([
      'opening',
      'agenda_initialize',
      'agenda_review',
      'authored_event',
      'actor_plan',
      'responsibility',
      'conversation',
      'observation',
      'action_result',
    ]),
    episodeId: Key.nullable(),
    actionId: Key.nullable(),
    resourceIds: keys,
    channel: Channel,
    threadId: Key,
    sourceIds: keys.min(1),
    expectedWorldVersion: Int,
    expectedActorRevision: Int,
    priority: z.number().finite(),
    reason: z.string().min(1).max(10000),
    requiresCoordination: z.boolean(),
  })
  .strict();
const Episode = z
  .object({
    schemaVersion: z.literal(1),
    worldId: Key,
    id: Key,
    revision: Int,
    origin: z.object({ kind: z.enum(['authored', 'director']), sourceId: Key }).strict(),
    status: z.enum(['proposed', 'active', 'resolved', 'withdrawn']),
    title: z.string().min(1).max(1000),
    description: z.string().max(20000),
    participantActorIds: keys.min(1),
    placeIds: keys,
    sourceEventIds: keys,
    resultIds: keys,
    unresolvedResponsibilityIds: keys,
    endReason: z.string().max(10000).optional(),
  })
  .strict();
const State = z
  .object({
    continuation: ActorContinuationSchema.extend({
      version: z.literal(1),
      decidedAt: Time,
      sourceInputId: Key,
      basisHash: Hash,
    }).optional(),
    schemaVersion: z.literal(1),
    worldId: Key,
    actorId: Key,
    revision: Int,
    projectedWorldVersion: Int,
    definitionRef: Key,
    knowledgeSourceIds: keys,
    memoryIds: keys,
    relationshipIds: keys,
    goals: z.array(z.unknown()),
    plans: z.array(z.unknown()),
    actions: z.array(z.unknown()),
    responsibilities: z.array(z.unknown()),
    decisions: z.array(z.unknown()),
    episodeParticipations: z
      .array(
        z
          .object({
            id: Key,
            choice: z.enum(['engage', 'decline', 'defer', 'need_information', 'quiet']),
            reason: z.string().min(1).max(2000),
            sourceIds: keys.min(1),
            recordedAtVersion: Int,
          })
          .strict(),
      )
      .optional(),
    questions: z
      .array(
        z.strictObject({
          id: Key,
          channel: Channel,
          threadId: Key,
          sourceId: Key,
          text: z.string().min(1),
          askedAt: Time,
          status: z.enum(['open', 'answered', 'withdrawn']),
          responsibilityId: Key.optional(),
          resolution: z
            .strictObject({
              sourceId: Key,
              quote: z.string().optional(),
              at: Time,
              kind: z.enum(['answer', 'decline_to_answer', 'withdrawal']),
              reason: z.string().optional(),
            })
            .optional(),
        }),
      )
      .optional(),
    focus: z.unknown().nullable(),
  })
  .strict();
const Boundary = z
  .object({
    worldId: Key,
    actorIds: keys,
    placeIds: keys,
    capabilityIds: keys,
    extensionPermission: z.literal('none'),
    createdFromVersion: Int,
    sourceEventId: Key.nullable(),
  })
  .strict();
const Change = z
  .object({
    id: Key,
    eventId: Key,
    worldVersion: Int.positive(),
    kind: z.enum([
      'player_decision',
      'plan_changed',
      'action_result',
      'new_condition',
      'cross_impact',
    ]),
    ref: z.union([
      z.object({ kind: z.literal('event'), id: Key }).strict(),
      z
        .object({ kind: z.enum(['decision', 'plan', 'action_result']), id: Key, actorId: Key })
        .strict(),
    ]),
  })
  .strict();
const Snapshot = z
  .object({
    schemaVersion: z.literal(1),
    worldId: Key,
    engineEpoch: Int.min(2),
    worldVersion: Int,
    storyAt: Time,
    observedThroughVersion: Int,
    evaluatedThroughVersion: Int,
    boundary: Boundary,
    evaluationCause: z
      .discriminatedUnion('kind', [
        z.strictObject({
          id: Key,
          kind: z.literal('opening_context'),
          genesisHash: z.string().regex(/^[0-9a-f]{32}$/),
          admittedAtVersion: Int,
          reviewKey: Hash,
        }),
        z.strictObject({
          id: Key,
          kind: z.literal('bootstrap'),
          genesisHash: z.string().regex(/^[0-9a-f]{32}$/),
          admittedAtVersion: z.number().int().nonnegative(),
        }),
        z.strictObject({
          id: Key,
          kind: z.literal('authored_eligibility'),
          genesisHash: z.string().regex(/^[0-9a-f]{32}$/),
          admittedAtVersion: z.number().int().nonnegative(),
          qualifications: z
            .array(z.strictObject({ nodeKey: Key, nodeHash: Hash, qualificationKey: Hash }))
            .min(1),
        }),
      ])
      .optional(),
    deliberationWindow: z
      .strictObject({ version: z.literal(1), nodeKeys: z.array(Key).max(2) })
      .optional(),
    openingContextAuthority: OpeningContextAuthoritySchema.optional(),
    worldSetting: z.string().max(100000).optional(),
    authoredMaterials: z
      .custom<NonNullable<DirectorSnapshot['authoredMaterials']>>((v) => {
        try {
          projectAuthoredDirectorModelView(v as NonNullable<DirectorSnapshot['authoredMaterials']>);
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
    authoredEligibility: z
      .array(
        z
          .object({
            nodeKey: Key,
            nodeHash: Hash,
            status: z.enum(['eligible', 'blocked', 'expired', 'already_presented']),
            reasons: keys,
            basisSourceIds: keys,
            qualificationKey: Hash,
          })
          .strict(),
      )
      .optional(),
    occupiedAuthoredEventKeys: keys.optional(),
    conversationWithoutTarget: z.boolean().optional(),
    returnContext: z
      .object({
        lastMessageAt: Time,
        lastMessageRole: z.enum(['player', 'assistant']),
        lastMessageActorId: Key.optional(),
        lastMessageText: z.string().max(800).optional(),
        lastMessageSourceId: Key.optional(),
        lastPlayerAt: Time.optional(),
        lastAssistantAt: Time.optional(),
        unansweredAssistant: z.boolean(),
        elapsedSinceLastMessageMs: Int.nonnegative(),
      })
      .strict()
      .optional(),
    actorDirectionMaterials: z
      .array(
        z.strictObject({
          actorId: Key,
          modules: AuthoredLifeModulesSchema,
        }),
      )
      .max(128)
      .optional(),
    cast: z
      .array(
        z
          .object({
            id: Key,
            name: z.string().min(1).max(200),
            persona: z.string().max(100000),
            relationship: z.string().max(10000).optional(),
          })
          .strict(),
      )
      .optional(),
    actorKnownTopics: z
      .array(
        z.strictObject({
          id: Key,
          actorId: Key,
          kind: z.enum(['goal', 'plan', 'responsibility']),
          itemId: Key,
          summary: z.string().min(1).max(2000),
          status: Key,
          contentHash: Hash,
          proofSourceIds: keys,
        }),
      )
      .max(1000)
      .optional(),
    nativeTurn: z
      .strictObject({
        taskId: Key,
        inputReceiptId: Key,
        channel: z.enum(['group', 'scene']),
        threadId: Key,
      })
      .optional(),
    actorStates: z.array(State),
    episodes: z.array(Episode),
    candidates: z.array(Candidate),
    blockers: z.array(
      z
        .object({
          scope: Scope,
          reason: z.enum([
            'unknown_attempt',
            'paused',
            'waiting_condition',
            'cooldown',
            'permission',
            'stale_projection',
          ]),
          sourceId: Key,
          reconsiderOn: z.array(Condition),
        })
        .strict(),
    ),
    changes: z.array(Change),
    observations: z.array(
      z
        .object({
          sourceId: Key,
          text: z.string().max(100000),
          kind: z.enum(['fact', 'speech', 'belief', 'plan', 'result']),
          knownByActorIds: keys,
        })
        .strict(),
    ),
    focus: z.array(z.object({ channel: Channel, threadId: Key, actorIds: keys }).strict()),
  })
  .strict();
const Opportunity = z
  .object({
    id: Key,
    title: z.string().min(1).max(1000),
    description: z.string().min(1).max(20000),
    playerImpact: z.string().min(1).max(10000),
    participantActorIds: keys.min(1),
    placeIds: keys,
    activity: z.enum(['conversation', 'meeting', 'follow_up']),
    basisSourceIds: keys.min(1),
    authoredEventKey: Key.optional(),
    stagingIntents: z
      .array(
        z.strictObject({
          actorId: Key,
          kind: z.literal('future_task'),
          task: z.string().trim().min(1).max(600),
        }),
      )
      .min(1)
      .max(12)
      .optional(),
    actorTopics: z
      .array(
        z.strictObject({
          actorId: Key,
          refs: z
            .array(z.strictObject({ id: Key, contentHash: Hash }))
            .min(1)
            .max(4),
        }),
      )
      .min(1)
      .max(12)
      .optional(),
  })
  .strict();
const Decision = z
  .object({
    openingContext: OpeningContextReviewSchema.optional(),
    schemaVersion: z.literal(1),
    id: Key,
    worldId: Key,
    engineEpoch: Int.min(2),
    worldVersion: Int,
    inputHash: Hash,
    evaluatedThroughVersion: Int,
    mode: z.enum(['quiet', 'coordinate', 'bounded_opportunity']),
    selectedCandidateIds: keys,
    deferred: z.array(
      z.object({ candidateId: Key, reason: z.string().min(1).max(10000) }).strict(),
    ),
    nudges: z.array(
      z
        .object({
          actorId: Key,
          candidateId: Key,
          kind: z.enum([
            'continue_own_plan',
            'reassess_own_responsibility',
            'respond_to_player',
            'consider_opportunity',
          ]),
          basisSourceIds: keys.min(1),
        })
        .strict(),
    ),
    opportunities: z.array(Opportunity),
    authoredAssessments: z
      .array(
        z.strictObject({
          nodeKey: Key,
          nodeHash: Hash,
          qualificationKey: Hash,
          decision: z.enum(['consider', 'defer']),
          reason: z.string().trim().min(1).max(2000),
        }),
      )
      .optional(),
    audit: z.object({ reason: z.string().min(1).max(20000), basisSourceIds: keys }).strict(),
  })
  .strict();

export const DIRECTOR_SNAPSHOT_MAX_BYTES = 1_000_000;
export const DIRECTOR_RESPONSE_MAX_BYTES = 1_000_000;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
        .join(',') +
      '}'
    );
  const out = JSON.stringify(v);
  if (out === undefined) fail('INVALID_DIRECTOR_INPUT');
  return out;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function body(v: unknown, max: number) {
  let out: string;
  try {
    out = canonical(v);
  } catch {
    return fail('INVALID_DIRECTOR_INPUT');
  }
  if (Buffer.byteLength(out, 'utf8') > max) fail('DIRECTOR_INPUT_TOO_LARGE');
  return out;
}
/** Server injects this canonical hash into its application runner; never hash a truncated snapshot. */
export function directorSnapshotInputHash(snapshot: DirectorSnapshot) {
  return digest(body(snapshot, DIRECTOR_SNAPSHOT_MAX_BYTES));
}
function snapshotShape(value: DirectorSnapshot): DirectorSnapshot {
  const result = Snapshot.safeParse(value);
  if (!result.success) {
    console.error('DIRECTOR_SNAPSHOT_INVALID', JSON.stringify(result.error.issues.slice(0, 8)));
    fail('INVALID_DIRECTOR_SNAPSHOT');
  }
  body(result.data, DIRECTOR_SNAPSHOT_MAX_BYTES);
  // Unknown-typed persisted state children still need a detached capture before
  // asynchronous SQL; caller mutation cannot change the protected hashed input.
  return JSON.parse(body(result.data, DIRECTOR_SNAPSHOT_MAX_BYTES)) as DirectorSnapshot;
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const ordered = <T>(a: T[], key: (v: T) => string) =>
  [...a].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
function attempt(row: any): DirectorAttempt {
  return {
    id: row.id,
    worldId: row.world_id,
    commandId: row.command_id,
    engineEpoch: row.engine_epoch,
    expectedWorldVersion: row.expected_world_version,
    inputHash: row.input_hash,
    token: row.token,
    leaseUntil: new Date(row.lease_until).toISOString(),
    status: row.status,
    ...(row.decision_id ? { decisionId: row.decision_id } : {}),
  };
}

/** Object key order is immaterial (JSONB canonicalizes it); array order remains intentional. */
function temporalFrame(snapshot: DirectorSnapshot) {
  const times: string[] = [];
  const conditions = (items: { kind: string; at?: string }[]) => {
    for (const item of items) if (item.kind === 'at_or_after' && item.at) times.push(item.at);
  };
  for (const state of snapshot.actorStates) {
    conditions(state.continuation?.conditions ?? []);
    for (const plan of state.plans) conditions(plan.triggers);
    for (const action of state.actions) conditions(action.preconditions);
    for (const responsibility of state.responsibilities) {
      conditions(responsibility.nextCheck);
      if (responsibility.deadline) times.push(responsibility.deadline.at);
    }
  }
  for (const blocker of snapshot.blockers) conditions(blocker.reconsiderOn);
  return [...new Set(times)]
    .sort()
    .map((at) => ({ at, reached: Date.parse(snapshot.storyAt) >= Date.parse(at) }));
}
function sameRecoveryFrame(saved: DirectorSnapshot, current: DirectorSnapshot): boolean {
  const { storyAt: before, ...originalFrame } = saved,
    { storyAt: now, ...currentFrame } = current;
  return (
    Date.parse(now) >= Date.parse(before) &&
    equal(originalFrame, currentFrame) &&
    equal(temporalFrame(saved), temporalFrame(current))
  );
}
/** Stable semantic frame, not a timer-driven permission to purchase another decision. */
export function directorCoordinationFrameHash(snapshot: DirectorSnapshot) {
  const validated = snapshotShape(snapshot);
  const { storyAt: _storyAt, evaluatedThroughVersion: _evaluated, ...frame } = validated;
  return digest(
    body({ ...frame, temporal: temporalFrame(validated) }, DIRECTOR_SNAPSHOT_MAX_BYTES),
  );
}

export class PostgresDirectorRuntimeRepository implements DirectorRecoveryStore {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  private async owned(sql: SqlClient, owner: string, id: string) {
    const role = (
      await sql.query(`SELECT pg_has_role(current_user,'pl_app','MEMBER') app,pg_has_role(current_user,'pl_worker','MEMBER') worker,
      current_setting('app.user_id',true) owner_id`)
    ).rows[0];
    if (!role?.app || role.worker || role.owner_id !== owner) fail('NOT_FOUND');
    const row = (
      await sql.query(
        'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id, owner],
      )
    ).rows[0];
    if (!row) fail('NOT_FOUND');
    return { ...row.state, version: row.version } as WorldState;
  }
  private async load(sql: SqlClient, owner: string, expected: DirectorAttempt, lock = true) {
    const row = (
      await sql.query(
        `SELECT *,lease_until>clock_timestamp() live FROM parallel_life.director_runtime_attempts WHERE id=$1 AND world_id=$2 AND owner_id=$3${lock ? ' FOR UPDATE' : ''}`,
        [expected.id, expected.worldId, owner],
      )
    ).rows[0];
    if (!row) fail('NOT_FOUND');
    const actual = attempt(row);
    for (const key of [
      'id',
      'worldId',
      'commandId',
      'engineEpoch',
      'expectedWorldVersion',
      'inputHash',
      'token',
      'leaseUntil',
    ] as const)
      if (actual[key] !== expected[key]) fail('DIRECTOR_ATTEMPT_STALE');
    return row;
  }
  private async current(
    sql: SqlClient,
    owner: string,
    world: WorldState,
    s: DirectorSnapshot,
    initialize = false,
    allowAttemptId?: string,
  ) {
    const { clock, realNow } = await requireActiveAgentDeliveryInTransaction(sql, owner, world.id);
    // Only a new narrative opportunity is deferred by deep conversation. Existing
    // responsibilities and actual global changes keep their ordinary coordination.
    if (s.evaluationCause) {
      const attention = await readWorldAttentionInTransaction(sql, owner, {
        worldId: world.id,
        worldVersion: world.version,
        realNow,
      });
      if (attention.conversationWithoutTarget) fail('DIRECTOR_DELIVERY_DEFERRED');
    }
    const control = (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
        [world.id, owner],
      )
    ).rows[0];
    if (control?.engine_epoch !== s.engineEpoch || s.engineEpoch < 2) fail('ENGINE_EPOCH_CONFLICT');
    if (world.version !== s.worldVersion) fail('VERSION_CONFLICT');
    // Native routing evaluates only this accepted turn, not the author-event wake queue.
    let actualMaterials: DirectorSnapshot['authoredMaterials'];
    if (!s.nativeTurn) {
      const authored = await readAuthoredAgentMaterialCatalog(sql, owner, {
        worldId: world.id,
        expectedEngineEpoch: s.engineEpoch,
        expectedWorldVersion: s.worldVersion,
      });
      if (authored.status !== 'complete')
        fail(
          initialize ? 'DIRECTOR_AUTHORED_MATERIAL_BUDGET' : 'DIRECTOR_AUTHORED_SOURCE_CONFLICT',
        );
      actualMaterials = authored.catalog.source ? authored.catalog : undefined;
      if (!equal(actualMaterials ?? null, s.authoredMaterials ?? null))
        fail('DIRECTOR_AUTHORED_SOURCE_CONFLICT');
    } else if (s.authoredMaterials !== undefined) fail('DIRECTOR_NATIVE_TURN_CONFLICT');
    if (s.conversationWithoutTarget !== undefined) {
      const attention = await readWorldAttentionInTransaction(sql, owner, {
        worldId: world.id,
        worldVersion: world.version,
      });
      if (
        !equal(attention.focus, s.focus) ||
        attention.conversationWithoutTarget !== s.conversationWithoutTarget
      )
        fail('DIRECTOR_ATTENTION_CONFLICT');
    }
    const latest = clock
      ? Math.max(
          Date.parse(world.time),
          Date.parse(projectStoryTime(storedActivityClock(clock), realNow)),
        )
      : Date.parse(world.time);
    if (Date.parse(s.storyAt) < Date.parse(world.time) || Date.parse(s.storyAt) > latest)
      fail('DIRECTOR_CLOCK_CONFLICT');
    let qualified: Awaited<ReturnType<typeof readAuthoredEligibilityInTransaction>> | undefined;
    if (actualMaterials) {
      const qualification = (qualified = await readAuthoredEligibilityInTransaction(sql, owner, {
        worldId: world.id,
        engineEpoch: s.engineEpoch,
        worldVersion: world.version,
        storyAt: new Date(latest).toISOString(),
      }));
      if (
        !equal(authoredEligibilitySummary(qualification), s.authoredEligibility) ||
        !equal(qualification.occupiedEventKeys, s.occupiedAuthoredEventKeys)
      )
        fail('DIRECTOR_AUTHORED_ELIGIBILITY_CONFLICT');
    } else if (s.authoredEligibility !== undefined || s.occupiedAuthoredEventKeys !== undefined)
      fail('DIRECTOR_AUTHORED_ELIGIBILITY_CONFLICT');
    if (!s.nativeTurn) {
      const { cause } = await readDirectorNarrativeWakeInTransaction(
        sql,
        owner,
        {
          worldId: world.id,
          engineEpoch: s.engineEpoch,
          worldVersion: world.version,
          storyAt: new Date(latest).toISOString(),
        },
        qualified,
        allowAttemptId,
      );
      if (!equal(cause, s.evaluationCause ?? null)) fail('DIRECTOR_EVALUATION_CAUSE_CONFLICT');
    }
    if (s.openingContextAuthority !== undefined) {
      const grant = await readOpeningContextAuthority(
        sql,
        owner,
        { worldId: world.id, engineEpoch: s.engineEpoch, worldVersion: world.version },
        { view: qualified, allowAttemptId },
      );
      if (!equal(grant, s.openingContextAuthority)) fail('DIRECTOR_OPENING_CONTEXT_CONFLICT');
    }
    if (!validDirectorDeliberationWindow(s)) fail('DIRECTOR_DELIBERATION_WINDOW_CONFLICT');
    if (s.nativeTurn && s.evaluationCause) fail('DIRECTOR_NATIVE_TURN_CONFLICT');
    if (
      s.worldId !== world.id ||
      s.evaluatedThroughVersion > s.observedThroughVersion ||
      s.observedThroughVersion > s.worldVersion
    )
      fail('INVALID_DIRECTOR_RANGE');
    if (initialize && world.version === 0)
      await sql.query(
        'INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES($1,$2) ON CONFLICT(world_id) DO NOTHING',
        [world.id, owner],
      );
    const observed = (
      await sql.query(
        'SELECT * FROM parallel_life.director_observed_states WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
        [world.id, owner],
      )
    ).rows[0];
    if (
      !observed ||
      observed.observed_through_version !== s.observedThroughVersion ||
      observed.evaluated_through_version !== s.evaluatedThroughVersion
    )
      fail('DIRECTOR_CURSOR_CONFLICT');
    const boundary = (
      await sql.query(
        'SELECT source_version,document FROM parallel_life.world_awareness_boundaries WHERE world_id=$1 AND owner_id=$2',
        [world.id, owner],
      )
    ).rows[0];
    const actualBoundary =
      world.version === 0 && !boundary
        ? worldBoundary(world, null)
        : boundary?.source_version === world.version
          ? boundary.document
          : null;
    if (!actualBoundary || !equal(s.boundary, actualBoundary)) fail('DIRECTOR_BOUNDARY_CONFLICT');
    if (s.nativeTurn)
      await validateNativeDirectorTurn(sql, owner, world, s.nativeTurn, s.candidates);
    const states = (
      await sql.query(
        'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id FOR SHARE',
        [world.id, owner],
      )
    ).rows.map((r) => r.document as ActorAgentState);
    if (
      !equal(
        ordered(states, (v) => v.actorId),
        ordered(s.actorStates, (v) => v.actorId),
      ) ||
      new Set(s.actorStates.map((a) => a.actorId)).size !== s.actorStates.length ||
      !equal([...states.map((a) => a.actorId)].sort(), [...s.boundary.actorIds].sort())
    )
      fail('DIRECTOR_ACTOR_STATE_CONFLICT');
    if (s.actorDirectionMaterials !== undefined) {
      const currentMaterials = await readDirectorActorDirectionMaterials(
        sql,
        world.id,
        world.actors.map((actor) => actor.id),
      );
      if (!equal(currentMaterials, s.actorDirectionMaterials))
        fail('DIRECTOR_ACTOR_DIRECTION_CONFLICT');
    }
    if (s.actorKnownTopics !== undefined) {
      const topics = (
        await Promise.all(
          states.map((state) =>
            readActorKnownTopicsInTransaction(sql, owner, state, world.version, s.storyAt),
          ),
        )
      ).flat();
      if (!equal(topics, s.actorKnownTopics)) fail('DIRECTOR_ACTOR_TOPIC_CONFLICT');
    }
    if (
      s.cast &&
      !equal(
        ordered(s.cast, (v) => v.id),
        ordered(
          world.actors.map((a) => ({
            id: a.id,
            name: a.name,
            persona: a.persona,
            ...(a.relationship === undefined ? {} : { relationship: a.relationship }),
          })),
          (v) => v.id,
        ),
      )
    )
      fail('DIRECTOR_CAST_CONFLICT');
    const episodes = (
      await sql.query(
        'SELECT document FROM parallel_life.shared_episodes WHERE world_id=$1 AND owner_id=$2 ORDER BY id',
        [world.id, owner],
      )
    ).rows.map((r) => r.document as SharedEpisode);
    if (
      !equal(
        ordered(episodes, (e) => e.id),
        ordered(s.episodes, (e) => e.id),
      )
    )
      fail('DIRECTOR_EPISODE_CONFLICT');
    const revisions = new Map(states.map((a) => [a.actorId, a.revision]));
    if (
      new Set(s.candidates.map((c) => c.id)).size !== s.candidates.length ||
      s.candidates.some(
        (c) =>
          c.worldId !== world.id ||
          c.expectedWorldVersion !== world.version ||
          revisions.get(c.actorId) !== c.expectedActorRevision,
      )
    )
      fail('DIRECTOR_CANDIDATE_CONFLICT');
    if (
      s.observations.some((o) => o.knownByActorIds.some((a) => !revisions.has(a))) ||
      s.focus.some((f) => f.actorIds.some((a) => !revisions.has(a)))
    )
      fail('DIRECTOR_SOURCE_FORBIDDEN');
    const count = (
      await sql.query(
        'SELECT count(*)::int n FROM parallel_life.director_pending_reasons WHERE world_id=$1 AND owner_id=$2 AND source_version>$3 AND source_version<=$4',
        [world.id, owner, s.evaluatedThroughVersion, s.observedThroughVersion],
      )
    ).rows[0].n;
    if (count !== s.changes.length || new Set(s.changes.map((c) => c.id)).size !== s.changes.length)
      fail('DIRECTOR_PENDING_RANGE_INCOMPLETE');
    const changes = (
      await sql.query(
        `SELECT p.document,c.status,c.result_event_id,p.source_event_id,e.payload FROM parallel_life.director_pending_reasons p
      LEFT JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.owner_id=p.owner_id AND e.id=p.source_event_id AND e.version=p.source_version
      LEFT JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
      WHERE p.world_id=$1 AND p.owner_id=$2 AND p.source_version>$3 AND p.source_version<=$4 ORDER BY p.source_version,p.id`,
        [world.id, owner, s.evaluatedThroughVersion, s.observedThroughVersion],
      )
    ).rows;
    if (
      changes.some(
        (r) =>
          r.status !== 'succeeded' ||
          r.result_event_id !== r.source_event_id ||
          !r.payload ||
          !instant(r.payload.storyAt ?? r.payload.storyTime) ||
          Date.parse(r.payload.storyAt ?? r.payload.storyTime) > Date.parse(s.storyAt),
      ) ||
      !equal(
        changes.map((r) => r.document).sort((a, b) => (a.id < b.id ? -1 : 1)),
        ordered(s.changes, (c) => c.id),
      )
    )
      fail('DIRECTOR_PENDING_RANGE_INCOMPLETE');
  }
  async prepareRecovery(
    owner: string,
    rawCurrent: DirectorSnapshot,
  ): Promise<DirectorRecoveryPreparation> {
    const current = snapshotShape(rawCurrent);
    return this.db.transaction(owner, async (sql) => {
      const world = await this.owned(sql, owner, current.worldId);
      const row = (
        await sql.query(
          `SELECT *,lease_until>clock_timestamp() live FROM parallel_life.director_runtime_attempts
         WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send') FOR UPDATE`,
          [world.id, owner],
        )
      ).rows[0];
      if (!row) {
        // A discarded known completion is still evidence of a paid decision for
        // this frame. Renaming the coordination command (including after an
        // upgrade) must not turn repeated idle checks into a fresh purchase.
        const discarded = (
          await sql.query(
            `SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2
           AND engine_epoch=$3 AND expected_world_version=$4 AND status='stale_discarded' AND response_hash IS NOT NULL
           AND snapshot-'storyAt'-'evaluatedThroughVersion'=$5::jsonb-'storyAt'-'evaluatedThroughVersion'
           ORDER BY created_at DESC`,
            [world.id, owner, current.engineEpoch, current.worldVersion, JSON.stringify(current)],
          )
        ).rows;
        for (const prior of discarded) {
          const saved = snapshotShape(prior.snapshot);
          if (directorCoordinationFrameHash(saved) === directorCoordinationFrameHash(current))
            return { status: 'stale', attempt: attempt(prior), reason: 'lease_expired' };
        }
        return { status: 'none' };
      }
      const pending = attempt(row);
      // Unknown payment remains unknown. A separately authenticated new narrative
      // cause may retire only the expired execution frame, never resend this call.
      if (
        pending.status === 'unknown_after_send' &&
        !row.live &&
        !row.response_hash &&
        !row.response
      ) {
        await this.current(sql, owner, world, current);
        const saved = snapshotShape(row.snapshot);
        if (pending.inputHash !== directorSnapshotInputHash(saved)) fail('DIRECTOR_INPUT_CONFLICT');
        const evidence = directorFrameRetirementEvidence(
          saved,
          current,
          await readAuthoredReconsiderationEvidence(sql, owner, world.id, current.worldVersion),
        );
        if (evidence.length) {
          const retired = await sql.query(
            `UPDATE parallel_life.director_runtime_attempts SET status='stale_discarded',updated_at=now()
             WHERE id=$1 AND owner_id=$2 AND status='unknown_after_send' AND response IS NULL
             AND response_hash IS NULL AND lease_until<=clock_timestamp() RETURNING id`,
            [pending.id, owner],
          );
          if (!retired.rowCount) fail('DIRECTOR_ATTEMPT_STALE');
          // The immutable old snapshot/sent_at still fence its paid cause. The
          // caller can assess only the authenticated, distinct current cause.
          return { status: 'none' };
        }
      }
      // Expiry or version movement alone cannot retire unknown work.
      if (pending.status !== 'response_received') return { status: 'blocked', attempt: pending };
      // A caller's outdated/invalid read must never discard a legitimate completion.
      await this.current(sql, owner, world, current);
      if (!row.response_hash) fail('DIRECTOR_RESULT_NOT_FOUND');
      const saved = snapshotShape(row.snapshot);
      if (pending.inputHash !== directorSnapshotInputHash(saved)) fail('DIRECTOR_INPUT_CONFLICT');
      const reason = !sameRecoveryFrame(saved, current)
        ? 'frame_changed'
        : !row.live
          ? 'lease_expired'
          : null;
      if (reason) {
        const changed = (
          await sql.query(
            "UPDATE parallel_life.director_runtime_attempts SET status='stale_discarded',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='response_received' RETURNING *",
            [pending.id, owner],
          )
        ).rows[0];
        if (!changed) fail('DIRECTOR_ATTEMPT_STALE');
        return { status: 'stale', attempt: attempt(changed), reason };
      }
      return { status: 'ready', attempt: pending, snapshot: saved, response: row.response };
    });
  }
  /** Immutable pending input scope, for faithful recovery rather than new scheduling policy. */
  readPendingFrame(owner: string, worldId: string): Promise<DirectorSnapshot | null> {
    return this.db.transaction(owner, async (sql) => {
      await this.owned(sql, owner, worldId);
      const saved = (
        await sql.query(
          `SELECT snapshot FROM parallel_life.director_runtime_attempts
         WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send')`,
          [worldId, owner],
        )
      ).rows[0]?.snapshot;
      return saved ? snapshotShape(saved) : null;
    });
  }
  lookup(owner: string, worldId: string, commandId: string) {
    return this.db.transaction(owner, async (sql) => {
      await this.owned(sql, owner, worldId);
      const row = (
        await sql.query(
          'SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
          [worldId, owner, commandId],
        )
      ).rows[0];
      return row ? attempt(row) : null;
    });
  }
  /** Confirmed zero-send attempts only. This grants no authority to retry a paid frame. */
  readUnsentFrameAttempts(owner: string, rawSnapshot: DirectorSnapshot): Promise<string[]> {
    const snapshot = snapshotShape(rawSnapshot);
    if (snapshot.evaluationCause) fail('INVALID_DIRECTOR_INPUT');
    const frameHash = directorCoordinationFrameHash(snapshot);
    return this.db.transaction(owner, async (sql) => {
      const world = await this.owned(sql, owner, snapshot.worldId);
      await this.current(sql, owner, world, snapshot);
      const rows = (
        await sql.query(
          `SELECT id,snapshot,status,sent_at,response,response_hash,decision_id FROM parallel_life.director_runtime_attempts
           WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND expected_world_version=$4
             AND ((sent_at IS NULL AND response_hash IS NULL
               AND status IN ('cancelled_before_send','stale_discarded'))
               OR status='invalid_output') ORDER BY id`,
          [snapshot.worldId, owner, snapshot.engineEpoch, snapshot.worldVersion],
        )
      ).rows;
      return rows
        .filter(
          (row) =>
            ((row.sent_at === null &&
              row.response_hash === null &&
              ['cancelled_before_send', 'stale_discarded'].includes(row.status)) ||
              isVerifiedDirectorPreflightRejection(row)) &&
            directorCoordinationFrameHash(snapshotShape(row.snapshot)) === frameHash,
        )
        .map((row) => String(row.id))
        .sort();
    });
  }
  async claim(
    owner: string,
    input: Omit<DirectorAttempt, 'status' | 'decisionId'>,
    rawSnapshot: DirectorSnapshot,
  ) {
    input = { ...input };
    const snapshot = snapshotShape(rawSnapshot);
    for (const v of [input.id, input.worldId, input.commandId, input.token])
      if (!Key.safeParse(v).success) fail('INVALID_DIRECTOR_INPUT');
    if (
      !Time.safeParse(input.leaseUntil).success ||
      input.worldId !== snapshot.worldId ||
      input.engineEpoch !== snapshot.engineEpoch ||
      input.expectedWorldVersion !== snapshot.worldVersion ||
      input.inputHash !== directorSnapshotInputHash(snapshot)
    )
      fail('INVALID_DIRECTOR_INPUT');
    return this.db.transaction(owner, async (sql) => {
      const world = await this.owned(sql, owner, input.worldId);
      const old = (
        await sql.query(
          'SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3 FOR UPDATE',
          [input.worldId, owner, input.commandId],
        )
      ).rows[0];
      if (old) {
        if (
          old.input_hash !== input.inputHash ||
          old.engine_epoch !== input.engineEpoch ||
          old.expected_world_version !== input.expectedWorldVersion ||
          !equal(old.snapshot, snapshot)
        )
          fail('DIRECTOR_COMMAND_CONFLICT');
        return { attempt: attempt(old), replay: true };
      }
      await this.current(sql, owner, world, snapshot, true);
      if (
        !(await sql.query('SELECT $1::timestamptz>clock_timestamp() live', [input.leaseUntil]))
          .rows[0].live
      )
        fail('DIRECTOR_ATTEMPT_STALE');
      if (
        (
          await sql.query(
            "SELECT 1 FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND status IN ('reserved','request_sent','response_received','unknown_after_send')",
            [world.id],
          )
        ).rowCount
      )
        fail('DIRECTOR_ATTEMPT_PENDING');
      const row = (
        await sql.query(
          `INSERT INTO parallel_life.director_runtime_attempts(id,world_id,owner_id,command_id,engine_epoch,expected_world_version,input_hash,token,lease_until,status,snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved',$10) RETURNING *`,
          [
            input.id,
            input.worldId,
            owner,
            input.commandId,
            input.engineEpoch,
            input.expectedWorldVersion,
            input.inputHash,
            input.token,
            input.leaseUntil,
            snapshot,
          ],
        )
      ).rows[0];
      return { attempt: attempt(row), replay: false };
    });
  }
  mark(owner: string, expected: DirectorAttempt, status: AgentAttemptStatus) {
    expected = { ...expected };
    return this.db.transaction(owner, async (sql) => {
      const world = await this.owned(sql, owner, expected.worldId),
        row = await this.load(sql, owner, expected);
      if (status === 'committed' || status === 'response_received')
        fail('ATOMIC_DIRECTOR_COMMIT_REQUIRED');
      transitionAgentAttempt(row.status, status);
      if (status === 'request_sent') {
        if (!row.live) fail('DIRECTOR_ATTEMPT_STALE');
        await this.current(sql, owner, world, row.snapshot, false, row.id);
      }
      if (row.status === status) return attempt(row);
      const updated = (
        await sql.query(
          `UPDATE parallel_life.director_runtime_attempts SET status=$2,sent_at=CASE WHEN $2='request_sent' THEN COALESCE(sent_at,clock_timestamp()) ELSE sent_at END,updated_at=now()
        WHERE id=$1 AND ($2<>'request_sent' OR lease_until>clock_timestamp()) RETURNING *`,
          [expected.id, status],
        )
      ).rows[0];
      // A lease can expire while SQL runs even though another tab cannot update
      // the locked clock. Roll back request_sent before the network is touched.
      if (status === 'request_sent')
        await requireActiveAgentDeliveryInTransaction(sql, owner, expected.worldId);
      if (!updated) fail('DIRECTOR_ATTEMPT_STALE');
      return attempt(updated);
    });
  }
  saveResponse(owner: string, expected: DirectorAttempt, response: unknown) {
    expected = { ...expected };
    let raw: string,
      rejected = false;
    try {
      raw = body(response, DIRECTOR_RESPONSE_MAX_BYTES);
    } catch {
      rejected = true;
      let original: string | undefined;
      try {
        original = JSON.stringify(response);
      } catch {}
      raw = JSON.stringify({
        storageError: 'INVALID_OR_OVERSIZE_RESPONSE',
        ...(original ? { sha256: digest(original), bytes: Buffer.byteLength(original) } : {}),
      });
    }
    const hash = digest(raw);
    return this.db.transaction(owner, async (sql) => {
      const world = await this.owned(sql, owner, expected.worldId),
        row = await this.load(sql, owner, expected);
      if (row.response_hash) {
        if (row.response_hash !== hash) fail('DIRECTOR_RESPONSE_CONFLICT');
        return attempt(row);
      }
      if (
        !row.sent_at ||
        !['request_sent', 'unknown_after_send', 'stale_discarded'].includes(row.status)
      )
        fail('INVALID_DIRECTOR_TRANSITION');
      const epoch = (
        await sql.query(
          'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
          [world.id, owner],
        )
      ).rows[0]?.engine_epoch;
      const stale =
        !row.live ||
        epoch !== expected.engineEpoch ||
        world.version !== expected.expectedWorldVersion ||
        row.status === 'stale_discarded';
      return attempt(
        (
          await sql.query(
            "UPDATE parallel_life.director_runtime_attempts SET response=$2,response_hash=$3,status=CASE WHEN lease_until<=clock_timestamp() THEN 'stale_discarded' ELSE $4 END,updated_at=now() WHERE id=$1 RETURNING *",
            [
              expected.id,
              raw,
              hash,
              stale ? 'stale_discarded' : rejected ? 'invalid_output' : 'response_received',
            ],
          )
        ).rows[0],
      );
    });
  }
  readCompletion(
    owner: string,
    expected: DirectorAttempt,
  ): Promise<{ found: true; snapshot: DirectorSnapshot; response: unknown } | { found: false }> {
    expected = { ...expected };
    return this.db.transaction(owner, async (sql) => {
      await this.owned(sql, owner, expected.worldId);
      const row = await this.load(sql, owner, expected, false);
      return row.response_hash
        ? { found: true, snapshot: row.snapshot, response: row.response }
        : { found: false };
    });
  }
  async commit(
    owner: string,
    expected: DirectorAttempt,
    rawSnapshot: DirectorSnapshot,
    rawDecision: DirectorDecision,
  ) {
    expected = { ...expected };
    const snapshot = snapshotShape(rawSnapshot),
      parsed = Decision.safeParse(rawDecision);
    if (!parsed.success) fail('INVALID_DIRECTOR_DECISION');
    const decision = parsed.data as DirectorDecision;
    body(decision, DIRECTOR_SNAPSHOT_MAX_BYTES);
    return this.db.transaction(owner, async (sql) => {
      const world = await this.owned(sql, owner, expected.worldId),
        row = await this.load(sql, owner, expected);
      if (
        !equal(row.snapshot, snapshot) ||
        expected.inputHash !== directorSnapshotInputHash(snapshot)
      )
        fail('DIRECTOR_INPUT_CONFLICT');
      if (row.status === 'committed') {
        const saved = (
          await sql.query(
            'SELECT document FROM parallel_life.director_decisions WHERE world_id=$1 AND owner_id=$2 AND id=$3',
            [world.id, owner, row.decision_id],
          )
        ).rows[0]?.document;
        if (!saved || !equal(saved, decision)) fail('DIRECTOR_DECISION_CONFLICT');
        return saved as DirectorDecision;
      }
      if (row.status !== 'response_received' || !row.response_hash || !row.live)
        fail('DIRECTOR_ATTEMPT_STALE');
      await this.current(sql, owner, world, snapshot, false, expected.id);
      this.validateDecision(snapshot, expected, decision);
      await sql.query(
        `INSERT INTO parallel_life.director_decisions(id,world_id,owner_id,attempt_id,engine_epoch,world_version,input_hash,evaluated_through_version,document)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          decision.id,
          world.id,
          owner,
          expected.id,
          expected.engineEpoch,
          expected.expectedWorldVersion,
          expected.inputHash,
          decision.evaluatedThroughVersion,
          decision,
        ],
      );
      for (const opportunity of decision.opportunities) {
        if (
          (
            await sql.query(
              'SELECT 1 FROM parallel_life.shared_episodes WHERE world_id=$1 AND id=$2',
              [world.id, opportunity.id],
            )
          ).rowCount
        )
          fail('DIRECTOR_EPISODE_ID_CONFLICT');
        const episode: SharedEpisode = {
          schemaVersion: 1,
          worldId: world.id,
          id: opportunity.id,
          revision: 0,
          origin: { kind: 'director', sourceId: decision.id },
          status: 'proposed',
          title: opportunity.title,
          description: opportunity.description,
          participantActorIds: opportunity.participantActorIds,
          placeIds: opportunity.placeIds,
          sourceEventIds: [],
          resultIds: [],
          unresolvedResponsibilityIds: [],
        };
        await sql.query(
          'INSERT INTO parallel_life.shared_episodes(world_id,owner_id,id,origin_decision_id,document) VALUES($1,$2,$3,$4,$5)',
          [world.id, owner, episode.id, decision.id, episode],
        );
      }
      if (!snapshot.nativeTurn)
        await markDirectorEvaluated(sql, owner, world.id, {
          expectedObservedThroughVersion: snapshot.observedThroughVersion,
          throughVersion: decision.evaluatedThroughVersion,
          result: decision.mode === 'quiet' ? 'quiet' : 'acted',
        });
      const finalized = await sql.query(
        "UPDATE parallel_life.director_runtime_attempts SET status='committed',decision_id=$2,updated_at=now() WHERE id=$1 AND token=$3 AND status='response_received' AND lease_until>clock_timestamp() RETURNING id",
        [expected.id, decision.id, expected.token],
      );
      if (!finalized.rowCount) fail('DIRECTOR_ATTEMPT_STALE');
      await createEpisodeRequestsInTransaction(sql, owner, {
        worldId: world.id,
        engineEpoch: expected.engineEpoch,
        decision,
      });
      await commitOpeningContextInTransaction(sql, owner, {
        world,
        attempt: expected,
        snapshot,
        decision,
      });
      // All private decisions, opportunities and actor requests roll back together
      // if activity elapsed during this short transaction; saved raw stays intact.
      await requireActiveAgentDeliveryInTransaction(sql, owner, world.id);
      return decision;
    });
  }
  /** Reapply only a known authored future proposal against today's authority.
   * No model port, no rewritten paid input, and no recovery of unknown content.
   */
  async revalidateKnownHandoff(
    owner: string,
    rawCurrent: DirectorSnapshot,
  ): Promise<DirectorDecision | null> {
    const current = snapshotShape(rawCurrent);
    return this.db.transaction(owner, async (sql) => {
      const world = await this.owned(sql, owner, current.worldId);
      await this.current(sql, owner, world, current);
      if (current.conversationWithoutTarget || current.nativeTurn) return null;
      const rows = (
        await sql.query(
          `SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2
        AND engine_epoch=$3 AND status IN ('stale_discarded','response_received') AND response_hash IS NOT NULL
        AND expected_world_version<=$4 ORDER BY created_at,id FOR UPDATE`,
          [world.id, owner, current.engineEpoch, current.worldVersion],
        )
      ).rows;
      for (const row of rows) {
        const original = snapshotShape(row.snapshot),
          originalAttempt = attempt(row);
        if (originalAttempt.inputHash !== directorSnapshotInputHash(original))
          fail('DIRECTOR_INPUT_CONFLICT');
        let decision: DirectorDecision;
        try {
          decision = parseDirectorDecision(original, row.response, originalAttempt);
        } catch {
          continue;
        } // Invalid historical output is never repaired or reinterpreted.
        if (decision.openingContext) continue; // New execution authority cannot rebase a paid fact-confirmation frame.
        this.validateDecision(original, originalAttempt, decision);
        const proof = revalidateDirectorHandoff({ original, current, decision });
        if (!proof.allowed) continue;
        const active = (
          await sql.query(
            `SELECT id,status,expected_world_version FROM parallel_life.director_runtime_attempts
           WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send')
           AND id<>$3 FOR UPDATE`,
            [world.id, owner, row.id],
          )
        ).rows;
        // A different live or recoverable coordinator still owns its slot. Only
        // an expired unknown whose read frame is obsolete can be fenced, never resent.
        const superseded: string[] = [];
        for (const pending of active) {
          const obsolete = (
            await sql.query(
              `SELECT 1 FROM parallel_life.director_runtime_attempts WHERE id=$1
             AND status='unknown_after_send' AND lease_until<=clock_timestamp()
             AND expected_world_version<$2 AND engine_epoch=$3`,
              [pending.id, current.worldVersion, current.engineEpoch],
            )
          ).rowCount;
          if (!obsolete) return null;
          superseded.push(String(pending.id));
        }
        await sql.query(
          `INSERT INTO parallel_life.director_handoff_revalidations(world_id,owner_id,attempt_id,response_hash,
          assessed_version,applied_version,input_hash,readset_hash,current_snapshot,opportunity_ids,superseded_unknown_ids)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            world.id,
            owner,
            row.id,
            row.response_hash,
            original.worldVersion,
            current.worldVersion,
            row.input_hash,
            digest(body(proof.readSet, DIRECTOR_SNAPSHOT_MAX_BYTES)),
            current,
            JSON.stringify(decision.opportunities.map((o) => o.id)),
            JSON.stringify(superseded),
          ],
        );
        await sql.query(
          `INSERT INTO parallel_life.director_decisions(id,world_id,owner_id,attempt_id,engine_epoch,world_version,input_hash,evaluated_through_version,document)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            decision.id,
            world.id,
            owner,
            row.id,
            current.engineEpoch,
            original.worldVersion,
            row.input_hash,
            decision.evaluatedThroughVersion,
            decision,
          ],
        );
        for (const opportunity of decision.opportunities) {
          const episode: SharedEpisode = {
            schemaVersion: 1,
            worldId: world.id,
            id: opportunity.id,
            revision: 0,
            origin: { kind: 'director', sourceId: decision.id },
            status: 'proposed',
            title: opportunity.title,
            description: opportunity.description,
            participantActorIds: opportunity.participantActorIds,
            placeIds: opportunity.placeIds,
            sourceEventIds: [],
            resultIds: [],
            unresolvedResponsibilityIds: [],
          };
          await sql.query(
            'INSERT INTO parallel_life.shared_episodes(world_id,owner_id,id,origin_decision_id,document) VALUES($1,$2,$3,$4,$5)',
            [world.id, owner, episode.id, decision.id, episode],
          );
        }
        await sql.query("SELECT set_config('app.director_handoff_revalidation',$1,true)", [row.id]);
        await sql.query(
          "UPDATE parallel_life.director_runtime_attempts SET status='committed',decision_id=$2,updated_at=now() WHERE id=$1",
          [row.id, decision.id],
        );
        for (const id of superseded)
          await sql.query(
            "UPDATE parallel_life.director_runtime_attempts SET status='stale_discarded',updated_at=now() WHERE id=$1 AND status='unknown_after_send'",
            [id],
          );
        await createEpisodeRequestsInTransaction(sql, owner, {
          worldId: world.id,
          engineEpoch: current.engineEpoch,
          decision,
        });
        // Do not mark newer observations evaluated: only the original frame was
        // assessed by the model; this receipt certifies eligibility, not new facts.
        await requireActiveAgentDeliveryInTransaction(sql, owner, world.id);
        return decision;
      }
      return null;
    });
  }
  private validateDecision(s: DirectorSnapshot, a: DirectorAttempt, d: DirectorDecision) {
    validateOpeningContextReview(s.openingContextAuthority, d.openingContext, s.authoredMaterials);
    if (!validNativeTurnDecision(s, d)) fail('INVALID_DIRECTOR_NATIVE_TURN');
    if (!validDirectorAuthoredAssessments(s, d)) fail('INVALID_DIRECTOR_AUTHORED_ASSESSMENTS');
    if (
      d.worldId !== a.worldId ||
      d.engineEpoch !== a.engineEpoch ||
      d.worldVersion !== a.expectedWorldVersion ||
      d.inputHash !== a.inputHash ||
      d.evaluatedThroughVersion !==
        (s.nativeTurn ? s.evaluatedThroughVersion : s.observedThroughVersion)
    )
      fail('INVALID_DIRECTOR_DECISION');
    const candidates = new Map(s.candidates.map((c) => [c.id, c])),
      selected = new Set(d.selectedCandidateIds),
      partition = [...d.selectedCandidateIds, ...d.deferred.map((v) => v.candidateId)];
    if (
      partition.length !== candidates.size ||
      new Set(partition).size !== partition.length ||
      partition.some((id) => !candidates.has(id))
    )
      fail('DIRECTOR_CANDIDATE_PARTITION');
    if (
      d.selectedCandidateIds.some((id) =>
        s.blockers.some((b) => agentScopeBlocks(b.scope, candidates.get(id)!)),
      )
    )
      fail('DIRECTOR_CANDIDATE_CONFLICT');
    if (
      d.mode === 'quiet' &&
      (d.selectedCandidateIds.length || d.nudges.length || d.opportunities.length)
    )
      fail('INVALID_DIRECTOR_QUIET');
    if (d.mode !== 'bounded_opportunity' && d.opportunities.length)
      fail('INVALID_DIRECTOR_OPPORTUNITY');
    if (d.mode === 'bounded_opportunity' && !d.opportunities.length)
      fail('INVALID_DIRECTOR_OPPORTUNITY');
    const authored = s.authoredMaterials
      ? projectAuthoredDirectorModelView(s.authoredMaterials)
      : undefined;
    const sources = new Set([
      ...s.observations.map((o) => o.sourceId).filter((id) => !id.startsWith('authored:')),
      ...s.candidates.flatMap((c) => c.sourceIds).filter((id) => !id.startsWith('authored:')),
      ...s.episodes.map((e) => e.origin.sourceId).filter((id) => !id.startsWith('authored:')),
      ...(authored?.materials.map((m) => m.sourceId) ?? []),
    ]);
    if (d.audit.basisSourceIds.some((id) => !sources.has(id))) fail('DIRECTOR_SOURCE_FORBIDDEN');
    if (new Set(d.nudges.map((n) => n.candidateId)).size !== d.nudges.length)
      fail('INVALID_DIRECTOR_NUDGE');
    for (const n of d.nudges) {
      const c = candidates.get(n.candidateId);
      if (
        !c ||
        !selected.has(c.id) ||
        n.actorId !== c.actorId ||
        n.basisSourceIds.some((id) => id.startsWith('authored:') || !c.sourceIds.includes(id))
      )
        fail('DIRECTOR_NUDGE_SOURCE_FORBIDDEN');
    }
    if (new Set(d.opportunities.map((o) => o.id)).size !== d.opportunities.length)
      fail('DIRECTOR_EPISODE_ID_CONFLICT');
    for (const o of d.opportunities)
      if (
        !validActorTopicSelection(o, s.actorKnownTopics ?? []) ||
        !validActorStagingIntents(o) ||
        o.participantActorIds.some((id) => !s.boundary.actorIds.includes(id)) ||
        o.placeIds.some((id) => !s.boundary.placeIds.includes(id)) ||
        o.basisSourceIds.some((id) => !sources.has(id)) ||
        new Set(o.participantActorIds).size !== o.participantActorIds.length ||
        new Set(o.placeIds).size !== o.placeIds.length ||
        new Set(o.basisSourceIds).size !== o.basisSourceIds.length ||
        o.basisSourceIds.some(
          (id) =>
            id.startsWith('authored:') &&
            (o.authoredEventKey === undefined ||
              !authored?.materials.some(
                (m) => m.sourceId === id && canConsiderAuthoredEvent(s, m.ref.nodeKey),
              )),
        ) ||
        (o.authoredEventKey !== undefined &&
          (!canConsiderAuthoredEvent(s, o.authoredEventKey) ||
            !authored?.materials.some(
              (m) => m.ref.nodeKey === o.authoredEventKey && o.basisSourceIds.includes(m.sourceId),
            )))
      )
        fail('DIRECTOR_OPPORTUNITY_BOUNDARY');
  }
  readEpisodes(owner: string, worldId: string): Promise<SharedEpisode[]> {
    return this.db.transaction(owner, async (sql) => {
      await this.owned(sql, owner, worldId);
      return (
        await sql.query(
          'SELECT document FROM parallel_life.shared_episodes WHERE world_id=$1 AND owner_id=$2 ORDER BY id',
          [worldId, owner],
        )
      ).rows.map((r) => r.document);
    });
  }
  readDecision(owner: string, worldId: string, id: string): Promise<DirectorDecision | null> {
    return this.db.transaction(owner, async (sql) => {
      await this.owned(sql, owner, worldId);
      return (
        (
          await sql.query(
            'SELECT document FROM parallel_life.director_decisions WHERE world_id=$1 AND owner_id=$2 AND id=$3',
            [worldId, owner, id],
          )
        ).rows[0]?.document ?? null
      );
    });
  }
}
