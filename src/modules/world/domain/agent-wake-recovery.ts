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
