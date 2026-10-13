import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import { advancePublicationStory } from '../src/server/publication-story-service.ts';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import type {
  ClockStore,
  TurnPlanner,
  StoryOpportunityInput,
} from '../src/modules/world/application/ports.ts';
import type { PublicationStoryPort } from '../src/modules/settings/application/publication-story-ports.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const now = '2026-10-16T10:30:00.000Z';
const input: StoryOpportunityInput = {
  storyNow: now,
  worldTitle: '合成世界',
  currentPlaceId: null,
  recentMessages: [],
  candidates: [
    {
      nodeKey: 'optional',
      title: '一个可选机会',
      editorialIntent: '人物有一件想商量的事',
      actorId: 'a',
      placeName: null,
    },
  ],
};
test('director returns a validated optional selection or an explicit deferral; no fallback after bad output', async () => {
  for (const [raw, expected] of [
    ['{"nodeKey":null}', null],
    ['{"nodeKey":"optional"}', 'optional'],
  ] as const) {
    let calls = 0;
    const planner = new WorldTurnPlanner({
      complete: async () => {
        calls++;
        return raw;
      },
    });
    assert.equal(await planner.chooseStoryOpportunity(input), expected);
    assert.equal(calls, 1);
  }
  for (const raw of [
    '{"nodeKey":"ineligible"}',
    '{"nodeKey":"optional","extra":true}',
    '{}',
    'bad',
  ]) {
    let calls = 0;
    const planner = new WorldTurnPlanner({
      complete: async () => {
        calls++;
        return raw;
      },
    });
    await assert.rejects(planner.chooseStoryOpportunity(input), /INVALID_STORY_SELECTION/);
    assert.equal(calls, 1);
  }
});
function setup(selected: string | null, reserve = true) {
  const world: WorldState = {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'o',
    version: 0,
    time: now,
    title: '合成世界',
    actors: [{ id: 'a', name: '甲', persona: '说话简短' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const worlds = new MemoryWorldRepository([world]);
  const evidence: string[] = [];
  let prepared: unknown;
  const story = {
    opportunities: async () => ({
      managed: true,
      directorPool: true,
      version: 0,
      storyNow: now,
      candidates: input.candidates,
    }),
    beginSelection: async () => {
      evidence.push('reserve');
      return reserve;
    },
    finishSelection: async (_o: string, _w: string, _a: string, status: string) => {
      evidence.push(status);
    },
    prepare: async (_o: string, _w: string, options: unknown) => {
      prepared = options;
      evidence.push('prepare');
      return {
        status: 'claimed',
        claim: {
          claimId: 'claim',
          nodeKey: 'optional',
          commandId: 'cmd',
          expectedVersion: 0,
          actorId: 'a',
          actorKey: 'a',
          placeId: null,
          placeName: null,
          editorialIntent: '人物有一件想商量的事',
          intent: { kind: 'director_event', actorKey: 'a' },
          origin: {
            workId: 'work',
            publicationVersion: 1,
            draftVersion: 0,
            contentHash: 'a'.repeat(64),
          },
        },
      };
    },
    finish: async () => {
      evidence.push('receipt');
      return { currentStageKeys: [], totalNodes: 1, presented: [], pending: null };
    },
  } as unknown as PublicationStoryPort;
  const planner: TurnPlanner = {
    chooseStoryOpportunity: async () => {
      evidence.push('choose');
      return selected;
    },
    propose: async () => {
      evidence.push('perform');
      return {
        schemaVersion: 1,
        effects: [
          { type: 'message.received', id: 'reply', actorId: 'a', text: '我有件事想和你商量。' },
        ],
      };
    },
  };
  const clock = {
    withAdvanceLock: async (_w: string, run: () => Promise<unknown>) => run(),
    read: async () => ({
      storyNow: now,
      lastTickAt: now,
      speed: 1,
      paused: false,
      missedBeats: 0,
      summary: null,
    }),
  } as unknown as ClockStore;
  return {
    deps: { story, worlds, planner, clock, now: () => now, newId: () => 'evt' },
    evidence,
    prepared: () => prepared,
  };
}
test('deferral and cooldown spend no character call and claim no event', async () => {
  for (const [selected, reserve, expected] of [
    [null, true, ['reserve', 'choose', 'deferred']],
    ['optional', false, ['reserve']],
  ] as const) {
    const s = setup(selected, reserve);
    const result = await advancePublicationStory(s.deps, 'o', 'w', true);
    assert.equal(result.result?.played, 0);
    assert.deepEqual(s.evidence, expected);
    assert.equal((await s.deps.worlds.get({ userId: 'o' }, 'w')).version, 0);
  }
});
test('selection is rechecked before an actual sourced character turn, without an invitation or protagonist action', async () => {
  const s = setup('optional');
  const result = await advancePublicationStory(s.deps, 'o', 'w', false);
  assert.equal(result.result?.played, 1);
  assert.deepEqual(s.evidence, ['reserve', 'choose', 'selected', 'prepare', 'perform', 'receipt']);
  assert.deepEqual(s.prepared(), { automatic: false, nodeKey: 'optional', expectedVersion: 0 });
  const w = await s.deps.worlds.get({ userId: 'o' }, 'w');
  assert.equal(w.messages.length, 1);
  assert.equal(w.messages[0]!.role, 'assistant');
  assert.equal(w.appointments.length, 0);
});
test('failed or injected selection is persisted unknown, never silently replaced with another event', async () => {
  const s = setup('not-in-pool');
  await assert.rejects(advancePublicationStory(s.deps, 'o', 'w', true));
  assert.deepEqual(s.evidence, ['reserve', 'choose', 'unknown']);
  assert.equal((await s.deps.worlds.get({ userId: 'o' }, 'w')).version, 0);
});
test('a general event cannot invent a calendar commitment', async () => {
  const s = setup('optional');
  s.deps.planner.propose = async () => ({
    schemaVersion: 1,
    effects: [
      { type: 'message.received', id: 'r', actorId: 'a', text: '我们约好了。' },
      {
        type: 'appointment.proposed',
        id: 'i',
        title: '无来源邀约',
        at: '2026-10-17T10:00:00.000Z',
        participantIds: ['a'],
      },
    ],
  });
  await assert.rejects(advancePublicationStory(s.deps, 'o', 'w', true));
  assert.equal((await s.deps.worlds.get({ userId: 'o' }, 'w')).appointments.length, 0);
});

import {
  evaluateStory,
  type StoryPlan,
  type StoryState,
} from '../src/modules/settings/domain/publication-story.ts';
test('an opened event prerequisite requires a persisted real presentation and does not require player completion', () => {
  const plan: StoryPlan = {
    schemaVersion: 1,
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    timeline: null,
    actors: [{ key: 'a', id: 'a' }],
    places: [],
    history: [],
    nodes: [
      {
        key: 'first',
        kind: 'candidate',
        title: '开始',
        editorialIntent: '第一次商量',
        actorKeys: ['a'],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event', actorKey: 'a' },
      },
      {
        key: 'later',
        kind: 'candidate',
        title: '之后',
        editorialIntent: '后续商量',
        actorKeys: ['a'],
        prerequisites: [{ kind: 'after_presented_node', nodeKey: 'first' }],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event', actorKey: 'a' },
      },
    ],
  };
  const state: StoryState = {
    nodeKey: 'first',
    claimId: 'c',
    commandId: 'cmd',
    actorId: 'a',
    expectedVersion: 0,
    status: 'presented',
    outcome: null,
    storyAt: now,
    automatic: false,
    sourceEventId: 'saved-event',
    sourceMessageId: 'saved-message',
    invitationId: null,
    responseEventId: null,
  };
  const evaluate = (states: StoryState[]) =>
    evaluateStory(plan, states, {
      storyNow: now,
      currentPlaceId: null,
      availableFactIds: [],
      automatic: false,
    }).eligible.map((n) => n.key);
  assert.deepEqual(evaluate([]), ['first']);
  assert.deepEqual(evaluate([state]), ['later']);
  assert.deepEqual(evaluate([{ ...state, sourceEventId: null }]), []);
  for (const status of ['claimed', 'unknown', 'failed'] as const)
    assert.deepEqual(evaluate([{ ...state, status }]), []);
  assert.equal(state.outcome, null);
});

test('a changed world or newly invalid prerequisite stops before character generation', async () => {
  const s = setup('optional');
  s.deps.story.prepare = async () => {
    s.evidence.push('recheck-conflict');
    throw new Error('VERSION_CONFLICT');
  };
  await assert.rejects(advancePublicationStory(s.deps, 'o', 'w', true), /VERSION_CONFLICT/);
  assert.deepEqual(s.evidence, ['reserve', 'choose', 'selected', 'recheck-conflict']);
  assert.equal((await s.deps.worlds.get({ userId: 'o' }, 'w')).version, 0);
});
