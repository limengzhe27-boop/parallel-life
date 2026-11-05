import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeResponder } from '../src/modules/world/domain/native-responder.ts';

function input(): Parameters<typeof nativeResponder>[0] {
  return {
    actorIds: ['c', 'b', 'a'],
    names: new Map([
      ['a', '甲'],
      ['b', '乙'],
      ['c', '丙'],
    ]),
    text: '谁在？',
    states: [],
    channel: 'scene',
    threadId: 'home',
    questions: [],
    relatedMatterIds: [],
  };
}
test('a first unaddressed scene message with multiple witnesses gets an NPC without director planning', () => {
  const i = input();
  assert.equal(nativeResponder(i), 'a');
  assert.equal(nativeResponder({ ...i, actorIds: ['b', 'a', 'c'] }), 'a');
  assert.deepEqual(i.actorIds, ['c', 'b', 'a']);
});
test('scene turn continues with the latest authorized speaker, skipping someone who left', () => {
  assert.equal(nativeResponder({ ...input(), recentSpeakerIds: ['departed', 'b', 'c'] }), 'b');
  assert.equal(nativeResponder({ ...input(), text: '@丙 你呢？', recentSpeakerIds: ['b'] }), 'c');
});
test('open question retains priority over the last interjection', () => {
  assert.equal(
    nativeResponder({
      ...input(),
      recentSpeakerIds: ['c'],
      questions: [
        {
          actorId: 'b',
          sourceWorldVersion: 3,
          question: {
            id: 'q',
            channel: 'scene',
            threadId: 'home',
            sourceId: 'scene:q',
            text: '你喝什么？',
            askedAt: '2026-11-05T12:00:00.000Z',
            status: 'open',
          },
        },
      ],
    }),
    'b',
  );
});
test('empty scene cannot invent a person; group and explicit multi-recipient coordination stay intact', () => {
  for (const i of [
    { ...input(), actorIds: [] },
    { ...input(), channel: 'group' as const },
    { ...input(), text: '@甲 @乙 谁先说？' },
  ]) {
    assert.throws(() => nativeResponder(i), /DIRECTOR_COORDINATION_REQUIRED/);
  }
});
