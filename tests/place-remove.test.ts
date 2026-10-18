import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeReferences, removePlace } from '../src/features/publisher/publisher-place-image.ts';

const withPlace = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  places: [
    { key: 'shop', name: '小店', description: '', knownAtStart: true },
    { key: 'office', name: '办公室', description: '', knownAtStart: false },
  ],
  ...extra,
});

test('没有任何引用时可以直接删除', () => {
  const next = removePlace(withPlace(), 'shop') as { places: { key: string }[] };
  assert.deepEqual(
    next.places.map((place) => place.key),
    ['office'],
  );
});

test('路线引用地点时阻止删除，且不自动清空原稿', () => {
  const content = withPlace({
    routes: [{ fromPlaceKey: 'shop', toPlaceKey: 'office', minutes: 10 }],
  });
  assert.ok(placeReferences(content, 'shop').length > 0);
  assert.throws(() => removePlace(content, 'shop'), /路线/);
  assert.equal((content.routes as unknown[]).length, 1, '原稿路线未被自动清空');
});

test('世界起点引用地点时阻止删除', () => {
  const content = withPlace({ world: { startPlaceKey: 'shop' } });
  assert.throws(() => removePlace(content, 'shop'), /世界起点/);
});

test('事件引用地点时阻止删除', () => {
  const content = withPlace({ candidates: [{ key: 'c1', placeKey: 'shop' }] });
  assert.throws(() => removePlace(content, 'shop'), /事件/);
});

test('拒绝删除最后一个地点', () => {
  const single = { places: [{ key: 'shop', name: '小店', knownAtStart: true }] };
  assert.throws(() => removePlace(single, 'shop'), /至少要保留 1 个地点/);
});
