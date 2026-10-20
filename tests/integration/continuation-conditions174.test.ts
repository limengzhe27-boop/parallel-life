import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../../src/modules/world/domain/agent-kernel.ts';
import { validateActorContinuation } from '../../src/modules/world/domain/actor-continuation.ts';
import { npcResponseFormat } from '../../src/modules/world/infrastructure/npc-model-protocol.ts';

function fixture() {
  const worldId = randomUUID(),
    actorId = randomUUID(),
    inputId = randomUUID(),
    placeId = 'shop';
  const state = emptyActorAgentState({ worldId, actorId }, 'author:actor:continuation174', 0);
  state.plans.push({
    id: 'p-known',
    goalId: 'g-known',
    summary: 'Wait for the known place',
    status: 'waiting',
    actionIds: [],
    nextActionId: null,
    triggers: [{ kind: 'at_place', placeId }],
    missingConditions: [],
    sourceIds: [inputId],
  });
  state.goals.push({
    id: 'g-known',
    summary: 'Own goal',
    status: 'active',
    resultIds: [],
    sourceIds: [inputId],
  });
  const sources = [
    {
      id: inputId,
      kind: 'accepted_input' as const,
      recordId: inputId,
      worldVersion: 0,
      at: '2026-10-20T08:00:00.000Z',
    },
  ];
  const context: AgentValidationContext = {
    state,
    viewState: structuredClone(state),
    sources,
    worldVersion: 0,
    storyAt: '2026-10-20T08:00:00.000Z',
    input: { sourceId: inputId, text: 'Continue.', origin: 'player' },
    channel: { kind: 'private', threadId: actorId, allowedCapabilities: [] },
  };
  return { context, inputId, placeId };
}

function proposal(
  decision: 'await_response' | 'await_condition' | 'no_current_intent',
  conditions: unknown[],
  inputId: string,
) {
  return {
    continuation: {
      decision,
      reason: 'My own next step.',
      sourceIds: [inputId],
      planIds: decision === 'await_condition' ? [] : ['p-known'],
      questionIds: [],
      conditions,
    },
    statements: [],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
}

test('44-174 await_response/no_current_intent carry no place or deadline conditions', () => {
  const f = fixture();
  const schema: any = npcResponseFormat(f.context.state, 'required', {
    input: f.context.input,
    channel: f.context.channel,
    sources: f.context.sources,
  });
  console.error(
    'SCHEMA_DEBUG',
    JSON.stringify({
      format: schema.format,
      keys: Object.keys(schema),
      schemaKeys: schema.schema ? Object.keys(schema.schema) : null,
      props: schema.schema?.properties ? Object.keys(schema.schema.properties) : null,
    }),
  );
  const changes = schema.schema.properties.changes;
  const continuation = changes.properties.continuation;
  const continuations = (continuation.anyOf ?? [continuation]).filter(
    (node: any) => node.type === 'object',
  );
  const response = continuations.find(
    (node: any) => node.properties.decision.enum[0] === 'await_response',
  );
  const condition = continuations.find(
    (node: any) => node.properties.decision.enum[0] === 'await_condition',
  );
  const quiet = continuations.find(
    (node: any) => node.properties.decision.enum[0] === 'no_current_intent',
  );
  assert.equal(response.properties.conditions.maxItems, 0);
  assert.equal(quiet.properties.conditions.maxItems, 0);
  assert.equal(condition.properties.conditions.minItems, 1);
});

test('44-174 valid await_response stays valid and fake place/deadline sources are rejected', () => {
  const f = fixture();
  const valid = proposal('await_response', [], f.inputId);
  assert.doesNotThrow(() => validateActorContinuation(f.context, valid as any));
  const awaitCondition = proposal(
    'await_condition',
    [{ kind: 'at_place', placeId: 'invented-place' }],
    f.inputId,
  );
  assert.throws(
    () => validateActorContinuation(f.context, awaitCondition as any),
    /INVALID_ACTOR_CONTINUATION/,
  );
  const noSourceDeadline = proposal(
    'await_condition',
    [{ kind: 'at_or_after', at: '2026-10-21T08:00:00.000Z', sourceId: randomUUID() }],
    f.inputId,
  );
  assert.throws(
    () => validateActorContinuation(f.context, noSourceDeadline as any),
    /INVALID_ACTOR_CONTINUATION/,
  );
  const foreignObservation = proposal(
    'await_condition',
    [{ kind: 'observation', sourceId: randomUUID() }],
    f.inputId,
  );
  assert.throws(
    () => validateActorContinuation(f.context, foreignObservation as any),
    /INVALID_ACTOR_CONTINUATION/,
  );
});
