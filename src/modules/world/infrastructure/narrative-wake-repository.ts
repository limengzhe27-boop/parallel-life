import { hasPendingEpisodeWork } from './episode-pending-work-repository.ts';
import { admitDirectorOpportunity } from '../domain/director-opportunity-admission.ts';
import { readOpeningContextAuthority } from './opening-context-repository.ts';
import { isVerifiedDirectorPreflightRejection } from './director-preflight-evidence.ts';
import { validDirectorAuthoredAssessments } from '../domain/director-runtime.ts';
import { readOpeningReviewEvidence } from './authored-opening-context-evidence.ts';
import { storedClockStopped } from './clock-activity-repository.ts';
import { authoredReconsiderationEvidence } from '../domain/authored-reconsideration.ts';
import { readAuthoredReconsiderationEvidence } from './authored-reconsideration-evidence.ts';
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
  allowAttemptId?: string,
  readOpening?: () => ReturnType<typeof readOpeningContextAuthority>,
): Promise<{
  cause: DirectorEvaluationCause | null;
  hasPendingDirector: boolean;
  deferred: boolean;
}> {
  // This existing reader authenticates caller/owner/epoch/version and immutable admission hash.
  const bootstrap = await readDirectorBootstrapCauseInTransaction(sql, ownerId, input);
  const attempts = (
    await sql.query(
      // The director response is not read here; selecting it would pull every
      // protected TOAST payload on the entry path for a field this reader never uses.
      `SELECT a.id,a.status,a.sent_at,a.snapshot,a.response_hash,a.decision_id,d.id actual_decision_id,d.document actual_decision
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
  const admission = (
    await sql.query(
      `SELECT a.genesis_hash,a.admitted_at_version FROM parallel_life.agent_narrative_admissions a
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3`,
      [input.worldId, ownerId, input.engineEpoch],
    )
  ).rows[0];
  // No read-side adoption, including epoch2 saves created before explicit admission.
  if (!admission) return { cause: null, hasPendingDirector, deferred: false };
  const clock = (
    await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2', [
      input.worldId,
      ownerId,
    ])
  ).rows[0];
  if (clock && storedClockStopped(clock, new Date().toISOString()))
    return { cause: null, hasPendingDirector, deferred: true };
  const attention = await readWorldAttentionInTransaction(sql, ownerId, {
    worldId: input.worldId,
    worldVersion: input.worldVersion,
  });
  // Authenticated conversation focus is carried into the Director snapshot for pacing.
  // It does not freeze other actors or turn pending author material into an interruption.
  if (attention.conversationWithoutTarget)
    return { cause: null, hasPendingDirector, deferred: true };
  if (bootstrap) return { cause: bootstrap, hasPendingDirector, deferred: false };
  const view = prepared ?? (await readAuthoredEligibilityInTransaction(sql, ownerId, input));
  if (
    view.catalog.world.worldId !== input.worldId ||
    view.catalog.world.engineEpoch !== input.engineEpoch ||
    view.catalog.world.worldVersion !== input.worldVersion
  )
    throw new DomainError('VERSION_CONFLICT');
  if (!view.catalog.source) return { cause: null, hasPendingDirector, deferred: false };
  const informationAuthority = await (readOpening
    ? readOpening()
    : readOpeningContextAuthority(sql, ownerId, input, { view, allowAttemptId }));
  if (informationAuthority)
    return {
      cause: {
        id: `opening-context:${informationAuthority.reviewKey}`,
        kind: 'opening_context',
        genesisHash: admission.genesis_hash,
        admittedAtVersion: admission.admitted_at_version,
        reviewKey: informationAuthority.reviewKey,
      },
      hasPendingDirector,
      deferred: false,
    };
  const occupied = new Set(view.occupiedEventKeys);
  const qualifications: AuthoredWakeQualification[] = view.eligibility
    .filter((e) => e.status === 'eligible' && !occupied.has(e.ref.nodeKey))
    .map((e) => ({
      nodeKey: e.ref.nodeKey,
      nodeHash: e.ref.nodeHash,
      qualificationKey: e.qualificationKey,
    }));
  const semanticReasons = await readAuthoredReconsiderationEvidence(
    sql,
    ownerId,
    input.worldId,
    input.worldVersion,
  );
  const evidenceFor = (q: AuthoredWakeQualification, through: number) => {
    const material = view.catalog.materials.find((m) => m.ref.nodeKey === q.nodeKey);
    const actorIds =
      material?.participantRefs.flatMap((a) =>
        a.status === 'resolved' && a.actorId ? [a.actorId] : [],
      ) ?? [];
    const placeIds =
      material?.placeRefs.flatMap((p) =>
        p.status === 'resolved' && p.placeId && p.availableInWorld ? [p.placeId] : [],
      ) ?? [];
    return authoredReconsiderationEvidence(actorIds, semanticReasons, through, placeIds);
  };
  const openingKey = view.catalog.openingEventKey;
  const opening = view.catalog.materials.find((m) => m.ref.nodeKey === openingKey);
  const openingEvidence = openingKey
    ? await readOpeningReviewEvidence(
        sql,
        ownerId,
        input.worldId,
        input.engineEpoch,
        input.worldVersion,
        opening?.participantRefs.flatMap((r) =>
          r.status === 'resolved' && r.actorId ? [r.actorId] : [],
        ) ?? [],
      )
    : [];
  const speechFor = (q: AuthoredWakeQualification, through: number) => {
    const actors = new Set(
      view.catalog.materials
        .find((m) => m.ref.nodeKey === q.nodeKey)
        ?.participantRefs.flatMap((r) =>
          r.status === 'resolved' && r.actorId ? [r.actorId] : [],
        ) ?? [],
    );
    return openingEvidence
      .filter((e) => e.worldVersion <= through && actors.has(e.actorId))
      .map((e) => e.sourceId);
  };
  const contextToken = (q: AuthoredWakeQualification, through: number) =>
    JSON.stringify([
      token(q),
      evidenceFor(q, through),
      ...(speechFor(q, input.worldVersion).length
        ? [{ openingSpeech: speechFor(q, through) }]
        : []),
    ]);
  // A paid assessment fences this evidence context, never completes the author event.
  const paidReviewContexts = new Set<string>();
  const lastAssessedVersion = new Map<string, number>();
  const paidFrames = attempts.filter(
    (a) =>
      (a.status === 'committed' || a.sent_at !== null) &&
      !isVerifiedDirectorPreflightRejection(a) &&
      a.snapshot?.authoredMaterials?.source?.sourceHash === view.catalog.source!.sourceHash,
  );
  // Revalidating a claimed window must retain its predecessor. Its own in-flight
  // assessment is neither a new predecessor nor evidence that the window vanished.
  const latestPaid = paidFrames.filter((a) => a.id !== allowAttemptId).at(-1);
  for (const a of attempts) {
    if (a.status === 'committed' && !a.actual_decision_id)
      throw new DomainError('INVALID_PROPOSAL', 'DIRECTOR_DECISION_RECEIPT_MISSING');
    const suppress =
      a.status === 'committed' ||
      (a.sent_at !== null &&
        ['invalid_output', 'stale_discarded'].includes(a.status) &&
        !isVerifiedDirectorPreflightRejection(a));
    if (
      !suppress ||
      a.snapshot?.authoredMaterials?.source?.sourceHash !== view.catalog.source.sourceHash
    )
      continue;
    const snapshotEntries = a.snapshot.deliberationWindow
      ? a.snapshot.authoredEligibility?.filter((q: AuthoredWakeQualification) =>
          a.snapshot.deliberationWindow.nodeKeys.includes(q.nodeKey),
        )
      : a.snapshot.authoredEligibility;
    if (!Array.isArray(snapshotEntries)) continue;
    // New decisions explicitly say which authored nodes were assessed. A saved
    // catalogue alone is not an assessment. Historical paid frames and received
    // failures retain their old paid fence; this is never retry permission.
    const explicit =
      a.status === 'committed' && Object.hasOwn(a.actual_decision ?? {}, 'authoredAssessments');
    if (explicit && !validDirectorAuthoredAssessments(a.snapshot, a.actual_decision))
      throw new DomainError('INVALID_PROPOSAL', 'DIRECTOR_AUTHORED_ASSESSMENT_INVALID');
    const entries = explicit
      ? snapshotEntries.filter((q: AuthoredWakeQualification) =>
          a.actual_decision.authoredAssessments.some(
            (review: AuthoredWakeQualification) =>
              review.nodeKey === q.nodeKey &&
              review.nodeHash === q.nodeHash &&
              review.qualificationKey === q.qualificationKey,
          ),
        )
      : snapshotEntries;
    const previousOccupied = new Set<string>(a.snapshot.occupiedAuthoredEventKeys ?? []);
    for (const q of entries)
      if (q.status === 'eligible' && !previousOccupied.has(q.nodeKey)) {
        paidReviewContexts.add(contextToken(q, a.snapshot.worldVersion));
        lastAssessedVersion.set(
          token(q),
          Math.max(lastAssessedVersion.get(token(q)) ?? -1, a.snapshot.worldVersion),
        );
      }
  }
  let unseen = qualifications
    .filter((q) => !paidReviewContexts.has(contextToken(q, input.worldVersion)))
    .sort((a, b) => (token(a) < token(b) ? -1 : token(a) > token(b) ? 1 : 0));

  if (latestPaid && unseen.length) {
    const load = (
      await sql.query(
        `SELECT
       COALESCE((SELECT jsonb_agg(ep.document) FROM parallel_life.shared_episodes ep WHERE ep.world_id=$1 AND ep.owner_id=$2),'[]'::jsonb) episodes,
       EXISTS(SELECT 1 FROM parallel_life.actor_agent_states s WHERE s.world_id=$1 AND s.owner_id=$2 AND (
         EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'questions','[]'::jsonb)) q WHERE q->>'status'='open') OR
         EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'responsibilities','[]'::jsonb)) r WHERE r->>'status' IN ('open','waiting')))) pending_player_work`,
        [input.worldId, ownerId],
      )
    ).rows[0];
    const episodes = load?.episodes ?? [];
    const terminal = (e: { status: string }) => ['resolved', 'withdrawn'].includes(e.status);
    const previousEpisodes = latestPaid.snapshot.episodes ?? [];
    const released = episodes.some(
      (e: { id: string; status: string }) =>
        terminal(e) &&
        !previousEpisodes.some((p: { id: string; status: string }) => p.id === e.id && terminal(p)),
    );
    const outstanding =
      (await hasPendingEpisodeWork(sql, ownerId, input.worldId, input.engineEpoch)) ||
      !!load?.pending_player_work ||
      episodes.some((e: { status: string }) => ['proposed', 'active'].includes(e.status));
    unseen = unseen.filter((q) => {
      const assessedAt = lastAssessedVersion.get(token(q));
      const baseline = assessedAt ?? latestPaid.snapshot.worldVersion;
      const oldEvidence = new Set(evidenceFor(q, baseline));
      const newEvidence = evidenceFor(q, input.worldVersion).filter((id) => !oldEvidence.has(id));
      const newSpeech = speechFor(q, input.worldVersion).some(
        (id) => !speechFor(q, baseline).includes(id),
      );
      const independent =
        newSpeech ||
        semanticReasons.some((r) => newEvidence.includes(r.id) && r.kind !== 'plan_changed');
      return admitDirectorOpportunity({
        previouslyAssessed: assessedAt !== undefined,
        hasPriorPaidAssessment: true,
        hasOutstandingWork: outstanding,
        hasRelatedNewEvidence: newSpeech || newEvidence.length > 0,
        hasIndependentNewEvidence: independent,
        hasNewlyReleasedEpisode: released,
        hasNewlyQualifiedEpisode: latestPaid.snapshot.authoredEligibility?.some(
          (previous: AuthoredWakeQualification & { status?: string }) =>
            previous.nodeKey === q.nodeKey &&
            previous.nodeHash === q.nodeHash &&
            previous.status !== undefined &&
            previous.status !== 'eligible',
        ),
        hasConfirmedQuietPredecessor:
          !attempts.some(
            (a) =>
              a.id !== allowAttemptId &&
              ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(
                a.status,
              ),
          ) &&
          latestPaid.status === 'committed' &&
          !!latestPaid.actual_decision_id &&
          latestPaid.actual_decision?.mode === 'quiet' &&
          Array.isArray(latestPaid.actual_decision.authoredAssessments) &&
          latestPaid.actual_decision.authoredAssessments.length > 0,
      });
    });
  }
  if (!unseen.length) return { cause: null, hasPendingDirector, deferred: false };
  // Only confirmed zero-send cancellations can change retry identity. No paid/unknown retry.
  const unseenTokens = new Set(unseen.map(token));
  const preSendCancellations = attempts
    .filter(
      (a) =>
        ((a.sent_at === null && ['cancelled_before_send', 'stale_discarded'].includes(a.status)) ||
          isVerifiedDirectorPreflightRejection(a)) &&
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
          ...(unseen.some((q) => speechFor(q, input.worldVersion).length)
            ? [{ openingSpeech: unseen.map((q) => speechFor(q, input.worldVersion)) }]
            : []),
          ...(unseen.some((q) => evidenceFor(q, input.worldVersion).length)
            ? [{ semanticEvidence: unseen.map((q) => evidenceFor(q, input.worldVersion)) }]
            : []),
          preSendCancellations,
        ]),
      )
      .digest('hex');
  return {
    cause: {
      id,
      kind: 'authored_eligibility',
      genesisHash: admission.genesis_hash,
      admittedAtVersion: admission.admitted_at_version,
      qualifications: unseen,
    },
    hasPendingDirector,
    deferred: false,
  };
}
