import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewOnly } from '../src/contracts/preview.ts';

test('only the explicit flag turns preview mode on', () => {
  assert.equal(isPreviewOnly({ APP_PREVIEW_ONLY: '1' }), true);
  assert.equal(isPreviewOnly({ APP_PREVIEW_ONLY: '0' }), false);
  assert.equal(isPreviewOnly({ APP_PREVIEW_ONLY: '' }), false);
  assert.equal(isPreviewOnly({ APP_PREVIEW_ONLY: 'true' }), false);
  assert.equal(isPreviewOnly({}), false);
});
