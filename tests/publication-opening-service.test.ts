import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { advancePublicationOpening } from '../src/modules/settings/application/advance-publication-opening.ts';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import type {
  OpeningSnapshot,
  PublicationOpeningPort,
  OpeningBrief,
} from '../src/modules/settings/application/publication-opening-ports.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const at = '2026-10-15T07:00:00.000Z';
function setup() {
  const seed: WorldState = {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'o',
    version: 0,
    time: at,
    title: '合成世界',
    actors: [
      { id: 'a', name: '甲', persona: '甲自己' },
      { id: 'b', name: '乙', persona: '乙自己' },
    ],
    facts: [
      {
        id: 'private',
        text: 'PRIVATE_OWNER_FACT',
        visibility: { kind: 'owner' },
        sourceEventId: 'genesis',
      },
    ],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const worlds = new MemoryWorldRepository([seed]);
  const s: OpeningSnapshot = {
    source: {
      worldId: 'w',
      ownerId: 'o',
      sourceHash: 'a'.repeat(64),
      nodeKey: 'start',
      title: '开场',
      script: 'GLOBAL_DIRECTOR_SCRIPT',
      worldSetting: 'GLOBAL_DIRECTOR_SETTING',
      actors: [
        { id: 'a', key: 'aa', name: '甲' },
        { id: 'b', key: 'bb', name: '乙' },
      ],
    },
    phase: 'unplanned',
    planCommandId: null,
    deliveries: [],
  };
  let director = 0,
    npc = 0,
    prepared = 0,
    paused = false,
    fail = false,
    finishLost = false;
  const opening: PublicationOpeningPort = {
    read: async () => structuredClone(s),
    beginPlan: async (_o, _w, id) => {
      if (s.phase !== 'unplanned') return false;
      s.phase = 'planning';
      s.planCommandId = id;
      return true;
    },
    savePlan: async (_o, _w, _id, briefs) => {
      s.deliveries = briefs.map((b) => ({
        ...b,
        commandId: randomUUID(),
        expectedVersion: null,
        status: 'queued',
        sourceEventId: null,
      }));
      s.phase = 'ready';
    },
    failPlan: async () => {
      s.phase = 'unknown';
    },
    claimNext: async () => {
      if (s.deliveries.some((d) => d.status === 'sending' || d.status === 'unknown')) return null;
      const d = s.deliveries.find((d) => d.status === 'queued');
      if (!d) return null;
      d.status = 'sending';
      d.expectedVersion = (await worlds.get({ userId: 'o' }, 'w')).version;
      return { ...d };
    },
    finishDelivery: async (_o, _w, actor) => {
      const d = s.deliveries.find((d) => d.actorId === actor)!;
      if (fail) return false;
      d.status = 'delivered';
      if (s.deliveries.every((d) => d.status === 'delivered')) s.phase = 'complete';
      if (finishLost) {
        finishLost = false;
        throw Error('LOST_RECEIPT_RESPONSE');
      }
      return true;
    },
    failDelivery: async (_o, _w, actor) => {
      s.deliveries.find((d) => d.actorId === actor)!.status = 'unknown';
      s.phase = 'unknown';
    },
    retry: async () => {
      s.phase = 'ready';
      for (const d of s.deliveries)
        if (d.status === 'unknown') {
          d.status = 'queued';
          d.commandId = randomUUID();
          d.expectedVersion = null;
        }
    },
  };
  const deps = {
    opening,
    worlds,
    clock: {
      read: async () => ({
        storyNow: at,
        lastTickAt: at,
        speed: 1,
        paused,
        missedBeats: 0,
        summary: null,
      }),
      withAdvanceLock: async <T>(_id: string, run: () => Promise<T>) => run(),
    },
    now: () => at,
    newId: randomUUID,
    planOpening: async (): Promise<OpeningBrief[]> => {
      director++;
      return [
        { actorId: 'a', brief: 'OWN_A_BRIEF' },
        { actorId: 'b', brief: 'OWN_B_BRIEF' },
      ];
    },
    planner: {
      prepareContext: async (
        context: import('../src/modules/world/application/ports.ts').ActorContext,
      ) => {
        prepared++;
        return {
          ...context,
          possibleRecipients: [{ id: 'other', name: '他人', persona: 'OTHER_PRIVATE_PERSONA' }],
        };
      },
      propose: async ({
        context,
        userText,
      }: {
        context: import('../src/modules/world/application/ports.ts').ActorContext;
        userText: string;
      }) => {
        npc++;
        if (fail) throw Error('REAL_PROVIDER_FAILURE_FIXTURE');
        const wire = JSON.stringify({ context, userText });
        assert.doesNotMatch(wire, /GLOBAL_DIRECTOR_|PRIVATE_OWNER_FACT|OTHER_PRIVATE_PERSONA/);
        assert.ok(userText.includes(context.actor.id === 'a' ? 'OWN_A_BRIEF' : 'OWN_B_BRIEF'));
        assert.ok(!userText.includes(context.actor.id === 'a' ? 'OWN_B_BRIEF' : 'OWN_A_BRIEF'));
        return {
          schemaVersion: 1,
          effects: [
            {
              id: 'local_reply',
              type: 'message.received',
              actorId: context.actor.id,
              text: '这是本人独立发言。',
            },
          ],
        };
      },
    },
  };
  return {
    deps,
    s,
    counts: () => ({ director, npc, prepared }),
    pause: () => {
      paused = true;
    },
    fail: () => {
      fail = true;
    },
    loseFinish: () => {
      finishLost = true;
    },
  };
}
test('each opening advance makes at most one director or one scoped NPC call, with fresh versions', async () => {
  const f = setup();
  await advancePublicationOpening(f.deps, 'o', 'w');
  assert.deepEqual(f.counts(), { director: 1, npc: 0, prepared: 0 });
  assert.equal((await f.deps.worlds.get({ userId: 'o' }, 'w')).version, 0);
  assert.equal((await advancePublicationOpening(f.deps, 'o', 'w')).result?.played, 1);
  assert.deepEqual(f.counts(), { director: 1, npc: 1, prepared: 1 });
  await advancePublicationOpening(f.deps, 'o', 'w');
  assert.equal(f.s.phase, 'complete');
  assert.equal((await f.deps.worlds.get({ userId: 'o' }, 'w')).version, 2);
  assert.deepEqual(f.counts(), { director: 1, npc: 2, prepared: 2 });
  assert.equal((await advancePublicationOpening(f.deps, 'o', 'w')).handled, false);
  assert.deepEqual(f.counts(), { director: 1, npc: 2, prepared: 2 });
});
test('paused, planning, sending and unknown refreshes do not spend another model call', async () => {
  const f = setup();
  f.pause();
  await advancePublicationOpening(f.deps, 'o', 'w');
  assert.deepEqual(f.counts(), { director: 0, npc: 0, prepared: 0 });
  for (const phase of ['planning', 'unknown'] as const) {
    f.s.phase = phase;
    await advancePublicationOpening(f.deps, 'o', 'w', false);
  }
  f.s.phase = 'ready';
  f.s.deliveries = [
    {
      actorId: 'a',
      brief: 'a',
      commandId: randomUUID(),
      expectedVersion: 0,
      status: 'sending',
      sourceEventId: null,
    },
  ];
  await advancePublicationOpening(f.deps, 'o', 'w', false);
  assert.deepEqual(f.counts(), { director: 0, npc: 0, prepared: 0 });
});
test('failed NPC leaves an unknown item and never automatically retries on later advance', async () => {
  const f = setup();
  await advancePublicationOpening(f.deps, 'o', 'w');
  f.fail();
  await assert.rejects(advancePublicationOpening(f.deps, 'o', 'w'));
  assert.equal(f.s.phase, 'unknown');
  await advancePublicationOpening(f.deps, 'o', 'w');
  assert.deepEqual(f.counts(), { director: 1, npc: 1, prepared: 1 });
  assert.equal((await f.deps.worlds.get({ userId: 'o' }, 'w')).version, 0);
});
test('a lost finish response reconciles an already committed actor without another generation', async () => {
  const f = setup();
  await advancePublicationOpening(f.deps, 'o', 'w');
  f.loseFinish();
  assert.equal((await advancePublicationOpening(f.deps, 'o', 'w')).result?.played, 1);
  assert.equal((await f.deps.worlds.get({ userId: 'o' }, 'w')).version, 1);
  assert.deepEqual(f.counts(), { director: 1, npc: 1, prepared: 1 });
});
