import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInvitationEvent,
  type InvitationCommand,
  type InvitationEvent,
} from '../src/modules/world/domain/invitations.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import { InvitationRequestSchema } from '../src/contracts/invitations.ts';
const time = '2026-09-22T00:00:00.000Z';
const state: WorldState = {
  schemaVersion: 1,
  id: 'world',
  ownerId: 'owner',
  version: 1,
  title: '测试',
  time,
  actors: [],
  facts: [],
  messages: [],
  mediaRequests: [],
  appointments: [
    {
      id: 'a'.repeat(100),
      title: '会面',
      at: time,
      participantIds: ['friend'],
      status: 'proposed',
      sourceEventId: 'opening',
    },
  ],
};
const event = (
  s: WorldState,
  operation: InvitationCommand['operation'],
  at?: string,
): InvitationEvent => ({
  schemaVersion: 1,
  type: 'invitation.responded',
  id: 'event',
  worldId: s.id,
  commandId: 'command',
  version: s.version + 1,
  occurredAt: time,
  storyTime: s.time,
  data: {
    worldId: s.id,
    commandId: 'command',
    id: s.appointments[0]!.id,
    expectedVersion: s.version,
    operation,
    ...(at ? { at } : {}),
  },
});
test('explicit invitation acceptance, reschedule and cancellation replay without mutating source', () => {
  const accepted = applyInvitationEvent(state, event(state, 'accept'));
  assert.equal(accepted.appointments[0]?.status, 'confirmed');
  assert.equal(state.appointments[0]?.status, 'proposed');
  const changed = applyInvitationEvent(
    accepted,
    event(accepted, 'reschedule', '2026-09-23T00:00:00.000Z'),
  );
  assert.equal(changed.appointments[0]?.status, 'proposed');
  assert.equal(changed.appointments[0]?.at, '2026-09-23T00:00:00.000Z');
  const cancelled = applyInvitationEvent(changed, event(changed, 'cancel'));
  assert.equal(cancelled.appointments[0]?.status, 'cancelled');
  assert.throws(() => applyInvitationEvent(cancelled, event(cancelled, 'accept')), {
    code: 'INVALID_COMMAND',
  });
});
test('an invitation only ends after the protagonist records attendance or absence', () => {
  const offered = structuredClone(state);
  offered.appointments[0]!.at = '2026-09-22T01:00:00.000Z';
  const accepted = applyInvitationEvent(offered, event(offered, 'accept'));
  assert.equal(accepted.appointments[0]?.responseVersion, 2);
  assert.throws(() => applyInvitationEvent(accepted, event(accepted, 'attend')), {
    code: 'INVALID_COMMAND',
  });
  const due = { ...accepted, time: '2026-09-22T01:00:00.000Z' };
  const attended = applyInvitationEvent(due, event(due, 'attend'));
  assert.equal(attended.appointments[0]?.status, 'attended');
  assert.equal(attended.appointments[0]?.responseAt, due.time);
  assert.equal(attended.appointments[0]?.responseVersion, 3);
  assert.throws(() => applyInvitationEvent(attended, event(attended, 'miss')), {
    code: 'INVALID_COMMAND',
  });
  const missed = applyInvitationEvent(due, event(due, 'miss'));
  assert.equal(missed.appointments[0]?.status, 'missed');
  assert.equal(
    InvitationRequestSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000001',
      id: 'invite',
      expectedVersion: 2,
      operation: 'attend',
      ownerId: 'other',
    }).success,
    false,
  );
});
test('invitation commands reject stale state, unknown/legacy records and invalid times', () => {
  assert.throws(() => applyInvitationEvent({ ...state, version: 2 }, event(state, 'accept')), {
    code: 'VERSION_CONFLICT',
  });
  assert.throws(
    () => applyInvitationEvent({ ...state, appointments: [] }, event(state, 'accept')),
    { code: 'NOT_FOUND' },
  );
  assert.throws(
    () =>
      applyInvitationEvent(
        { ...state, appointments: [{ ...state.appointments[0]!, status: undefined }] },
        event(state, 'accept'),
      ),
    { code: 'INVALID_COMMAND' },
  );
  for (const at of ['invalid', '2026-09-21T00:00:00.000Z'])
    assert.throws(() => applyInvitationEvent(state, event(state, 'reschedule', at)), {
      code: 'INVALID_COMMAND',
    });
  assert.throws(() => applyInvitationEvent(state, event(state, 'accept', time)), {
    code: 'INVALID_COMMAND',
  });
});
test('invitation HTTP contract rejects identity injection and normalizes selected time', () => {
  const request = {
    commandId: '00000000-0000-4000-8000-000000000001',
    id: 'invite',
    expectedVersion: 1,
    operation: 'reschedule',
    at: '2026-09-23T10:00:00+08:00',
  };
  const parsed = InvitationRequestSchema.parse(request);
  assert.equal(parsed.operation === 'reschedule' && parsed.at, '2026-09-23T02:00:00.000Z');
  assert.equal(
    InvitationRequestSchema.safeParse({ ...request, ownerId: 'someone' }).success,
    false,
  );
  assert.equal(
    InvitationRequestSchema.safeParse({ ...request, operation: 'accept' }).success,
    false,
  );
});
