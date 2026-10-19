import { continuationReviewAdmission } from '../domain/continuation-review-admission.ts';
import { actorContinuationBasis } from '../domain/actor-continuation.ts';
import { awarenessLocalTime } from '../domain/world-awareness.ts';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt, AgentCandidate } from '../domain/agent-runtime.ts';
import type { WorldState } from '../domain/types.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { createAgentScheduleSources } from '../application/agent-schedule-collectors.ts';
import { agentScopeBlocks } from '../application/schedule-agents.ts';
import {
  evaluateOwnAgendaReview,
  ownAgendaReviewWindow,
  type OwnAgendaReviewPolicy,
} from '../application/own-agenda-review-policy.ts';
import {
  isOwnAgendaReviewInput,
  type OwnAgendaReviewEnvelope,
} from '../domain/own-agenda-review.ts';
import { readOwnAgendaReviewEvidenceInTransaction } from './own-agenda-review-repository.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { projectStoryTime } from '../domain/clock.ts';
import { storedActivityClock, storedClockStopped } from './clock-activity-repository.ts';
import { agentDefinitionRef } from './agent-snapshot-repository.ts';
import {
  readOwnAgendaBudgetInTransaction,
  type OwnAgendaBudgetPolicy,
} from './own-agenda-budget-repository.ts';

