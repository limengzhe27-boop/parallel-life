import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDirectSocialProposal } from '../src/features/publisher/publisher-social-direct.ts';

const opening = '2035-08-20T09:00:00Z';
function draft(): Record<string, unknown> {
  return {
    work: { title: '尚在写作的世界', description: 'AUTHOR_PROSE' },
    world: { startAt: opening, hiddenContext: 'AUTHOR_SECRET' },
    actors: [
      {
        key: 'mei',
        name: '梅宁',
        knownAtStart: true,
        publicCard: { introduction: '给玩家看的人物介绍。' },
        lifeModules: { relationships: '相识多年。' },
        privatePersona: { motivation: '不能泄露的心事。' },
      },
      { key: 'yan', name: '严朔', knownAtStart: true, privatePersona: { voice: '谨慎。' } },
    ],
    phone: {
      messages: [
        {
          key: 'old_line',
          actorKey: 'mei',
          origin: 'history',
          speaker: 'actor',
          text: '上周那本书还在我这里。',
          at: '2035-08-18T08:00:00Z',
        },
        {
          key: 'other_line',
          actorKey: 'yan',
          origin: 'history',
          speaker: 'actor',
          text: '另一人的原句。',
          at: '2035-08-17T08:00:00Z',
        },
      ],
      moments: [
        { key: 'old_post', actorKey: 'mei', text: '作者写的动态。', at: '2035-08-18T08:00:00Z' },
      ],
    },
    extensions: [{ key: 'author_extension', value: '保留' }],
  };
}
const line = (key = 'new_line') => ({
  key,
  actorKey: 'mei',
  origin: 'history',
  speaker: 'player',
  text: '好，明天见。',
  at: '2035-08-19T07:00:00Z',
});
const post = (key = 'new_post') => ({
  key,
  actorKey: 'mei',
  text: '今天把书架整理好了。',
  at: '2035-08-19T08:00:00Z',
});
function propose(
  before: Record<string, unknown>,
  focus: 'history' | 'moments',
  rows: unknown[],
): Record<string, unknown> {
  const next = structuredClone(before);
  const phone = next.phone as Record<string, unknown>;
  const collection = focus === 'history' ? 'messages' : 'moments';
  phone[collection] = [...(phone[collection] as unknown[]), ...rows];
  return next;
}
function refused(
  before: Record<string, unknown>,
  proposed: Record<string, unknown>,
  focus: 'history' | 'moments',
  expectedCode: string,
) {
  const snapshot = structuredClone(before);
  const result = applyDirectSocialProposal(before, proposed, 'mei', focus);
  assert.equal(result.error, expectedCode);
  assert.equal(result.added, 0);
  assert.equal(result.content, before);
  assert.deepEqual(before, snapshot);
}

test('selected history is appended from the authoritative draft without mutating either input', () => {
  const before = draft(),
    original = structuredClone(before);
  const proposed = propose(before, 'history', [line(), { ...line('new_actor'), speaker: 'actor' }]);
  const proposalSnapshot = structuredClone(proposed);
  const result = applyDirectSocialProposal(before, proposed, 'mei', 'history');
  assert.equal(result.error, undefined);
  assert.equal(result.added, 2);
  assert.deepEqual(result.content, proposed);
  assert.notEqual(result.content, proposed);
  assert.notEqual(result.content, before);
  assert.deepEqual(before, original);
  assert.deepEqual(proposed, proposalSnapshot);
});

test('selected Moments are appended while existing and other-person content remain identical', () => {
  const before = draft();
  const result = applyDirectSocialProposal(
    before,
    propose(before, 'moments', [post()]),
    'mei',
    'moments',
  );
  assert.equal(result.error, undefined);
  assert.equal(result.added, 1);
  assert.deepEqual(
    (result.content.phone as Record<string, unknown>).messages,
    (before.phone as Record<string, unknown>).messages,
  );
  assert.deepEqual((result.content.phone as Record<string, unknown>).moments, [
    ...(before.phone as { moments: unknown[] }).moments,
    post(),
  ]);
});

