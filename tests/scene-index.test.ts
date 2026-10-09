import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentScene,
  canEnterAppointment,
  mergeHistory,
} from '../src/features/phone/scenes/index-state.ts';
import type { SceneHistory } from '../src/contracts/scenes.ts';
const record = {
  id: 'scene',
  title: '已保存现场',
  status: 'ended' as const,
  sourceVersion: 4,
  appointmentId: 'ap',
};
const history: SceneHistory = {
  worldId: 'world',
  worldVersion: 5,
  storyNow: '2026-10-09T03:00:00Z',
  paused: false,
  currentScene: null,
  scenes: [record],
  appointmentScenes: [record],
  nextBefore: null,
};
const invitation = {
  id: 'ap',
  title: '约定',
  at: '2026-10-09T01:00:00Z',
  participantIds: [],
  status: 'confirmed' as const,
  version: 0,
  responseVersion: 2,
};
test('completed visit opens its saved record while a later reschedule can enter once due', () => {
  assert.equal(appointmentScene(history, invitation)?.id, 'scene');
  assert.equal(canEnterAppointment(history, invitation), false);
  const rescheduled = { ...invitation, responseVersion: 6 };
  assert.equal(appointmentScene(history, rescheduled), undefined);
  assert.equal(canEnterAppointment(history, rescheduled), true);
  assert.equal(canEnterAppointment({ ...history, paused: true }, rescheduled), false);
  assert.equal(
    canEnterAppointment({ ...history, currentScene: { ...record, status: 'active' } }, rescheduled),
    false,
  );
  assert.equal(canEnterAppointment(history, { ...rescheduled, at: '2026-10-10T03:00:00Z' }), false);
});
test('history pagination merges duplicate IDs without replacing newer saved states', () => {
  assert.deepEqual(mergeHistory([{ ...record, sourceVersion: 8 }], [record]), [
    { ...record, sourceVersion: 8 },
  ]);
  assert.equal(mergeHistory([record], [{ ...record, sourceVersion: 9 }])[0]!.sourceVersion, 9);
});