export type OwnAgendaRuntimeConfig = {
  policy: OwnAgendaReviewPolicy;
  budgets: OwnAgendaBudgetPolicy;
};
export const DEFAULT_OWN_AGENDA_RUNTIME_CONFIG: OwnAgendaRuntimeConfig = {
  policy: {
    version: 'own-agenda-v1',
    storyGapMs: 60_000,
    realGapMs: 20_000,
    quietBackoffMultiplier: 2,
    maxRealGapMs: 300_000,
  },
  budgets: {
    owner: { limit: 48, windowSeconds: 3600 },
    world: { limit: 16, windowSeconds: 600 },
    actor: { limit: 4, windowSeconds: 300 },
  },
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = (h: string) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
export const ownAgendaReviewCommandId = (worldId: string, familyId: string) =>
  uuid(digest(JSON.stringify(['npc-wake-v1', worldId, familyId])));
/** Same business grant, a proven zero-send predecessor, and a new CAS; not a new paid opportunity. */
export const ownAgendaUnsentTransportCommandId = (
  worldId: string,
  familyId: string,
  predecessor: string,
  version: number,
) =>
  uuid(
    digest(
      JSON.stringify(['npc-agenda-unsent-transport-v1', worldId, familyId, predecessor, version]),
    ),
  );
export const ownAgendaReviewInputText = (grant: OwnAgendaReviewEnvelope) =>
  JSON.stringify({
    type: grant.type,
    family: grant.family,
    grantId: grant.grantId,
    anchorAttemptId: grant.anchorAttemptId,
    policyVersion: grant.policyVersion,
    basisSourceIds: grant.basisSourceIds,
  });
export type OwnAgendaReviewWork = {
  candidate: AgentCandidate;
  grant: OwnAgendaReviewEnvelope;
  commandId: string;
  recovery: boolean;
};
function fail(code = 'OWN_AGENDA_REVIEW_FORBIDDEN'): never {
  throw Object.assign(Error(code), { code });
}
type Holder = {
  id: string;
  status: string;
  command_id: string;
  input_receipt_id: string;
  input_hash: string;
  engine_epoch: number;
  expected_world_version: number;
  expected_actor_revision: number;
  sent_at: unknown;
  response_hash: unknown;
  response: unknown;
  event_id: unknown;
  live?: boolean;
};

async function frame(
  sql: SqlClient,
  owner: string,
  worldId: string,
  actorId: string,
  version: number,
) {
  const r = (
    await sql.query(
      `SELECT w.state,w.version,c.engine_epoch,s.document AS actor_state,
    a.engine_epoch AS admitted_epoch, a.genesis_hash, current_setting('app.user_id',true) AS identity
    FROM parallel_life.worlds w JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
    JOIN parallel_life.actor_agent_states s ON s.world_id=w.id AND s.owner_id=w.owner_id AND s.actor_id=$3
    LEFT JOIN parallel_life.agent_narrative_admissions a ON a.world_id=w.id AND a.owner_id=w.owner_id
    WHERE w.id=$1 AND w.owner_id=$2 FOR UPDATE OF w`,
      [worldId, owner, actorId],
    )
  ).rows[0];
  if (!r || r.identity !== owner) fail('NOT_FOUND');
  if (r.version !== version) fail('VERSION_CONFLICT');
  if (r.engine_epoch < 2 || r.admitted_epoch !== r.engine_epoch || !r.genesis_hash) return null;
  const clock = (
    await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2', [
      worldId,
      owner,
    ])
  ).rows[0];
  const realAt = new Date().toISOString(),
    world = r.state as WorldState;
  return {
    ...r,
    world,
    realAt,
    paused: !!clock && storedClockStopped(clock, realAt),
    storyAt: new Date(
      Math.max(
        Date.parse(world.time),
        clock ? Date.parse(projectStoryTime(storedActivityClock(clock), realAt)) : 0,
      ),
    ).toISOString(),
  };
}
async function transportHistory(
  sql: SqlClient,
  owner: string,
  worldId: string,
  actorId: string,
  grant: OwnAgendaReviewEnvelope,
) {
  const rows = (
    await sql.query(
      `SELECT i.document,a.id AS attempt_id,a.status,a.sent_at,a.response_hash,a.response,a.event_id,
    a.expected_actor_revision FROM parallel_life.agent_input_receipts i
    LEFT JOIN parallel_life.agent_attempts a ON a.world_id=i.world_id AND a.owner_id=i.owner_id AND a.input_receipt_id=i.id
    WHERE i.world_id=$1 AND i.owner_id=$2 AND i.document->>'recipientActorId'=$3 AND i.document->>'origin'='wake'
    AND i.document->>'text' LIKE '%npc_agenda_review%' ORDER BY (i.document->>'expectedWorldVersion')::integer,i.created_at,i.id LIMIT 4097`,
      [worldId, owner, actorId],
    )
  ).rows;
  if (rows.length > 4096) fail('OWN_AGENDA_REVIEW_HISTORY_LIMIT');
  const relevant = rows.filter((r) => {
    try {
      return JSON.parse(r.document.text).grantId === grant.grantId;
    } catch {
      return false;
    }
  });
  let previous: (typeof relevant)[number] | undefined;
  for (const row of relevant) {
    const b = row.document as AgentInputReceipt;
    const command = previous
      ? ownAgendaUnsentTransportCommandId(
          worldId,
          grant.grantId,
          previous.document.commandId,
          b.expectedWorldVersion,
        )
      : ownAgendaReviewCommandId(worldId, grant.grantId);
    if (
      b.worldId !== worldId ||
      b.channel !== 'private' ||
      b.threadId !== actorId ||
      b.recipientActorId !== actorId ||
      b.text !== ownAgendaReviewInputText(grant) ||
      b.commandId !== command ||
      b.inputHash !== digest(JSON.stringify([worldId, actorId, grant.grantId, b.text])) ||
      (previous &&
        (b.expectedWorldVersion <= previous.document.expectedWorldVersion ||
          !zeroSendTerminal(previous)))
    )
      fail();
    previous = row;
  }
  return relevant;
}
function zeroSendTerminal(row: Record<string, any>) {
  return (
    (!row.attempt_id || ['cancelled_before_send', 'stale_discarded'].includes(row.status)) &&
    row.sent_at == null &&
    row.response_hash == null &&
    row.response == null &&
    row.event_id == null
  );
}
/** Uses original condition collectors. A stored but unready plan does not freeze review forever. */
async function priorityWork(
  sql: SqlClient,
  owner: string,
  f: NonNullable<Awaited<ReturnType<typeof frame>>>,
  snapshot: AgentSnapshot,
) {
  const pending = await sql.query(
    "SELECT 1 FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND status='pending' LIMIT 1",
    [snapshot.state.worldId, owner, snapshot.state.actorId],
  );
  if (pending.rowCount) return true;
  const history = (
    await sql.query(
      `SELECT a.command_id,a.status,a.sent_at,a.response_hash,r.document->>'text' text FROM parallel_life.agent_attempts a
    JOIN parallel_life.agent_input_receipts r ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
    WHERE a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3`,
      [snapshot.state.worldId, owner, snapshot.state.actorId],
    )
  ).rows;
  const results = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
      [snapshot.state.worldId, owner, snapshot.state.actorId],
    )
  ).rows.map((r) => r.document);
  const sources = createAgentScheduleSources({
    worldId: snapshot.state.worldId,
    engineEpoch: f.engine_epoch,
    worldVersion: f.version,
    storyAt: f.storyAt,
    actors: [
      {
        snapshot: {
          ...snapshot,
          storyAt: f.storyAt,
          ...(snapshot.worldContext
            ? { worldContext: { ...snapshot.worldContext, time: awarenessLocalTime(f.storyAt) } }
            : {}),
        },
        trustedResults: results,
        appointments: f.world.appointments.filter((a: WorldState['appointments'][number]) =>
          a.participantIds.includes(snapshot.state.actorId),
        ),
      },
    ],
    activeAttempts: [],
    consumedCandidateIds: [],
  });
  const collections = await Promise.all(
    sources.map((s) => s.source.collect(owner, snapshot.state.worldId)),
  );
  const blockers = collections.flatMap((c) => c.blockers);
  return collections
    .flatMap((c) => c.candidates)
    .some(
      (c) =>
        !blockers.some((b) => agentScopeBlocks(b.scope, c)) &&
        !history.some(
          (h) =>
            h.command_id === ownAgendaReviewCommandId(c.worldId, c.id) &&
            (['committed', 'invalid_output', 'stale_discarded'].includes(h.status) ||
              (h.status === 'cancelled_before_send' && (h.sent_at || h.response_hash))),
        ),
    );
}

