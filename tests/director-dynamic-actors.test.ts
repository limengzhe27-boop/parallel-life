import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import {
  eligibleStoryActors,
  evaluateStory,
  type StoryPlan,
} from '../src/modules/settings/domain/publication-story.ts';
import { advancePublicationStory } from '../src/server/publication-story-service.ts';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import type {
  PublicationStoryPort,
  PublicationStoryClaim,
} from '../src/modules/settings/application/publication-story-ports.ts';
import type { ClockStore } from '../src/modules/world/application/ports.ts';
import type { StoryOpportunityInput } from '../src/modules/world/application/ports.ts';

const script = '开始讨论自己的安排。'.repeat(500) + '尾段：玩家拒绝时，人物自己另作安排。';
const input: StoryOpportunityInput = {
  storyNow: '2026-10-14T09:00:00.000Z',
  worldTitle: '明确合成夹具',
  currentPlaceId: 'home',
  recentMessages: [],
  candidates: [
    {
      nodeKey: 'choice',
      title: '可选事件',
      editorialIntent: script,
      placeName: null,
      actorOptions: [
        { id: 'a', key: 'first', name: '同名人物' },
        { id: 'b', key: 'second', name: '同名人物' },
      ],
      places: [
        { key: 'hospital', name: '医院走廊' },
        { key: 'room', name: '母亲病房' },
      ],
    },
  ],
};
test('unassigned director explicitly chooses the second legal actor and receives the complete multi-place manuscript', async () => {
  let seen: StoryOpportunityInput | undefined;
  const planner = new WorldTurnPlanner({
    complete: async (messages) => {
      seen = JSON.parse(messages[1]!.content);
      return '{"nodeKey":"choice","actorId":"b"}';
    },
  });
  assert.deepEqual(await planner.chooseStoryOpportunity(input), {
    nodeKey: 'choice',
    actorId: 'b',
  });
  assert.equal(seen?.candidates[0]?.editorialIntent, script);
  assert.deepEqual(seen?.candidates[0]?.places, input.candidates[0]!.places);
  assert.equal(seen?.currentPlaceId, 'home');
});
test('an unassigned event never defaults to the first actor, and foreign actors or hidden extra decisions are rejected', async () => {
  for (const raw of [
    '{"nodeKey":"choice"}',
    '{"nodeKey":"choice","actorId":"foreign"}',
    '{"nodeKey":"choice","actorId":"a","arrived":true}',
  ]) {
    const planner = new WorldTurnPlanner({ complete: async () => raw });
    await assert.rejects(planner.chooseStoryOpportunity(input), /INVALID_STORY/);
  }
  assert.equal(
    await new WorldTurnPlanner({ complete: async () => '{"nodeKey":null}' }).chooseStoryOpportunity(
      input,
    ),
    null,
  );
});
test('dynamic actor options respect each actor’s actual historical knowledge and preserve the authored plan', () => {
  const plan: StoryPlan = {
    schemaVersion: 1,
    origin: { workId: 'w', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    timeline: null,
    actors: [
      { key: 'first', id: 'a' },
      { key: 'second', id: 'b' },
    ],
    places: [{ key: 'home', name: '家' }],
    history: [{ key: 'private', factIds: ['f'], allowedActorIds: ['b'] }],
    nodes: [
      {
        key: 'choice',
        kind: 'candidate',
        title: '事件',
        editorialIntent: script,
        actorKeys: [],
        prerequisites: [{ kind: 'history_fact', factKey: 'private' }],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
      },
    ],
  };
  const before = JSON.stringify(plan);
  const context = {
    storyNow: input.storyNow,
    currentPlaceId: 'home',
    availableFactIds: ['f'],
    automatic: false,
  };
  assert.deepEqual(eligibleStoryActors(plan, plan.nodes[0]!, [], context), [
    { key: 'second', id: 'b' },
  ]);
  assert.equal(evaluateStory(plan, [], context).eligible[0]?.key, 'choice');
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(
    eligibleStoryActors(plan, plan.nodes[0]!, [], { ...context, availableFactIds: [] }),
    [],
  );
});

test('a manuscript longer than player command limits reaches the character intact without becoming a player message', async () => {
  const worlds = new MemoryWorldRepository([
    {
      schemaVersion: 1,
      id: 'w',
      ownerId: 'o',
      version: 0,
      time: input.storyNow,
      title: '合成测试',
      actors: [{ id: 'b', name: '人物', persona: '自主安排' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
  ]);
  const claim: PublicationStoryClaim = {
    claimId: 'claim',
    commandId: 'command',
    nodeKey: 'choice',
    expectedVersion: 0,
    actorId: 'b',
    actorKey: 'second',
    placeId: null,
    placeName: null,
    editorialIntent: script,
    script,
    places: input.candidates[0]!.places,
    intent: { kind: 'director_event' },
    origin: { workId: 'work', draftVersion: 0, publicationVersion: 1, contentHash: 'a'.repeat(64) },
  };
  let cue = '',
    selectedActor = '';
  const story = {
    opportunities: async () => ({
      managed: true,
      directorPool: true,
      version: 0,
      storyNow: input.storyNow,
      candidates: input.candidates,
    }),
    beginSelection: async () => true,
    finishSelection: async () => {},
    prepare: async (_owner: string, _world: string, options: { actorId?: string }) => {
      selectedActor = options.actorId!;
      return { status: 'claimed', claim };
    },
    finish: async () => ({ currentStageKeys: [], totalNodes: 1, presented: [], pending: null }),
  } as unknown as PublicationStoryPort;
  const clock = {
    withAdvanceLock: async (_id: string, run: () => Promise<unknown>) => run(),
    read: async () => ({
      storyNow: input.storyNow,
      lastTickAt: input.storyNow,
      speed: 1,
      paused: false,
      missedBeats: 0,
      summary: null,
    }),
  } as unknown as ClockStore;
  await advancePublicationStory(
    {
      story,
      worlds,
      clock,
      now: () => input.storyNow,
      newId: () => 'event',
      planner: {
        chooseStoryOpportunity: async () => ({ nodeKey: 'choice', actorId: 'b' }),
        propose: async (i) => {
          cue = i.userText;
          return {
            schemaVersion: 1,
            effects: [
              { type: 'message.received', id: 'reply', actorId: 'b', text: '你先忙，我自己安排。' },
            ],
          };
        },
      },
    },
    'o',
    'w',
    false,
  );
  assert.equal(selectedActor, 'b');
  assert.ok(cue.includes(script));
  assert.ok(cue.length > 4000);
  const result = await worlds.get({ userId: 'o' }, 'w');
  assert.equal(result.version, 1);
  assert.equal(result.messages.filter((m) => m.role === 'user').length, 0);
});
