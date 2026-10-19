/** Diagnostics only: no retry, authorization, proposal repair, state mutation or billing decisions. */
export type AgentRejectionCategory =
  | 'mechanical_format'
  | 'protocol_adapter'
  | 'context_missing'
  | 'legitimate_intent_blocked'
  | 'business_precondition'
  | 'permission_source'
  | 'version_resource'
  | 'upstream_or_unknown'
  | 'unclassified';

/**
 * A server-side audit of the original protected v6 case, not player/model-supplied metadata.
 * The caller must verify the artifact and semantic sources first. This pure classifier cannot
 * authenticate a database artifact; this evidence affects a diagnostic label, never authority.
 */
export type AgentRejectionAuditEvidence = {
  caseId: 'v6_missing_current_input_anchor';
  protocol: 'npc-wire-v6';
  evidenceDigest: string;
  semanticSourcesAuthorized: true;
  onlyMechanicalInputAnchorMissing: true;
};
export type AgentRejectionClassification = {
  category: AgentRejectionCategory;
  /** Exact allowlisted symbols only. Never arbitrary original code/message/source identifiers. */
  code: string | null;
  reason: string | null;
  basis: 'known_code' | 'audited_case' | 'unclassified';
  auditCase: AgentRejectionAuditEvidence['caseId'] | null;
};
type UnambiguousCategory = Exclude<
  AgentRejectionCategory,
  'unclassified' | 'legitimate_intent_blocked'
>;
const directGroups: Readonly<Record<UnambiguousCategory, readonly string[]>> = {
  mechanical_format: [
    'NPC_EXECUTION_INTENT_SHAPE',
    'NPC_EXECUTION_INTENT_DUPLICATE_REF',
    'NPC_EXECUTION_INTENT_ID_CONFLICT',
    'NPC_EXECUTION_INTENT_PARAMETERS',
  ],
  protocol_adapter: ['NPC_RESPONSE_SCHEMA', 'DIRECTOR_RESPONSE_SCHEMA_LIMIT'],
  context_missing: [
    'NPC_AGENT_INVALID_SNAPSHOT',
    'NPC_AGENT_SNAPSHOT_LIMIT',
    'DIRECTOR_CONTEXT_LIMIT',
    'AGENT_PROJECTION_INCOMPLETE',
  ],
  business_precondition: [
    'NPC_EXECUTION_INTENT_GOAL',
    'NPC_EXECUTION_INTENT_SUPERSEDES',
    'NPC_EXECUTION_INTENT_DEPENDENCY',
    'NPC_EXECUTION_INTENT_RESPONSIBILITY',
  ],
  permission_source: [
    'INPUT_SCOPE_FORBIDDEN',
    'NPC_EXECUTION_INTENT_IDENTITY',
    'NPC_EXECUTION_INTENT_SOURCE',
    'NPC_EXECUTION_INTENT_CAPABILITY',
    'EPISODE_LIFECYCLE_SOURCE_CONFLICT',
    'EPISODE_RESULT_SOURCE_CONFLICT',
    'SCENE_OBSERVATION_SOURCE_CONFLICT',
    'GROUP_OBSERVATION_SOURCE_CONFLICT',
  ],
  version_resource: [
    'VERSION_CONFLICT',
    'AGENT_REVISION_CONFLICT',
    'ENGINE_EPOCH_CONFLICT',
    'ATTEMPT_STALE',
    'COMMAND_CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'ATTEMPT_PENDING',
    'WORLD_PAUSED',
    'NPC_DELIVERY_DEFERRED',
    'EPISODE_DELIVERY_DEFERRED',
    'DIRECTOR_DELIVERY_DEFERRED',
    'OWN_AGENDA_BUDGET_WAIT',
  ],
  upstream_or_unknown: [
    'UPSTREAM_FAILED',
    'INVALID_RESPONSE',
    'TIMEOUT',
    'CANCELLED',
    'TRUNCATED',
    'INVALID_CONFIG',
    'ATTEMPT_UNKNOWN',
  ],
};
const reasonGroups: Readonly<Partial<Record<UnambiguousCategory, readonly string[]>>> = {
  mechanical_format: [
    'RESPONSE_JSON',
    'RESPONSE_LIMIT',
    'RESPONSE_SHAPE',
    'DUPLICATE_ID',
    'NPC_PLAN_INTENT_SHAPE',
    'NPC_PLAN_INTENT_DUPLICATE_REF',
    'NPC_PLAN_INTENT_ID_CONFLICT',
  ],
  protocol_adapter: [],
  context_missing: [],
  business_precondition: [
    'UNKNOWN_GOAL',
    'UNKNOWN_RESPONSIBILITY',
    'UNKNOWN_ACTION_CONDITION',
    'UNKNOWN_STATEMENT_DEPENDENCY',
    'UNKNOWN_QUESTION_RESPONSIBILITY',
    'PLAN_GOAL_NOT_ACTIVE',
    'ACTION_GOAL_NOT_ACTIVE',
    'INVALID_PLAN_ACTION',
    'INVALID_NEXT_ACTION',
    'INVALID_PREVIOUS_PLAN',
    'PLAN_NEXT_STEP_REQUIRED',
    'PLAN_BLOCKED_REASON_REQUIRED',
    'PLAN_WAITING_BASIS_REQUIRED',
    'TERMINAL_ACTION',
    'TERMINAL_GOAL',
    'TERMINAL_PLAN',
    'TERMINAL_PREVIOUS_PLAN',
    'TERMINAL_RESPONSIBILITY',
    'PLAN_SUPERSESSION_CONFLICT',
    'PLAN_SUPERSESSION_FORK',
    'PLAN_SUPERSESSION_HISTORY',
    'PLAN_SUPERSESSION_INFLIGHT',
    'MODEL_EXECUTION_CLAIM',
    'GOAL_RESULT_REQUIRED',
    'RESPONSIBILITY_RESULT_REQUIRED',
    'UNCONFIRMED_GOAL_RESULT',
    'UNCONFIRMED_RESPONSIBILITY_RESULT',
    'REPLY_DEPENDS_ON_UNEXECUTED_ACTION',
    'MISSING_REPLY',
    'NOT_EXPIRED',
    'NPC_PLAN_INTENT_GOAL',
    'NPC_PLAN_INTENT_PLAN',
    'NPC_PLAN_INTENT_CHILD_ACTION',
    'NPC_PLAN_INTENT_UNFINISHED_ACTION',
    'NPC_PLAN_INTENT_DUPLICATE_TARGET',
    'NPC_PLAN_INTENT_CONDITION_ACTION',
    'NPC_PLAN_INTENT_CONDITION_RESPONSIBILITY',
  ],
  permission_source: [
    'UNKNOWN_SOURCE',
    'MISSING_BASIS',
    'DUPLICATE_SOURCE',
    'FUTURE_SOURCE',
    'REDACTED_STATE_MUTATION',
    'INVALID_AUTHORIZED_VIEW',
    'UNAUTHORIZED_CAPABILITY',
    'EPISODE_DECISION_SCOPE',
    'UNSOURCED_LOCATION_REPORT',
    'UNSOURCED_DEADLINE',
    'DECISION_NOT_PLAYER_INPUT',
    'DECISION_QUOTE',
    'DECISION_HISTORY_IMMUTABLE',
    'SOURCE_HISTORY_IMMUTABLE',
    'RESULT_SCOPE',
    'NPC_PLAN_INTENT_SOURCE',
    'NPC_PLAN_INTENT_SCOPE',
    'NPC_PLAN_INTENT_IDENTITY',
    'NPC_PLAN_INTENT_CONDITION_SOURCE',
  ],
  version_resource: ['FUTURE_STATE', 'RESULT_WORLD_VERSION'],
};
function index(groups: Readonly<Partial<Record<UnambiguousCategory, readonly string[]>>>) {
  const result = new Map<string, UnambiguousCategory>();
  for (const [category, codes] of Object.entries(groups))
    for (const code of codes) result.set(code, category as UnambiguousCategory);
  return result;
}
const direct = index(directGroups),
  reasons = index(reasonGroups);
