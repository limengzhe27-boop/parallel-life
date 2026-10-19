import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  evaluateOwnAgendaReview,
  type OwnAgendaReviewInput,
  type OwnAgendaReviewAttemptEvidence,
} from '../src/modules/world/application/own-agenda-review-policy.ts';

const digest = (canonical: string) => createHash('sha256').update(canonical).digest('hex');
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 19) + seconds * 1000).toISOString();
function input(): OwnAgendaReviewInput {
  const identity = {
    worldId: 'world-a',
    engineEpoch: 2,
    actorId: 'actor-a',
    definitionRef: 'definition-a',
  };
  return {
    identity,
    anchor: {
      ...identity,
      attemptId: 'actual-committed-attempt',
      eventId: 'actual-committed-event',
      committedStoryAt: at(0),
      committedRealAt: at(0),
    },
    purpose: 'own_agenda',
    storyAt: at(3600),
    realAt: at(3600),
    paused: false,
    hasPriorityWork: false,
    attempts: [],
    quietStreak: 0,
    budgets: {
      owner: { remaining: 4, nextWindowRealAt: null },
      world: { remaining: 2, nextWindowRealAt: null },
      actor: { remaining: 1, nextWindowRealAt: null },
    },
    policy: {
      version: 'policy-1',
      storyGapMs: 600_000,
      realGapMs: 60_000,
      quietBackoffMultiplier: 2,
      maxRealGapMs: 480_000,
    },
  };
}
const run = (i = input()) => evaluateOwnAgendaReview(i, digest);
const family = (i = input()) => {
  const result = run(i);
  assert.ok('familyId' in result);
  return result.familyId;
};
function evidence(
  i: OwnAgendaReviewInput,
  override: Partial<OwnAgendaReviewAttemptEvidence> = {},
): OwnAgendaReviewAttemptEvidence {
  return {
    familyId: family(i),
    attemptId: 'earlier-transport-attempt',
    policyVersion: 'policy-1',
    status: 'cancelled_before_send',
    sent: false,
    hasRaw: false,
    ...override,
  };
}

test('only a consideration envelope is returned; there is no message, deadline or player promise', () => {
  const i = input();
  const result = run(i);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw Error('expected consideration');
  assert.deepEqual(result.grant, {
    type: 'npc_agenda_review',
    family: 'own_agenda',
    grantId: result.familyId,
    anchorAttemptId: i.anchor!.attemptId,
    policyVersion: 'policy-1',
    basisSourceIds: ['definition:definition-a'],
  });
  assert.deepEqual(result.window, { nextReviewStoryAt: at(600), nextReviewRealAt: at(60) });
});

test('family identity ignores clock ticks, world versions, policy versions, quiet streak and spare budgets', () => {
  const i = input();
  const original = family(i);
  i.storyAt = at(7200);
  i.realAt = at(7200);
  i.policy.version = 'policy-2';
  i.policy.storyGapMs = 300_000;
  i.policy.realGapMs = 120_000;
  i.quietStreak = 2;
  i.budgets.owner.remaining = 1;
  Object.assign(i, { worldVersion: 999, foregroundEntry: 'another-tab' });
  assert.equal(family(i), original);
  const result = run(i);
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.grant.policyVersion, 'policy-2');
});

test('a different authenticated committed anchor is a different family; a quiet tick is not', () => {
  const i = input();
  const original = family(i);
  i.anchor!.attemptId = 'next-actual-committed-attempt';
  i.anchor!.eventId = 'next-actual-committed-event';
  assert.notEqual(family(i), original);
});

test('actor, world, epoch and definition bind separate authenticated families', () => {
  const original = family();
  for (const field of ['worldId', 'actorId', 'definitionRef', 'engineEpoch'] as const) {
    const i = input();
    const value = field === 'engineEpoch' ? 3 : `different-${field}`;
    Object.assign(i.identity, { [field]: value });
    Object.assign(i.anchor!, { [field]: value });
    assert.notEqual(family(i), original, field);
  }
});

test('without an anchor the original initial-agenda path is required; no grant is fabricated', () => {
  const i = input();
  i.anchor = null;
  let digests = 0;
  assert.deepEqual(
    evaluateOwnAgendaReview(i, () => {
      digests++;
      return 'a'.repeat(64);
    }),
    { status: 'not_due', reason: 'missing_anchor' },
  );
  assert.equal(digests, 0);
});

test('historical finished goals do not block a legitimate new review anchor', () => {
  const i = input();
  Object.assign(i, {
    oldGoals: [{ id: 'g', status: 'fulfilled' }],
    oldPlans: [{ id: 'p', status: 'finished' }],
  });
  assert.equal(run(i).status, 'ready');
});

