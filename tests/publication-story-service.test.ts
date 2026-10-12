import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePublicationStory,
  validateStoryInvitation,
} from '../src/server/publication-story-service.ts';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { ClockStore } from '../src/modules/world/application/ports.ts';
import type {
  PublicationStoryPort,
  PublicationStoryPrepare,
  PublicationStoryClaim,
} from '../src/modules/settings/application/publication-story-ports.ts';

const time = '2026-10-16T10:30:00.000Z';
test('a presented invitation uses the same guard as a director offer, while allowing refusal', () => {
  const intention = { title: '约定', earliestAt: '2026-10-16T11:30:00.000Z' };
  const reply = { type: 'message.received' as const, id: 'r', actorId: 'a', text: '今天不约。' };
  const invite = {
    type: 'appointment.proposed' as const,
    id: 'i',
    title: '约定',
    at: '2026-10-16T11:30:00.000Z',
    participantIds: ['a'],
  };
  validateStoryInvitation({ schemaVersion: 1, effects: [reply] }, 'a', intention);
  validateStoryInvitation({ schemaVersion: 1, effects: [reply, invite] }, 'a', intention);
  for (const invalid of [
    { ...invite, title: '别的事' },
    { ...invite, at: '2026-10-16T11:00:00.000Z' },
    { ...invite, participantIds: ['b'] },
  ])
    assert.throws(() =>
      validateStoryInvitation({ schemaVersion: 1, effects: [reply, invalid] }, 'a', intention),
    );
  assert.throws(() =>
    validateStoryInvitation(
      { schemaVersion: 1, effects: [reply, invite, { ...invite, id: 'another' }] },
      'a',
      intention,
    ),
  );
});
const claim: PublicationStoryClaim = {
  claimId: 'claim',
  nodeKey: 'dinner',
  commandId: 'command',
  expectedVersion: 0,
  actorId: 'a',
  actorKey: 'a',
  placeId: 'restaurant',
  placeName: '餐厅',
  editorialIntent: '询问主角是否有时间见面，不预设答应',
  intent: {
    kind: 'offer_invitation',
    actorKeys: ['a'],
    placeKey: 'restaurant',
    title: '晚饭',
    earliestAt: '2026-10-16T11:30:00.000Z',
  },
  origin: { workId: 'work', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
};
function setup(prepared: PublicationStoryPrepare, paused = false) {
  const seed: WorldState = {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'o',
    version: 0,
    time,
    title: '合成世界',
    actors: [
      { id: 'a', name: '青青', persona: '短句，不替别人答应' },
      { id: 'b', name: '其他人', persona: '另一个人物' },
    ],
    facts: [
      {
        id: 'private',
        text: 'PRIVATE_OWNER_ONLY',
        visibility: { kind: 'owner' },
        sourceEventId: 'genesis',
      },
    ],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const worlds = new MemoryWorldRepository([seed]);
  let calls = 0,
    finishes = 0,
    seen = '';
  const story = {
    prepare: async () => prepared,
    finish: async () => {
      finishes++;
      return { currentStageKeys: [], totalNodes: 1, presented: [], pending: null };
    },
  } as unknown as PublicationStoryPort;
  const clock = {
    withAdvanceLock: async (_w: string, run: () => Promise<unknown>) => run(),
    read: async () => ({
      storyNow: time,
      lastTickAt: time,
      speed: 1,
      paused,
      missedBeats: 0,
      summary: null,
    }),
  } as unknown as ClockStore;
  const deps = {
    worlds,
    story,
    clock,
    now: () => time,
    newId: () => 'event',
    planner: {
      async propose(input: unknown): Promise<unknown> {
        calls++;
        seen = JSON.stringify(input);
        return {
          schemaVersion: 1,
          effects: [
            {
              type: 'message.received',
              id: 'local',
              actorId: 'a',
              text: '晚上有空吗？我想请你吃顿饭。',
            },
            {
              type: 'appointment.proposed',
              id: 'local_invite',
              title: '晚饭',
              at: '2026-10-16T11:30:00.000Z',
              participantIds: ['a'],
            },
          ],
        };
      },
    },
  };
  return { deps, counts: () => ({ calls, finishes, seen }) };
}
test('a sourced story offer uses character context and persists an unaccepted invitation', async () => {
  const s = setup({ status: 'claimed', claim });
  const result = await advancePublicationStory(s.deps, 'o', 'w', false);
  assert.equal(result.handled, true);
  assert.equal(result.result?.played, 1);
  assert.equal(s.counts().calls, 1);
  assert.equal(s.counts().finishes, 1);
  assert.ok(!s.counts().seen.includes('PRIVATE_OWNER_ONLY'));
  assert.ok(s.counts().seen.includes('"storyInvitation"'));
  assert.ok(s.counts().seen.includes('"earliestAt":"2026-10-16T11:30:00.000Z"'));
  const w = await s.deps.worlds.get({ userId: 'o' }, 'w');
  assert.equal(w.messages.filter((m) => m.role === 'user').length, 0);
  assert.equal(w.appointments.length, 1);
  assert.equal(w.appointments[0]!.status, 'proposed');
  assert.deepEqual(w.appointments[0]!.participantIds, ['a']);
});
test('a character refusal remains a real message, without a fabricated invitation', async () => {
  const s = setup({ status: 'claimed', claim });
  s.deps.planner.propose = async () => ({
    schemaVersion: 1,
    effects: [{ type: 'message.received', id: 'no', actorId: 'a', text: '今天不能约，别来了。' }],
  });
  await advancePublicationStory(s.deps, 'o', 'w', false);
  const w = await s.deps.worlds.get({ userId: 'o' }, 'w');
  assert.equal(w.appointments.length, 0);
  assert.equal(w.messages[0]!.text, '今天不能约，别来了。');
  assert.equal(s.counts().finishes, 1);
});
test('authored time without milliseconds is normalized in the cue and earliest is a lower bound', async () => {
  const later = {
    ...claim,
    intent: {
      ...claim.intent,
      kind: 'offer_invitation' as const,
      actorKeys: ['a'],
      placeKey: 'restaurant',
      title: '晚饭',
      earliestAt: '2026-10-16T09:30:00Z',
    },
  };
  const s = setup({ status: 'claimed', claim: later });
  await advancePublicationStory(s.deps, 'o', 'w', false);
  assert.ok(s.counts().seen.includes('2026-10-16T09:30:00.000Z'));
  assert.equal(
    (await s.deps.worlds.get({ userId: 'o' }, 'w')).appointments[0]!.at,
    '2026-10-16T11:30:00.000Z',
  );
  assert.ok(s.counts().seen.includes('2026-10-16 17:30'));
  assert.ok(s.counts().seen.includes('当前世界当地时间：2026-10-16 18:30'));
});
test('paused automatic checks never claim or call the model', async () => {
  const s = setup({ status: 'claimed', claim }, true);
  s.deps.story.prepare = async () => {
    throw Error('must not claim');
  };
  const result = await advancePublicationStory(s.deps, 'o', 'w', true);
  assert.equal(result.result?.played, 0);
  assert.equal(s.counts().calls, 0);
});
test('unknown sends never invoke the model or silently retry', async () => {
  const s = setup({ status: 'unknown', pendingClaimId: 'pending' });
  await assert.rejects(advancePublicationStory(s.deps, 'o', 'w', true));
  assert.equal(s.counts().calls, 0);
});

test('explicit recovery uses the original claimed command, never prepares another opportunity', async () => {
  const s = setup({ status: 'unknown', pendingClaimId: 'claim' });
  s.deps.story.prepare = async () => {
    throw Error('must not prepare a new node');
  };
  s.deps.story.retry = async (_owner, _world, id) => {
    assert.equal(id, 'claim');
    return { status: 'claimed', claim };
  };
  const result = await advancePublicationStory(s.deps, 'o', 'w', false, 'claim');
  assert.equal(result.result?.played, 1);
  assert.equal((await s.deps.worlds.get({ userId: 'o' }, 'w')).appointments.length, 1);
  assert.equal(s.counts().calls, 1);
});
test('managed waiting keeps the authored timeline; only legacy worlds fall back to the generic director', async () => {
  const s = setup({ status: 'none', managed: true });
  const waiting = await advancePublicationStory(s.deps, 'o', 'w', true);
  assert.equal(waiting.handled, true);
  assert.equal(waiting.result?.played, 0);
  s.deps.story.prepare = async () => ({ status: 'none', managed: false });
  assert.equal((await advancePublicationStory(s.deps, 'o', 'w', true)).handled, false);
  assert.equal(s.counts().calls, 0);
});
test('an invalid cross-character response is reconciled, never marked as a completed player task', async () => {
  const s = setup({ status: 'claimed', claim });
  s.deps.planner.propose = async () => ({
    schemaVersion: 1,
    effects: [{ type: 'message.received', id: 'bad', actorId: 'b', text: '我代青青答应了' }],
  });
  await assert.rejects(advancePublicationStory(s.deps, 'o', 'w', false));
  assert.equal(s.counts().finishes, 1);
  assert.equal((await s.deps.worlds.get({ userId: 'o' }, 'w')).version, 0);
});
