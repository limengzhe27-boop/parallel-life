/**
 * Runtime interpretation of an authored event library. The publication source remains
 * immutable; this plan only decides which authored events are currently eligible.
 */
export type AuthoredStoryPlanNode = {
  key: string;
  intent: { kind: string };
  timeline?: { stageKey?: string } | null;
};

export type AuthoredStoryPlanStage = {
  key: string;
  order: number;
  afterStageKeys: string[];
};

export type AuthoredStoryPlan = {
  openingEventKey?: string | null;
  timeline?: { initialStageKey?: string; stages?: AuthoredStoryPlanStage[] } | null;
  nodes: AuthoredStoryPlanNode[];
};

export type AuthoredStoryEventState = {
  nodeKey: string;
  status: 'proposed' | 'active' | 'resolved' | 'withdrawn';
  presented: boolean;
  resolved?: boolean;
};

export type AuthoredStoryGate = {
  planVersion: 1;
  openingEventKey: string | null;
  openingPresented: boolean;
  currentStageKeys: string[];
  eligibleNodeKeys: string[];
  activeNodeKeys: string[];
  presentedNodeKeys: string[];
  terminalNodeKeys: string[];
};

export class AuthoredStoryGateError extends Error {
  readonly code = 'INVALID_AUTHORED_STORY_PLAN';
  constructor() {
    super('INVALID_AUTHORED_STORY_PLAN');
  }
}

const unique = (values: string[]) => [...new Set(values)];
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function validate(plan: AuthoredStoryPlan) {
  if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length > 128)
    throw new AuthoredStoryGateError();
  const keys = plan.nodes.map((node) => node.key);
  if (keys.some((key) => !text(key)) || new Set(keys).size !== keys.length)
    throw new AuthoredStoryGateError();
  const stages = plan.timeline?.stages;
  if (stages !== undefined && stages !== null) {
    if (!Array.isArray(stages) || stages.length > 64) throw new AuthoredStoryGateError();
    const stageKeys = stages.map((stage) => stage.key);
    if (
      stageKeys.some((key) => !text(key)) ||
      new Set(stageKeys).size !== stageKeys.length ||
      stages.some(
        (stage) =>
          !Number.isSafeInteger(stage.order) ||
          !Array.isArray(stage.afterStageKeys) ||
          stage.afterStageKeys.some((key) => !stageKeys.includes(key)),
      )
    )
      throw new AuthoredStoryGateError();
    for (const node of plan.nodes)
      if (node.timeline?.stageKey && !stageKeys.includes(node.timeline.stageKey))
        throw new AuthoredStoryGateError();
    if (plan.timeline?.initialStageKey && !stageKeys.includes(plan.timeline.initialStageKey))
      throw new AuthoredStoryGateError();
  }
  if (plan.openingEventKey && !keys.includes(plan.openingEventKey))
    throw new AuthoredStoryGateError();
}

function stateMap(states: readonly AuthoredStoryEventState[]) {
  const map = new Map<string, AuthoredStoryEventState>();
  for (const state of states) {
    if (!text(state.nodeKey)) throw new AuthoredStoryGateError();
    const prior = map.get(state.nodeKey);
    const terminal = state.status === 'resolved' || state.status === 'withdrawn' || state.resolved;
    const priorTerminal =
      prior && (prior.status === 'resolved' || prior.status === 'withdrawn' || prior.resolved);
    if (!prior || (terminal && !priorTerminal))
      map.set(state.nodeKey, { ...state, presented: state.presented || !!terminal });
    else if (!prior.presented && (state.presented || terminal))
      map.set(state.nodeKey, { ...prior, presented: true });
  }
  return map;
}

/**
 * A presented opening unlocks the first act; an in-flight but unshown opening does not.
 * Old episodes before the plan cutover are excluded by the caller, not rewritten.
 */
export function deriveAuthoredStoryGate(
  plan: AuthoredStoryPlan,
  states: readonly AuthoredStoryEventState[],
): AuthoredStoryGate {
  validate(plan);
  const map = stateMap(states);
  const terminal = (key: string) => {
    const state = map.get(key);
    return (
      !!state && (state.status === 'resolved' || state.status === 'withdrawn' || !!state.resolved)
    );
  };
  const presented = (key: string) => !!map.get(key)?.presented;
  const active = (key: string) => {
    const state = map.get(key);
    // A proposed episode is only an offer; it becomes in-flight when an actor
    // engages. Let the next review re-consider it instead of deadlocking the act.
    return !!state && !terminal(key) && state.status === 'active';
  };
  const openingEventKey = text(plan.openingEventKey) ? plan.openingEventKey : null;
  const openingPresented = !openingEventKey || presented(openingEventKey);
  const openingActive = !!openingEventKey && active(openingEventKey);
  const stages = [...(plan.timeline?.stages ?? [])].sort(
    (a, b) => a.order - b.order || a.key.localeCompare(b.key, 'en'),
  );
  const stageMembers = new Map<string, string[]>();
  for (const node of plan.nodes) {
    if (node.intent.kind === 'editorial_only') continue;
    const stageKey = node.timeline?.stageKey;
    if (!stageKey) continue;
    const members = stageMembers.get(stageKey) ?? [];
    members.push(node.key);
    stageMembers.set(stageKey, members);
  }
  const stageDone = (stageKey: string) =>
    (stageMembers.get(stageKey) ?? []).every((key) => presented(key) || terminal(key));
  const resolvedStages = new Set(stages.filter((stage) => stageDone(stage.key)).map((s) => s.key));
  const currentStageKeys = stages
    .filter(
      (stage) =>
        !resolvedStages.has(stage.key) &&
        stage.afterStageKeys.every((key) => resolvedStages.has(key)),
    )
    .map((stage) => stage.key);
  const executable = plan.nodes.filter((node) => node.intent.kind !== 'editorial_only');
  const eligible =
    openingEventKey && !openingPresented
      ? openingActive || terminal(openingEventKey)
        ? []
        : [openingEventKey]
      : (currentStageKeys.length
          ? currentStageKeys.flatMap((stage) => stageMembers.get(stage) ?? [])
          : executable.map((node) => node.key)
        ).filter((key) => !presented(key) && !terminal(key) && !active(key));
  return {
    planVersion: 1,
    openingEventKey,
    openingPresented,
    currentStageKeys,
    eligibleNodeKeys: unique(eligible),
    activeNodeKeys: unique(
      [...map.values()].filter((state) => active(state.nodeKey)).map((state) => state.nodeKey),
    ),
    presentedNodeKeys: unique(
      [...map.values()].filter((state) => presented(state.nodeKey)).map((state) => state.nodeKey),
    ),
    terminalNodeKeys: unique([...map.keys()].filter((key) => terminal(key))),
  };
}
