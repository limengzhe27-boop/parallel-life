import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentActionResult } from '../domain/agent-runtime.ts';
import type { Appointment } from '../domain/types.ts';
import { verifyEpisodeEvidence, type EpisodeEvidenceRecord } from '../domain/episode-evidence.ts';
import { readAgentJourneysInTransaction } from './agent-journey-repository.ts';

/** Actual committed sources only. Runs within the original writer's transaction, no model calls. */
export async function projectEpisodeEvidenceInTransaction(
  sql: SqlClient,
  owner: string,
  worldId: string,
  eventId: string,
): Promise<void> {
  const row = (
    await sql.query(
      `SELECT e.payload,c.engine_epoch FROM parallel_life.world_events e
    JOIN parallel_life.commands q ON q.world_id=e.world_id AND q.owner_id=e.owner_id AND q.id=e.command_id
      AND q.status='succeeded' AND q.result_event_id=e.id
    JOIN parallel_life.agent_runtime_worlds c ON c.world_id=e.world_id AND c.owner_id=e.owner_id
    WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3`,
      [worldId, owner, eventId],
    )
  ).rows[0];
  if (!row || row.engine_epoch < 2) throw Error('EPISODE_EVIDENCE_SOURCE_REQUIRED');
  const event = row.payload;
  const append = async (record: EpisodeEvidenceRecord | null) => {
    if (!record) return;
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          worldId,
          record.episodeId,
          record.actorId,
          eventId,
          record.kind,
          record.subject.id,
        ]),
      )
      .digest('hex');
    await sql.query(
      `INSERT INTO parallel_life.agent_episode_evidence
      (world_id,owner_id,id,episode_id,actor_id,engine_epoch,action_id,source_event_id,world_version,kind,subject_kind,subject_id,document)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [
        worldId,
        owner,
        id,
        record.episodeId,
        record.actorId,
        record.engineEpoch,
        record.actionId,
        eventId,
        record.worldVersion,
        record.kind,
        record.subject.kind,
        record.subject.id,
        record,
      ],
    );
    const stored = (
      await sql.query(
        'SELECT document FROM parallel_life.agent_episode_evidence WHERE world_id=$1 AND id=$2',
        [worldId, id],
      )
    ).rows[0]?.document;
    if (!isDeepStrictEqual(stored, JSON.parse(JSON.stringify(record))))
      throw Error('EPISODE_EVIDENCE_IDENTITY_CONFLICT');
  };
  const prior = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_episode_evidence WHERE world_id=$1 AND owner_id=$2 ORDER BY world_version,id',
      [worldId, owner],
    )
  ).rows.map((r) => r.document as EpisodeEvidenceRecord);
  const actions = event.data?.agentRuntime?.stateAfter?.actions ?? [];
  if (actions.length) {
    const results = (
      await sql.query(
        `SELECT r.document FROM parallel_life.agent_action_results r
      JOIN parallel_life.agent_attempts a ON a.world_id=r.world_id AND a.owner_id=r.owner_id
        AND a.actor_id=r.actor_id AND a.event_id=r.source_event_id AND a.status='committed' AND a.engine_epoch=$4
      WHERE r.world_id=$1 AND r.owner_id=$2 AND r.source_event_id=$3`,
        [worldId, owner, eventId, row.engine_epoch],
      )
    ).rows;
    const requests = (
      await sql.query(
        `SELECT id,input_receipt_id,episode_id,actor_id FROM parallel_life.agent_episode_requests
      WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND status='consumed'`,
        [worldId, owner, row.engine_epoch],
      )
    ).rows;
    for (const item of results) {
      const result = item.document as AgentActionResult;
      const action = actions.find((a: { id: string }) => a.id === result.actionId);
      if (!action || !['appointment.propose', 'travel.begin'].includes(action.capability)) continue;
      for (const request of requests.filter(
        (r) =>
          r.actor_id === result.actorId &&
          (action.sourceIds.includes('episode-intent:' + r.id) ||
            action.sourceIds.includes(r.input_receipt_id)),
      )) {
        for (const ref of result.outputRefs ?? []) {
          if (ref.kind !== 'appointment' && ref.kind !== 'journey') continue;
          await append(
            verifyEpisodeEvidence(
              {
                worldId,
                engineEpoch: row.engine_epoch,
                episodeId: request.episode_id,
                actorId: result.actorId,
                actionId: action.id,
                subject: { kind: ref.kind, id: ref.id },
              },
              { kind: 'action_result', capability: action.capability, result },
              prior.filter((p) => p.episodeId === request.episode_id),
            ),
          );
        }
      }
    }
  }
  if (event.type === 'invitation.responded') {
    for (const offered of prior.filter(
      (p) => p.kind === 'invitation_proposed' && p.subject.id === event.data.id,
    )) {
      // Recover the genuine before-appointment from the original successful creation command.
      const creation = (
        await sql.query(
          `SELECT e.payload FROM parallel_life.world_events e
        JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
          AND c.status='succeeded' AND c.result_event_id=e.id
        WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3`,
          [worldId, owner, offered.eventId],
        )
      ).rows[0];
      const effect = creation?.payload?.data?.effects?.find(
        (a: { type: string; id: string }) =>
          a.type === 'appointment.proposed' && a.id === offered.subject.id,
      );
      const before: Appointment | undefined = effect
        ? {
            id: effect.id,
            title: effect.title,
            at: effect.at,
            participantIds: effect.participantIds,
            status: 'proposed',
            sourceEventId: offered.eventId,
          }
        : undefined;
      if (!before) continue;
      const intervening = (
        await sql.query(
          `SELECT 1 FROM parallel_life.world_events
        WHERE world_id=$1 AND owner_id=$2 AND version>$3 AND version<$4
          AND payload->>'type'='invitation.responded' AND payload->'data'->>'id'=$5 LIMIT 1`,
          [worldId, owner, offered.worldVersion, event.version, offered.subject.id],
        )
      ).rows.length;
      if (intervening) continue;
      await append(
        verifyEpisodeEvidence(
          offered,
          { kind: 'invitation_response', event, beforeAppointment: before },
          prior.filter((p) => p.episodeId === offered.episodeId),
        ),
      );
    }
  }
  if (event.type === 'agent.arrival_committed') {
    const journeys = await readAgentJourneysInTransaction(sql, owner, {
      worldId,
      actorId: event.data.actorId,
    });
    const journey = journeys.find((j) => j.id === event.data.journeyId);
    if (journey)
      for (const started of prior.filter(
        (p) =>
          p.kind === 'travel_started' &&
          p.actorId === journey.actorId &&
          p.subject.id === journey.id,
      ))
        await append(
          verifyEpisodeEvidence(
            started,
            { kind: 'arrival', journey },
            prior.filter((p) => p.episodeId === started.episodeId),
          ),
        );
  }
}
