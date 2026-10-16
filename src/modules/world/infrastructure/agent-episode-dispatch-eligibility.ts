import { createHash } from 'node:crypto';
import type { AgentEpisodeRequest } from '../domain/agent-narrative.ts';
import type { WorldAttention } from './world-attention-repository.ts';
import { episodeAttentionAllows } from './agent-episode-attention.ts';
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

/** One eligibility calculation for dispatch and the read-only phone hint. No claim or execution. */
export function eligibleEpisodeDispatches(
  worldId: string,
  worldVersion: number,
  requests: readonly AgentEpisodeRequest[],
  attention: WorldAttention,
  attempts: readonly EpisodeDispatchAttempt[],
) {
  return requests.flatMap((request) => {
    if (!episodeAttentionAllows(attention, request.actorId)) return [];
    const prior = attempts.filter((a) => a.requestId === request.id);
    if (prior.some((a) => a.status === 'committed' && !a.playerManifest))
      throw new DomainError('INVALID_PROPOSAL', 'EPISODE_CONSUMPTION_RECEIPT_MISSING');
    if (prior.some((a) => a.paid)) return [];
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
        ]),
      )
      .digest('hex');
    const commandId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return prior.some((a) => a.commandId === commandId) ? [] : [{ request, commandId }];
  });
}
