import test from 'node:test';
import assert from 'node:assert/strict';
import { actorStateContextPayload } from '../src/modules/world/application/agent-state-context.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import { WorldDirectorAgentModel } from '../src/modules/world/infrastructure/director-agent-model.ts';
import type { DirectorSnapshot } from '../src/modules/world/domain/director-runtime.ts';

function state() {
  return {
    ...emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 1),
    continuation: {
      version: 1 as const,
      decision: 'no_current_intent' as const,
      reason: '玩家明确表示先不去了，我不再等这个安排。',
      sourceIds: ['input'],
      planIds: [],
      questionIds: [],
      conditions: [],
      decidedAt: '2026-10-27T08:00:00.000Z',
      sourceInputId: 'input',
      basisHash: 'a'.repeat(64),
    },
  };
}

test('Director continuation projection is explicit, immutable and does not invent a formal player decision', () => {
  const original = state();
  assert.equal(actorStateContextPayload(original).continuation, undefined);
  const view = actorStateContextPayload(original, { includeContinuation: true });
  assert.deepEqual(view.continuation, original.continuation);
  assert.notEqual(view.continuation, original.continuation);
  assert.notEqual(view.continuation!.sourceIds, original.continuation.sourceIds);
  assert.deepEqual(view.decisions, []);
  assert.equal(
    actorStateContextPayload(original, {
      includeContinuation: true,
      privateStrategySourceIds: new Set(['input']),
    }).continuation!.reason,
    '',
  );
});

test('continuation projection never invokes an accessor and rejects malformed declared fields', () => {
  const original = state();
  let reads = 0;
  Object.defineProperty(original, 'continuation', {
    get() {
      reads++;
      return {};
    },
  });
  assert.equal(actorStateContextPayload(original).continuation, undefined);
  assert.throws(() => actorStateContextPayload(original, { includeContinuation: true }));
  assert.equal(reads, 0);
  assert.throws(() =>
    actorStateContextPayload(
      { ...state(), continuation: { ...state().continuation, decision: 'fabricated' as never } },
      { includeContinuation: true },
    ),
  );
});

test('actual Director request receives the NPC next-step judgment alongside questions and plans', async () => {
  const actor = state();
  const snapshot: DirectorSnapshot = {
    schemaVersion: 1,
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 1,
    storyAt: '2026-10-27T08:01:00.000Z',
    observedThroughVersion: 1,
    evaluatedThroughVersion: 0,
    boundary: {
      worldId: 'w',
      actorIds: ['a'],
      placeIds: [],
      capabilityIds: [],
      extensionPermission: 'none',
      createdFromVersion: 1,
      sourceEventId: 'e',
    },
    actorStates: [actor],
    episodes: [],
    candidates: [],
    blockers: [],
    changes: [],
    observations: [],
    focus: [],
  };
  let captured: any;
  const model = new WorldDirectorAgentModel({
    async complete(messages) {
      captured = JSON.parse(messages[1]!.content);
      return '{}';
    },
  });
  await model.decide(snapshot);
  assert.deepEqual(captured.actorStates[0].continuation, actor.continuation);
  assert.deepEqual(captured.actorStates[0].decisions, []);
});
