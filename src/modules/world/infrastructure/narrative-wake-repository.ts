import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type {
  DirectorEvaluationCause,
  AuthoredWakeQualification,
} from '../domain/agent-narrative.ts';
import { DomainError } from '../domain/errors.ts';
import { readDirectorBootstrapCauseInTransaction } from './agent-narrative-repository.ts';
import {
  readAuthoredEligibilityInTransaction,
  type AuthoredEligibilityView,
} from './authored-event-eligibility-repository.ts';
import { readWorldAttentionInTransaction } from './world-attention-repository.ts';

const token = (q: AuthoredWakeQualification) =>
  JSON.stringify([q.nodeKey, q.nodeHash, q.qualificationKey]);
/** Read source-qualified semantic changes; seconds, unrelated versions and silence are not new causes. */
export async function readDirectorNarrativeWakeInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: { worldId: string; engineEpoch: number; worldVersion: number; storyAt: string },
  prepared?: AuthoredEligibilityView,
): Promise<{
  cause: DirectorEvaluationCause | null;
  hasPendingDirector: boolean;
  deferred: boolean;
}> {
  // This existing reader authenticates caller/owner/epoch/version and immutable admission hash.
  const bootstrap = await readDirectorBootstrapCauseInTransaction(sql, ownerId, input);
  const attempts = (
    await sql.query(
      `SELECT a.id,a.status,a.sent_at,a.snapshot,d.id actual_decision_id
     FROM parallel_life.director_runtime_attempts a
     LEFT JOIN parallel_life.director_decisions d ON d.world_id=a.world_id AND d.owner_id=a.owner_id
       AND d.id=a.decision_id AND d.input_hash=a.input_hash AND d.attempt_id=a.id
       AND d.engine_epoch=a.engine_epoch AND d.world_version=a.expected_world_version
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3 ORDER BY a.created_at,a.id`,
      [input.worldId, ownerId, input.engineEpoch],
    )
  ).rows;
  const hasPendingDirector = attempts.some((a) =>
    ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(a.status),
  );
  if (bootstrap) return { cause: bootstrap, hasPendingDirector, deferred: false };
  const admission = (
    await sql.query(
      `SELECT a.genesis_hash FROM parallel_life.agent_narrative_admissions a
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3`,
      [input.worldId, ownerId, input.engineEpoch],
    )
  ).rows[0];
  // No read-side adoption, including epoch2 saves created before explicit admission.
  if (!admission) return { cause: null, hasPendingDirector, deferred: false };
  const clock = (
    await sql.query(
      'SELECT paused,managed,active_until FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2',
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (
    clock &&
    (clock.paused ||
      (clock.managed &&
        (!clock.active_until || new Date(clock.active_until).getTime() <= Date.now())))
  )
    return { cause: null, hasPendingDirector, deferred: true };
  const attention = await readWorldAttentionInTransaction(sql, ownerId, {
    worldId: input.worldId,
    worldVersion: input.worldVersion,
  });
  if (attention.conversationWithoutTarget || attention.focus.length)
    return { cause: null, hasPendingDirector, deferred: true };
  const view = prepared ?? (await readAuthoredEligibilityInTransaction(sql, ownerId, input));
  if (
    view.catalog.world.worldId !== input.worldId ||
    view.catalog.world.engineEpoch !== input.engineEpoch ||
    view.catalog.world.worldVersion !== input.worldVersion
  )
    throw new DomainError('VERSION_CONFLICT');
  if (!view.catalog.source) return { cause: null, hasPendingDirector, deferred: false };
  const occupied = new Set(view.occupiedEventKeys);
  const qualifications: AuthoredWakeQualification[] = view.eligibility
    .filter((e) => e.status === 'eligible' && !occupied.has(e.ref.nodeKey))
    .map((e) => ({
      nodeKey: e.ref.nodeKey,
      nodeHash: e.ref.nodeHash,
      qualificationKey: e.qualificationKey,
    }));
  const alreadyAttempted = new Set<string>();
  for (const a of attempts) {
    if (a.status === 'committed' && !a.actual_decision_id)
      throw new DomainError('INVALID_PROPOSAL', 'DIRECTOR_DECISION_RECEIPT_MISSING');
    const suppress =
      a.status === 'committed' ||
      (a.sent_at !== null && ['invalid_output', 'stale_discarded'].includes(a.status));
    if (
      !suppress ||
      a.snapshot?.authoredMaterials?.source?.sourceHash !== view.catalog.source.sourceHash
    )
      continue;
    const entries = a.snapshot.authoredEligibility;
    if (!Array.isArray(entries)) continue;
    const previousOccupied = new Set<string>(a.snapshot.occupiedAuthoredEventKeys ?? []);
    for (const q of entries)
      if (q.status === 'eligible' && !previousOccupied.has(q.nodeKey))
        alreadyAttempted.add(token(q));
  }
  const unseen = qualifications
    .filter((q) => !alreadyAttempted.has(token(q)))
    .sort((a, b) => (token(a) < token(b) ? -1 : token(a) > token(b) ? 1 : 0));
  if (!unseen.length) return { cause: null, hasPendingDirector, deferred: false };
  // Only confirmed zero-send cancellations can change retry identity. No paid/unknown retry.
  const unseenTokens = new Set(unseen.map(token));
  const preSendCancellations = attempts
    .filter(
      (a) =>
        a.sent_at === null &&
        ['cancelled_before_send', 'stale_discarded'].includes(a.status) &&
        a.snapshot?.authoredMaterials?.source?.sourceHash === view.catalog.source!.sourceHash &&
        a.snapshot?.evaluationCause?.kind === 'authored_eligibility' &&
        a.snapshot.evaluationCause.qualifications.some((q: AuthoredWakeQualification) =>
          unseenTokens.has(token(q)),
        ),
    )
    .map((a) => a.id)
    .sort();
  const id =
    'authored_eligibility:' +
    createHash('sha256')
      .update(
        JSON.stringify([
          input.worldId,
          input.engineEpoch,
          admission.genesis_hash,
          view.catalog.source.sourceHash,
          unseen,
          preSendCancellations,
        ]),
      )
      .digest('hex');
  return {
    cause: {
      id,
      kind: 'authored_eligibility',
      genesisHash: admission.genesis_hash,
      admittedAtVersion: 0,
      qualifications: unseen,
    },
    hasPendingDirector,
    deferred: false,
  };
}
