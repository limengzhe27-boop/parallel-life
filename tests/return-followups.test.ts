import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';
import { followupAgenda } from '../src/modules/world/domain/return-followups.ts';
import { beatCue } from '../src/modules/world/domain/clock.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const before = '2026-10-09T12:00:00.000Z',
  next = '2026-10-10T16:00:00.000Z';
const world = (): WorldState => ({
  schemaVersion: 1,
  id: 'w',
  ownerId: 'owner',
  version: 3,
  title: 'test',
  time: next,
  actors: [{ id: 'a', name: 'A', persona: 'partner' }],
  facts: [],
  messages: [],
  mediaRequests: [],
  appointments: [
    {
      id: 'ap',
      title: '第二次相纸对照',
      at: '2026-10-10T12:00:00.000Z',
      participantIds: ['a'],
      sourceEventId: 'genesis',
      status: 'confirmed',
    },
  ],
});
const delivered = [{ actorId: 'a', at: before, version: 2 }];
test('a sourced later milestone permits the same contact on a later story date', () => {
  const w = world();
  const agenda = buildAgenda(w);
  assert.equal(followupAgenda(w, agenda, next, delivered).length, 1);
  assert.equal(agenda[0]!.basisId, 'ap');
  assert.equal(agenda[0]!.sourceId, undefined);
  assert(!beatCue(w, 'a', agenda).includes('[choice:ap]'));
});
test('same UTC+08 story day or less than 12h never licenses another beat', () => {
  const w = world();
  assert.deepEqual(
    followupAgenda(w, buildAgenda(w), '2026-10-10T14:00:00.000Z', [
      { actorId: 'a', at: '2026-10-10T01:00:00.000Z', version: 2 },
    ]),
    [],
  );
  w.appointments[0]!.at = '2026-10-09T18:00:00.000Z';
  assert.deepEqual(
    followupAgenda(w, buildAgenda(w), '2026-10-10T01:00:00.000Z', [
      { actorId: 'a', at: '2026-10-09T15:00:00.000Z', version: 2 },
    ]),
    [],
  );
});
test('old milestone, old commitment and a new date alone cannot produce daily reminders', () => {
  const w = world();
  w.appointments[0]!.at = '2026-10-09T10:00:00.000Z';
  assert.deepEqual(followupAgenda(w, buildAgenda(w), next, delivered), []);
  assert.deepEqual(
    followupAgenda(
      w,
      [
        { kind: 'commitment', actorId: 'a', detail: 'old promise' },
        { kind: 'reconnect', actorId: 'a', detail: 'check in' },
      ],
      next,
      delivered,
    ),
    [],
  );
});
test('source and actual participant must match; a future milestone cannot be backdated', () => {
  const w = world();
  const a = buildAgenda(w);
  assert.deepEqual(followupAgenda(w, a, '2026-10-10T10:00:00.000Z', []), []);
  assert.deepEqual(followupAgenda(w, [{ ...a[0]!, basisId: 'forged' }], next, delivered), []);
  w.appointments[0]!.participantIds = ['other'];
  assert.deepEqual(followupAgenda(w, a, next, delivered), []);
});
test('a fresh player result can be acknowledged on a later date but its old version cannot', () => {
  const w = world();
  w.choices = [
    {
      id: 'choice',
      actorId: 'a',
      quote: '试印',
      intent: '试印',
      status: 'pending',
      sourceEventId: 'old',
      sourceVersion: 1,
      result: { kind: 'blocked', quote: '相纸用完了', sourceEventId: 'new', sourceVersion: 3 },
    },
  ];
  const agenda = buildAgenda(w).filter((t) => t.kind === 'choice_result');
  assert.equal(followupAgenda(w, agenda, next, delivered).length, 1);
  assert.deepEqual(followupAgenda(w, agenda, next, [{ ...delivered[0]!, version: 3 }]), []);
});
test('past unconfirmed invitation is quiet and an overdue confirmed node never implies attendance', () => {
  const w = world();
  w.appointments[0]!.status = 'proposed';
  assert.deepEqual(buildAgenda(w), []);
  w.appointments[0]!.status = 'confirmed';
  const cue = beatCue(w, 'a', buildAgenda(w));
  assert.match(cue, /原定于/);
  assert.match(cue, /不继续催赴已经过时的约/);
  assert.match(cue, /不能声称已经发生/);
});
test('offset representations of the same instant keep the same timing decision', () => {
  const w = world();
  w.appointments[0]!.at = '2026-10-10T20:00:00.000+08:00';
  const a = [
    {
      kind: 'appointment_due' as const,
      actorId: 'a',
      detail: 'same physical time',
      basisId: 'ap',
      basisAt: w.appointments[0]!.at,
    },
  ];
  assert.equal(followupAgenda(w, a, next, delivered).length, 1);
  assert.equal(buildAgenda(w)[0]?.basisId, 'ap');
});
