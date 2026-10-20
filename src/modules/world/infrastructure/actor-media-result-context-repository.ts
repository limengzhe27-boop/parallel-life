import { isAdmittedAgentCommitHead } from './agent-commit-version.ts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { taskCommandId, outboxRequestHash } from '../../tasks/infrastructure/postgres-outbox.ts';
import type {
  ActorMediaExecutionRef,
  ActorMediaResultContext,
  ActorMediaResultView,
} from '../domain/actor-media-result-context.ts';
import { DomainError } from '../domain/errors.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';

export type ActorMediaResultRead = {
  worldId: string;
  actorId: string;
  engineEpoch: number;
  worldVersion: number;
  limit?: number;
  /** Exact source reauthorization does not depend on a recent-result recall window. */
  requestIds?: readonly string[];
  /**
   * The private snapshot reader has already checked the world head in this transaction.
   * With no media rows there is nothing to authorize, so skip the second head read.
   */
  skipEmptyHeadCheck?: boolean;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** No new state/queue: exact source chain is re-read on each authorization, including forgotten evidence. */
export async function readActorMediaResultContextInTransaction(
  sql: SqlClient,
  owner: string,
  input: ActorMediaResultRead,
): Promise<ActorMediaResultView> {
  const limit = input.limit ?? 32;
  if (
    input.requestIds &&
    (!Array.isArray(input.requestIds) ||
      input.requestIds.length < 1 ||
      input.requestIds.length > 64 ||
      input.requestIds.some((id) => typeof id !== 'string' || !id || id.length > 240))
  )
    throw new DomainError('INVALID_COMMAND');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw new DomainError('INVALID_COMMAND');
  // Read the bounded result window first. Version/engine checks and the forget
  // snapshot are only needed when there is media evidence to authorize; with no
  // rows the caller gets an empty view without extra round trips.
  const rows = (
    await sql.query(
      `SELECT r.id,r.action_id,r.source_event_id,r.world_version,r.document,e.payload
 FROM parallel_life.agent_action_results r
 JOIN parallel_life.world_events e ON e.world_id=r.world_id AND e.owner_id=r.owner_id AND e.id=r.source_event_id AND e.version=r.world_version
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
 JOIN parallel_life.agent_attempts a ON a.world_id=e.world_id AND a.owner_id=e.owner_id AND (a.event_id=e.id OR (e.payload#>>'{data,stream,attemptId}'=a.id AND e.payload#>>'{data,stream,parentCommandId}'=a.command_id AND e.payload#>>'{data,stream,unit}'='media')) AND a.actor_id=r.actor_id AND a.status='committed' AND a.engine_epoch=$4
 WHERE r.world_id=$1 AND r.owner_id=$2 AND r.actor_id=$3 AND r.world_version<=$5 AND r.document->>'outcome'='succeeded'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.document->'outputRefs')='array' THEN r.document->'outputRefs' ELSE '[]'::jsonb END) ref WHERE ref->>'kind'='media' AND ($7::text[] IS NULL OR ref->>'id'=ANY($7::text[])))
 ORDER BY r.world_version DESC,r.id LIMIT $6`,
      [
        input.worldId,
        owner,
        input.actorId,
        input.engineEpoch,
        input.worldVersion,
        limit,
        input.requestIds ?? null,
      ],
    )
  ).rows;
  if (!rows.length && input.skipEmptyHeadCheck) return { completed: [], pending: [] };
  const world = (
    await sql.query(
      'SELECT w.version,w.state,c.engine_epoch FROM parallel_life.worlds w JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id WHERE w.id=$1 AND w.owner_id=$2',
      [input.worldId, owner],
    )
  ).rows[0];
  if (!world || !world.state.actors?.some((a: any) => a.id === input.actorId))
    throw new DomainError('NOT_FOUND');
  if (world.version !== input.worldVersion) {
    // Source visibility stays bounded by the original snapshot. A newer head
    // requires the shared commit admission or this attempt's committed prefix.
    const ownPrefix = await isAdmittedAgentCommitHead(
      sql,
      owner,
      input.worldId,
      input.actorId,
      input.worldVersion,
      world.version,
    );
    if (!ownPrefix) throw new DomainError('VERSION_CONFLICT');
  }
  if (input.engineEpoch < 2 || world.engine_epoch !== input.engineEpoch)
    throw new DomainError('INVALID_COMMAND');
  if (!rows.length) return { completed: [], pending: [] };
  const blocked = await forgottenAgentSourceIds(sql, owner, input.worldId, input.actorId);
  // Bounded batched reads: no database round trip per generated image on a chat snapshot.
  const requestIds = [
    ...new Set(
      rows.flatMap((r) =>
        Array.isArray(r.document.outputRefs)
          ? r.document.outputRefs
              .filter((v: any) => v.kind === 'media' && typeof v.id === 'string')
              .slice(0, 1)
              .map((v: any) => v.id)
          : [],
      ),
    ),
  ];
  const eventIds = [...new Set(rows.map((r) => String(r.source_event_id)))];
  const requestRows = (
    await sql.query(
      'SELECT id,document FROM parallel_life.world_media_requests WHERE world_id=$1 AND owner_id=$2 AND id=ANY($3::text[])',
      [input.worldId, owner, requestIds],
    )
  ).rows;
  const requests = new Map(requestRows.map((r) => [String(r.id), r.document]));
  const outboxRows = (
    await sql.query(
      "SELECT id,event_id,payload,status,provider_task_id FROM parallel_life.outbox_jobs WHERE world_id=$1 AND owner_id=$2 AND event_id=ANY($3::text[]) AND payload->>'requestId'=ANY($4::text[]) ORDER BY id",
      [input.worldId, owner, eventIds, requestIds],
    )
  ).rows;
  const taskRows = (
    await sql.query(
      "SELECT id,command_id,scope_id,status,result_version,attempts,lease_token,updated_at,input,request_hash FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=ANY($2::uuid[]) AND scope_kind='media' AND scope_id=ANY($3::text[])",
      [owner, outboxRows.map((r) => taskCommandId(String(r.id))), requestIds],
    )
  ).rows;
  const tasks = new Map(taskRows.map((r) => [String(r.command_id), r]));
  const assetIds = [
    ...new Set(
      requestRows.flatMap((r) =>
        typeof r.document.assetId === 'string' ? [r.document.assetId] : [],
      ),
    ),
  ];
  const assetRows = (
    await sql.query(
      "SELECT id,revision,mime_type,status,origin,created_at FROM parallel_life.assets WHERE id::text=ANY($1::text[]) AND owner_id=$2 AND world_id=$3 AND status='ready' AND origin='generated' AND revision=1",
      [assetIds, owner, input.worldId],
    )
  ).rows;
  const assets = new Map(assetRows.map((r) => [String(r.id), r]));
  const messageRows = (
    await sql.query(
      "SELECT id,document->>'sourceEventId' AS event_id FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND document->>'role'='assistant' AND (document->>'sourceEventId'=ANY($4::text[]) OR id=ANY($5::text[])) ORDER BY ordinal,id",
      [
        input.worldId,
        owner,
        input.actorId,
        eventIds,
        requestRows.flatMap((row) =>
          typeof row.document.replyMessageId === 'string' ? [row.document.replyMessageId] : [],
        ),
      ],
    )
  ).rows;
  const result: ActorMediaResultView = { completed: [], pending: [] };
  for (const row of rows) {
    const runtime = row.payload?.data?.agentRuntime;
    if (
      !Array.isArray(runtime?.proposal?.actions) ||
      !Array.isArray(runtime?.results) ||
      !Array.isArray(row.payload?.data?.effects) ||
      !Array.isArray(row.document.evidenceSourceIds)
    )
      continue;
    const action = runtime.proposal.actions.find((a: any) => a.id === row.action_id);
    const original = runtime.results.find((r: any) => r.id === row.id);
    if (
      !object(action) ||
      !isDeepStrictEqual(original, row.document) ||
      !['media.generate_image', 'media.generate_video'].includes(action.capability) ||
      runtime?.stateAfter?.actorId !== input.actorId
    )
      continue;
    const refs = row.document.outputRefs?.filter((r: any) => r.kind === 'media');
    if (!Array.isArray(refs) || refs.length !== 1 || typeof refs[0].id !== 'string') continue;
    const requestId = refs[0].id,
      mediaType = action.capability === 'media.generate_video' ? 'video' : 'image';
    const effect = row.payload.data.effects?.find(
      (e: any) => e.type === 'media.requested' && e.id === requestId,
    );
    if (
      !effect ||
      typeof effect.prompt !== 'string' ||
      effect.targetActorId !== input.actorId ||
      (effect.mediaType ?? 'image') !== mediaType ||
      !instant(row.document.at)
    )
      continue;
    const proofIds = [
      row.id,
      `action-result:${row.id}`,
      row.action_id,
      row.source_event_id,
      requestId,
      ...(row.document.evidenceSourceIds ?? []),
    ];
    if (proofIds.some((id) => blocked.has(id))) continue;
    const request = requests.get(requestId);
    if (
      !request ||
      request.id !== requestId ||
      request.sourceEventId !== row.source_event_id ||
      request.targetActorId !== input.actorId ||
      request.prompt !== effect.prompt ||
      (request.mediaType ?? 'image') !== mediaType
    )
      continue;
    const base: ActorMediaExecutionRef = {
      worldId: input.worldId,
      actorId: input.actorId,
      actionId: row.action_id,
      enqueueResultId: row.id,
      requestId,
      sourceEventId: row.source_event_id,
      sourceWorldVersion: row.world_version,
      requestedAtStory: row.document.at,
      mediaType,
    };
    const outboxes = outboxRows.filter(
      (o) => o.event_id === row.source_event_id && o.payload?.requestId === requestId,
    );
    let completed: ActorMediaResultContext | undefined;
    let externalStatus: string | undefined;
    for (const outbox of outboxes) {
      const p = outbox.payload;
      if (
        !object(p) ||
        p.id !== outbox.id ||
        p.eventId !== row.source_event_id ||
        p.worldId !== input.worldId ||
        p.requestId !== requestId ||
        p.prompt !== effect.prompt ||
        p.type !== (mediaType === 'video' ? 'video.generate' : 'image.generate') ||
        (p.targetActorId !== undefined && p.targetActorId !== input.actorId)
      )
        continue;
      // The original OutboxPayloadSchema strips extra fields in precisely this property order.
      const dispatched = {
        id: p.id,
        eventId: p.eventId,
        worldId: p.worldId,
        type: p.type,
        requestId: p.requestId,
        ...(p.prompt === undefined ? {} : { prompt: p.prompt }),
      };
      const task = tasks.get(taskCommandId(outbox.id));
      if (
        !task ||
        task.scope_id !== requestId ||
        task.request_hash !== outboxRequestHash(dispatched) ||
        !isDeepStrictEqual(task.input, { assetRequestId: requestId, prompt: p.prompt ?? '' })
      )
        continue;
      externalStatus = task.status;
      if (
        request.status !== 'ready' ||
        task.status !== 'succeeded' ||
        task.result_version !== 1 ||
        task.attempts < 1 ||
        !task.lease_token ||
        outbox.status !== 'succeeded' ||
        typeof request.assetId !== 'string' ||
        outbox.provider_task_id !== request.assetId
      )
        continue;
      const asset = assets.get(request.assetId);
      if (
        !asset ||
        (mediaType === 'video'
          ? asset.mime_type !== 'video/mp4'
          : !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime_type))
      )
        continue;
      const provenance = {
        taskId: String(task.id),
        taskResultVersion: Number(task.result_version),
        outboxId: String(outbox.id),
      };
      const assetRef = {
        id: String(asset.id),
        revision: Number(asset.revision),
        mimeType: String(asset.mime_type),
      };
      const id = `media-result:${digest([input.worldId, input.actorId, row.id, requestId, provenance, assetRef])}`;
      if (
        blocked.has(id) ||
        blocked.has(assetRef.id) ||
        blocked.has(provenance.taskId) ||
        blocked.has(provenance.outboxId)
      )
        continue;
      const messages = messageRows
        .filter(
          (m) =>
            m.event_id === row.source_event_id ||
            (m.id === request.replyMessageId && row.payload.data.stream?.replyMessageId === m.id),
        )
        .map((m) => String(m.id));
      const policy = request.deliveryDecision;
      if (policy !== undefined && !object(policy)) continue;
      const allowed = policy ? (policy.deliverToChat ?? policy.approved ?? true) : true;
      if (typeof allowed !== 'boolean') continue;
      completed = {
        ...base,
        id,
        phase: 'completed',
        asset: assetRef,
        provenance,
        completedAtReal: new Date(task.updated_at).toISOString(),
        source: {
          id,
          recordId: requestId,
          contentHash: digest([base, provenance, assetRef]),
          sourceEventId: row.source_event_id,
          sourceWorldVersion: row.world_version,
          sourceStoryAt: row.document.at,
        },
        chatProjection: {
          status: !allowed ? 'suppressed' : messages.length ? 'eligible' : 'no_message',
          messageIds: allowed ? messages : [],
        },
      };
      break;
    }
    if (completed) result.completed.push(completed);
    else
      result.pending.push({
        ...base,
        phase:
          request.status === 'ready'
            ? 'unverified_ready'
            : request.status === 'unknown' || externalStatus === 'unknown'
              ? 'unknown'
              : request.status === 'failed' || externalStatus === 'failed'
                ? 'failed'
                : 'queued',
      });
  }
  return result;
}
export class PostgresActorMediaResultContextRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  read(owner: string, input: ActorMediaResultRead) {
    return this.db.transaction(owner, (sql) =>
      readActorMediaResultContextInTransaction(sql, owner, input),
    );
  }
}

/** Source/ACK adapter can reauthorize a selected completion under its existing transaction. */
export async function requireActorMediaResultContextInTransaction(
  sql: SqlClient,
  owner: string,
  input: ActorMediaResultRead,
  expected: { id: string; contentHash: string; recordId?: string },
): Promise<ActorMediaResultContext> {
  const read = await readActorMediaResultContextInTransaction(sql, owner, {
    ...input,
    ...(expected.recordId ? { requestIds: [expected.recordId] } : {}),
  });
  const result = read.completed.find(
    (r) => r.id === expected.id && r.source.contentHash === expected.contentHash,
  );
  if (!result) throw new DomainError('VERSION_CONFLICT');
  return result;
}
