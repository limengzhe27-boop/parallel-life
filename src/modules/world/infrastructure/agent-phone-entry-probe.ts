import { readActorNarrativeObservationSourcesInTransaction } from './actor-narrative-observation-sources.ts';
import { readConsumedSceneObservationSourcesInTransaction } from './actor-observation-consumption-repository.ts';
import { collectPendingSceneObservationCandidates } from '../domain/actor-observation-candidate.ts';
import { readAgendaInitializeGrantsInTransaction } from './actor-agenda-initialization-repository.ts';
import { readDirectorNarrativeWakeInTransaction } from './narrative-wake-repository.ts';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { PublicOpeningStatus } from '../../../contracts/publication-opening.ts';
import {
  readDirectorBootstrapCauseInTransaction,
  readPendingEpisodeRequestsInTransaction,
} from './agent-narrative-repository.ts';
import {
  eligibleEpisodeDispatches,
  episodeDispatchAttempt,
} from './agent-episode-dispatch-eligibility.ts';
import { collectActorMediaResultCandidates } from '../application/agent-schedule-collectors.ts';
import { readActorMediaCompletionContextInTransaction } from './agent-source-resolver.ts';

/** Caller holds world then clock share locks; never writes/adopts/claims/calls a model. */
export async function readAgentPhoneEntryProbe(
  sql: SqlClient,
  ownerId: string,
  frame: { worldId: string; engineEpoch: number; worldVersion: number; storyAt: string },
): Promise<NonNullable<PublicOpeningStatus['continuation']>> {
  const ready = (kind: string, identity: string) => ({
    status: 'ready' as const,
    key: createHash('sha256')
      .update(
        JSON.stringify(['phone-continuation-v1', frame.worldId, frame.engineEpoch, kind, identity]),
      )
      .digest('hex'),
  });
  const row = (
    await sql.query(
      'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR SHARE',
      [frame.worldId, ownerId],
    )
  ).rows[0];
  const now = Date.now();
  // Wait for an actual activity acknowledgement, including fresh worlds without a clock row.
  if (
    !row ||
    row.paused ||
    !row.managed ||
    !row.active_until ||
    new Date(row.active_until).getTime() <= now
  )
    return { status: 'deferred' };
  const actors = (
    await sql.query(
      // Never select a.response: protected model responses are TOAST-heavy and this
      // probe runs under world/clock share locks on every entry. Only presence matters.
      `SELECT a.id,a.actor_id,a.command_id,a.status,a.sent_at,a.response_hash,(a.response IS NOT NULL) AS has_response,a.event_id,
    a.expected_world_version,a.expected_actor_revision,a.lease_until,r.document,s.revision,b.request_id AS bound_request_id
    FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts r
      ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
    LEFT JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.actor_id=a.actor_id
    LEFT JOIN parallel_life.agent_episode_attempt_bindings b ON b.world_id=a.world_id AND b.owner_id=a.owner_id AND b.attempt_id=a.id
    WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3 ORDER BY a.created_at,a.id`,
      [frame.worldId, ownerId, frame.engineEpoch],
    )
  ).rows;
  const raw = actors.find(
    (a) =>
      a.status === 'response_received' &&
      a.document.channel === 'private' &&
      a.expected_world_version === frame.worldVersion &&
      a.expected_actor_revision === a.revision &&
      new Date(a.lease_until).getTime() > now,
  );
  if (raw) return ready('npc_raw', raw.id);
  const blockedActors = new Set(
    actors
      .filter((a) =>
        ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(a.status),
      )
      .map((a) => String(a.actor_id)),
  );
  const states = () =>
    sql
      .query(
        'SELECT actor_id,document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
        [frame.worldId, ownerId],
      )
      .then((result) => result.rows);
  const pendingMedia = async (rows: { actor_id: string; document: any }[]) => {
    const candidates = [];
    for (const actor of rows) {
      if (blockedActors.has(String(actor.actor_id))) continue;
      // Full persistent action history is retained by the native kernel. No own
      // generation action means no possible G-authenticated external generation result.
      if (
        !(actor.document.actions ?? []).some((action: any) =>
          ['media.generate_image', 'media.generate_video'].includes(action.capability),
        )
      )
        continue;
      const packet = await readActorMediaCompletionContextInTransaction(sql, ownerId, {
        state: actor.document,
        worldVersion: frame.worldVersion,
        storyAt: frame.storyAt,
      });
      const own = await collectActorMediaResultCandidates({
        worldId: frame.worldId,
        actorId: String(actor.actor_id),
        engineEpoch: frame.engineEpoch,
        worldVersion: frame.worldVersion,
        actorRevision: actor.document.revision,
        storyAt: frame.storyAt,
        ...packet,
      });
      for (const candidate of own) {
        const attempted = actors.some((attempt) => {
          if (
            attempt.actor_id !== candidate.actorId ||
            attempt.document.origin !== 'wake' ||
            attempt.document.worldId !== frame.worldId ||
            attempt.document.recipientActorId !== candidate.actorId ||
            attempt.document.commandId !== attempt.command_id ||
            !(
              ['committed', 'invalid_output', 'stale_discarded'].includes(attempt.status) ||
              (attempt.status === 'cancelled_before_send' &&
                (attempt.sent_at || attempt.response_hash))
            )
          )
            return false;
          try {
            const input = JSON.parse(attempt.document.text);
            return input.type === 'npc_own_condition_ready' && input.candidateId === candidate.id;
          } catch {
            return false;
          }
        });
        if (!attempted) candidates.push(candidate.id);
      }
    }
    return candidates.sort();
  };
  const requests = await readPendingEpisodeRequestsInTransaction(sql, ownerId, {
    worldId: frame.worldId,
    engineEpoch: frame.engineEpoch,
  });
  const next = eligibleEpisodeDispatches(
    frame.worldId,
    frame.worldVersion,
    requests,
    actors.map(episodeDispatchAttempt),
  )[0];
  if (next) return ready('episode', next.commandId);
  // Do not freeze the world because another verified conversation is open.
  // This is a cheap original-scheduler hint, never permission to interrupt or execute.
  const knownHandoff = (
    await sql.query(
      `SELECT a.id FROM parallel_life.director_runtime_attempts a WHERE a.world_id=$1 AND a.owner_id=$2
     AND a.engine_epoch=$3 AND a.status='stale_discarded' AND a.response_hash IS NOT NULL
     AND a.snapshot->'authoredMaterials' IS NOT NULL AND a.snapshot->'nativeTurn' IS NULL
     AND NOT EXISTS(SELECT 1 FROM parallel_life.director_handoff_revalidations r
       WHERE r.world_id=a.world_id AND r.attempt_id=a.id) ORDER BY a.created_at,a.id LIMIT 1`,
      [frame.worldId, ownerId, frame.engineEpoch],
    )
  ).rows[0];
  // A hint grants one cheap validation, never a model retry or a message.
  if (knownHandoff) return ready('known_director_handoff', knownHandoff.id);
  const pendingDirectors = (
    await sql.query(
      `SELECT id,status,expected_world_version,lease_until FROM parallel_life.director_runtime_attempts
    WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3
      AND status IN ('reserved','request_sent','response_received','unknown_after_send') ORDER BY created_at,id`,
      [frame.worldId, ownerId, frame.engineEpoch],
    )
  ).rows;
  if (pendingDirectors.length) {
    const received = pendingDirectors.find(
      (a) =>
        a.status === 'response_received' &&
        a.expected_world_version === frame.worldVersion &&
        new Date(a.lease_until).getTime() > now,
    );
    if (received) return ready('director_raw', received.id);
    // A pending global decision owns only its coordination slot. Exact agenda grants
    // and stable plan intent may request one cheap original scheduler evaluation;
    // this probe never authorizes a model, executes a plan or retries the Director.
    const agenda = await readAgendaInitializeGrantsInTransaction(sql, ownerId, frame);
    const actorStates = await states();
    const media = await pendingMedia(actorStates);
    const plans = actorStates
      .filter((s) => !blockedActors.has(String(s.actor_id)))
      .flatMap((s) => {
        const state = s.document;
        return (state.plans ?? [])
          .filter(
            (p: any) =>
              ['active', 'waiting', 'blocked'].includes(p.status) &&
              (state.goals ?? []).some(
                (g: any) => g.id === p.goalId && ['active', 'deferred'].includes(g.status),
              ) &&
              (p.nextActionId || p.triggers?.length),
          )
          .map((p: any) => ({
            actorId: String(s.actor_id),
            plan: p,
            goal: (state.goals ?? []).find((g: any) => g.id === p.goalId),
            actions: (state.actions ?? []).filter(
              (a: any) => p.actionIds?.includes(a.id) || p.nextActionId === a.id,
            ),
          }));
      });
    return agenda.length || plans.length || media.length
      ? ready(
          'independent_scheduler_check',
          JSON.stringify({
            directors: pendingDirectors.map((d) => [d.id, d.status]),
            agenda: agenda.map((g) => g.candidateId).sort(),
            plans,
            ...(media.length ? { media } : {}),
          }),
        )
      : { status: 'pending' };
  }
  // A fact commit does not change last_tick_at. Give newly received information its
  // own stable entry identity; this is only a scheduler hint, never execution permission.
  const narrativeActors = (
    await sql.query(
      `SELECT s.actor_id,s.document FROM parallel_life.actor_agent_states s
     WHERE s.world_id=$1 AND s.owner_id=$2 AND EXISTS (
       SELECT 1 FROM parallel_life.actor_narrative_knowledge k
       WHERE k.world_id=s.world_id AND k.owner_id=s.owner_id AND k.actor_id=s.actor_id
       AND k.source_version<=$3)
     ORDER BY s.actor_id`,
      [frame.worldId, ownerId, frame.worldVersion],
    )
  ).rows;
  const narrativeCandidates: string[] = [];
  for (const actor of narrativeActors) {
    if (blockedActors.has(String(actor.actor_id))) continue;
    const packet = await readActorNarrativeObservationSourcesInTransaction(sql, ownerId, {
      ...frame,
      actorId: String(actor.actor_id),
    });
    if (!packet.sources.length) continue;
    const consumed = await readConsumedSceneObservationSourcesInTransaction(sql, ownerId, {
      ...frame,
      actorId: String(actor.actor_id),
    });
    const candidates = await collectPendingSceneObservationCandidates({
      ...frame,
      actorId: String(actor.actor_id),
      actorRevision: actor.document.revision,
      ...packet,
      consumed,
    });
    for (const candidate of candidates) {
      const attempted = actors.some((attempt) => {
        if (
          attempt.actor_id !== candidate.actorId ||
          attempt.document.origin !== 'wake' ||
          attempt.document.worldId !== frame.worldId ||
          attempt.document.recipientActorId !== candidate.actorId ||
          attempt.document.commandId !== attempt.command_id ||
          !(
            ['committed', 'invalid_output', 'stale_discarded'].includes(attempt.status) ||
            (attempt.status === 'cancelled_before_send' &&
              (attempt.sent_at ||
                attempt.response_hash ||
                attempt.has_response ||
                attempt.event_id))
          )
        )
          return false;
        try {
          const input = JSON.parse(attempt.document.text);
          return input.type === 'npc_own_condition_ready' && input.candidateId === candidate.id;
        } catch {
          return false;
        }
      });
      if (!attempted) narrativeCandidates.push(candidate.id);
    }
  }
  if (narrativeCandidates.length)
    return ready('own_narrative_information', narrativeCandidates.sort().join('|'));
  const bootstrap = await readDirectorBootstrapCauseInTransaction(sql, ownerId, frame);
  if (bootstrap) return ready('bootstrap', bootstrap.id);
  // Existing saves resume eligible, still-unreviewed author material through the same scheduler.
  // This is not genesis replay: original history, paid-context suppression and focus remain authoritative.
  const wake = await readDirectorNarrativeWakeInTransaction(sql, ownerId, frame);
  if (wake.cause && !wake.deferred && !wake.hasPendingDirector)
    return ready('narrative', wake.cause.id);
  const agenda = await readAgendaInitializeGrantsInTransaction(sql, ownerId, frame);
  if (agenda.length)
    return ready(
      'agenda_initialize',
      agenda
        .map((g) => g.candidateId)
        .sort()
        .join('|'),
    );
  const media = await pendingMedia(await states());
  if (media.length) return ready('own_media_completion', media.join('|'));
  // Grants only a cheap original scheduler evaluation once per foreground entry, never a model cause.
  // Due plans/arrivals and paid-context guards remain authoritative inside advanceIfEnabled.
  return row.continuity_mode === 'continuous' && !wake.hasPendingDirector
    ? ready('continuity', String(row.last_tick_at))
    : { status: 'quiet' };
}
