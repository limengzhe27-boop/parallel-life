import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  playerFacingProjection,
  playerFacingText,
} from '../src/server/player-facing-copy.ts';

test('rewrites third-person 主角 into second person', () => {
  assert.equal(playerFacingText('魂穿后，主角发现手机里同时收到消息'), '魂穿后，你发现手机里同时收到消息');
  assert.equal(playerFacingText('主角家和附近公园'), '你家和附近公园');
  assert.equal(playerFacingText('主角居住的现代住宅'), '你居住的现代住宅');
});

test('keeps gendered nouns such as 男主角 intact', () => {
  assert.equal(playerFacingText('男主角登场'), '男主角登场');
  assert.equal(playerFacingText('女主角登场'), '女主角登场');
});

test('projects nested payload strings without touching keys', () => {
  const input = {
    places: [{ name: '主角家', description: '主角居住的现代住宅' }],
    count: 1,
    ok: true,
    miss: null,
  };
  assert.deepEqual(playerFacingProjection(input), {
    places: [{ name: '你家', description: '你居住的现代住宅' }],
    count: 1,
    ok: true,
    miss: null,
  });
});
