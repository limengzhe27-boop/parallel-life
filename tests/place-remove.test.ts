import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removePlace } from '../src/features/publisher/publisher-place-image.ts';

const content = () => ({
  places: [
    { key: 'shop', name: '小店', description: '', knownAtStart: true },
    { key: 'office', name: '办公室', description: '', knownAtStart: false },
  ],
  routes: [
    { fromPlaceKey: 'shop', toPlaceKey: 'office', minutes: 10 },
    { fromPlaceKey: 'office', toPlaceKey: 'shop', minutes: 10 },
  ],
});

test('删除地点时同时清理引用它的路线', () => {
  const next = removePlace(content(), 'shop') as {
    places: { key: string }[];
    routes: unknown[];
  };
  assert.deepEqual(
    next.places.map((p) => p.key),
    ['office'],
  );
  assert.equal(next.routes.length, 0);
});

test('拒绝删除最后一个地点（契约要求至少 1 个）', () => {
  const single = { places: [{ key: 'shop', name: '小店', knownAtStart: true }] };
  assert.throws(() => removePlace(single, 'shop'), /至少要保留 1 个地点/);
});

test('地点不存在或重复时不静默丢弃，而是报错', () => {
  assert.throws(() => removePlace(content(), 'missing'), /未找到这个地点/);
  const duplicate = {
    places: [
      { key: 'shop', name: 'A', knownAtStart: true },
      { key: 'shop', name: 'B', knownAtStart: true },
    ],
  };
  assert.throws(() => removePlace(duplicate, 'shop'), /未找到这个地点/);
});
