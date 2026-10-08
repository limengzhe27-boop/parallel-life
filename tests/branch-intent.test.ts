import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBranchBrief,
  chooseUnbuiltDirection,
  routeBranchIntent,
} from '../src/features/interview/branch-intent.ts';

test('a user asking for a branch gets one created', () => {
  for (const text of [
    '帮我创建一个分支',
    '给我建个分支吧',
    '我想创建一个平行人生',
    '生成一个分支看看',
    '我想试试另一条路',
    '我要试试这个方向',
    '帮我实现这个',
    '创建一个新的分支',
    '建一个属于我的分支',
    '给我生成一条全新的平行人生',
    '去创建新的人生分支让我进去体验',
    '帮我创建一个新分支体验一下',
    '创建新的人生分支',
    '直接创建新的世界分支',
    '直接建一个分支让我体验',
    '我想体验新的人生分支',
  ])
    assert.equal(routeBranchIntent(text), 'create', text);
});

test('a user asking what is available gets a recommendation, not a build', () => {
  for (const text of [
    '有什么分支吗',
    '有哪些方向',
    '推荐一下分支',
    '看看我的平行人生',
    '推演一下我的另一个可能',
  ])
    assert.equal(routeBranchIntent(text), 'recommend', text);
});

test('a user asking to enter an existing branch just opens it', () => {
  for (const text of [
    '进入这个分支',
    '开始这个分支',
    '体验一下这个分支',
    '就选这个分支',
    '进入我的人生',
  ])
    assert.equal(routeBranchIntent(text), 'enter', text);
});

test('ordinary conversation is left alone', () => {
  for (const text of [
    '今天上班好累',
    '我最近在考虑换工作',
    '你觉得我该不该搬去另一个城市',
    '我们聊聊这家公司的分支业务',
    '',
  ])
    assert.equal(routeBranchIntent(text), 'none', text);
});

test('creating a branch never re-opens a life that already exists', () => {
  const directions = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }];
  /* d1 already produced a life: the next request must build d2, not d1. */
  assert.deepEqual(chooseUnbuiltDirection(directions, ['d1'], 0), { id: 'd2' });
  /* The user's current selection wins when it is still unbuilt. */
  assert.deepEqual(chooseUnbuiltDirection(directions, ['d1'], 2), { id: 'd3' });
  /* Everything adopted: the caller must ask instead of reopening the old life. */
  assert.equal(chooseUnbuiltDirection(directions, ['d1', 'd2', 'd3'], 0), null);
  /* Nothing adopted yet: the preferred direction is used. */
  assert.deepEqual(chooseUnbuiltDirection(directions, [], 0), { id: 'd1' });
});

test('the conversation itself becomes the brief a branch needs', () => {
  const messages = [
    { role: 'assistant', text: '你最近在忙什么？' },
    { role: 'user', text: '我在做街头摄影，想把作品整理成一册' },
    { role: 'assistant', text: '听起来不错' },
    { role: 'user', text: '但房租压力挺大，我在犹豫要不要找份稳定工作' },
  ];
  const brief = buildBranchBrief(messages);
  assert.match(brief, /街头摄影/);
  assert.match(brief, /房租压力/);
  assert.equal(/你最近在忙什么/.test(brief), false, 'only the user words are used');
  /* Nothing said yet: no brief, so the caller must keep the conversation going. */
  assert.equal(buildBranchBrief([]), '');
  assert.equal(buildBranchBrief([{ role: 'assistant', text: '你好' }]), '');
  /* Bounded, never unbounded prompt growth. */
  assert.ok(
    buildBranchBrief(Array.from({ length: 20 }, () => ({ role: 'user', text: 'x'.repeat(500) })))
      .length <= 400,
  );
});

test('negation, quotation, hypothetical and questions never trigger branch creation', () => {
  for (const text of [
    '不要创建分支',
    '先别帮我创建分支',
    '我不想创建平行世界',
    '如果我说创建分支呢',
    '他说“帮我创建分支”',
    '创建分支会怎么样？',
    '取消创建分支',
    '不是要创建分支',
    '先不进入这个分支',
  ])
    assert.equal(routeBranchIntent(text), 'none', text);
});

test('explicit polite requests and hypothetical branch descriptions open review', () => {
  for (const text of [
    '可以帮我创建一个分支吗？',
    '能否帮我创建一个平行人生？',
    '创建一个如果高考去了上海的分支',
    '帮我开启一段平行人生',
    '我想体验如果去了上海的平行人生',
  ])
    assert.equal(routeBranchIntent(text), 'create', text);
  for (const text of [
    '如果能帮我创建一个分支就好了',
    '如果我说可以帮我创建一个分支吗？',
    '帮我创建分支会怎么样？',
    '不要帮我开启一段平行人生',
    '我想体验如果去了上海的平行人生，但先不要创建',
  ])
    assert.equal(routeBranchIntent(text), 'none', text);
});
