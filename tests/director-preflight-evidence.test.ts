import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isVerifiedDirectorPreflightRejection } from '../src/modules/world/infrastructure/director-preflight-evidence.ts';
const response = { kind: 'model_preflight_rejection', schemaVersion: 1 };
const row = {
  status: 'invalid_output',
  response,
  response_hash: createHash('sha256').update(JSON.stringify(response)).digest('hex'),
  decision_id: null,
};

test('only protected exact server preflight evidence is zero-send despite prior sent marker', () => {
  const evidence = { ...row, sent_at: '2026-10-19T01:00:00.000Z' };
  const before = structuredClone(evidence);
  assert.equal(isVerifiedDirectorPreflightRejection(evidence), true);
  assert.equal(
    isVerifiedDirectorPreflightRejection({
      ...row,
      response: { schemaVersion: 1, kind: 'model_preflight_rejection' },
    }),
    true,
  );
  assert.deepEqual(evidence, before);
});
test('unknown, real invalid completion, rejection, bad hash or existing decision cannot gain zero-send permission', () => {
  for (const status of [
    'committed',
    'unknown_after_send',
    'request_sent',
    'response_received',
    'stale_discarded',
    'cancelled_before_send',
  ])
    assert.equal(isVerifiedDirectorPreflightRejection({ ...row, status }), false);
  for (const response of [
    JSON.stringify(row.response),
    {},
    null,
    [],
    { kind: 'model_request_rejection', schemaVersion: 1 },
    { kind: 'model_preflight_rejection', schemaVersion: 2 },
    { ...row.response, code: 'INVALID_CONFIG' },
  ])
    assert.equal(isVerifiedDirectorPreflightRejection({ ...row, response }), false);
  for (const response_hash of [null, undefined, '', 'f'.repeat(64)])
    assert.equal(isVerifiedDirectorPreflightRejection({ ...row, response_hash }), false);
  for (const decision_id of [undefined, '', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
    assert.equal(isVerifiedDirectorPreflightRejection({ ...row, decision_id }), false);
});
