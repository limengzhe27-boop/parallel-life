import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callerAddress,
  callerBucket,
} from '../src/modules/identity/infrastructure/guest-bucket.ts';

const headers = (values: Record<string, string>) => new Headers(values);

test('the first forwarded hop wins and is used as the caller address', () => {
  assert.equal(
    callerAddress(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })),
    '203.0.113.9',
  );
  assert.equal(callerAddress(headers({ 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
  assert.equal(callerAddress(headers({})), '');
});

test('the same caller keeps one bucket and different callers get different buckets', () => {
  const salt = 'test-salt';
  const a = callerBucket(headers({ 'x-forwarded-for': '203.0.113.9' }), salt);
  const again = callerBucket(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), salt);
  const b = callerBucket(headers({ 'x-forwarded-for': '203.0.113.10' }), salt);
  assert.equal(a, again);
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('the bucket is salted and never contains the raw address', () => {
  const address = '203.0.113.9';
  const one = callerBucket(headers({ 'x-forwarded-for': address }), 'salt-one');
  const two = callerBucket(headers({ 'x-forwarded-for': address }), 'salt-two');
  assert.notEqual(one, two);
  assert.equal(one.includes(address), false);
  /* Callers without an address share one bucket on purpose. */
  assert.equal(callerBucket(headers({}), 'salt-one'), callerBucket(headers({}), 'salt-one'));
});
