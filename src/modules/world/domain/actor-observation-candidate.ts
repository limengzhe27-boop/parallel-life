import type { AgentCandidate, AgentSource } from './agent-runtime.ts';

/** Produced only by the owner/actor/epoch-scoped committed-consumption reader. */
export type ConsumedSceneObservationSource = { sourceId: string; contentHash: string };
export type ActorObservationCandidateInput = {
  worldId: string;
  actorId: string;
  engineEpoch: number;
  worldVersion: number;
  actorRevision: number;
  storyAt: string;
  /** Already source-authorized, visible observation packets; not a list copied from a model. */
  sources: readonly AgentSource[];
  /** Required to distinguish full private recall from a generic private strategy placeholder. */
  observations?: readonly { sourceId: string; text: string; evidenceKind?: string }[];
  consumed: readonly ConsumedSceneObservationSource[];
};

const digest = /^[a-f0-9]{64}$/;
const key = (value: string) => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(value);
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
const invalid = (): never => {
  throw Object.assign(Error('ACTOR_OBSERVATION_CANDIDATE_INVALID'), {
    code: 'ACTOR_OBSERVATION_CANDIDATE_INVALID',
  });
};

/**
 * Pure candidate construction, not a new scheduler or an execution/payment grant. No actor
 * projected-version heuristic: same-commit observations can remain pending until truly supplied.
 * These are private self-reconsideration candidates, never disclosure to another group or scene.
 */
export async function collectPendingSceneObservationCandidates(
  input: ActorObservationCandidateInput,
): Promise<AgentCandidate[]> {
  if (
    !key(input.worldId) ||
    !key(input.actorId) ||
    !integer(input.engineEpoch) ||
    input.engineEpoch < 2 ||
    !integer(input.worldVersion) ||
    !integer(input.actorRevision) ||
    !Number.isFinite(Date.parse(input.storyAt))
  )
    invalid();
  const consumed = new Set<string>();
  for (const ref of input.consumed) {
    if (!key(ref.sourceId) || !digest.test(ref.contentHash)) invalid();
    consumed.add(JSON.stringify([ref.sourceId, ref.contentHash]));
  }
  const visible = new Map<string, AgentSource>();
  for (const source of input.sources) {
    if (source.kind !== 'scene_entry' && source.kind !== 'group_message') continue;
    if (source.kind === 'group_message' && source.usage !== 'private_strategy') continue;
    if (
      source.usage === 'private_strategy' &&
      !input.observations?.some(
        (observation) =>
          observation.sourceId === source.id &&
          !!observation.text.trim() &&
          ['scene_record', 'adjudicated_result', 'player_report', 'actor_report'].includes(
            observation.evidenceKind ?? '',
          ),
      )
    )
      continue;
    if (
      !key(source.recordId) ||
      source.id !== (source.kind === 'scene_entry' ? 'scene:' : 'group:') + source.recordId ||
      !source.contentHash ||
      !digest.test(source.contentHash) ||
      !integer(source.worldVersion) ||
      source.worldVersion > input.worldVersion ||
      !Number.isFinite(Date.parse(source.at)) ||
      Date.parse(source.at) > Date.parse(input.storyAt)
    )
      invalid();
    const previous = visible.get(source.id);
    if (previous && previous.contentHash !== source.contentHash) invalid();
    visible.set(source.id, source);
  }
  const candidates: AgentCandidate[] = [];
  for (const source of [...visible.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (consumed.has(JSON.stringify([source.id, source.contentHash]))) continue;
    const identity = JSON.stringify([
      source.kind === 'scene_entry' ? 'scene-observation-v1' : 'group-observation-v1',
      input.worldId,
      input.actorId,
      input.engineEpoch,
      source.id,
      source.contentHash,
    ]);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const fingerprint = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    candidates.push({
      id: 'observation:' + fingerprint,
      worldId: input.worldId,
      actorId: input.actorId,
      source: 'observation',
      episodeId: null,
      actionId: null,
      resourceIds: [],
      channel: 'private',
      threadId: input.actorId,
      sourceIds: [source.id],
      expectedWorldVersion: input.worldVersion,
      expectedActorRevision: input.actorRevision,
      priority: 40,
      reason:
        '本人有尚未实际评估的获准观察来源；可重考自己的安排或保持安静，不推定他人知情、位置或整段事件完成。',
      requiresCoordination: false,
    });
  }
  return candidates;
}
