import test from 'node:test';
import assert from 'node:assert/strict';
import { isSimilarText } from '../src/modules/profile/infrastructure/profile-repository.ts';

test('isSimilarText should accurately catch duplicate/similar experiences', () => {
  const text1 = '后悔大学期间既没玩够也没好好学，两边都没做好';
  const text2 = '上大学期间既未投入学习也未尽情玩乐，事后感到后悔';
  assert.equal(isSimilarText(text1, text2), true);

  const text3 = '出生于2005年4月12日';
  const text4 = '2005年4月12日出生';
  assert.equal(isSimilarText(text3, text4), true);

  const text5 = '喜欢安静做手工';
  const text6 = '喜欢热闹的派对和社交';
  assert.equal(isSimilarText(text5, text6), false);
});
