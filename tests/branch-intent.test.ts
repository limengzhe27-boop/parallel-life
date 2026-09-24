import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeBranchIntent } from '../src/features/interview/branch-intent.ts';

test('a user asking for a branch gets one created', () => {
  for (const text of [
    '帮我创建一个分支',
    '给我建个分支吧',
    '我想创建一个平行人生',
    '生成一个分支看看',
    '我想试试另一条路',
    '我要试试这个方向',
    '帮我实现这个',
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