test('reject changes outside selected category, including private cards and hidden world facts', () => {
  for (const change of [
    (next: Record<string, unknown>) =>
      ((
        (next.actors as Record<string, unknown>[])[0]!.privatePersona as Record<string, unknown>
      ).motivation = 'LEAK'),
    (next: Record<string, unknown>) =>
      ((
        (next.actors as Record<string, unknown>[])[0]!.publicCard as Record<string, unknown>
      ).introduction = '重写'),
    (next: Record<string, unknown>) =>
      ((next.world as Record<string, unknown>).hiddenContext = '改写'),
    (next: Record<string, unknown>) =>
      ((next.phone as { moments: Record<string, unknown>[] }).moments[0]!.text = '改写旧朋友圈'),
    (next: Record<string, unknown>) =>
      ((next.phone as { messages: Record<string, unknown>[] }).messages[1]!.text = '改写其他人'),
    (next: Record<string, unknown>) =>
      ((next.extensions as Record<string, unknown>[])[0]!.value = '改写'),
  ]) {
    const before = draft(),
      next = propose(before, 'history', [line()]);
    change(next);
    refused(before, next, 'history', 'OUT_OF_SCOPE');
  }
});

test('reject changing, deleting or reordering author lines even if a new line was added', () => {
  for (const change of [
    (next: Record<string, unknown>) =>
      ((next.phone as { messages: Record<string, unknown>[] }).messages[0]!.text = 'AI改写'),
    (next: Record<string, unknown>) =>
      ((next.phone as { messages: unknown[] }).messages = [
        (next.phone as { messages: unknown[] }).messages[0],
        line(),
      ]),
    (next: Record<string, unknown>) => (next.phone as { messages: unknown[] }).messages.reverse(),
  ]) {
    const before = draft(),
      next = propose(before, 'history', [line()]);
    change(next);
    refused(before, next, 'history', 'OUT_OF_SCOPE');
  }
});

test('reject an appended row for another actor, duplicate key, invalid time or future content', () => {
  const bad = [
    { ...line(), actorKey: 'yan' },
    line('old_line'),
    { ...line(), at: '2035-02-30T07:00:00Z' },
    { ...line(), at: '2035-08-20T09:00:00Z' },
    { ...line(), at: '2035-08-21T09:00:00Z' },
    { ...line(), at: '2035-08-19T15:00:00+08:00' },
    { ...line(), speaker: 'system' },
    { ...line(), image: 'nope' },
    { ...line(), text: ' ' },
  ];
  for (const row of bad) {
    const before = draft();
    refused(before, propose(before, 'history', [row]), 'history', 'INVALID_NEW_CONTENT');
  }
  const before = draft();
  refused(
    before,
    propose(before, 'moments', [{ ...post(), at: '2035-08-21T09:00:00Z' }]),
    'moments',
    'INVALID_NEW_CONTENT',
  );
  refused(before, propose(before, 'moments', [post(), post()]), 'moments', 'INVALID_NEW_CONTENT');
});

test('reject no additions, unknown/unacquainted actor, or a malformed proposal', () => {
  const before = draft();
  refused(before, structuredClone(before), 'history', 'NO_NEW_CONTENT');
  const unknown = applyDirectSocialProposal(
    before,
    propose(before, 'history', [line()]),
    'unknown',
    'history',
  );
  assert.equal(unknown.error, 'INVALID_ACTOR');
  const unacquainted = draft();
  (unacquainted.actors as Record<string, unknown>[])[0]!.knownAtStart = false;
  refused(unacquainted, propose(unacquainted, 'history', [line()]), 'history', 'INVALID_ACTOR');
  const altered = propose(before, 'history', [line()]);
  delete (altered.phone as Record<string, unknown>).moments;
  refused(before, altered, 'history', 'OUT_OF_SCOPE');
});

test('when the opening date is not yet authored, valid UTC history can be adopted without inventing one', () => {
  const before = draft();
  (before.world as Record<string, unknown>).startAt = '';
  const result = applyDirectSocialProposal(
    before,
    propose(before, 'history', [line()]),
    'mei',
    'history',
  );
  assert.equal(result.error, undefined);
  assert.equal((result.content.world as Record<string, unknown>).startAt, '');
  (before.world as Record<string, unknown>).startAt = 'not a date';
  refused(before, propose(before, 'history', [line()]), 'history', 'INVALID_DRAFT');
});
