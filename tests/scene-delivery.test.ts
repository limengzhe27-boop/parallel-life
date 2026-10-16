import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSceneDialogueConsistency,
  sceneDeliveryText,
} from '../src/modules/world/domain/scene-delivery.ts';

test('same-turn dialogue cannot follow a fabricated no-response conclusion', () => {
  for (const observation of [
    '你在小店内询问是否有人，但没有得到任何回应。',
    '你问她是否吃饭，但尚未获得明确的回应。',
    '无人答话，只有风声。',
  ]) {
    assert.throws(
      () =>
        assertSceneDialogueConsistency({
          narration: '帘子轻轻摆动。',
          observation,
          dialogues: [{ actorId: 'owner', text: '我在，进来吧。' }],
        }),
      { code: 'INVALID_PROPOSAL' },
    );
  }
  assert.doesNotThrow(() =>
    assertSceneDialogueConsistency({
      narration: '小店安静，窗外有风声。',
      observation: '你的声音传到柜台后。',
      dialogues: [{ actorId: 'owner', text: '我在。' }],
    }),
  );
  assert.doesNotThrow(() =>
    assertSceneDialogueConsistency({
      narration: '无人回应。',
      observation: null,
      dialogues: [],
    }),
  );
});

test('visible delivery binds the speaker and supports old replies without delivery', () => {
  assert.equal(
    sceneDeliveryText({ name: '店主' }, '放下手里的笔，抬头看向门口。'),
    '店主放下手里的笔，抬头看向门口。',
  );
  assert.equal(sceneDeliveryText({ name: '店主' }, '我朝你点了点头。'), '店主朝你点了点头。');
  assert.equal(sceneDeliveryText({ name: '店主' }, '店主停顿了一下。'), '店主停顿了一下。');
  assert.equal(sceneDeliveryText({ name: '店主' }, undefined), null);
  assert.equal(sceneDeliveryText({ name: '店主' }, null), null);
});

test('delivery cannot bypass independent task evidence or choose for another participant', () => {
  for (const value of [
    '接过R17钥匙和维修单。',
    '已经完成全部检修。',
    '心里暗自决定帮你。',
    '边擦拭柜台，期待你的反应。',
    '同意签约。',
    '你点头答应了。',
    '邻居走了进来。',
    '',
    {},
    '抬头'.repeat(130),
  ]) {
    assert.throws(() => sceneDeliveryText({ name: '店主' }, value, ['邻居']), {
      code: 'INVALID_PROPOSAL',
    });
  }
});

test('direct simple questions exclude deferred actions, thoughts and linked physical work', async () => {
  const { isSimpleSceneQuestion } = await import('../src/modules/world/domain/scene-delivery.ts');
  const base = { intent: 'attempt', kind: 'try', relatedMatterIds: [] };
  assert.equal(isSimpleSceneQuestion({ ...base, text: '有人吗' }), true);
  assert.equal(isSimpleSceneQuestion({ ...base, text: '你不是要和我吃饭吗' }), true);
  for (const action of [
    { ...base, text: '我把钥匙给你然后你检查一下好吗' },
    { ...base, text: '如果我把店烧掉会怎样呢' },
    { ...base, text: '我签好协议再问你好吗' },
    { ...base, text: '有人吗', relatedMatterIds: ['matter'] },
    { ...base, text: '有人吗', intent: 'plan' },
    { ...base, text: '我走到门口了吗', kind: 'move' },
  ])
    assert.equal(isSimpleSceneQuestion(action), false);
});
