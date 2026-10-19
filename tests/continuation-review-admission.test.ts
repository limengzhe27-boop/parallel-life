import test from 'node:test';
import assert from 'node:assert/strict';
import { continuationReviewAdmission } from '../src/modules/world/domain/continuation-review-admission.ts';
import type { ActorContinuation } from '../src/modules/world/domain/actor-continuation.ts';

const continuation = (decision: ActorContinuation['decision']): ActorContinuation => ({
  version: 1,
  decision,
  reason: 'Own arrangement',
  sourceIds: ['source'],
  planIds: [],
  questionIds: [],
  conditions: [],
  decidedAt: '2026-10-19T00:00:00Z',
  sourceInputId: 'input',
  basisHash: 'basis',
});
test('waiting and quiet can reconsider once, without granting action or repeat payment', () => {
  for (const decision of [
    'act',
    'await_response',
    'await_condition',
    'no_current_intent',
  ] as const) {
    const value = continuation(decision);
    const before = structuredClone(value);
    assert.equal(
      continuationReviewAdmission({
        continuation: value,
        currentBasisHash: 'basis',
        paidBasisHashes: [],
      }),
      'eligible',
    );
    assert.equal(
      continuationReviewAdmission({
        continuation: value,
        currentBasisHash: 'basis',
        paidBasisHashes: ['basis'],
      }),
      'already_considered',
    );
    assert.deepEqual(value, before, 'admission never rewrites decisions or conditions');
  }
});
test('different reason or quiet decision cannot bypass the semantic payment fence', () => {
  const value = {
    ...continuation('no_current_intent'),
    reason: 'Reworded quiet',
    sourceInputId: 'new-input',
  };
  assert.equal(
    continuationReviewAdmission({
      continuation: value,
      currentBasisHash: 'basis',
      paidBasisHashes: ['basis'],
    }),
    'already_considered',
  );
  assert.equal(
    continuationReviewAdmission({
      continuation: value,
      currentBasisHash: 'real-new-plan',
      paidBasisHashes: ['basis'],
    }),
    'eligible',
  );
});
