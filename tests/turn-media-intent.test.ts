import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';
import { resolveTurn } from '../src/modules/world/application/resolve-turn.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

const time = '2026-09-24T00:00:00.000Z';
const seed = (): WorldState => ({
  schemaVersion: 1,
  id: 'world-1',
  ownerId: 'user-1',
  version: 0,
  title: '意图接线测试',
  time,
  actors: [{ id: 'friend', name: '朋友', persona: '外向' }],
  facts: [],
  messages: [],
  appointments: [],
  mediaRequests: [],
});
const deps = (worlds: MemoryWorldRepository) => ({
  worlds,
  planner: {
    propose: async () => ({
      schemaVersion: 1 as const,
      effects: [
        { type: 'message.received' as const, id: 'reply-1', actorId: 'friend', text: '好。' },
      ],
    }),
  },
  now: () => time,
  newId: () => 'event-1',
});

test('asking for a picture commits a media request in the same turn', async () => {
  const worlds = new MemoryWorldRepository([seed()]);
  const result = await resolveTurn(
    deps(worlds),
    { userId: 'user-1' },
    {
      id: 'cmd-1',
      worldId: 'world-1',
      actorId: 'friend',
      text: '给我发张窗外的照片',
      expectedVersion: 0,
    },
  );
  const effects = (result.event.data as { effects: { type: string; prompt?: string }[] }).effects;
  const media = effects.find((effect) => effect.type === 'media.requested');
  assert.ok(media, `expected a media request, got ${effects.map((e) => e.type).join(',')}`);
  assert.ok(media.prompt && media.prompt.length > 0);
  /* A committed media request also wrote a durable outbox job. */
});

test('ordinary chat does not create media work', async () => {
  const worlds = new MemoryWorldRepository([seed()]);
  const result = await resolveTurn(
    deps(worlds),
    { userId: 'user-1' },
    {
      id: 'cmd-2',
      worldId: 'world-1',
      actorId: 'friend',
      text: '今天上班好累',
      expectedVersion: 0,
    },
  );
  const effects = (result.event.data as { effects: { type: string }[] }).effects;
  assert.equal(
    effects.some((effect) => effect.type === 'media.requested'),
    false,
  );
});