test('an episode participation review cannot be laundered into ordinary own-agenda review', () => {
  const i = input();
  i.purpose = 'episode_participation';
  assert.deepEqual(run(i), { status: 'needs_episode_review_contract' });
});

test('explicit pause and existing higher-priority work do not grant an extra model opportunity', () => {
  const i = input();
  i.paused = true;
  assert.deepEqual(run(i), { status: 'not_due', reason: 'paused' });
  i.paused = false;
  i.hasPriorityWork = true;
  assert.equal(run(i).status, 'priority_work');
});

for (const [story, real, expected] of [
  [599, 3600, 'not_due'],
  [3600, 59, 'not_due'],
  [600, 60, 'ready'],
  [-1, 3600, 'not_due'],
  [3600, -1, 'not_due'],
] as const)
  test(`story ${story}s and real ${real}s enforce separate exact gates`, () => {
    const i = input();
    i.storyAt = at(story);
    i.realAt = at(real);
    assert.equal(run(i).status, expected);
  });

for (const [streak, seconds] of [
  [0, 60],
  [1, 120],
  [2, 240],
  [3, 480],
  [4, 480],
  [1000000, 480],
] as const)
  test(`quiet streak ${streak} saturates at the configured real window (${seconds}s)`, () => {
    const i = input();
    i.quietStreak = streak;
    const result = run(i);
    assert.equal(result.status, 'ready');
    if (result.status === 'ready') assert.equal(result.window.nextReviewRealAt, at(seconds));
    i.realAt = at(seconds - 1);
    assert.equal(run(i).status, 'not_due');
  });

test('paid evidence from any previous policy/transport fences the same family after an upgrade', () => {
  const i = input();
  const old = evidence(i, {
    status: 'stale_discarded',
    sent: true,
    policyVersion: 'obsolete-policy',
  });
  i.policy.version = 'new-policy';
  i.realAt = at(86400);
  i.storyAt = at(86400);
  i.attempts = [old];
  const result = run(i);
  assert.equal(result.status, 'paid_fence');
  assert.equal('familyId' in result && result.familyId, old.familyId);
});

test('unknown is preserved distinctly and cannot be made fresh by budget replenishment', () => {
  const i = input();
  const unknown = evidence(i, { status: 'unknown_after_send', sent: true });
  i.attempts = [unknown];
  i.budgets.owner.remaining = 0;
  assert.deepEqual(run(i), {
    status: 'unknown',
    familyId: unknown.familyId,
    attemptIds: [unknown.attemptId],
  });
  i.budgets.owner.remaining = 100;
  i.policy.version = 'upgrade';
  assert.equal(run(i).status, 'unknown');
});

for (const partial of [
  { status: 'response_received' as const, sent: true, hasRaw: true },
  { status: 'unknown_after_send' as const, sent: true, hasRaw: true },
  { status: 'invalid_output' as const, sent: true, hasRaw: true },
  { status: 'committed' as const, sent: true, hasRaw: true },
] as const)
  test(`protected ${partial.status} is never another grant`, () => {
    const i = input();
    i.attempts = [evidence(i, partial)];
    assert.ok(['unknown', 'paid_fence'].includes(run(i).status));
  });

test('in-flight, unused reservation and zero-send cancellation remain runtime recovery duties', () => {
  for (const [status, sent, reason] of [
    ['request_sent', true, 'attempt_in_flight'],
    ['reserved', false, 'unsent_attempt_pending'],
    ['cancelled_before_send', false, 'unsent_recovery_required'],
    ['stale_discarded', false, 'unsent_recovery_required'],
  ] as const) {
    const i = input();
    const a = evidence(i, { status, sent });
    i.attempts = [a];
    assert.deepEqual(run(i), {
      status: 'not_due',
      reason,
      familyId: a.familyId,
      attemptIds: [a.attemptId],
    });
  }
});

test('a cancelled label cannot hide a sent request or received raw result', () => {
  const i = input();
  i.attempts = [evidence(i, { sent: true })];
  assert.equal(run(i).status, 'paid_fence');
  i.attempts = [evidence(i, { hasRaw: true })];
  const result = run(i);
  assert.ok(result.status === 'paid_fence' && result.reason === 'protected_raw');
});

test('a committed label fences the family even if a faulty summary omits paid flags', () => {
  const i = input();
  i.attempts = [evidence(i, { status: 'committed' })];
  const result = run(i);
  assert.ok(result.status === 'paid_fence' && result.reason === 'committed');
});

