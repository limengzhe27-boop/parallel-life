import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  type AgentValidationContext,
  validateAgentProposal,
} from '../src/modules/world/domain/agent-kernel.ts';
import { AgentProposalSchema } from '../src/modules/world/infrastructure/agent-proposal-schema.ts';
import {
  NativeMediaIntentSchema,
  compileNpcMediaIntent,
  nativeMediaIntentIds,
  NPC_MEDIA_CURRENT_REF,
} from '../src/modules/world/infrastructure/npc-media-intent.ts';

function fixture(): AgentValidationContext {
  return {
    state: emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 3),
    worldVersion: 3,
    storyAt: '2026-10-19T10:00:00.000Z',
    input: {
      origin: 'player',
      sourceId: 'accepted-input',
      text: 'Would you like to send a picture?',
    },
    sources: [
      {
        id: 'accepted-input',
        kind: 'accepted_input',
        recordId: 'accepted-input',
        at: '2026-10-19T10:00:00.000Z',
        worldVersion: 3,
      },
    ],
    channel: {
      kind: 'private',
      threadId: 'actor',
      allowedCapabilities: ['media.generate_image', 'media.generate_video'],
    },
  };
}
const image = () => ({
  kind: 'generate_image',
  goalSummary: 'Request a fictional self portrait',
  planSummary: 'Submit one portrait request; wait for its real result',
  parameters: {
    sceneDescription: 'A neutral fictional portrait, without claiming a real location.',
    purpose: 'portrait',
  },
  basisSourceIds: ['accepted-input'],
});

test('only explicit active media kind compiles; refusal and absent request remain null', () => {
  const context = fixture(),
    before = structuredClone(context);
  assert.equal(compileNpcMediaIntent(context, { kind: 'decline' }), null);
  assert.equal(compileNpcMediaIntent(context, { kind: 'not_requested' }), null);
  assert.throws(() => compileNpcMediaIntent(context, 'I will send you a photo'));
  assert.throws(() => compileNpcMediaIntent(context, {}));
  assert.throws(() => compileNpcMediaIntent(context, { kind: 'decline', execution: null }));
  assert.deepEqual(context, before);
});

test('explicit image semantics compile into the existing proposal with no execution or completion claim', () => {
  const context = fixture(),
    raw = image(),
    before = structuredClone(context);
  const execution = compileNpcMediaIntent(context, raw)!;
  assert.equal(NPC_MEDIA_CURRENT_REF, 'media:current');
  assert.deepEqual(execution.action.parameters, raw.parameters);
  assert.equal(execution.action.capability, 'media.generate_image');
  assert.deepEqual(execution.action.targetIds, ['actor']);
  assert.deepEqual(execution.action.sourceIds, ['accepted-input']);
  assert.deepEqual(execution.action.handlesResponsibilityIds, []);
  const proposal = AgentProposalSchema.parse({
    statements: [
      {
        text: 'I will submit a portrait request; its result is still pending.',
        dependsOnActionIds: [],
      },
    ],
    goals: [
      {
        id: execution.goal.id,
        summary: execution.goal.summary,
        status: 'active',
        sourceIds: execution.goal.sourceIds,
        resultIds: [],
      },
    ],
    plans: [
      {
        id: execution.plan.id,
        goalId: execution.goal.id,
        summary: execution.plan.summary,
        status: 'active',
        sourceIds: execution.plan.sourceIds,
        actionIds: [execution.action.id],
        nextActionId: execution.action.id,
        triggers: [],
        missingConditions: [],
      },
    ],
    actions: [{ ...execution.action, goalId: execution.goal.id, status: 'proposed' }],
    responsibilities: [],
    decisions: [],
  });
  validateAgentProposal(context, proposal);
  assert.equal(proposal.goals[0]!.status, 'active');
  assert.deepEqual(proposal.goals[0]!.resultIds, []);
  assert.equal(Object.hasOwn(execution.action, 'resultId'), false);
  assert.deepEqual(context, before);
  execution.goal.sourceIds.push('mutated-result');
  assert.deepEqual(raw.basisSourceIds, ['accepted-input']);
  assert.deepEqual(execution.plan.sourceIds, ['accepted-input']);
  assert.deepEqual(execution.action.sourceIds, ['accepted-input']);
});

test('video exposes only semantic parameters actually consumed by the original executor', () => {
  const raw = {
    ...image(),
    kind: 'generate_video',
    parameters: {
      actionDescription: 'A fictional short wave at the camera.',
      purpose: 'character_action',
    },
  };
  const execution = compileNpcMediaIntent(fixture(), raw)!;
  assert.equal(execution.action.capability, 'media.generate_video');
  assert.deepEqual(execution.action.parameters, raw.parameters);
  for (const parameters of [
    { ...raw.parameters, durationSeconds: 6 },
    { ...raw.parameters, deliveryIntent: { channel: 'chat' } },
    { ...raw.parameters, targetActorId: 'other' },
    { ...raw.parameters, purpose: 'portrait' },
  ])
    assert.equal(NativeMediaIntentSchema.safeParse({ ...raw, parameters }).success, false);
  assert.equal(
    NativeMediaIntentSchema.safeParse({
      ...image(),
      parameters: { ...image().parameters, aspectRatio: '9:16' },
    }).success,
    false,
  );
  assert.equal(
    NativeMediaIntentSchema.safeParse({ kind: 'share_existing', assetId: 'asset' }).success,
    false,
  );
});

