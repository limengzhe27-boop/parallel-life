import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advancePreflightMode,
  advancePreflightReason,
  shouldLogAdvancePreflight,
} from '../src/modules/world/application/advance-preflight.ts';

test('advance preflight defaults to shadow and accepts explicit modes', () => {
  assert.equal(advancePreflightMode(undefined), 'shadow');
  assert.equal(advancePreflightMode('shadow'), 'shadow');
  assert.equal(advancePreflightMode('on'), 'on');
  assert.equal(advancePreflightMode('off'), 'off');
  assert.equal(advancePreflightMode('unexpected'), 'shadow');
});

test('advance preflight only reports definitive quiet states', () => {
  assert.equal(advancePreflightReason({ paused: true, modelCooldown: false }), 'paused');
  assert.equal(advancePreflightReason({ paused: false, modelCooldown: true }), 'model_cooldown');
  assert.equal(advancePreflightReason({ paused: true, modelCooldown: true }), 'paused');
  assert.equal(advancePreflightReason({ paused: false, modelCooldown: false }), null);
});

test('shadow observation logs once per world and reason', () => {
  const world = '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0');
  assert.equal(shouldLogAdvancePreflight(world, 'paused'), true);
  assert.equal(shouldLogAdvancePreflight(world, 'paused'), false);
  assert.equal(shouldLogAdvancePreflight(world, 'model_cooldown'), true);
});
