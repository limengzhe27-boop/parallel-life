import type { AgentAttemptStatus } from '../domain/agent-runtime.ts';
import { worldDateTimeInput } from '../domain/display-time.ts';

export type OwnAgendaReviewIdentity = {
  worldId: string;
  engineEpoch: number;
  actorId: string;
  definitionRef: string;
};
/** Authenticated by the caller using the original committed attempt/event, never a message count. */
export type OwnAgendaReviewAnchor = OwnAgendaReviewIdentity & {
  attemptId: string;
  eventId: string;
  committedStoryAt: string;
  committedRealAt: string;
};
export type OwnAgendaReviewAttemptEvidence = {
  familyId: string;
  attemptId: string;
  policyVersion: string;
  status: AgentAttemptStatus;
  sent: boolean;
  hasRaw: boolean;
};
export type OwnAgendaReviewBudget = {
  /** Already accounts for reservations. This read snapshot is not an atomic spending permission. */
  remaining: number;
  nextWindowRealAt: string | null;
};
export type OwnAgendaReviewPolicy = {
  version: string;
  storyGapMs: number;
  realGapMs: number;
  quietBackoffMultiplier: number;
  maxRealGapMs: number;
};
export type OwnAgendaReviewInput = {
  identity: OwnAgendaReviewIdentity;
  anchor: OwnAgendaReviewAnchor | null;
  purpose: 'own_agenda' | 'episode_participation';
  storyAt: string;
  realAt: string;
  paused: boolean;
  hasPriorityWork: boolean;
  /** Complete authenticated history for the family, across all policies and transport tries. */
  attempts: readonly OwnAgendaReviewAttemptEvidence[];
  quietStreak: number;
  budgets: Readonly<Record<'owner' | 'world' | 'actor', OwnAgendaReviewBudget>>;
  policy: OwnAgendaReviewPolicy;
};
export type OwnAgendaReviewGrant = {
  type: 'npc_agenda_review';
  family: 'own_agenda';
  grantId: string;
  anchorAttemptId: string;
  policyVersion: string;
  basisSourceIds: string[];
};
type Window = { nextReviewStoryAt: string; nextReviewRealAt: string };
export type OwnAgendaReviewResult =
  | { status: 'needs_episode_review_contract' }
  | { status: 'not_due'; reason: 'paused' | 'missing_anchor' }
  | { status: 'not_due'; reason: 'time_window'; familyId: string; window: Window }
  | {
      status: 'not_due';
      reason: 'attempt_in_flight' | 'unsent_attempt_pending' | 'unsent_recovery_required';
      familyId: string;
      attemptIds: string[];
    }
  | { status: 'priority_work'; familyId: string }
  | { status: 'unknown'; familyId: string; attemptIds: string[] }
  | {
      status: 'paid_fence';
      familyId: string;
      attemptIds: string[];
      reason: 'protected_raw' | 'committed' | 'paid_or_failed';
    }
  | {
      status: 'budget_wait';
      familyId: string;
      exhausted: ('owner' | 'world' | 'actor')[];
      nextCheckRealAt: string | null;
    }
  | { status: 'ready'; familyId: string; grant: OwnAgendaReviewGrant; window: Window };

export class OwnAgendaReviewPolicyError extends Error {
  readonly code = 'INVALID_OWN_AGENDA_REVIEW_INPUT';
  constructor() {
    super('INVALID_OWN_AGENDA_REVIEW_INPUT');
  }
}
const fail = (): never => {
  throw new OwnAgendaReviewPolicyError();
};
const key = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 240 && v.trim() === v;
const instant = (v: string): number => (worldDateTimeInput(v) ? Date.parse(v) : fail());
const positive = (v: number) => Number.isSafeInteger(v) && v > 0;
const identities = (proofs: readonly OwnAgendaReviewAttemptEvidence[]) =>
  [...new Set(proofs.map((p) => p.attemptId))].sort();
