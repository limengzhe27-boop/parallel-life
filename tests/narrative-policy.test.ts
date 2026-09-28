import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrativeBrief } from '../src/modules/world/domain/narrative-policy.ts';
const base = { actorId: 'a', userText: '你好', messages: [], appointments: [], memories: [] };

test('a direct question is answered before opening another hook', () => {
  const brief = narrativeBrief({ ...base, userText: '你找我什么事？' });
  assert.equal(brief.move, 'answer');
  assert.equal(brief.maxNewThreads, 0);
});
test('explicit rest and goodbye take precedence over open invitations', () => {
  const appointments = [
    {
      id: 'date',
      title: '看展',
      at: '2026-09-28T12:00:00.000Z',
      participantIds: ['a'],
      status: 'proposed' as const,
      sourceEventId: 'event',
    },
  ];
  for (const userText of ['我只想休息', '先别推进剧情', '晚安'])
    assert.equal(narrativeBrief({ ...base, userText, appointments }).move, 'breathing_room');
  assert.notEqual(
    narrativeBrief({ ...base, userText: '不要再休息了，我们出发' }).move,
    'breathing_room',
  );
});
test('negotiation needs a relevant pending invitation, not a cancelled or foreign one', () => {
  const appointment = {
    id: 'date',
    title: '看展',
    at: '2026-09-28T12:00:00.000Z',
    participantIds: ['a'],
    status: 'proposed' as const,
    sourceEventId: 'event',
  };
  assert.equal(
    narrativeBrief({ ...base, userText: '几点见面？', appointments: [appointment] }).move,
    'negotiate',
  );
  assert.equal(
    narrativeBrief({ ...base, userText: '你喜欢什么颜色？', appointments: [appointment] }).move,
    'answer',
  );
  for (const invalid of [
    { ...appointment, status: 'cancelled' as const },
    { ...appointment, participantIds: ['b'] },
  ])
    assert.notEqual(
      narrativeBrief({ ...base, userText: '几点见面？', appointments: [invalid] }).move,
      'negotiate',
    );
});
test('director reflects the exact explicit appointment result instead of revisiting old ones', () => {
  const appointments = [
    {
      id: 'old',
      title: '旧约定',
      at: '2026-09-27T12:00:00.000Z',
      participantIds: ['a'],
      status: 'attended' as const,
      responseAt: '2026-09-27T12:00:00.000Z',
      sourceEventId: 'e1',
    },
    {
      id: 'new',
      title: '看展',
      at: '2026-09-28T12:00:00.000Z',
      participantIds: ['a'],
      status: 'missed' as const,
      responseAt: '2026-09-28T12:00:00.000Z',
      sourceEventId: 'e2',
    },
  ];
  const brief = narrativeBrief({
    ...base,
    origin: 'director',
    appointments,
    userText: '未了结的事：用户明确标记「看展」未赴约',
  });
  assert.equal(brief.move, 'appointment_result');
  assert.deepEqual(brief.evidenceIds, ['new']);
  const due = narrativeBrief({
    ...base,
    origin: 'director',
    time: '2026-09-29T00:00:00.000Z',
    appointments: [{ ...appointments[1]!, status: 'confirmed' }],
    userText: '「看展」时间到了，不知道用户有没有去',
  });
  assert.equal(due.move, 'appointment_due');
});
test('director follows sourced promises instead of treating its cue as user dialogue', () => {
  const promise = {
    id: 'promise',
    kind: 'commitment',
    status: 'active',
    scopeType: 'character',
    scopeId: 'a',
  };
  const input = {
    ...base,
    origin: 'director' as const,
    userText: '你找我什么事？',
    memories: [promise],
  };
  assert.equal(narrativeBrief(input).move, 'follow_through');
  assert.deepEqual(narrativeBrief(input).evidenceIds, ['promise']);
  for (const invalid of [
    { ...promise, status: 'forgotten' },
    { ...promise, scopeId: 'b' },
    { ...promise, kind: 'belief' },
  ])
    assert.notEqual(narrativeBrief({ ...input, memories: [invalid] }).move, 'follow_through');
});
test('repeated ordinary turns do not mechanically escalate or promise a win', () => {
  const input = {
    ...base,
    messages: [
      {
        id: 'm',
        role: 'user' as const,
        actorId: 'a',
        text: '一起整理照片',
        at: '2026-09-28T12:00:00.000Z',
        sourceEventId: 'e',
      },
    ],
  };
  assert.equal(narrativeBrief(input).move, 'continue');
  assert.equal(narrativeBrief(input).maxNewThreads, 0);
  assert.deepEqual(narrativeBrief(input), narrativeBrief(input));
});
