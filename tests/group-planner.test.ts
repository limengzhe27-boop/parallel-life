import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGroupPlanner } from '../src/modules/world/infrastructure/group-planner.ts';
import { planGroupTurn } from '../src/modules/world/application/group-turn.ts';
import type { GroupRead } from '../src/modules/world/application/group-ports.ts';
const read: GroupRead = {
  world: {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'u',
    version: 1,
    title: '试拍',
    time: '2026-10-08T00:00:00.000Z',
    actors: [{ id: 'a', name: '搭档', persona: '摄影' }],
    facts: [
      {
        id: 'secret',
        text: 'PRIVATE_FACT',
        kind: 'canonical',
        sourceEventId: 'e',
        visibility: { kind: 'actors', actorIds: ['a'] },
      },
      {
        id: 'public',
        text: '作品要投影展',
        kind: 'canonical',
        sourceEventId: 'e',
        visibility: { kind: 'world' },
      },
    ],
    messages: [
      {
        id: 'private',
        actorId: 'a',
        role: 'user',
        text: 'PRIVATE_CHAT',
        at: '2026-10-08T00:00:00.000Z',
        sourceEventId: 'e',
      },
    ],
    appointments: [],
    mediaRequests: [],
  },
  context: {
    world: {
      id: 'w',
      ownerId: 'u',
      version: 1,
      actors: [{ id: 'a', name: '搭档', persona: '摄影' }],
    },
    events: [{ id: 'e', ownerId: 'u', worldId: 'w', version: 1 }],
  },
  group: {
    id: 'g',
    ownerId: 'u',
    worldId: 'w',
    title: '试拍群',
    sourceEventId: 'e',
    sourceVersion: 1,
    memberships: [
      { participant: { kind: 'player' }, joinedVersion: 1, sourceEventId: 'e', sourceVersion: 1 },
      {
        participant: { kind: 'actor', actorId: 'a' },
        joinedVersion: 1,
        sourceEventId: 'e',
        sourceVersion: 1,
      },
    ],
  },
  messages: [],
};
test('group planner input has public facts and scoped group history, no private conversation or private fact', async () => {
  let calls = 0;
  const result = await planGroupTurn(
    read,
    '@a 先拍哪段',
    new WorldGroupPlanner({
      async complete(messages) {
        calls++;
        assert(!JSON.stringify(messages).includes('PRIVATE_'));
        assert(JSON.stringify(messages).includes('作品要投影展'));
        return JSON.stringify({ text: '先拍片头吧，我来架机位。' });
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result[0]!.actorId, 'a');
});
test('malformed, foreign authors, media and action results are rejected instead of rewritten as success', async () => {
  for (const raw of [
    '假回复',
    JSON.stringify({ text: '我已经拍好了', actorId: 'other' }),
    JSON.stringify({ text: '照片发你', media: 'fake' }),
    JSON.stringify({ text: '你获奖了', completed: true }),
  ]) {
    await assert.rejects(
      new WorldGroupPlanner({
        async complete() {
          return raw;
        },
      }).propose({
        actor: read.world.actors[0]!,
        worldTitle: 'w',
        storyAt: read.world.time,
        publicFacts: [],
        groupTitle: 'g',
        members: [],
        messages: [],
      }),
    );
  }
});
