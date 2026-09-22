import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvePoints } from '../src/features/interview/life-curve.ts';
test('curve excludes unknown dates, never turns unknown feelings into a neutral score', () => {
  const points = curvePoints([
    { id: 'a', title: 'A', date: '2022', feeling: -2, sourceMessageIds: [] },
    { id: 'b', title: 'B', date: '2023', feeling: null, sourceMessageIds: [] },
    { id: 'c', title: 'C', date: null, feeling: 5, sourceMessageIds: [] },
    { id: 'd', title: 'D', date: '2024', feeling: 0, sourceMessageIds: [] },
  ]);
  assert.equal(points.length, 3);
  assert.equal(points[1]?.y, null);
  assert.equal(points[2]?.y, 70);
  assert(points[0]!.x < points[2]!.x);
});