const iso = (millis: number) => {
  if (!Number.isSafeInteger(millis) || !Number.isFinite(new Date(millis).getTime())) fail();
  const result = new Date(millis).toISOString();
  return worldDateTimeInput(result) ? result : fail();
};

/** Single identity implementation shared with authenticated read adapters; no policy or fake budget input. */
export function ownAgendaReviewFamilyId(
  identity: OwnAgendaReviewIdentity,
  anchor: OwnAgendaReviewAnchor,
  digest: (canonical: string) => string,
): string {
  if (
    !key(identity.worldId) ||
    !key(identity.actorId) ||
    !key(identity.definitionRef) ||
    !Number.isSafeInteger(identity.engineEpoch) ||
    identity.engineEpoch < 2
  )
    fail();
  if (
    anchor.worldId !== identity.worldId ||
    anchor.engineEpoch !== identity.engineEpoch ||
    anchor.actorId !== identity.actorId ||
    anchor.definitionRef !== identity.definitionRef ||
    !key(anchor.attemptId) ||
    !key(anchor.eventId)
  )
    fail();
  instant(anchor.committedStoryAt);
  instant(anchor.committedRealAt);
  // Policy upgrades, scheduling windows and CAS versions cannot turn this business family into a new one.
  const hash = digest(
    JSON.stringify([
      'own_agenda_review',
      identity.worldId,
      identity.engineEpoch,
      identity.actorId,
      identity.definitionRef,
      anchor.attemptId,
      anchor.eventId,
    ]),
  );
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) fail();
  return `agenda-review:${hash}`;
}

/** Shared time window for fresh admission and explicitly authenticated zero-send recovery. */
export function ownAgendaReviewWindow(
  anchor: OwnAgendaReviewAnchor,
  policy: OwnAgendaReviewPolicy,
  quietStreak: number,
): Window {
  if (
    !positive(policy.storyGapMs) ||
    !positive(policy.realGapMs) ||
    !positive(policy.maxRealGapMs) ||
    policy.maxRealGapMs < policy.realGapMs ||
    !Number.isFinite(policy.quietBackoffMultiplier) ||
    policy.quietBackoffMultiplier < 1 ||
    !Number.isSafeInteger(quietStreak) ||
    quietStreak < 0
  )
    fail();
  const realGap = Math.min(
    policy.maxRealGapMs,
    Math.ceil(policy.realGapMs * policy.quietBackoffMultiplier ** quietStreak),
  );
  return {
    nextReviewStoryAt: iso(instant(anchor.committedStoryAt) + policy.storyGapMs),
    nextReviewRealAt: iso(instant(anchor.committedRealAt) + realGap),
  };
}

/**
 * Computes permission to consider one's own agenda. No clock tick becomes a story fact,
 * contact reason, user deadline, episode request, model call, or budget reservation.
 * Accept/send authority, original receipt recovery and question deduplication remain runtime duties.
 */
