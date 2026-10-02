import test from 'node:test';
import assert from 'node:assert/strict';
import { isSimilarText } from '../src/modules/profile/infrastructure/profile-repository.ts';

test('profile dedupe only merges a claim whose meaning is still the same', () => {
  const text1 = '后悔大学期间既没玩够也没好好学，两边都没做好';
  const text2 = '上大学期间既未投入学习也未尽情玩乐，事后感到后悔';
  // These may describe the same period, but a lexical overlap cannot prove it.
  assert.equal(isSimilarText(text1, text2), false);

  const text3 = '出生于2005年4月12日';
  const text4 = '2005年4月12日出生';
  // Birthday conflict resolution has its own field-specific rules.
  assert.equal(isSimilarText(text3, text4), false);

  const text5 = '喜欢安静做手工';
  const text6 = '喜欢热闹的派对和社交';
  assert.equal(isSimilarText(text5, text6), false);
  assert.equal(isSimilarText('我喜欢摄影', '我喜欢旅行'), false);
  assert.equal(isSimilarText('我想成为摄影师', '我想成为音乐家'), false);
  assert.equal(isSimilarText('我在上海上大学', '我在北京上大学'), false);
  assert.equal(isSimilarText('喜欢摄影', '我还是很喜欢摄影'), true);
  assert.equal(isSimilarText('我喜欢摄影', '我不喜欢摄影'), false);
  assert.equal(isSimilarText('我喜欢摄影', '我喜欢摄影和旅行'), false);
  assert.equal(isSimilarText('我喜欢摄影。', '我喜欢 摄影'), true);
});
