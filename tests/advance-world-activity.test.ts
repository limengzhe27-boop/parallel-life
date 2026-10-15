import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { advanceWorld } from '../src/modules/world/application/advance-world.ts';
import type { ClockStore } from '../src/modules/world/application/ports.ts';
import type { WorldClock } from '../src/modules/world/domain/clock.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
const at = (s: number) => new Date(Date.parse('2026-10-15T00:00:00Z') + s * 1000).toISOString();
function fixture(managed = true, needsReply = true) {
  const actor = randomUUID(),
    owner = randomUUID(),
    worldId = randomUUID();
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: '合成节拍',
    time: at(0),
    actors: [{ id: actor, name: '测试人物', persona: '合成' }],
    facts: [],
    messages: needsReply
      ? [
          {
            id: randomUUID(),
            actorId: actor,
            role: 'user',
            text: '你先忙，我等一下。',
            at: at(0),
            sourceEventId: randomUUID(),
          },
        ]
      : [],
    appointments: [],
    mediaRequests: [],
  };
  let saved: WorldClock = {
    storyNow: at(0),
    lastTickAt: at(0),
    speed: 12,
    paused: false,
    missedBeats: 0,
    summary: null,
    ...(managed ? { managed: true, activeUntil: at(600) } : {}),
  };
  let now = at(0),
    finishes = 0,
    calls = 0,
    begun = 0,
    unresolved = false;
  let pending: { commandId: string; plannedFor: string; actorId: string } | null = null;
  const worlds = new MemoryWorldRepository([world]);
  const clock: ClockStore = {
    beatCommandId: () => randomUUID(),
    withAdvanceLock: async (_w, fn) => fn(),
    read: async () => saved,
    ensureAnchor: async () => {},
    write: async (_o, _w, c) => {
      saved = c;
    },
    setStoryTime: async () => {},
    setClock: async () => {},
    recordBeat: async () => {},
    committedBeat: async () => null,
    recentActors: async () => [],
    hasUnresolvedAttempt: async () => unresolved,
    pendingAttempt: async () => pending,
    beginAttempt: async () => {
      begun++;
      return true;
    },
    markAttempt: async () => {},
    finishAdvance: async (_o, _w, c) => {
      finishes++;
      saved = c;
    },
  };
  const run = () =>
    advanceWorld(
      {
        clock,
        worlds,
        planner: {
          propose: async () => {
            calls++;
            return {
              schemaVersion: 1,
              effects: [
                {
                  type: 'message.received',
                  id: randomUUID(),
                  actorId: actor,
                  text: '我先收拾一下，待会儿再说。',
                },
              ],
            };
          },
        },
        now: () => now,
        newId: randomUUID,
        automatic: true,
        maxBeats: 1,
      },
      { userId: owner },
      worldId,
    );
  return {
    run,
    setNow: (s: number) => {
      now = at(s);
    },
    stats: () => ({ finishes, calls, begun, saved }),
    pausePending: () => {
      saved = { ...saved, paused: true };
      unresolved = true;
      pending = { commandId: randomUUID(), plannedFor: at(900), actorId: actor };
    },
  };
}
test('frequent managed checks preserve partial beats and call one eligible actor at 75 seconds', async () => {
  const f = fixture();
  for (const seconds of [15, 30, 45, 60, 74]) {
    f.setNow(seconds);
    assert.equal((await f.run()).played, 0);
  }
  assert.equal(f.stats().finishes, 0);
  assert.equal(f.stats().saved.lastTickAt, at(0));
  assert.equal(f.stats().calls, 0);
  f.setNow(75);
  assert.equal((await f.run()).played, 1);
  assert.equal(f.stats().calls, 1);
  assert.equal(f.stats().finishes, 1);
  f.setNow(90);
  assert.equal((await f.run()).played, 0);
  assert.equal(f.stats().finishes, 1);
});
test('legacy worlds retain 30-world-minute eligibility', async () => {
  const f = fixture(false);
  f.setNow(75);
  assert.equal((await f.run()).played, 0);
  assert.equal(f.stats().finishes, 0);
  f.setNow(150);
  assert.equal((await f.run()).played, 1);
});
test('an empty agenda remains quiet even when the managed beat is due', async () => {
  const f = fixture(true, false);
  f.setNow(75);
  assert.equal((await f.run()).played, 0);
  assert.equal(f.stats().calls, 0);
  assert.equal(f.stats().begun, 0);
});
test('automatic paused checks do not inspect or reopen an unknown pending attempt', async () => {
  const f = fixture();
  f.pausePending();
  f.setNow(300);
  assert.equal((await f.run()).played, 0);
  assert.equal(f.stats().calls, 0);
  assert.equal(f.stats().begun, 0);
  assert.equal(f.stats().finishes, 0);
});
