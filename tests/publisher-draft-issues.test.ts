import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DraftIssuesError,
  describeDraftIssues,
  draftIssues,
} from '../src/features/publisher/publisher-draft-issues.ts';

test('空内容会被指出缺少哪些部分，而不是一句“请核对故事”', () => {
  const issues = draftIssues({});
  assert.ok(issues.length > 0);
  assert.ok(issues.every((issue) => issue.path && issue.message));
  assert.match(describeDraftIssues(issues), /保存前发现 \d+ 处需要修正/);
});

test('地点为空时会明确指向“地点”', () => {
  const issues = draftIssues({ places: [] });
  assert.ok(issues.some((issue) => issue.path.includes('地点')));
});

test('人物标识非法时会指向人物与其标识', () => {
  const issues = draftIssues({
    places: [{ key: 'shop', name: '小店', description: '', knownAtStart: true }],
    actors: [{ key: '张三', name: '张三', knownAtStart: true, publicCard: { traits: [] } }],
  });
  assert.ok(issues.some((issue) => issue.path.includes('人物')));
});

test('描述最多列 5 条并提示剩余数量', () => {
  const text = describeDraftIssues(
    Array.from({ length: 9 }, (_, i) => ({ path: `字段${i}`, message: '不符合要求' })),
  );
  assert.match(text, /另有 4 处/);
});

test('校验错误保留为 INVALID_INPUT，不被折叠成“连接失败”', () => {
  const error = new DraftIssuesError([{ path: '地点', message: '至少 1 个' }]);
  assert.equal(error.code, 'INVALID_INPUT');
  assert.match(error.message, /地点/);
});
