import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentAttemptStatus } from '../domain/agent-runtime.ts';
import { DomainError } from '../domain/errors.ts';
import { worldDateTimeInput } from '../domain/display-time.ts';
import { agentDefinitionRef } from './agent-snapshot-repository.ts';
import {
  ownAgendaReviewFamilyId,
  type OwnAgendaReviewIdentity,
  type OwnAgendaReviewAnchor,
  type OwnAgendaReviewAttemptEvidence,
} from '../application/own-agenda-review-policy.ts';

export type OwnAgendaReviewActorBlocker = {
  attemptId: string;
  commandId: string;
  engineEpoch: number;
  status: AgentAttemptStatus;
  sent: boolean;
  hasRaw: boolean;
  familyId: string | null;
};
export type OwnAgendaReviewEvidence = {
  worldVersion: number;
  actorRevision: number;
  anchor: OwnAgendaReviewAnchor | null;
  familyId: string | null;
  attempts: OwnAgendaReviewAttemptEvidence[];
  /** Must be handled before N2. A different family or epoch cannot hide an active actor call. */
  actorBlockers: OwnAgendaReviewActorBlocker[];
};
export class OwnAgendaReviewEvidenceError extends Error {
  readonly code = 'INVALID_OWN_AGENDA_REVIEW_EVIDENCE';
  readonly reason: 'scope' | 'receipt' | 'committed_source' | 'envelope' | 'history_limit';
  constructor(reason: OwnAgendaReviewEvidenceError['reason']) {
    super('INVALID_OWN_AGENDA_REVIEW_EVIDENCE');
    this.reason = reason;
  }
}
type Row = Record<string, any>;
const fail = (reason: OwnAgendaReviewEvidenceError['reason']): never => {
  throw new OwnAgendaReviewEvidenceError(reason);
};
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const key = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() === v && !!v && v.length <= 240;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const instant = (v: unknown): v is string => typeof v === 'string' && !!worldDateTimeInput(v);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const statuses = [
  'reserved',
  'request_sent',
  'response_received',
  'invalid_output',
  'stale_discarded',
  'committed',
  'cancelled_before_send',
  'unknown_after_send',
];
const historyLimit = 4096;