/** Read/accept/claim/send share one original-family authority. Only send reserves money elsewhere. */
export async function readOwnAgendaReviewWorkInTransaction(
  sql: SqlClient,
  owner: string,
  input: {
    worldId: string;
    actorId: string;
    worldVersion: number;
    config?: OwnAgendaRuntimeConfig;
    hasPriorityWork?: boolean;
    snapshot?: AgentSnapshot;
    holder?: Holder;
    phase?: 'collect' | 'accept' | 'claim' | 'send' | 'commit';
    receipt?: AgentInputReceipt;
  },
): Promise<OwnAgendaReviewWork | null> {
  const config = input.config ?? DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
    phase = input.phase ?? 'collect';
  if (config.policy.version !== 'own-agenda-v1') fail('OWN_AGENDA_POLICY_UNSUPPORTED');
  const f = await frame(sql, owner, input.worldId, input.actorId, input.worldVersion);
  if (!f) return null;
  const continuation = f.actor_state.continuation;
  const currentBasisHash = createHash('sha256')
    .update(actorContinuationBasis(f.actor_state))
    .digest('hex');
  const definitionRef = agentDefinitionRef(f.world, input.actorId);
  const evidence = await readOwnAgendaReviewEvidenceInTransaction(sql, owner, {
    worldId: input.worldId,
    actorId: input.actorId,
    engineEpoch: f.engine_epoch,
    definitionRef,
  });
  if (!evidence.anchor || !evidence.familyId) return null;
  if (
    phase !== 'commit' &&
    continuationReviewAdmission({
      continuation,
      currentBasisHash,
      paidBasisHashes: evidence.paidContinuationBases,
    }) === 'already_considered'
  )
    return null;
  const forgotten = await forgottenAgentSourceIds(sql, owner, input.worldId, input.actorId);
  if (forgotten.has(definitionRef) || forgotten.has(`definition:${definitionRef}`)) return null;
  const grant: OwnAgendaReviewEnvelope = {
    type: 'npc_agenda_review',
    family: 'own_agenda',
    grantId: evidence.familyId,
    anchorAttemptId: evidence.anchor.attemptId,
    policyVersion: config.policy.version,
    basisSourceIds: [`definition:${definitionRef}`],
  };
  const history = await transportHistory(sql, owner, input.worldId, input.actorId, grant),
    last = history.at(-1);
  const holder = input.holder;
  if (holder) {
    if (
      !last ||
      last.attempt_id !== holder.id ||
      holder.command_id !== last.document.commandId ||
      holder.input_receipt_id !== last.document.id ||
      holder.input_hash !== last.document.inputHash ||
      holder.engine_epoch !== f.engine_epoch ||
      holder.expected_world_version !== f.version ||
      holder.expected_actor_revision !== f.actor_state.revision
    )
      fail();
    if (
      phase === 'send' &&
      (holder.status !== 'reserved' ||
        !holder.live ||
        holder.sent_at !== null ||
        holder.response_hash !== null ||
        holder.response !== null ||
        holder.event_id !== null)
    )
      fail();
    if (phase === 'claim' && !zeroSendTerminal(last)) fail();
    if (
      phase === 'commit' &&
      (!['response_received', 'committed'].includes(holder.status) ||
        !holder.sent_at ||
        !holder.response_hash ||
        !holder.response)
    )
      fail();
  } else if (phase === 'send' || phase === 'commit') fail();
  if (evidence.actorBlockers.some((a) => a.attemptId !== holder?.id)) return null;
  const paid = history.filter(
    (h) =>
      h.sent_at ||
      h.response_hash ||
      h.response ||
      h.event_id ||
      [
        'invalid_output',
        'unknown_after_send',
        'request_sent',
        'response_received',
        'committed',
      ].includes(h.status),
  );
  if (paid.some((h) => h.attempt_id !== holder?.id)) return null;
  if (phase === 'commit') {
    if (!holder || paid.length !== 1) fail();
  } else if (paid.length) return null;
  const recovery =
    history.some((h) => h.attempt_id !== holder?.id && zeroSendTerminal(h)) ||
    (!!last && zeroSendTerminal(last));
  let commandId = ownAgendaReviewCommandId(input.worldId, grant.grantId);
  if (last) {
    if (holder || last.document.expectedWorldVersion === f.version)
      commandId = last.document.commandId;
    else if (recovery && last.document.expectedWorldVersion < f.version)
      commandId = ownAgendaUnsentTransportCommandId(
        input.worldId,
        grant.grantId,
        last.document.commandId,
        f.version,
      );
    else return null;
  }
  if (
    input.receipt &&
    (input.receipt.expectedWorldVersion !== f.version ||
      input.receipt.commandId !== commandId ||
      input.receipt.text !== ownAgendaReviewInputText(grant) ||
      input.receipt.inputHash !==
        digest(JSON.stringify([input.worldId, input.actorId, grant.grantId, input.receipt.text])) ||
      input.receipt.origin !== 'wake' ||
      input.receipt.channel !== 'private' ||
      input.receipt.recipientActorId !== input.actorId ||
      input.receipt.threadId !== input.actorId)
  )
    fail();
  if (phase !== 'commit') {
    if (f.paused) return null;
    if (
      evidence.lastPresentedRealAt &&
      Date.parse(f.realAt) < Date.parse(evidence.lastPresentedRealAt) + config.policy.realGapMs
    )
      return null;
    const pendingEpisode = await sql.query(
      "SELECT 1 FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND status='pending' LIMIT 1",
      [input.worldId, owner, input.actorId],
    );
    if (pendingEpisode.rowCount) return null;
    const priority =
      input.hasPriorityWork ??
      (input.snapshot ? await priorityWork(sql, owner, f, input.snapshot) : false);
    const budgets = await readOwnAgendaBudgetInTransaction(
      sql,
      owner,
      input.worldId,
      input.actorId,
      config.budgets,
      f.realAt,
    );
    // The current reserved/cancelled transport is authenticated above, not a new grant.
    // Historical zero-send transports retain the same family and verified lineage.
    const others = evidence.attempts.filter((a) => a.attemptId !== holder?.id);
    const status = evaluateOwnAgendaReview(
      {
        identity: {
          worldId: input.worldId,
          actorId: input.actorId,
          engineEpoch: f.engine_epoch,
          definitionRef,
        },
        anchor: evidence.anchor,
        purpose: 'own_agenda',
        storyAt: f.storyAt,
        realAt: f.realAt,
        paused: f.paused,
        hasPriorityWork: priority,
        attempts: others,
        quietStreak: evidence.quietStreak,
        budgets,
        policy: config.policy,
      },
      digest,
    );
    if (status.status !== 'ready' && !(phase === 'send' && status.status === 'budget_wait')) {
      // Explicit zero-send recovery contract: time/priority/budget still apply, but
      // unsent terminal history is not turned into a new grant or erased from storage.
      if (!(
        recovery &&
        status.status === 'not_due' &&
        status.reason === 'unsent_recovery_required'
      ))
        return null;
      const window = ownAgendaReviewWindow(evidence.anchor, config.policy, evidence.quietStreak);
      if (
        priority ||
        f.paused ||
        Date.parse(f.storyAt) < Date.parse(window.nextReviewStoryAt) ||
        Date.parse(f.realAt) < Date.parse(window.nextReviewRealAt) ||
        (phase !== 'send' && Object.values(budgets).some((b) => b.remaining === 0))
      )
        return null;
    }
  }
  return {
    grant,
    commandId,
    recovery,
    candidate: {
      id: grant.grantId,
      worldId: input.worldId,
      actorId: input.actorId,
      source: 'agenda_review',
      episodeId: null,
      actionId: null,
      resourceIds: [grant.grantId],
      channel: 'private',
      threadId: input.actorId,
      sourceIds: grant.basisSourceIds,
      expectedWorldVersion: f.version,
      expectedActorRevision: f.actor_state.revision,
      priority: 5,
      reason: '根据本人已提交状态，有界重新考虑自己的议程；允许保持安静，不代表用户承担任务。',
      requiresCoordination: false,
    },
  };
}
export async function requireOwnAgendaReviewAuthorityInTransaction(
  sql: SqlClient,
  owner: string,
  receipt: AgentInputReceipt,
  options: {
    phase: 'accept' | 'claim' | 'send' | 'commit';
    holder?: Holder;
    snapshot?: AgentSnapshot;
    config?: OwnAgendaRuntimeConfig;
  },
) {
  if (!isOwnAgendaReviewInput(receipt)) return null;
  if (!receipt.recipientActorId) fail();
  const work = await readOwnAgendaReviewWorkInTransaction(sql, owner, {
    worldId: receipt.worldId,
    actorId: receipt.recipientActorId,
    worldVersion: receipt.expectedWorldVersion,
    receipt,
    ...options,
  });
  if (!work) fail('OWN_AGENDA_REVIEW_NOT_READY');
  return work;
}
