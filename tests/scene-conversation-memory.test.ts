import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneConversationMemory } from '../src/modules/world/domain/scene-conversation-memory.ts';
import type { SceneEntry } from '../src/modules/world/domain/experience-rules.ts';
function fixture() {
  const action = {
    id: 'action',
    text: '今天不吃饭了，我想先安静坐一会儿。',
    sourceEventId: 'input-event',
  };
  const entry = {
    id: 'entry',
    kind: 'user_action',
    actionId: action.id,
    text: action.text,
    sourceEventId: action.sourceEventId,
    observableTo: [{ kind: 'player' }, { kind: 'actor', actorId: 'actor' }],
  } as SceneEntry;
  return {
    actorId: 'actor',
    storyAt: '2026-10-09T07:36:00.000Z',
    location: '小店',
    presentActorIds: ['actor'],
    action,
    entries: [entry],
    dialogues: [
      { actorId: 'actor', text: '好，那今天就不做你的那份。先坐着歇会儿。' },
      { actorId: 'other', text: 'OTHER_PRIVATE_GOAL' },
    ],
    observableResult: '你在柜台前说明了今天不吃饭。',
    resultSourceEventId: 'result-event',
    blockedSources: new Set<string>(),
  };
}
test('saved public refusal and this speaker own response remain exact quoted episodes with both sources', () => {
  const input = fixture(),
    before = structuredClone(input);
  const result = sceneConversationMemory(input)!;
  assert.ok(result.text.includes('2026-10-09 15:36'));
  assert.ok(result.text.includes(input.action.text));
  assert.ok(result.text.includes(input.dialogues[0]!.text));
  assert.ok(result.text.includes('不证明事件完成'));
  assert.ok(!result.text.includes('OTHER_PRIVATE_GOAL'));
  assert.deepEqual(result.sourceIds, ['result-event', 'input-event']);
  assert.deepEqual(input, before);
});
test('private thoughts, absent actors and forgotten result sources cannot create a character episode', () => {
  const f = fixture();
  assert.equal(sceneConversationMemory({ ...f, presentActorIds: [] }), null);
  assert.equal(sceneConversationMemory({ ...f, blockedSources: new Set(['result-event']) }), null);
  for (const text of [
    '我心里想：PRIVATE_THOUGHT_SENTINEL',
    '我在心里想：PRIVATE_THOUGHT_SENTINEL',
    '我心中想着：PRIVATE_THOUGHT_SENTINEL',
  ]) {
    assert.equal(
      sceneConversationMemory({
        ...f,
        action: { ...f.action, text },
        entries: [{ ...f.entries[0], text } as SceneEntry],
      }),
      null,
    );
  }
});
test('a hearer who arrived later or forgot the original source receives no public-input quote', () => {
  const f = fixture();
  assert.equal(sceneConversationMemory({ ...f, blockedSources: new Set(['input-event']) }), null);
  assert.equal(sceneConversationMemory({ ...f, blockedSources: new Set(['entry']) }), null);
  for (const input of [
    { ...f, entries: [{ ...f.entries[0], observableTo: [{ kind: 'player' }] } as SceneEntry] },
    { ...f, entries: [{ ...f.entries[0], sourceEventId: 'unrelated-event' } as SceneEntry] },
  ]) {
    const result = sceneConversationMemory(input)!;
    assert.ok(!result.text.includes(f.action.text));
    assert.deepEqual(result.sourceIds, ['result-event']);
  }
});
test('budgeting never cuts a quoted refusal into an affirmative fragment', () => {
  const f = fixture(),
    text = '甲'.repeat(3998) + '不去';
  const result = sceneConversationMemory({
    ...f,
    action: { ...f.action, text },
    entries: [{ ...f.entries[0], text } as SceneEntry],
  })!;
  assert.ok(result.text.length <= 4000);
  assert.ok(!result.text.includes('甲'));
  assert.ok(result.text.includes(f.dialogues[0]!.text));
  assert.deepEqual(result.sourceIds, ['result-event', 'input-event']);
});
