import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  basicInfoPairs,
  coveredByBasicInfo,
  dedupeBatch,
  rejectReason,
} from '../src/modules/profile/application/fact-quality.ts';

const empty = { facts: [], events: [], basicInfoBlob: '' };
const blob =
  '个人资料\n姓名：小李\n生日：1993-04-05\n所在城市：杭州\n职业：产品设计\n家乡：河北';

test('the basic-info card is parsed into labelled values', () => {
  assert.deepEqual(basicInfoPairs(blob), [
    { label: '姓名', value: '小李' },
    { label: '生日', value: '1993-04-05' },
    { label: '所在城市', value: '杭州' },
    { label: '职业', value: '产品设计' },
    { label: '家乡', value: '河北' },
  ]);
  assert.deepEqual(basicInfoPairs('不是资料'), []);
});

test('a statement that only repeats the card is dropped, extra detail is kept', () => {
  const pairs = basicInfoPairs(blob);
  assert.equal(coveredByBasicInfo('在杭州做产品设计', pairs), true);
  assert.equal(coveredByBasicInfo('在杭州做产品设计，负责结算链路', pairs), false);
  assert.equal(coveredByBasicInfo('喜欢骑车', pairs), false);
  assert.equal(coveredByBasicInfo('在杭州做产品设计', []), false);
});

test('noise never reaches the profile', () => {
  assert.equal(rejectReason({ category: 'interest', text: '好的' }, empty), 'TOO_SHORT');
  assert.equal(rejectReason({ category: 'interest', text: '你喜欢骑车吗？' }, empty), 'QUESTION');
  assert.equal(
    rejectReason({ category: 'personality', text: '你想聊聊你的性格吗' }, empty),
    'ASSISTANT_WORDING',
  );
  assert.equal(
    rejectReason({ category: 'identity', text: '今天有点累，正在加班' }, empty),
    'TRANSIENT',
  );
  assert.equal(
    rejectReason({ category: 'identity', text: '如果去了上海就好了' }, empty),
    'HYPOTHETICAL',
  );
});

test('a genuine wish may be phrased as a hypothesis, and experiences are never filtered as transient', () => {
  assert.equal(rejectReason({ category: 'wish', text: '如果能去上海工作就好了' }, empty), null);
  assert.equal(
    rejectReason({ category: 'experience', text: '今天把第一辆车修好了' }, empty),
    null,
  );
});

test('the card and the user-rejected list are respected', () => {
  assert.equal(
    rejectReason({ category: 'identity', text: '在杭州做产品设计' }, { ...empty, basicInfoBlob: blob }),
    'BASIC_INFO_DUPLICATE',
  );
  assert.equal(
    rejectReason(
      { category: 'interest', text: '喜欢骑行长途' },
      { ...empty, facts: [{ category: 'interest', value: '喜欢骑行长途', status: 'rejected' }] },
    ),
    'USER_REJECTED',
  );
  assert.equal(
    rejectReason(
      { category: 'interest', text: '喜欢骑行长途' },
      { ...empty, facts: [{ category: 'interest', value: '喜欢骑行长途', status: 'confirmed' }] },
    ),
    null,
  );
});

test('a normal durable fact is accepted', () => {
  assert.equal(rejectReason({ category: 'relationship', text: '大学同学林越，常一起骑车' }, empty), null);
  assert.equal(rejectReason({ category: 'experience', text: '三年前放弃去大理开书店' }, empty), null);
});

test('near-duplicates inside one turn collapse and keep every source', () => {
  const same = (a: string, b: string) => a.replace(/\s/g, '') === b.replace(/\s/g, '');
  const kept = dedupeBatch(
    [
      { category: 'interest' as const, text: '喜欢骑行', eventDate: null, sourceMessageIds: ['a'] },
      { category: 'interest' as const, text: '喜欢 骑行', eventDate: null, sourceMessageIds: ['b'] },
      { category: 'wish' as const, text: '想开书店', eventDate: null, sourceMessageIds: ['c'] },
    ],
    same,
  );
  assert.equal(kept.length, 2);
  assert.deepEqual(kept[0]!.sourceMessageIds, ['a', 'b']);
  assert.deepEqual(kept[1]!.sourceMessageIds, ['c']);
});
