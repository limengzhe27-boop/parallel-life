import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeShapeIssues } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';

test('把校验失败翻译成可定位的字段路径与原因', () => {
  const detail = describeShapeIssues([
    { path: ['actors', 0, 'goal'], message: 'Required' },
    { path: ['reply', 'text'], message: 'Expected string' },
  ]);
  assert.equal(detail, 'actors.0.goal=Required|reply.text=Expected string');
});

test('最多列出 3 条，避免把整段模型输出塞进日志', () => {
  const detail = describeShapeIssues(
    Array.from({ length: 6 }, (_, i) => ({ path: [`f${i}`], message: 'bad' })),
  );
  assert.equal(detail.split('|').length, 3);
});

test('空路径显示为根，不产生空字符串', () => {
  assert.equal(describeShapeIssues([{ path: [], message: 'Invalid' }]), '(root)=Invalid');
});
