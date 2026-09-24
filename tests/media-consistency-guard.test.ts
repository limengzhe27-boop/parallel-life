import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConsistencySpec,
  checkMediaQuota,
  assertGenuineCharacterMedia,
  DEFAULT_MEDIA_BUDGET,
} from '../src/modules/media/domain/consistency-guard.ts';

test('AUD-04: consistency-guard rejects invalid specs and enforces fidelity boundaries', () => {
  assert.throws(
    () => validateConsistencySpec(null),
    /INVALID_CONSISTENCY_SPEC: payload must be an object/,
  );

  assert.throws(
    () => validateConsistencySpec({ referenceAssetId: '' }),
    /INVALID_CONSISTENCY_SPEC: referenceAssetId is required/,
  );

  assert.throws(
    () => validateConsistencySpec({ referenceAssetId: 'ref-1', fidelityThreshold: 0.3 }),
    /INVALID_CONSISTENCY_SPEC: fidelityThreshold must be between 0.5 and 1.0/,
  );

  const valid = validateConsistencySpec({
    referenceAssetId: 'ref-portrait-123',
    fidelityThreshold: 0.85,
    preserveFacialFeatures: true,
  });

  assert.equal(valid.referenceAssetId, 'ref-portrait-123');
  assert.equal(valid.fidelityThreshold, 0.85);
  assert.equal(valid.preserveFacialFeatures, true);
  assert.equal(valid.ageDeviationMaxYears, 5);
});

test('AUD-04: checkMediaQuota enforces hard per-world image limits', () => {
  const allowed = checkMediaQuota(5, DEFAULT_MEDIA_BUDGET);
  assert.equal(allowed.allowed, true);

  const rejected = checkMediaQuota(12, DEFAULT_MEDIA_BUDGET);
  assert.equal(rejected.allowed, false);
  assert.match(rejected.reason ?? '', /EXCEEDED_WORLD_MEDIA_QUOTA/);
});

test('AUD-04: assertGenuineCharacterMedia strictly forbids generic stock wallpaper masquerading', () => {
  // Masqueraded mock placeholder
  assert.throws(
    () =>
      assertGenuineCharacterMedia({
        origin: 'generated',
        referenceAssetIds: ['ref-1'],
        isMockPlaceholder: true,
      }),
    /FORBIDDEN_GENERIC_SUBSTITUTION/,
  );

  // Untracked generated portrait without reference asset ID
  assert.throws(
    () =>
      assertGenuineCharacterMedia({
        origin: 'generated',
        referenceAssetIds: [],
        isMockPlaceholder: false,
      }),
    /UNTRACKED_REFERENCE/,
  );

  // Genuine tracked generated asset
  assert.doesNotThrow(() =>
    assertGenuineCharacterMedia({
      origin: 'generated',
      referenceAssetIds: ['ref-portrait-999'],
      isMockPlaceholder: false,
    }),
  );
});
