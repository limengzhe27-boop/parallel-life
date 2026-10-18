import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';

const world = (time: string) =>
  ({
    time,
    actors: [{ id: 'a', name: '林白语' }],
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        actorId: 'a',
        text: '今晚和我去出差。速回复。',
        at: '2026-10-14T00:00:00.000Z',
      },
    ],
    facts: [],
    appointments: [],
    choices: [],
    matters: [],
  }) as never;

test('隔了 4 天后，既有追进逻辑会为未回消息的角色建立议程', () => {
  const agenda = buildAgenda(world('2026-10-18T00:00:00.000Z'));
  assert.ok(
    agenda.some((thread) => thread.actorId === 'a'),
    '应有人可以开口',
  );
});

test('同一时刻（没有时间差）不会凭空催人', () => {
  const agenda = buildAgenda(world('2026-10-14T00:10:00.000Z'));
  assert.equal(agenda.length, 0);
});