const wrappers = new Set(['INVALID_AGENT_PROPOSAL', 'INVALID_PROPOSAL', 'INVALID_QUESTION_CHANGE']);
const coarse = new Set(['INVALID_DIRECTOR_PROPOSAL', 'INVALID_DIRECTOR_RESULT', 'ATTEMPT_INVALID']);

/** Never invoke getters, traverse causes, read message/stack or coerce arbitrary values to strings. */
function data(value: unknown, property: string): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
function result(
  category: AgentRejectionCategory,
  code: string | null,
  reason: string | null,
  basis: AgentRejectionClassification['basis'] = 'known_code',
  auditCase: AgentRejectionClassification['auditCase'] = null,
): AgentRejectionClassification {
  return { category, code, reason, basis, auditCase };
}

/**
 * Exact structured-code allowlists only. A coarse parser rejection has already lost its root
 * cause, so leave it unclassified rather than infer an invalid shape or a legitimate intention.
 */
export function classifyAgentRejection(
  error: unknown,
  audit?: AgentRejectionAuditEvidence,
): AgentRejectionClassification {
  const observedCode = data(error, 'code');
  if (typeof observedCode !== 'string') return result('unclassified', null, null, 'unclassified');
  const category = direct.get(observedCode);
  if (category) {
    // Original batch preflight uses INVALID_CONFIG plus this explicit structured flag.
    if (observedCode === 'INVALID_CONFIG' && data(error, 'batchYield') === true)
      return result('version_resource', observedCode, null);
    return result(category, observedCode, null);
  }
  if (coarse.has(observedCode)) return result('unclassified', observedCode, null, 'unclassified');
  if (!wrappers.has(observedCode)) return result('unclassified', null, null, 'unclassified');
  const observedReason = data(error, 'reason');
  const normalized =
    typeof observedReason === 'string' && observedReason.startsWith('RESPONSE_SHAPE:')
      ? 'RESPONSE_SHAPE'
      : observedReason;
  const reason =
    typeof normalized === 'string' &&
    (reasons.has(normalized) || normalized === 'RESPONSE_WIRE_SHAPE')
      ? normalized
      : null;
  if (
    ((observedCode === 'INVALID_PROPOSAL' && reason === 'NPC_PLAN_INTENT_SOURCE') ||
      (observedCode === 'INVALID_AGENT_PROPOSAL' && reason === 'RESPONSE_WIRE_SHAPE')) &&
    data(audit, 'caseId') === 'v6_missing_current_input_anchor' &&
    data(audit, 'protocol') === 'npc-wire-v6' &&
    typeof data(audit, 'evidenceDigest') === 'string' &&
    /^[a-f0-9]{64}$/.test(data(audit, 'evidenceDigest') as string) &&
    data(audit, 'semanticSourcesAuthorized') === true &&
    data(audit, 'onlyMechanicalInputAnchorMissing') === true
  )
    return result(
      'legitimate_intent_blocked',
      observedCode,
      reason,
      'audited_case',
      'v6_missing_current_input_anchor',
    );
  const reasonCategory = reason ? reasons.get(reason) : undefined;
  return reasonCategory
    ? result(reasonCategory, observedCode, reason)
    : result('unclassified', observedCode, reason, 'unclassified');
}
