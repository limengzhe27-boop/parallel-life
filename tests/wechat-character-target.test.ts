import test from 'node:test';
import assert from 'node:assert/strict';
import { wechatCharacterTarget } from '../src/features/phone/wechat-character-target.ts';
import { phoneTrialUrl } from '../src/features/publisher/publisher-phone-trial.ts';
import { trialCharacterPreviewIssues } from '../src/features/publisher/publisher-trial-preparation.ts';
test('same-name NPCs use immutable actor keys; missing/duplicate keys never select a different person', () => {
  const actors = [
    { id: 'one', name: '小雨', relationship: '朋友', publicationActorKey: 'first' },
    { id: 'two', name: '小雨', relationship: '同事', publicationActorKey: 'second' },
  ];
  assert.equal(wechatCharacterTarget(actors, 'second'), 'two');
  assert.equal(wechatCharacterTarget(actors, 'absent'), undefined);
  assert.equal(
    wechatCharacterTarget([...actors, { ...actors[0]!, id: 'other' }], 'first'),
    undefined,
  );
  const t = { trialId: 'trial', workId: 'work', draftVersion: 1, contentHash: 'a'.repeat(64) };
  assert.equal(phoneTrialUrl(t, 'second'), '/workbench/trials/trial?view=wechat&actor=second');
  assert.equal(phoneTrialUrl(t), '/workbench/trials/trial');
});
test('empty, future or other-person posts do not satisfy this familiar NPC; unknown relationships remain unknown', () => {
  const c = {
    world: { startAt: '2026-10-14T01:00:00Z' },
    actors: [
      { key: 'a', name: '成年同事', knownAtStart: true },
      { key: 'b', name: '未认识的人', knownAtStart: false },
    ],
    phone: {
      moments: [
        { key: 'other', actorKey: 'b', text: '其他人的内容', at: '2026-10-13T01:00:00Z' },
        { key: 'future', actorKey: 'a', text: '未来未发生', at: '2026-10-15T01:00:00Z' },
      ],
    },
  };
  assert.deepEqual(
    trialCharacterPreviewIssues(c).map((i) => i.path),
    [['actors', 0, 'momentsPreview']],
  );
  c.phone.moments.push({
    key: 'now',
    actorKey: 'a',
    text: '今天整理了材料。',
    at: '2026-10-13T01:00:00Z',
  });
  assert.deepEqual(trialCharacterPreviewIssues(c), []);
});