test('unrelated families and ordering cannot change this family or its paid fence', () => {
  const i = input();
  const original = family(i);
  const a = evidence(i, { attemptId: 'b', status: 'unknown_after_send', sent: true });
  const b = evidence(i, { attemptId: 'a', status: 'unknown_after_send', sent: true });
  i.attempts = [
    a,
    b,
    a,
    evidence(i, { familyId: 'unrelated', status: 'invalid_output', sent: true }),
  ];
  assert.deepEqual(run(i), { status: 'unknown', familyId: original, attemptIds: ['a', 'b'] });
});

for (const scope of ['owner', 'world', 'actor'] as const)
  test(`${scope} budget exhaustion is a distinct wait without changing family identity`, () => {
    const i = input();
    const original = family(i);
    i.budgets = { ...i.budgets, [scope]: { remaining: 0, nextWindowRealAt: at(7200) } };
    assert.deepEqual(run(i), {
      status: 'budget_wait',
      familyId: original,
      exhausted: [scope],
      nextCheckRealAt: at(7200),
    });
    i.budgets[scope].remaining = 1;
    assert.equal(run(i).status, 'ready');
    assert.equal(family(i), original);
  });

test('combined budget windows use the latest known availability; unknown windows are not invented', () => {
  const i = input();
  i.budgets = {
    ...i.budgets,
    owner: { remaining: 0, nextWindowRealAt: at(7200) },
    world: { remaining: 0, nextWindowRealAt: at(10800) },
  };
  let result = run(i);
  assert.ok(result.status === 'budget_wait' && result.nextCheckRealAt === at(10800));
  i.budgets.actor.remaining = 0;
  result = run(i);
  assert.ok(result.status === 'budget_wait' && result.nextCheckRealAt === null);
});

test('scope mismatch or invented timestamps cannot authenticate an anchor', () => {
  for (const field of [
    'worldId',
    'actorId',
    'definitionRef',
    'engineEpoch',
    'committedStoryAt',
    'committedRealAt',
  ] as const) {
    const i = input();
    Object.assign(i.anchor!, { [field]: field === 'engineEpoch' ? 1 : 'invalid' });
    assert.throws(() => run(i), { code: 'INVALID_OWN_AGENDA_REVIEW_INPUT' });
  }
});

test('invalid policy, budget, time, status and digest inputs fail without a permissive default', () => {
  for (const change of [
    (i: OwnAgendaReviewInput) => {
      i.policy.realGapMs = 0;
    },
    (i: OwnAgendaReviewInput) => {
      i.policy.storyGapMs = -1;
    },
    (i: OwnAgendaReviewInput) => {
      i.policy.maxRealGapMs = 1;
    },
    (i: OwnAgendaReviewInput) => {
      i.policy.quietBackoffMultiplier = Infinity;
    },
    (i: OwnAgendaReviewInput) => {
      i.quietStreak = -1;
    },
    (i: OwnAgendaReviewInput) => {
      i.budgets.owner.remaining = -1;
    },
    (i: OwnAgendaReviewInput) => {
      i.storyAt = '2026-02-30T00:00:00Z';
    },
    (i: OwnAgendaReviewInput) => {
      i.realAt = '2026-10-19T12:00:00';
    },
    (i: OwnAgendaReviewInput) => {
      i.attempts = [evidence(i, { status: 'made_up' as never })];
    },
  ]) {
    const i = input();
    change(i);
    assert.throws(() => run(i), { code: 'INVALID_OWN_AGENDA_REVIEW_INPUT' });
  }
  assert.throws(() => evaluateOwnAgendaReview(input(), () => 'bad'), {
    code: 'INVALID_OWN_AGENDA_REVIEW_INPUT',
  });
});

test('evaluation is read-only and equivalent anchor time offsets do not change the family', () => {
  const i = input();
  const before = structuredClone(i);
  const original = family(i);
  assert.deepEqual(i, before);
  i.anchor!.committedStoryAt = '2026-10-19T08:00:00+08:00';
  i.anchor!.committedRealAt = '2026-10-19T08:00:00+08:00';
  assert.equal(family(i), original);
});

test('a ready snapshot does not spend or reserve a call; repeated evaluation returns the same envelope', () => {
  const i = input();
  const before = structuredClone(i);
  assert.deepEqual(run(i), run(i));
  assert.deepEqual(i, before);
  assert.equal(i.budgets.actor.remaining, 1);
});

test('an out-of-range computed date fails instead of wrapping a scheduling window', () => {
  const i = input();
  i.policy.storyGapMs = Number.MAX_SAFE_INTEGER;
  assert.throws(() => run(i), { code: 'INVALID_OWN_AGENDA_REVIEW_INPUT' });
});
