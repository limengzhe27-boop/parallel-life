/** The caller authenticates the latest attempt for the same semantic candidate. */
export type AgentWakeRecoveryPrior = {
  id: string;
  commandId: string;
  status: string;
  paid: boolean;
  sent: boolean;
  hasResponse: boolean;
  hasEvent: boolean;
  expectedWorldVersion: number;
  expectedActorRevision: number;
  engineEpoch: number;
};

export type AgentWakeRecoveryFrame = {
  worldVersion: number;
  actorRevision: number;
  engineEpoch: number;
};

export type AgentWakeRecovery =
  | { kind: 'keep'; commandId: string }
  | {
      kind: 'successor';
      previousAttemptId: string;
      previousCommandId: string;
      /** Hash this tuple within the original world/actor/candidate command namespace. */
      identity: readonly [string, string, string, number, number, number];
    };

/** Parse the semantic candidate carried by a durable wake receipt. */
export function wakeCandidateIdFromInputText(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  try {
    const input = JSON.parse(text);
    return input?.type === 'npc_own_condition_ready' &&
      typeof input.candidateId === 'string' &&
      input.candidateId.length > 0
      ? input.candidateId
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A wake receipt with no attempt can be left behind by an interrupted advance.
 * It is not a fresh request: replaying it after the world version moved on can
 * never commit and makes the scheduler spend a full operation every tick.
 * Treat its semantic candidate as already consumed unless the exact receipt
 * version is still current.
 */
export function orphanedWakeCandidateIds(
  rows: readonly { expectedWorldVersion: number; inputText: string }[],
  currentWorldVersion: number,
): Set<string> {
  const ids = new Set<string>();
  if (!Number.isSafeInteger(currentWorldVersion) || currentWorldVersion < 0) return ids;
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.expectedWorldVersion) ||
      row.expectedWorldVersion < 0 ||
      row.expectedWorldVersion >= currentWorldVersion
    )
      continue;
    const candidateId = wakeCandidateIdFromInputText(row.inputText);
    if (candidateId) ids.add(candidateId);
  }
  return ids;
}

/** Never rewrites an attempt or authorizes another paid execution. */
export function agentWakeRecovery(
  prior: AgentWakeRecoveryPrior,
  current: AgentWakeRecoveryFrame,
): AgentWakeRecovery {
  const keep: AgentWakeRecovery = { kind: 'keep', commandId: prior.commandId };
  const versions = [
    prior.expectedWorldVersion,
    prior.expectedActorRevision,
    prior.engineEpoch,
    current.worldVersion,
    current.actorRevision,
    current.engineEpoch,
  ];
  if (
    !prior.id ||
    !prior.commandId ||
    !versions.every((n) => Number.isSafeInteger(n) && n >= 0) ||
    prior.status !== 'cancelled_before_send' ||
    prior.paid !== false ||
    prior.sent !== false ||
    prior.hasResponse !== false ||
    prior.hasEvent !== false ||
    prior.engineEpoch !== current.engineEpoch ||
    current.worldVersion < prior.expectedWorldVersion ||
    current.actorRevision < prior.expectedActorRevision ||
    (current.worldVersion === prior.expectedWorldVersion &&
      current.actorRevision === prior.expectedActorRevision)
  ) {
    return keep;
  }
  return {
    kind: 'successor',
    previousAttemptId: prior.id,
    previousCommandId: prior.commandId,
    identity: [
      'agent-wake-zero-send-successor-v1',
      prior.id,
      prior.commandId,
      current.engineEpoch,
      current.worldVersion,
      current.actorRevision,
    ],
  };
}
