import test from 'node:test';
import assert from 'node:assert/strict';
import { modelRequestRejection } from '../src/modules/ai/application/ports.ts';

test('explicit gateway 5xx and rate-limit responses are known rejections, not lost results', () => {
  for (const httpStatus of [408, 429, 500, 502, 503, 504]) {
    assert.deepEqual(modelRequestRejection({ responseOutcome: 'rejected', httpStatus }), {
      httpStatus,
    });
  }
  assert.equal(
    modelRequestRejection({ responseOutcome: 'rejected', httpStatus: 401 })?.httpStatus,
    401,
  );
  assert.equal(modelRequestRejection({ responseOutcome: 'unknown', httpStatus: 503 }), null);
});