/** One SELECT snapshot, no locks/config changes/writes, model/source registration or budget reservation. */
export async function readOwnAgendaReviewEvidenceInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: OwnAgendaReviewIdentity,
): Promise<OwnAgendaReviewEvidence> {
  if (
    !key(ownerId) ||
    !key(input.worldId) ||
    !key(input.actorId) ||
    !key(input.definitionRef) ||
    !integer(input.engineEpoch) ||
    input.engineEpoch < 2
  )
    fail('scope');
  const frame = (
    await sql.query(
      `SELECT w.version,w.state->'actors' actors,w.state->>'time' story_at,c.engine_epoch,
      s.revision,s.projected_world_version,s.document AS actor_state,
      current_setting('app.user_id',true) identity,
      pg_has_role(current_user,'pl_app','MEMBER') is_app,
      pg_has_role(current_user,'pl_worker','MEMBER') is_worker,
      COALESCE((SELECT jsonb_agg(to_jsonb(history)) FROM (
        SELECT a.id,a.world_id,a.owner_id,a.actor_id,a.command_id,a.input_receipt_id,a.input_hash,
          a.engine_epoch,a.expected_world_version,a.expected_actor_revision,a.status,a.event_id,
          a.sent_at IS NOT NULL AS sent,a.response IS NOT NULL AS has_response,a.response_hash,
          CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object('id',i.id,'worldId',i.world_id,
            'ownerId',i.owner_id,'commandId',i.command_id,'inputHash',i.input_hash,'document',i.document) END receipt,
          CASE WHEN cmd.id IS NULL THEN NULL ELSE jsonb_build_object('id',cmd.id,'worldId',cmd.world_id,
            'ownerId',cmd.owner_id,'expectedVersion',cmd.expected_version,'status',cmd.status,
            'eventId',cmd.result_event_id,'hash',cmd.request_hash,'payload',cmd.request_payload) END command,
          CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id',e.id,'worldId',e.world_id,
            'ownerId',e.owner_id,'version',e.version,'commandId',e.command_id,'realAt',e.occurred_at,
            'payload',jsonb_build_object('id',e.payload->'id','worldId',e.payload->'worldId',
              'commandId',e.payload->'commandId','schemaVersion',e.payload->'schemaVersion',
              'version',e.payload->'version','occurredAt',e.payload->'occurredAt',
              'storyAt',e.payload->'storyAt','type',e.payload->'type','actorId',e.payload->'data'->'actorId',
              'runtime',jsonb_build_object('schemaVersion',e.payload#>'{data,agentRuntime,schemaVersion}',
                'engineEpoch',e.payload#>'{data,agentRuntime,engineEpoch}',
                'inputReceiptId',e.payload#>'{data,agentRuntime,inputReceiptId}',
                'inputStoryAt',e.payload#>'{data,agentRuntime,inputStoryAt}',
                'inputWorldVersion',e.payload#>'{data,agentRuntime,inputWorldVersion}',
                'actorRevisionBefore',e.payload#>'{data,agentRuntime,actorRevisionBefore}',
                'actorRevisionAfter',e.payload#>'{data,agentRuntime,actorRevisionAfter}',
                'statementCount',CASE WHEN jsonb_typeof(e.payload#>'{data,agentRuntime,proposal,statements}')='array'
                  THEN jsonb_array_length(e.payload#>'{data,agentRuntime,proposal,statements}') END,
                'stateAfter',jsonb_build_object('worldId',e.payload#>'{data,agentRuntime,stateAfter,worldId}',
                  'actorId',e.payload#>'{data,agentRuntime,stateAfter,actorId}',
                  'schemaVersion',e.payload#>'{data,agentRuntime,stateAfter,schemaVersion}',
                  'revision',e.payload#>'{data,agentRuntime,stateAfter,revision}',
                  'projectedWorldVersion',e.payload#>'{data,agentRuntime,stateAfter,projectedWorldVersion}',
                  'definitionRef',e.payload#>'{data,agentRuntime,stateAfter,definitionRef}')))) END event
        FROM parallel_life.agent_attempts a
        LEFT JOIN parallel_life.agent_input_receipts i ON i.world_id=a.world_id AND i.owner_id=a.owner_id AND i.id=a.input_receipt_id
        LEFT JOIN parallel_life.commands cmd ON cmd.world_id=a.world_id AND cmd.owner_id=a.owner_id AND cmd.id=a.command_id
        LEFT JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
        WHERE a.world_id=w.id AND a.owner_id=w.owner_id AND a.actor_id=$3
        ORDER BY a.expected_world_version,a.created_at,a.id LIMIT $4
      ) history),'[]'::jsonb) history
      FROM parallel_life.worlds w
      LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
      LEFT JOIN parallel_life.actor_agent_states s ON s.world_id=w.id AND s.owner_id=w.owner_id AND s.actor_id=$3
      WHERE w.id=$1 AND w.owner_id=$2`,
      [input.worldId, ownerId, input.actorId, historyLimit + 1],
    )
  ).rows[0];
  if (!frame) throw new DomainError('NOT_FOUND');
  if (
    frame.identity !== ownerId ||
    !frame.is_app ||
    frame.is_worker ||
    frame.engine_epoch !== input.engineEpoch ||
    !integer(frame.version) ||
    !integer(frame.revision) ||
    !integer(frame.projected_world_version) ||
    frame.projected_world_version > frame.version ||
    !Array.isArray(frame.actors) ||
    !instant(frame.story_at) ||
    !object(frame.actor_state) ||
    frame.actor_state.worldId !== input.worldId ||
    frame.actor_state.actorId !== input.actorId ||
    frame.actor_state.schemaVersion !== 1 ||
    frame.actor_state.revision !== frame.revision ||
    frame.actor_state.projectedWorldVersion !== frame.projected_world_version ||
    frame.actor_state.definitionRef !== input.definitionRef
  )
    fail('scope');
  const actors = frame.actors.filter((a: unknown) => object(a) && a.id === input.actorId);
  if (
    actors.length !== 1 ||
    typeof actors[0].persona !== 'string' ||
    (actors[0].relationship !== undefined && typeof actors[0].relationship !== 'string') ||
    agentDefinitionRef({ id: input.worldId, actors: frame.actors }, input.actorId) !==
      input.definitionRef
  )
    fail('scope');
  if (!Array.isArray(frame.history)) fail('scope');
  if (frame.history.length > historyLimit) fail('history_limit');
  const rows = frame.history as Row[];
  const byId = new Map<string, Row>();
  for (const r of rows) {
    if (
      !object(r) ||
      !key(r.id) ||
      byId.has(r.id) ||
      r.world_id !== input.worldId ||
      r.owner_id !== ownerId ||
      r.actor_id !== input.actorId ||
      !integer(r.engine_epoch) ||
      r.engine_epoch < 1 ||
      !integer(r.expected_world_version) ||
      !integer(r.expected_actor_revision) ||
      !statuses.includes(r.status) ||
      typeof r.sent !== 'boolean' ||
      typeof r.has_response !== 'boolean' ||
      !(r.response_hash === null || /^[a-f0-9]{64}$/.test(r.response_hash)) ||
      r.has_response !== (r.response_hash !== null)
    )
      fail('receipt');
    const receipt = r.receipt,
      body = receipt?.document;
    if (
      !object(receipt) ||
      !object(body) ||
      receipt.id !== r.input_receipt_id ||
      receipt.worldId !== input.worldId ||
      receipt.ownerId !== ownerId ||
      receipt.commandId !== r.command_id ||
      receipt.inputHash !== r.input_hash ||
      !/^[a-f0-9]{64}$/.test(r.input_hash) ||
      body.id !== receipt.id ||
      body.worldId !== input.worldId ||
      body.commandId !== r.command_id ||
      body.inputHash !== r.input_hash ||
      !key(body.threadId) ||
      typeof body.text !== 'string' ||
      !['private', 'group', 'scene'].includes(body.channel) ||
      !['player', 'wake', 'coordination'].includes(body.origin) ||
      !instant(body.receivedAt) ||
      !instant(body.storyAt) ||
      !integer(body.expectedWorldVersion) ||
      body.expectedWorldVersion > r.expected_world_version ||
      (body.recipientActorId !== null && body.recipientActorId !== input.actorId)
    )
      fail('receipt');
    byId.set(r.id, r);
  }
  const anchors = new Map<string, { anchor: OwnAgendaReviewAnchor; version: number }>();
  for (const r of rows) {
    if (r.status !== 'committed' || r.engine_epoch !== input.engineEpoch) continue;
    const e = r.event,
      c = r.command,
      b = r.receipt.document;
    if (
      !object(e) ||
      !object(c) ||
      !object(e.payload) ||
      !r.sent ||
      !r.has_response ||
      e.id !== r.event_id ||
      e.worldId !== input.worldId ||
      e.ownerId !== ownerId ||
      e.commandId !== r.command_id ||
      !integer(e.version) ||
      e.version !== r.expected_world_version + 1 ||
      e.version > frame.version ||
      c.id !== r.command_id ||
      c.worldId !== input.worldId ||
      c.ownerId !== ownerId ||
      c.status !== 'succeeded' ||
      c.eventId !== e.id ||
      c.expectedVersion !== r.expected_world_version ||
      e.payload.id !== e.id ||
      e.payload.worldId !== input.worldId ||
      e.payload.commandId !== r.command_id ||
      e.payload.version !== e.version ||
      e.payload.actorId !== input.actorId ||
      e.payload.schemaVersion !== 1 ||
      !instant(e.payload.storyAt) ||
      !instant(e.payload.occurredAt) ||
      !instant(e.realAt) ||
      Date.parse(e.realAt) !== Date.parse(e.payload.occurredAt)
    )
      fail('committed_source');
    // Messages are not anchors. This first package certifies only the original private state-commit path.
    if (e.payload.type !== 'agent.state_committed') continue;
    const rt = e.payload.runtime,
      after = rt?.stateAfter;
    const command = {
      id: r.command_id,
      worldId: input.worldId,
      expectedVersion: r.expected_world_version,
      actorId: input.actorId,
      text: b.text,
      ...(b.origin === 'player' ? {} : { origin: 'director' }),
    };
    const commandHash = digest(
      JSON.stringify([
        input.worldId,
        r.expected_world_version,
        input.actorId,
        b.text,
        ...(b.origin === 'player' ? [] : ['director']),
      ]),
    );
    if (
      b.channel !== 'private' ||
      b.threadId !== input.actorId ||
      b.recipientActorId !== input.actorId ||
      b.expectedWorldVersion !== r.expected_world_version ||
      c.hash !== commandHash ||
      !isDeepStrictEqual(c.payload, command) ||
      !object(rt) ||
      !object(after) ||
      rt.schemaVersion !== 1 ||
      rt.engineEpoch !== input.engineEpoch ||
      rt.inputReceiptId !== r.input_receipt_id ||
      rt.inputStoryAt !== b.storyAt ||
      rt.inputWorldVersion !== b.expectedWorldVersion ||
      rt.actorRevisionBefore !== r.expected_actor_revision ||
      rt.actorRevisionAfter !== r.expected_actor_revision + 1 ||
      rt.statementCount !== 0 ||
      after.schemaVersion !== 1 ||
      after.worldId !== input.worldId ||
      after.actorId !== input.actorId ||
      after.revision !== rt.actorRevisionAfter ||
      after.revision > frame.revision ||
      after.projectedWorldVersion !== e.version ||
      !key(after.definitionRef) ||
      Date.parse(e.payload.storyAt) < Date.parse(b.storyAt) ||
      Date.parse(e.payload.storyAt) > Date.parse(frame.story_at)
    )
      fail('committed_source');
    if (after.definitionRef !== input.definitionRef) continue;
    anchors.set(r.id, {
      version: e.version,
      anchor: {
        ...input,
        attemptId: r.id,
        eventId: e.id,
        committedStoryAt: e.payload.storyAt,
        committedRealAt: new Date(e.realAt).toISOString(),
      },
    });
  }
  const latest = [...anchors.values()].sort((a, b) => b.version - a.version)[0]?.anchor ?? null;
  const familyId = latest ? ownAgendaReviewFamilyId(input, latest, digest) : null;
  const attempts: OwnAgendaReviewAttemptEvidence[] = [];
  const actorBlockers: OwnAgendaReviewActorBlocker[] = [];
  for (const r of rows) {
    const body = r.receipt.document;
    let envelope: unknown;
    if (body.origin === 'wake') {
      try {
        envelope = JSON.parse(body.text);
      } catch {
        /* Ordinary wakes need not be JSON. */
      }
    }
    let recordFamily: string | null = null;
    if (object(envelope) && envelope.type === 'npc_agenda_review') {
      if (
        !isDeepStrictEqual(
          Object.keys(envelope).sort(),
          [
            'type',
            'family',
            'grantId',
            'anchorAttemptId',
            'policyVersion',
            'basisSourceIds',
          ].sort(),
        ) ||
        envelope.family !== 'own_agenda' ||
        !key(envelope.grantId) ||
        !key(envelope.anchorAttemptId) ||
        !key(envelope.policyVersion) ||
        !Array.isArray(envelope.basisSourceIds) ||
        envelope.basisSourceIds.length !== 1 ||
        typeof envelope.basisSourceIds[0] !== 'string' ||
        !/^definition:[a-f0-9]{64}$/.test(envelope.basisSourceIds[0]) ||
        body.channel !== 'private' ||
        body.threadId !== input.actorId ||
        body.recipientActorId !== input.actorId
      )
        fail('envelope');
      // Old epochs cannot supply this family's authority, but their original active calls still block.
      if (r.engine_epoch !== input.engineEpoch && envelope.grantId === familyId) fail('envelope');
      if (r.engine_epoch === input.engineEpoch) {
        const predecessor = anchors.get(envelope.anchorAttemptId);
        if (
          !predecessor ||
          envelope.anchorAttemptId === r.id ||
          predecessor.version > body.expectedWorldVersion ||
          Date.parse(predecessor.anchor.committedStoryAt) > Date.parse(body.storyAt) ||
          Date.parse(predecessor.anchor.committedRealAt) > Date.parse(body.receivedAt) ||
          !isDeepStrictEqual(envelope.basisSourceIds, [`definition:${input.definitionRef}`]) ||
          ownAgendaReviewFamilyId(input, predecessor.anchor, digest) !== envelope.grantId
        )
          fail('envelope');
        recordFamily = envelope.grantId;
        if (recordFamily !== null && recordFamily === familyId)
          attempts.push({
            familyId: recordFamily,
            attemptId: r.id,
            policyVersion: envelope.policyVersion,
            status: r.status,
            sent: r.sent,
            hasRaw: r.has_response,
          });
      }
    }
    if (['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(r.status))
      actorBlockers.push({
        attemptId: r.id,
        commandId: r.command_id,
        engineEpoch: r.engine_epoch,
        status: r.status,
        sent: r.sent,
        hasRaw: r.has_response,
        familyId: recordFamily,
      });
  }
  return {
    worldVersion: frame.version,
    actorRevision: frame.revision,
    anchor: latest,
    familyId,
    attempts: attempts.sort((a, b) =>
      a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0,
    ),
    actorBlockers: actorBlockers.sort((a, b) =>
      a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0,
    ),
  };
}
