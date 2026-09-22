import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  InterviewSendSchema,
  TaskSchema,
  ProfileEditSchema,
  WorldFactSchema,
} from '../src/contracts/api.ts';

test('write contract refuses caller identity and oversize or empty text', () => {
  const input = { commandId: randomUUID(), expectedVersion: 0, text: '喜欢摄影' };
  assert.equal(InterviewSendSchema.parse(input).text, '喜欢摄影');
  for (const bad of [
    { ...input, ownerId: randomUUID() },
    { ...input, text: ' '.repeat(5) },
    { ...input, text: 'a'.repeat(4001) },
    { ...input, expectedVersion: -1 },
  ])
    assert.equal(InterviewSendSchema.safeParse(bad).success, false);
});
test('interview task is valid without world id and hides lease/owner', () => {
  const task = {
    id: randomUUID(),
    scope: { kind: 'interview', interviewId: randomUUID() },
    status: 'unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errorCode: 'UNKNOWN',
    resultVersion: null,
  };
  assert.equal(TaskSchema.safeParse(task).success, true);
  assert.equal(TaskSchema.safeParse({ ...task, leaseToken: 'secret' }).success, false);
});
test('profile edits cannot set sources, revision or confirmation arbitrarily', () => {
  const input = {
    expectedVersion: 2,
    operation: { kind: 'set-fact', category: 'wish', value: '开一家小店' },
  };
  assert.equal(ProfileEditSchema.safeParse(input).success, true);
  assert.equal(
    ProfileEditSchema.safeParse({
      ...input,
      operation: { ...input.operation, sourceMessageIds: [randomUUID()] },
    }).success,
    false,
  );
});
test('world fact separates belief attribution from canonical truth', () => {
  const fact = {
    id: randomUUID(),
    kind: 'belief',
    text: '我觉得会获奖',
    believedByActorId: randomUUID(),
    sourceEventId: randomUUID(),
    validFrom: new Date().toISOString(),
    validUntil: null,
    visibility: { kind: 'owner' },
  };
  assert.equal(WorldFactSchema.safeParse(fact).success, true);
  assert.equal(WorldFactSchema.safeParse({ ...fact, believedByActorId: null }).success, false);
  assert.equal(WorldFactSchema.safeParse({ ...fact, kind: 'canonical' }).success, false);
});

test('life dates reject nonexistent dates and preserve unknown feelings separately from zero', () => {
  for (const date of ['2026-02-30', '2026-13', 'not-a-date'])
    assert.equal(
      ProfileEditSchema.safeParse({
        expectedVersion: 0,
        operation: {
          kind: 'set-event',
          event: { id: randomUUID(), title: '事件', date, feeling: null },
        },
      }).success,
      false,
    );
  for (const feeling of [null, 0, -5, 5])
    assert.equal(
      ProfileEditSchema.safeParse({
        expectedVersion: 0,
        operation: {
          kind: 'set-event',
          event: { id: randomUUID(), title: '事件', date: '2024-02-29', feeling },
        },
      }).success,
      true,
    );
});
