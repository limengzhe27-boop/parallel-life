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

test('long group history retains a complete latest input within the model budget', async () => {
  const text = '保留当前问题'.repeat(600);
  const input = {
    actor: read.world.actors[0]!,
    worldTitle: read.world.title,
    storyAt: read.world.time,
    publicFacts: [],
    groupTitle: read.group.title,
    members: [],
    messages: Array.from({ length: 80 }, (_, i) => ({
      id: 'm' + i,
      ownerId: 'u',
      worldId: 'w',
      sourceEventId: 'e',
      sourceVersion: 1,
      conversationId: 'g',
      sender: { kind: 'player' as const },
      text: i === 79 ? text : '过去的长消息'.repeat(600),
      media: [],
    })),
  };
  const planner = new WorldGroupPlanner({
    async complete(messages) {
      const payload = messages.at(-1)!.content;
      assert.ok(payload.length <= 24000);
      assert.equal(JSON.parse(payload).messages.at(-1).text, text);
      assert.ok(JSON.parse(payload).messages.length < 80);
      return JSON.stringify({ text: '我看到了，先试一下。' });
    },
  });
  await planner.propose(input);
});

test('a minute-rounded past invitation is rejected without retrying or hiding the model response', async () => {
  let calls = 0;
  const planner = new WorldGroupPlanner({
    async complete() {
      calls++;
      return JSON.stringify({
        text: '一起试试吧。',
        invitation: { title: '试灯', at: '2026-10-08T08:00:00+08:00' },
      });
    },
  });
  await assert.rejects(
    planner.propose({
      actor: read.world.actors[0]!,
      worldTitle: read.world.title,
      storyAt: '2026-10-08T00:00:51.000Z',
      publicFacts: [],
      groupTitle: read.group.title,
      members: [],
      messages: [],
    }),
    { code: 'INVALID_RESPONSE' },
  );
  assert.equal(calls, 1);
});

test('an empty optional invitation means no invitation while partial filled objects still fail', async () => {
  const input = {
    actor: read.world.actors[0]!,
    worldTitle: read.world.title,
    storyAt: read.world.time,
    publicFacts: [],
    groupTitle: read.group.title,
    members: [],
    messages: [],
  };
  for (const invitation of [null, {}]) {
    const planner = new WorldGroupPlanner({
      async complete() {
        return JSON.stringify({ text: '先试两个机位。', invitation });
      },
    });
    assert.equal((await planner.propose(input)).invitation, undefined);
  }
  const planner = new WorldGroupPlanner({
    async complete() {
      return JSON.stringify({ text: '先试两个机位。', invitation: { title: '试拍' } });
    },
  });
  await assert.rejects(planner.propose(input), { code: 'INVALID_RESPONSE' });
});
