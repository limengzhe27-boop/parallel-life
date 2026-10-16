import test from 'node:test';
import assert from 'node:assert/strict';
import { viewportGeometry } from '../src/components/viewport-geometry.ts';

test('keyboard panning keeps the full visible interval, without double subtraction', () => {
  const result = viewportGeometry({ height: 360, offsetTop: 180, scale: 1, fallbackHeight: 780 });
  assert.deepEqual(result, { height: 360, top: 180, track: true });
  assert.equal(result.top + result.height, 540);
});
test('closing keyboard restores the original full viewport and top', () => {
  assert.deepEqual(viewportGeometry({ height: 780, offsetTop: 0, scale: 1, fallbackHeight: 780 }), {
    height: 780,
    top: 0,
    track: true,
  });
});
test('short viewport is not expanded to a minimum chat height', () => {
  assert.equal(
    viewportGeometry({ height: 220, offsetTop: 90, scale: 1, fallbackHeight: 600 }).height,
    220,
  );
});
test('invalid transient measurements use fallback and clamp negative overscroll', () => {
  assert.deepEqual(
    viewportGeometry({ height: NaN, offsetTop: -12, scale: 1, fallbackHeight: 600 }),
    { height: 600, top: 0, track: true },
  );
});
test('pinch zoom is not treated as a keyboard resize', () => {
  assert.equal(
    viewportGeometry({ height: 300, offsetTop: 90, scale: 2, fallbackHeight: 600 }).track,
    false,
  );
});
