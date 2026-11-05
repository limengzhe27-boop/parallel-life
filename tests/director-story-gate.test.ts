import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveAuthoredStoryGate,
  type AuthoredStoryEventState,
  type AuthoredStoryPlan,
} from '../src/modules/world/domain/authored-story-gate.ts';
import {
  canConsiderAuthoredEvent,
  type DirectorSnapshot,
} from '../src/modules/world/domain/director-runtime.ts';

const plan: AuthoredStoryPlan = {
  openingEventKey: 'opening',
  timeline: {
    initialStageKey: 'act_1',
    stages: [
      { key: 'act_1', order: 1, afterStageKeys: [] },
      { key: 'act_2', order: 2, afterStageKeys: ['act_1'] },
    ],
  },
  nodes: [
    { key: 'opening', intent: { kind: 'director_event' }, timeline: { stageKey: 'act_1' } },
    { key: 'node_1', intent: { kind: 'director_event' }, timeline: { stageKey: 'act_1' } },
    { key: 'node_2', intent: { kind: 'director_event' }, timeline: { stageKey: 'act_1' } },
    { key: 'node_3', intent: { kind: 'director_event' }, timeline: { stageKey: 'act_2' } },
  ],
};
const state = (
  nodeKey: string,
  status: AuthoredStoryEventState['status'],
  presented = false,
): AuthoredStoryEventState => ({ nodeKey, status, presented });

test('opening must be presented before any act is eligible', () => {
  const gate = deriveAuthoredStoryGate(plan, []);
  assert.equal(gate.openingPresented, false);
  assert.deepEqual(gate.eligibleNodeKeys, ['opening']);
  assert.deepEqual(gate.currentStageKeys, ['act_1']);
});

test('an in-flight but unshown opening does not unlock other events', () => {
  const gate = deriveAuthoredStoryGate(plan, [state('opening', 'active')]);
  assert.equal(gate.openingPresented, false);
  assert.deepEqual(gate.eligibleNodeKeys, []);
});

test('a presented opening unlocks only the current act', () => {
  const gate = deriveAuthoredStoryGate(plan, [
    state('opening', 'active', true),
    state('node_1', 'active'),
  ]);
  assert.equal(gate.openingPresented, true);
  assert.deepEqual(gate.eligibleNodeKeys, ['node_2']);
  assert.deepEqual(gate.currentStageKeys, ['act_1']);
});

test('the next act stays closed until every current-act event was presented', () => {
  const before = deriveAuthoredStoryGate(plan, [
    state('opening', 'resolved', true),
    state('node_1', 'resolved', true),
  ]);
  assert.deepEqual(before.currentStageKeys, ['act_1']);
  assert.deepEqual(before.eligibleNodeKeys, ['node_2']);
  const after = deriveAuthoredStoryGate(plan, [
    state('opening', 'resolved', true),
    state('node_1', 'resolved', true),
    state('node_2', 'resolved', true),
  ]);
  assert.deepEqual(after.currentStageKeys, ['act_2']);
  assert.deepEqual(after.eligibleNodeKeys, ['node_3']);
  assert.deepEqual(after.terminalNodeKeys, ['opening', 'node_1', 'node_2']);
});

test('a proposed but unshown episode does not block the act from being reconsidered', () => {
  const gate = deriveAuthoredStoryGate(plan, [
    state('opening', 'active', true),
    state('node_1', 'proposed'),
    state('node_2', 'active'),
  ]);
  assert.deepEqual(gate.activeNodeKeys, ['opening', 'node_2']);
  assert.deepEqual(gate.eligibleNodeKeys, ['node_1']);
});

test('a presented but unresolved event is occupied and is not proposed twice', () => {
  const gate = deriveAuthoredStoryGate(plan, [state('opening', 'active', true)]);
  assert.deepEqual(gate.presentedNodeKeys, ['opening']);
  assert.equal(gate.eligibleNodeKeys.includes('opening'), false);
});

test('director consideration is bounded by the runtime plan gate', () => {
  const base = {
    authoredMaterials: {
      materials: [
        {
          ref: { nodeKey: 'node_3', nodeHash: 'a'.repeat(64) },
          role: 'event',
        },
      ],
    },
    authoredEligibility: [
      {
        nodeKey: 'node_3',
        nodeHash: 'a'.repeat(64),
        status: 'eligible',
        reasons: [],
        basisSourceIds: [],
        qualificationKey: 'b'.repeat(64),
      },
    ],
    occupiedAuthoredEventKeys: [],
    authoredStory: deriveAuthoredStoryGate(plan, [state('opening', 'resolved', true)]),
  } as unknown as DirectorSnapshot;
  assert.equal(canConsiderAuthoredEvent(base, 'node_3'), false);
  base.authoredStory = deriveAuthoredStoryGate(plan, [
    state('opening', 'resolved', true),
    state('node_1', 'resolved', true),
    state('node_2', 'resolved', true),
  ]);
  assert.equal(canConsiderAuthoredEvent(base, 'node_3'), true);
});
