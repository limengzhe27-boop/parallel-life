import { createHash } from 'node:crypto';
import type { AgentEpisodeRequest } from '../domain/agent-narrative.ts';
import { DomainError } from '../domain/errors.ts';

export type EpisodeDispatchAttempt = {
  actorId: string;
  commandId: string;
  status: string;
  paid: boolean;
  playerManifest?: boolean;
  requestId: string | null;
};
export function episodeDispatchAttempt(row: {
  bound_request_id?: string | null;
  actor_id: string;
  command_id: string;
  status: string;
  sent_at: unknown;
  response_hash: unknown;
  document: { origin: string; text: string };
}): EpisodeDispatchAttempt {
  let requestId: string | null = row.bound_request_id ?? null;
  if (!requestId && row.document.origin === 'coordination') {
    try {
      const intent = JSON.parse(row.document.text);
      if (intent.type === 'npc_episode_consideration' && typeof intent.requestId === 'string')
        requestId = intent.requestId;
    } catch {
      // A different coordination input grants no episode authority.
    }
  }
  return {
    actorId: row.actor_id,
    ...(row.bound_request_id ? { playerManifest: true } : {}),
    commandId: row.command_id,
    status: row.status,
    paid: row.sent_at != null || row.response_hash != null,
    requestId,
  };
}

/** Transport failure is not pending executable work, nor a new payment grant. */
export function episodeRequestWorkState(
  requestId: string,
  attempts: readonly EpisodeDispatchAttempt[],
): 'available' | 'in_flight' | 'paid_terminal' {
  const prior = attempts.filter((a) => a.requestId === requestId);
  if (prior.some((a) => a.status === 'committed' && !a.playerManifest))
    throw new DomainError('INVALID_PROPOSAL', 'EPISODE_CONSUMPTION_RECEIPT_MISSING');
  if (
    prior.some((a) =>
      ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(a.status),
    )
  )
    return 'in_flight';
  return prior.some((a) => a.paid) ? 'paid_terminal' : 'available';
}

/** One eligibility calculation for dispatch and the read-only phone hint. No claim or execution. */
export function eligibleEpisodeDispatches(
  worldId: string,
  worldVersion: number,
  requests: readonly AgentEpisodeRequest[],
  attempts: readonly EpisodeDispatchAttempt[],
  options?: { freshCommand?: string; allowKnownInvalid?: boolean },
) {
  return requests.flatMap((request) => {
    const prior = attempts.filter((a) => a.requestId === request.id);
    const state = episodeRequestWorkState(request.id, attempts);
    // A known invalid response has no committed effect. Only an explicit owner
    // dispatch may buy a fresh evaluation; automatic workers still see it fenced.
    const retired = prior.filter((a) => a.status === 'invalid_output' && a.paid);
    const freshKnownInvalid =
      options?.allowKnownInvalid === true &&
      !!options.freshCommand &&
      retired.length > 0 &&
      prior.every(
        (a) =>
          (a.status === 'invalid_output' && a.paid) ||
          (!a.paid && ['stale_discarded', 'cancelled_before_send'].includes(a.status)),
      );
    if (state !== 'available' && !freshKnownInvalid) return [];
    if (
      attempts.some(
        (a) =>
          a.actorId === request.actorId &&
          ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(
            a.status,
          ),
      )
    )
      return [];
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          'npc-episode-evaluation-v2',
          worldId,
          request.id,
          worldVersion,
          prior.filter((a) => a.status === 'cancelled_before_send' && !a.paid).length,
          ...(freshKnownInvalid ? [options!.freshCommand] : []),
        ]),
      )
      .digest('hex');
    const commandId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    if (prior.some((a) => a.commandId === commandId)) return [];
    return [
      {
        request,
        commandId,
        ...(freshKnownInvalid ? { retiredCommandId: retired[0]!.commandId } : {}),
      },
    ];
  });
}
