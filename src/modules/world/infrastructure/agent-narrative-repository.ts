import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentAttempt, AgentInputReceipt } from '../domain/agent-runtime.ts';
import type {
  AgentEpisodeReceipt,
  AgentEpisodeRequest,
  DirectorEvaluationCause,
  NarrativeAdmission,
} from '../domain/agent-narrative.ts';
import type { DirectorDecision, SharedEpisode } from '../domain/director-runtime.ts';
import { DomainError } from '../domain/errors.ts';

const key = z
  .string()
  .min(1)
  .max(240)
  .refine((v) => v.trim() === v);
const list = z
  .array(key)
  .max(64)
  .refine((v) => new Set(v).size === v.length);
const intentSchema = z.strictObject({
  type: z.literal('npc_episode_consideration'),
  requestId: key,
  revision: z.literal(0),
  activity: z.enum(['conversation', 'meeting', 'follow_up']),
  placeOptionIds: z.tuple([]),
  basisSourceIds: z.tuple([key]),
});
const choiceSchema = z.strictObject({
  requestId: key,
  choice: z.enum(['engage', 'decline', 'defer', 'need_information', 'quiet']),
  reason: z
    .string()
    .min(1)
    .max(2000)
    .refine((v) => v.trim().length > 0),
  sourceIds: list.refine((v) => v.length > 0),
});
const stable = (prefix: string, ...parts: string[]) =>
  `${prefix}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
function invalid(): never {
  throw new DomainError('INVALID_PROPOSAL', 'INVALID_NARRATIVE_BASIS');
}
async function authority(sql: SqlClient, owner: string) {
  const r = (
    await sql.query(`SELECT current_setting('app.user_id',true) owner,
    pg_has_role(current_user,'pl_app','MEMBER') app,
    pg_has_role(current_user,'pl_worker','MEMBER') worker`)
  ).rows[0];
  if (!r || r.owner !== owner || !r.app || r.worker) throw new DomainError('NOT_FOUND');
}
async function frame(sql: SqlClient, owner: string, worldId: string, lock = false) {
  await authority(sql, owner);
  const world = (
    await sql.query(
      `SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [worldId, owner],
    )
  ).rows[0];
  if (!world) throw new DomainError('NOT_FOUND');
  const control = (
    await sql.query(
      `SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [worldId, owner],
    )
  ).rows[0];
  return { ...world, epoch: control?.engine_epoch ?? 1 };
}
function epoch(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 2 || expected !== actual) invalid();
}
function admission(r: any): NarrativeAdmission {
  return {
    worldId: r.world_id,
    engineEpoch: r.engine_epoch,
    kind: r.kind,
    genesisHash: r.genesis_hash,
    admittedAtVersion: r.admitted_at_version,
  };
}
function request(r: any): AgentEpisodeRequest {
  return {
    schemaVersion: 1,
    worldId: r.world_id,
    actorId: r.actor_id,
    id: r.id,
    episodeId: r.episode_id,
    originDecisionId: r.origin_decision_id,
    engineEpoch: r.engine_epoch,
    createdAtVersion: r.created_at_version,
    activity: r.activity,
    status: r.status,
    inputReceiptId: r.input_receipt_id,
    receiptId: r.receipt_id,
  };
}
function receipt(r: any): AgentEpisodeReceipt {
  return {
    schemaVersion: 1,
    worldId: r.world_id,
    actorId: r.actor_id,
    id: r.id,
    requestId: r.request_id,
    episodeId: r.episode_id,
    attemptId: r.attempt_id,
    inputReceiptId: r.input_receipt_id,
    sourceEventId: r.source_event_id,
    worldVersion: r.world_version,
    choice: r.choice,
    reason: r.reason,
    sourceIds: r.source_ids,
    presentedMessageIds: r.presented_message_ids,
  };
}
/** Explicit genesis-only enrollment. Never switches an epoch or manufactures an opening event. */
export async function admitNewAgentNarrativeInTransaction(
  sql: SqlClient,
  owner: string,
  input: { worldId: string; engineEpoch: number },
): Promise<NarrativeAdmission> {
  const w = await frame(sql, owner, input.worldId, true);
  epoch(w.epoch, input.engineEpoch);
  const initial = (
    await sql.query(
      'SELECT md5(state::text) hash FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
      [input.worldId, owner],
    )
  ).rows[0];
  if (!initial) invalid();
  const prior = (
    await sql.query(
      'SELECT * FROM parallel_life.agent_narrative_admissions WHERE world_id=$1 AND owner_id=$2',
      [input.worldId, owner],
    )
  ).rows[0];
  if (prior) {
    if (prior.engine_epoch !== input.engineEpoch || prior.genesis_hash !== initial.hash) invalid();
    return admission(prior);
  }
  if (w.version !== 0) invalid();
  // SQL independently checks the full persisted cast, no attempts, and the exact initial JSONB hash.
  const row = (
    await sql.query(
      `INSERT INTO parallel_life.agent_narrative_admissions
    (world_id,owner_id,engine_epoch,kind,genesis_hash,admitted_at_version)
    VALUES($1,$2,$3,'new_genesis',$4,0) RETURNING *`,
      [input.worldId, owner, input.engineEpoch, initial.hash],
    )
  ).rows[0];
  await sql.query(
    `INSERT INTO parallel_life.director_observed_states(world_id,owner_id)
    VALUES($1,$2) ON CONFLICT(world_id) DO NOTHING`,
    [input.worldId, owner],
  );
  return admission(row);
}
/** One readonly statement pins admission, hash, current frame and prior attempt statuses together. */
export async function readDirectorBootstrapCauseInTransaction(
  sql: SqlClient,
  owner: string,
  input: { worldId: string; engineEpoch: number; worldVersion: number },
): Promise<DirectorEvaluationCause | null> {
  await authority(sql, owner);
  const r = (
    await sql.query(
      `SELECT w.version,c.engine_epoch,a.genesis_hash,
    a.engine_epoch admission_epoch,md5(i.state::text) initial_hash,
    COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('causeId',d.snapshot#>>'{evaluationCause,id}','status',d.status))
      FROM parallel_life.director_runtime_attempts d WHERE d.world_id=w.id AND d.owner_id=w.owner_id
        AND d.engine_epoch=c.engine_epoch AND d.snapshot#>>'{evaluationCause,kind}'='bootstrap'
        AND d.snapshot#>>'{evaluationCause,genesisHash}'=a.genesis_hash),'[]'::jsonb) attempts
    FROM parallel_life.worlds w
    LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
    LEFT JOIN parallel_life.agent_narrative_admissions a ON a.world_id=w.id AND a.owner_id=w.owner_id
    LEFT JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id
    WHERE w.id=$1 AND w.owner_id=$2`,
      [input.worldId, owner],
    )
  ).rows[0];
  if (!r) throw new DomainError('NOT_FOUND');
  epoch(r.engine_epoch, input.engineEpoch);
  if (r.version !== input.worldVersion) throw new DomainError('VERSION_CONFLICT');
  if (!r.genesis_hash) return null;
  if (r.admission_epoch !== input.engineEpoch || r.genesis_hash !== r.initial_hash) invalid();
  const id = stable('bootstrap', input.worldId, String(input.engineEpoch), r.genesis_hash);
  const terminal = new Set([
    'committed',
    'invalid_output',
    'stale_discarded',
    'cancelled_before_send',
  ]);
  if (r.attempts.some((a: any) => a.causeId === id && terminal.has(a.status))) return null;
  return { id, kind: 'bootstrap', genesisHash: r.genesis_hash, admittedAtVersion: 0 };
}
/** The committed director document grants delivery eligibility, never knowledge of its audit prose. */
export async function createEpisodeRequestsInTransaction(
  sql: SqlClient,
  owner: string,
  input: { worldId: string; engineEpoch: number; decision: DirectorDecision },
): Promise<AgentEpisodeRequest[]> {
  const w = await frame(sql, owner, input.worldId, true);
  epoch(w.epoch, input.engineEpoch);
  const d = (
    await sql.query(
      `SELECT d.document FROM parallel_life.director_decisions d
    JOIN parallel_life.director_runtime_attempts a ON a.id=d.attempt_id AND a.world_id=d.world_id AND a.owner_id=d.owner_id
    WHERE d.world_id=$1 AND d.owner_id=$2 AND d.id=$3 AND d.engine_epoch=$4
      AND a.status='committed' AND a.decision_id=d.id`,
      [input.worldId, owner, input.decision.id, input.engineEpoch],
    )
  ).rows[0]?.document as DirectorDecision | undefined;
  if (!d || !isDeepStrictEqual(d, input.decision) || d.worldVersion > w.version) invalid();
  const result: AgentEpisodeRequest[] = [];
  for (const opportunity of [...d.opportunities].sort((a, b) => a.id.localeCompare(b.id))) {
    const ep = (
      await sql.query(
        `SELECT document FROM parallel_life.shared_episodes
      WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND origin_decision_id=$4`,
        [input.worldId, owner, opportunity.id, d.id],
      )
    ).rows[0]?.document as SharedEpisode | undefined;
    if (!ep || !isDeepStrictEqual(ep.participantActorIds, opportunity.participantActorIds))
      invalid();
    for (const actorId of [...opportunity.participantActorIds].sort()) {
      const id = stable('episode_request', input.worldId, d.id, opportunity.id, actorId);
      let row = (
        await sql.query(
          `SELECT * FROM parallel_life.agent_episode_requests
        WHERE world_id=$1 AND owner_id=$2 AND episode_id=$3 AND actor_id=$4 FOR UPDATE`,
          [input.worldId, owner, ep.id, actorId],
        )
      ).rows[0];
      if (!row)
        row = (
          await sql.query(
            `INSERT INTO parallel_life.agent_episode_requests
        (world_id,owner_id,id,actor_id,episode_id,origin_decision_id,engine_epoch,created_at_version,activity)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              input.worldId,
              owner,
              id,
              actorId,
              ep.id,
              d.id,
              input.engineEpoch,
              d.worldVersion,
              opportunity.activity,
            ],
          )
        ).rows[0];
      if (
        row.id !== id ||
        row.origin_decision_id !== d.id ||
        row.engine_epoch !== input.engineEpoch ||
        row.created_at_version !== d.worldVersion ||
        row.activity !== opportunity.activity
      )
        throw new DomainError('IDEMPOTENCY_CONFLICT');
      result.push(request(row));
    }
  }
  return result;
}
export async function readPendingEpisodeRequestsInTransaction(
  sql: SqlClient,
  owner: string,
  input: { worldId: string; engineEpoch: number },
): Promise<AgentEpisodeRequest[]> {
  const w = await frame(sql, owner, input.worldId);
  epoch(w.epoch, input.engineEpoch);
  return (
    await sql.query(
      `SELECT * FROM parallel_life.agent_episode_requests
    WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND status='pending' ORDER BY created_at_version,id`,
      [input.worldId, owner, input.engineEpoch],
    )
  ).rows.map(request);
}
function parseIntent(text: string) {
  try {
    return intentSchema.parse(JSON.parse(text));
  } catch {
    return invalid();
  }
}
function checkedInput(body: AgentInputReceipt, r: AgentEpisodeRequest, definitionRef: string) {
  const intent = parseIntent(body.text);
  if (
    body.origin !== 'coordination' ||
    body.channel !== 'private' ||
    body.worldId !== r.worldId ||
    body.recipientActorId !== r.actorId ||
    body.threadId !== r.actorId ||
    intent.requestId !== r.id ||
    intent.activity !== r.activity ||
    intent.basisSourceIds[0] !== `definition:${definitionRef}`
  )
    invalid();
  return intent;
}
/** Final internal step only: receipt and consumed request must commit together (deferred SQL FK). */
async function consumeEpisodeRequestInTransaction(
  sql: SqlClient,
  owner: string,
  r: AgentEpisodeRequest,
  value: AgentEpisodeReceipt,
): Promise<void> {
  const saved = await sql.query(
    `UPDATE parallel_life.agent_episode_requests
    SET status='consumed',input_receipt_id=$4,receipt_id=$5
    WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND status='pending'
      AND input_receipt_id IS NULL AND receipt_id IS NULL`,
    [r.worldId, owner, r.id, value.inputReceiptId, value.id],
  );
  if (saved.rowCount !== 1) throw new DomainError('VERSION_CONFLICT');
}
/** After actual kernel finish, on its original SqlClient and commit authority. Replay only reads. */
export async function projectEpisodeRequestInTransaction(
  sql: SqlClient,
  owner: string,
  input: { attempt: AgentAttempt; eventId: string },
): Promise<AgentEpisodeReceipt | null> {
  const a = input.attempt;
  const w = await frame(sql, owner, a.worldId, true);
  const body = (
    await sql.query(
      `SELECT document FROM parallel_life.agent_input_receipts
    WHERE world_id=$1 AND owner_id=$2 AND id=$3`,
      [a.worldId, owner, a.inputReceiptId],
    )
  ).rows[0]?.document as AgentInputReceipt | undefined;
  if (!body) invalid();
  if (body.origin !== 'coordination' || body.channel !== 'private') return null;
  let raw: any;
  try {
    raw = JSON.parse(body.text);
  } catch {
    return null;
  }
  if (raw?.type !== 'npc_episode_consideration') return null;
  const intent = parseIntent(body.text);
  const row = (
    await sql.query(
      `SELECT * FROM parallel_life.agent_episode_requests
    WHERE world_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`,
      [a.worldId, owner, intent.requestId],
    )
  ).rows[0];
  if (!row) invalid();
  const r = request(row);
  if (
    r.actorId !== a.actorId ||
    (r.inputReceiptId !== null && r.inputReceiptId !== a.inputReceiptId) ||
    r.engineEpoch !== a.engineEpoch
  )
    invalid();
  const committed = (
    await sql.query(
      `SELECT e.payload,e.version,c.status command_status,c.result_event_id,c.expected_version,c.request_hash,
      a.response->'snapshot' snapshot
    FROM parallel_life.agent_attempts a
    JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
    JOIN parallel_life.commands c ON c.world_id=a.world_id AND c.owner_id=a.owner_id AND c.id=a.command_id
    WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3 AND a.actor_id=$4 AND a.command_id=$5
      AND a.input_receipt_id=$6 AND a.input_hash=$7 AND a.token=$8 AND a.engine_epoch=$9
      AND a.expected_world_version=$10 AND a.expected_actor_revision=$11 AND a.status='committed' AND a.event_id=$12`,
      [
        a.worldId,
        owner,
        a.id,
        a.actorId,
        a.commandId,
        a.inputReceiptId,
        a.inputHash,
        a.token,
        a.engineEpoch,
        a.expectedWorldVersion,
        a.expectedActorRevision,
        input.eventId,
      ],
    )
  ).rows[0];
  const event = committed?.payload,
    rt = event?.data?.agentRuntime;
  if (
    !committed ||
    committed.command_status !== 'succeeded' ||
    committed.result_event_id !== input.eventId ||
    committed.version !== a.expectedWorldVersion + 1 ||
    event.id !== input.eventId ||
    event.worldId !== a.worldId ||
    event.version !== committed.version ||
    event.commandId !== a.commandId ||
    event.data?.actorId !== a.actorId ||
    committed.expected_version !== a.expectedWorldVersion ||
    rt?.engineEpoch !== a.engineEpoch ||
    rt.inputReceiptId !== a.inputReceiptId ||
    rt.actorRevisionBefore !== a.expectedActorRevision ||
    rt.actorRevisionAfter !== a.expectedActorRevision + 1 ||
    rt.stateAfter?.actorId !== a.actorId ||
    rt.stateAfter?.worldId !== a.worldId ||
    rt.inputWorldVersion !== body.expectedWorldVersion ||
    rt.inputStoryAt !== body.storyAt ||
    body.commandId !== a.commandId ||
    body.inputHash !== a.inputHash
  )
    invalid();
  checkedInput(body, r, rt.stateAfter.definitionRef);
  if (!isDeepStrictEqual(rt.proposal?.episodeDecision, rt.episodeDecision)) invalid();
  const choice =
    rt.episodeDecision === undefined ? undefined : choiceSchema.safeParse(rt.episodeDecision);
  if (
    choice &&
    (!choice.success || choice.data.requestId !== r.id || !choice.data.sourceIds.includes(body.id))
  )
    invalid();
  const selected = choice?.success ? choice.data : undefined;
  const captured = committed.snapshot;
  if (
    !captured ||
    captured.state?.worldId !== a.worldId ||
    captured.state?.actorId !== a.actorId ||
    captured.state?.revision !== a.expectedActorRevision ||
    captured.worldVersion !== a.expectedWorldVersion ||
    captured.input?.sourceId !== body.id ||
    captured.input?.origin !== body.origin ||
    captured.input?.text !== body.text ||
    !Array.isArray(captured.sources) ||
    (selected &&
      selected.sourceIds.some((id) => !captured.sources.some((source: any) => source.id === id)))
  )
    invalid();
  const messageIds = (
    await sql.query(
      `SELECT id FROM parallel_life.world_messages
    WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND document->>'role'='assistant'
      AND document->>'sourceEventId'=$4 ORDER BY id`,
      [a.worldId, owner, a.actorId, input.eventId],
    )
  ).rows.map((m) => m.id as string);
  const value: AgentEpisodeReceipt = {
    schemaVersion: 1,
    worldId: a.worldId,
    actorId: a.actorId,
    id: stable('episode_receipt', a.worldId, r.id, a.id, input.eventId),
    requestId: r.id,
    episodeId: r.episodeId,
    attemptId: a.id,
    inputReceiptId: body.id,
    sourceEventId: input.eventId,
    worldVersion: committed.version,
    choice: selected?.choice ?? 'unassessed',
    reason: selected?.reason ?? null,
    sourceIds: selected?.sourceIds ?? [],
    presentedMessageIds: messageIds,
  };
  const prior = (
    await sql.query(
      `SELECT * FROM parallel_life.agent_episode_receipts
    WHERE world_id=$1 AND owner_id=$2 AND request_id=$3`,
      [a.worldId, owner, r.id],
    )
  ).rows[0];
  if (prior) {
    if (
      !isDeepStrictEqual(receipt(prior), value) ||
      r.status !== 'consumed' ||
      r.receiptId !== value.id
    )
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    return value;
  }
  epoch(w.epoch, a.engineEpoch);
  if (
    r.status !== 'pending' ||
    r.inputReceiptId !== null ||
    r.receiptId !== null ||
    w.version !== value.worldVersion ||
    body.expectedWorldVersion !== a.expectedWorldVersion
  )
    invalid();
  // SQL verifies the inherited commit GUC. This helper never sets or upgrades commit authority.
  await sql.query(
    `INSERT INTO parallel_life.agent_episode_receipts
    (world_id,owner_id,id,actor_id,request_id,episode_id,attempt_id,input_receipt_id,source_event_id,world_version,choice,reason,source_ids,presented_message_ids)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      a.worldId,
      owner,
      value.id,
      a.actorId,
      r.id,
      r.episodeId,
      a.id,
      body.id,
      input.eventId,
      value.worldVersion,
      value.choice,
      value.reason,
      JSON.stringify(value.sourceIds),
      JSON.stringify(messageIds),
    ],
  );
  await consumeEpisodeRequestInTransaction(sql, owner, r, value);
  if (value.choice === 'engage' && messageIds.length > 0) {
    const ep = (
      await sql.query(
        `SELECT document FROM parallel_life.shared_episodes
      WHERE world_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`,
        [a.worldId, owner, r.episodeId],
      )
    ).rows[0]?.document as SharedEpisode | undefined;
    if (
      !ep ||
      !['proposed', 'active'].includes(ep.status) ||
      ep.sourceEventIds.includes(input.eventId)
    )
      invalid();
    const next: SharedEpisode = {
      ...ep,
      revision: ep.revision + 1,
      status: 'active',
      sourceEventIds: [...ep.sourceEventIds, input.eventId],
    };
    const updated = await sql.query(
      `UPDATE parallel_life.shared_episodes SET document=$4
      WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND (document->>'revision')::integer=$5`,
      [a.worldId, owner, ep.id, next, ep.revision],
    );
    if (updated.rowCount !== 1) throw new DomainError('VERSION_CONFLICT');
  }
  return value;
}