export function evaluateOwnAgendaReview(
  input: OwnAgendaReviewInput,
  digest: (canonical: string) => string,
): OwnAgendaReviewResult {
  const { identity, anchor, policy } = input;
  const storyNow = instant(input.storyAt),
    realNow = instant(input.realAt);
  if (
    !key(identity.worldId) ||
    !key(identity.actorId) ||
    !key(identity.definitionRef) ||
    !Number.isSafeInteger(identity.engineEpoch) ||
    identity.engineEpoch < 2 ||
    !key(policy.version) ||
    !positive(policy.storyGapMs) ||
    !positive(policy.realGapMs) ||
    !positive(policy.maxRealGapMs) ||
    policy.maxRealGapMs < policy.realGapMs ||
    !Number.isFinite(policy.quietBackoffMultiplier) ||
    policy.quietBackoffMultiplier < 1 ||
    !Number.isSafeInteger(input.quietStreak) ||
    input.quietStreak < 0 ||
    typeof input.paused !== 'boolean' ||
    typeof input.hasPriorityWork !== 'boolean' ||
    !['own_agenda', 'episode_participation'].includes(input.purpose)
  )
    fail();
  for (const scope of ['owner', 'world', 'actor'] as const) {
    const budget = input.budgets[scope];
    if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0) fail();
    if (budget.nextWindowRealAt !== null) instant(budget.nextWindowRealAt);
  }
  for (const attempt of input.attempts)
    if (
      !key(attempt.familyId) ||
      !key(attempt.attemptId) ||
      !key(attempt.policyVersion) ||
      ![
        'reserved',
        'request_sent',
        'response_received',
        'invalid_output',
        'stale_discarded',
        'committed',
        'cancelled_before_send',
        'unknown_after_send',
      ].includes(attempt.status) ||
      typeof attempt.sent !== 'boolean' ||
      typeof attempt.hasRaw !== 'boolean'
    )
      fail();
  if (input.purpose === 'episode_participation') return { status: 'needs_episode_review_contract' };
  if (input.paused) return { status: 'not_due', reason: 'paused' };
  if (!anchor) return { status: 'not_due', reason: 'missing_anchor' };
  const familyId = ownAgendaReviewFamilyId(identity, anchor, digest);

  if (input.hasPriorityWork) return { status: 'priority_work', familyId };
  const prior = input.attempts.filter((a) => a.familyId === familyId);
  const unknown = prior.filter((a) => a.status === 'unknown_after_send');
  if (unknown.length) return { status: 'unknown', familyId, attemptIds: identities(unknown) };
  const raw = prior.filter((a) => a.hasRaw || a.status === 'response_received');
  if (raw.length)
    return { status: 'paid_fence', familyId, attemptIds: identities(raw), reason: 'protected_raw' };
  const committed = prior.filter((a) => a.status === 'committed');
  if (committed.length)
    return {
      status: 'paid_fence',
      familyId,
      attemptIds: identities(committed),
      reason: 'committed',
    };
  const sent = prior.filter((a) => a.status === 'request_sent');
  if (sent.length)
    return {
      status: 'not_due',
      reason: 'attempt_in_flight',
      familyId,
      attemptIds: identities(sent),
    };
  const paid = prior.filter((a) => a.sent || a.status === 'invalid_output');
  if (paid.length)
    return {
      status: 'paid_fence',
      familyId,
      attemptIds: identities(paid),
      reason: 'paid_or_failed',
    };
  const reserved = prior.filter((a) => a.status === 'reserved');
  if (reserved.length)
    return {
      status: 'not_due',
      reason: 'unsent_attempt_pending',
      familyId,
      attemptIds: identities(reserved),
    };
  if (prior.length)
    return {
      status: 'not_due',
      reason: 'unsent_recovery_required',
      familyId,
      attemptIds: identities(prior),
    };
  const window = ownAgendaReviewWindow(anchor, policy, input.quietStreak);
  if (storyNow < instant(window.nextReviewStoryAt) || realNow < instant(window.nextReviewRealAt))
    return { status: 'not_due', reason: 'time_window', familyId, window };
  const exhausted = (['owner', 'world', 'actor'] as const).filter(
    (scope) => input.budgets[scope].remaining === 0,
  );
  if (exhausted.length) {
    const windows = exhausted.map((scope) => input.budgets[scope].nextWindowRealAt);
    return {
      status: 'budget_wait',
      familyId,
      exhausted,
      nextCheckRealAt: windows.some((at) => at === null)
        ? null
        : iso(Math.max(realNow, ...windows.map((at) => instant(at!)))),
    };
  }
  return {
    status: 'ready',
    familyId,
    window,
    grant: {
      type: 'npc_agenda_review',
      family: 'own_agenda',
      grantId: familyId,
      anchorAttemptId: anchor.attemptId,
      policyVersion: policy.version,
      basisSourceIds: [`definition:${identity.definitionRef}`],
    },
  };
}