test('source basis stays explicit and limited to the supplied scope, including current wake input', () => {
  const context = fixture();
  context.sources.push({
    id: 'own-memory',
    kind: 'private_message',
    recordId: 'own-memory',
    worldVersion: 2,
    at: '2026-10-19T09:00:00.000Z',
  });
  assert.deepEqual(
    compileNpcMediaIntent(context, {
      ...image(),
      basisSourceIds: ['own-memory', 'accepted-input'],
    })!.action.sourceIds,
    ['own-memory', 'accepted-input'],
  );
  assert.throws(() => compileNpcMediaIntent(context, { ...image(), basisSourceIds: [] }), {
    code: 'NPC_MEDIA_INTENT_SHAPE',
  });
  for (const basisSourceIds of [
    ['own-memory'],
    ['accepted-input', 'foreign-source'],
    ['accepted-input', 'accepted-input'],
  ]) {
    assert.throws(() => compileNpcMediaIntent(context, { ...image(), basisSourceIds }), {
      code: 'NPC_MEDIA_INTENT_SOURCE',
    });
  }
  const wake = fixture();
  wake.input = { origin: 'wake', sourceId: 'system-wake', text: 'Own real trigger' };
  wake.sources = [
    { ...wake.sources[0]!, id: 'system-wake', recordId: 'system-wake', kind: 'world_event' },
  ];
  assert.deepEqual(
    compileNpcMediaIntent(wake, { ...image(), basisSourceIds: ['system-wake'] })!.action.sourceIds,
    ['system-wake'],
  );
  assert.throws(() => compileNpcMediaIntent(wake, image()), { code: 'NPC_MEDIA_INTENT_SOURCE' });
});

test('IDs remain stable for one accepted input, and independent across actor, world, kind and input', () => {
  const context = fixture();
  const ids = nativeMediaIntentIds(context, 'generate_image');
  assert.deepEqual(nativeMediaIntentIds(context, 'generate_image'), ids);
  assert.deepEqual(compileNpcMediaIntent(context, image())!.action.id, ids.actionId);
  const later = structuredClone(context);
  later.storyAt = '2026-10-20T10:00:00.000Z';
  later.worldVersion++;
  assert.deepEqual(nativeMediaIntentIds(later, 'generate_image'), ids);
  for (const field of ['actorId', 'worldId'] as const) {
    const other = structuredClone(context);
    other.state[field] = 'other';
    assert.notEqual(nativeMediaIntentIds(other, 'generate_image').actionId, ids.actionId);
  }
  const other = structuredClone(context);
  other.input.sourceId = 'different-input';
  assert.notEqual(nativeMediaIntentIds(other, 'generate_image').actionId, ids.actionId);
  assert.notEqual(nativeMediaIntentIds(context, 'generate_video').actionId, ids.actionId);
  assert.ok(new Set(Object.values(ids)).size === 3);
  assert.ok(Object.values(ids).every((id) => id.length <= 240));
});

test('existing authoritative or redacted state IDs are never overwritten or fulfilled', () => {
  for (const field of ['goals', 'plans', 'actions'] as const) {
    const context = fixture(),
      ids = nativeMediaIntentIds(context, 'generate_image');
    const id = field === 'goals' ? ids.goalId : field === 'plans' ? ids.planId : ids.actionId;
    (context.state[field] as { id: string }[]).push({ id });
    const before = structuredClone(context);
    assert.throws(() => compileNpcMediaIntent(context, image()), {
      code: 'NPC_MEDIA_INTENT_ID_CONFLICT',
    });
    assert.deepEqual(context, before);
  }
  const context = fixture();
  context.viewState = structuredClone(context.state);
  const id = nativeMediaIntentIds(context, 'generate_image').actionId;
  (context.state.actions as { id: string }[]).push({ id });
  assert.throws(() => compileNpcMediaIntent(context, image()), {
    code: 'NPC_MEDIA_INTENT_ID_CONFLICT',
  });
});

test('capability absence and model-supplied IDs, execution state or extra parameters fail closed', () => {
  const context = fixture();
  context.channel.allowedCapabilities = [];
  assert.throws(() => compileNpcMediaIntent(context, image()), {
    code: 'NPC_MEDIA_INTENT_CAPABILITY',
  });
  assert.equal(compileNpcMediaIntent(context, { kind: 'decline' }), null);
  for (const raw of [
    { ...image(), id: 'chosen-id' },
    { ...image(), status: 'succeeded' },
    { ...image(), resultIds: ['fake'] },
    { ...image(), parameters: { ...image().parameters, targetActorId: 'other' } },
    { ...image(), parameters: { ...image().parameters, sceneDescription: '' } },
    { ...image(), parameters: { ...image().parameters, purpose: 'author_asset' } },
  ])
    assert.throws(() => compileNpcMediaIntent(fixture(), raw), { code: 'NPC_MEDIA_INTENT_SHAPE' });
});

test('an executing media action suppresses duplicate media intent without consuming the turn', () => {
  const context = fixture();
  context.state.actions.push({
    id: 'media-action:pending',
    goalId: null,
    capability: 'media.generate_image',
    targetIds: ['actor'],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['accepted-input'],
    status: 'executing',
  });
  const before = structuredClone(context);
  assert.equal(compileNpcMediaIntent(context, image()), null);
  assert.deepEqual(context, before);
});
