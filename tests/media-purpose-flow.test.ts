import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import { parseProposal } from '../src/modules/world/domain/validation.ts';
import type { WorldState, WorldEvent } from '../src/modules/world/domain/types.ts';
import { createMediaPipelineHandler } from '../src/modules/media/infrastructure/media-pipeline-handler.ts';
import { applyAgentStateEvent } from '../src/modules/world/domain/agent-state-event.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import { resolveCharacterReference } from '../src/modules/media/domain/character-reference-resolver.ts';
import { MediaPromptBuilder } from '../src/modules/media/domain/prompt-builder.ts';

const at = '2026-10-19T10:00:00.000Z';

test('an explicitly requested scene survives proposal validation and both world projections', () => {
  const world: WorldState = {
    schemaVersion: 1,
    id: 'world1',
    ownerId: 'owner1',
    version: 0,
    title: '场景用途',
    time: at,
    actors: [{ id: 'actor1', name: '阿宁', relationship: '朋友', persona: '摄影师' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const effects = parseProposal({
    schemaVersion: 1,
    effects: [
      { type: 'message.received', id: 'reply1', actorId: 'actor1', text: '我画给你看。' },
      {
        type: 'media.requested',
        id: 'media1',
        prompt: '一张临窗设计示意图，只有家具和阳光，没有人',
        mediaType: 'image',
        purpose: 'scene',
        targetActorId: 'actor1',
      },
    ],
  }).effects;
  const event: WorldEvent = {
    schemaVersion: 1,
    id: 'event1',
    commandId: 'command1',
    worldId: world.id,
    version: 1,
    occurredAt: at,
    type: 'turn.resolved',
    data: { actorId: 'actor1', userText: '画张室内示意图', effects },
  };
  const result = applyEvent(world, event);
  assert.equal(result.state.mediaRequests[0]?.purpose, 'scene');
  assert.equal(result.state.mediaRequests[0]?.targetActorId, 'actor1');
  assert.equal(result.jobs[0]?.purpose, 'scene');

  const stateAfter = emptyActorAgentState(
    { worldId: world.id, actorId: 'actor1' },
    'definition1',
    0,
  );
  stateAfter.revision = 1;
  stateAfter.projectedWorldVersion = 1;
  const silent = applyAgentStateEvent(world, {
    schemaVersion: 1,
    id: 'event2',
    commandId: 'command2',
    worldId: world.id,
    version: 1,
    occurredAt: at,
    storyAt: at,
    type: 'agent.state_committed',
    data: {
      actorId: 'actor1',
      agentRuntime: {
        schemaVersion: 1,
        engineEpoch: 2,
        inputReceiptId: 'receipt1',
        inputStoryAt: at,
        inputWorldVersion: 0,
        actorRevisionBefore: 0,
        actorRevisionAfter: 1,
        proposal: {
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
          statements: [],
        },
        results: [],
        stateAfter,
      },
      effects: [
        {
          type: 'media.requested',
          id: 'media2',
          prompt: '无人物的室内布置图',
          mediaType: 'image',
          purpose: 'scene',
          targetActorId: 'actor1',
        },
      ],
    },
  });
  assert.equal(silent.mediaRequests[0]?.purpose, 'scene');

  assert.throws(
    () =>
      parseProposal({
        schemaVersion: 1,
        effects: [
          {
            type: 'media.requested',
            id: 'bad1',
            prompt: '图',
            mediaType: 'image',
            purpose: 'character_action',
          },
        ],
      }),
    { code: 'INVALID_PROPOSAL' },
  );
});

test('scene with NPC sender remains a pure scene, without portrait anchor', () => {
  const intent = {
    purpose: 'scene' as const,
    sceneDescription: '一张临窗设计示意图，只有家具和阳光，没有人',
    targetActorId: 'actor1',
  };
  const resolution = resolveCharacterReference({
    intent,
    callerActorId: 'actor1',
    isCallerPlayer: false,
    targetAnchor: {
      actorId: 'actor1',
      name: '阿宁',
      isPlayer: false,
      authorizedForWorld: true,
    },
  });
  assert.equal(resolution.allowed, true);
  if (!resolution.allowed) return;
  assert.equal(resolution.mode, 'pure_scene');
  const prompt = new MediaPromptBuilder().buildImagePrompt({
    intent,
    characterSnippet: resolution.characterPromptSnippet,
    hasReferenceImage: false,
    targetModel: 'flux-schnell',
  }).prompt;
  assert.doesNotMatch(prompt, /A portrait of/);
  assert.match(prompt, /临窗设计示意图/);
});

test('worker forwards explicit image/video purpose and retains legacy purpose fallback', async () => {
  const seen: { purpose: string; targetActorId?: string }[] = [];
  let doc: Record<string, unknown> = {};
  const sql = {
    async query(statement: string) {
      if (statement.includes('SELECT m.document'))
        return { rows: [{ document: doc, world_id: 'world1', outbox_id: null }] };
      if (statement.includes('SELECT count(*)')) return { rows: [{ count: 0 }] };
      if (statement.includes('SELECT state->>')) return { rows: [{ status: 'active' }] };
      return { rows: [] };
    },
  };
  const queue = {
    async read(_lease: unknown, task: (db: typeof sql) => Promise<unknown>) {
      return task(sql);
    },
  };
  const stopped = Object.assign(new Error('stop before provider call'), { code: 'TEST_STOP' });
  const service = {
    async executeImagePipeline(input: { intent: { purpose: string; targetActorId?: string } }) {
      seen.push(input.intent);
      throw stopped;
    },
    async executeVideoPipeline(input: { intent: { purpose: string; targetActorId?: string } }) {
      seen.push(input.intent);
      throw stopped;
    },
  };
  const handler = createMediaPipelineHandler(queue as never, service as never);
  const lease = { kind: 'media', scopeId: 'media1', ownerId: 'owner1' } as never;
  for (const [mediaType, purpose, expected] of [
    ['image', 'scene', 'scene'],
    ['video', 'scene_moment', 'scene_moment'],
    ['image', undefined, 'portrait'],
    ['video', undefined, 'character_action'],
  ] as const) {
    doc = {
      id: 'media1',
      sourceEventId: 'event1',
      mediaType,
      purpose,
      prompt: '窗边图像',
      targetActorId: 'actor1',
    };
    await assert.rejects(handler(lease), stopped);
    assert.deepEqual(seen.at(-1), {
      purpose: expected,
      targetActorId: expected === 'scene_moment' ? undefined : 'actor1',
      ...(mediaType === 'image'
        ? { sceneDescription: '窗边图像' }
        : { actionDescription: '窗边图像' }),
      sourceEventId: 'event1',
      deliveryIntent: undefined,
    });
  }
});
