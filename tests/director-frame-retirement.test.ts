import test from 'node:test';
import assert from 'node:assert/strict';
import { directorFrameRetirementEvidence } from '../src/modules/world/domain/director-frame-retirement.ts';
import type { DirectorSnapshot } from '../src/modules/world/domain/director-runtime.ts';
import type { AuthoredReconsiderationReason } from '../src/modules/world/domain/authored-reconsideration.ts';
const old = {
  worldId: 'world',
  engineEpoch: 2,
  worldVersion: 2,
  evaluationCause: { kind: 'opening_context', id: 'old' },
  authoredMaterials: {
    source: { sourceHash: 'hash' },
    openingEventKey: 'opening',
    materials: [
      {
        ref: { nodeKey: 'opening' },
        participantRefs: [{ status: 'resolved', actorId: 'A' }],
        placeRefs: [],
      },
    ],
  },
} as unknown as DirectorSnapshot;
const current = {
  ...old,
  worldVersion: 5,
  evaluationCause: { ...old.evaluationCause!, id: 'new' },
} as DirectorSnapshot;
const evidence = {
  id: 'plan-event',
  worldVersion: 4,
  kind: 'plan_changed',
  ref: { kind: 'plan', actorId: 'A', id: 'plan' },
} as AuthoredReconsiderationReason;
test('only distinct semantic causes backed by related committed changes retire a frame', () => {
  assert.deepEqual(directorFrameRetirementEvidence(old, current, [evidence]), ['plan-event']);
  assert.deepEqual(directorFrameRetirementEvidence(old, current, []), []);
  assert.deepEqual(
    directorFrameRetirementEvidence(old, { ...current, evaluationCause: old.evaluationCause }, [
      evidence,
    ]),
    [],
  );
  assert.deepEqual(
    directorFrameRetirementEvidence(old, current, [{ ...evidence, worldVersion: 2 }]),
    [],
  );
  assert.deepEqual(
    directorFrameRetirementEvidence(old, current, [
      { ...evidence, ref: { kind: 'plan', actorId: 'B', id: 'plan' } },
    ]),
    [],
  );
  assert.deepEqual(
    directorFrameRetirementEvidence(old, { ...current, engineEpoch: 3 }, [evidence]),
    [],
  );
});

test('new actor-scoped question progress can retire only a different later cause; paid old cause remains unchanged', () => {
  const question: AuthoredReconsiderationReason = {
    id: 'answer:cross_impact:answer',
    eventId: 'answer',
    worldVersion: 4,
    kind: 'cross_impact',
    ref: { kind: 'event', id: 'answer' },
    actorId: 'A',
  };
  const next = {
    ...current,
    evaluationCause: {
      kind: 'authored_eligibility',
      id: 'authored:new-answer',
      qualifications: [{ nodeKey: 'opening', nodeHash: 'node', qualificationKey: 'qualified' }],
    },
  } as DirectorSnapshot;
  const prior = structuredClone(old);
  assert.deepEqual(directorFrameRetirementEvidence(old, next, [question]), [question.id]);
  assert.deepEqual(
    directorFrameRetirementEvidence(old, { ...next, evaluationCause: old.evaluationCause }, [
      question,
    ]),
    [],
  );
  assert.deepEqual(
    directorFrameRetirementEvidence(old, next, [{ ...question, worldVersion: 2 }]),
    [],
  );
  assert.deepEqual(directorFrameRetirementEvidence(old, next, [{ ...question, actorId: 'B' }]), []);
  assert.deepEqual(
    directorFrameRetirementEvidence(old, next, [{ ...question, actorId: undefined }]),
    [],
  );
  assert.deepEqual(directorFrameRetirementEvidence(old, next, [question, question]), [question.id]);
  assert.deepEqual(old, prior);
});
