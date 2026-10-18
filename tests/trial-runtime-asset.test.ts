import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readTrialRuntimeAsset } from '../src/server/trial-runtime-asset-http.ts';
const owner = randomUUID(),
  world = randomUUID(),
  asset = randomUUID();
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
test('trial runtime asset forwards exact owner/world/id/revision and returns actual private binary content', async () => {
  let call: unknown[] = [];
  const response = await readTrialRuntimeAsset(owner, world, asset, '3', {
    async readForWorld(...args) {
      call = args;
      return png;
    },
  });
  assert.deepEqual(call, [owner, world, asset, 3]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});
test('invalid runtime revision/id and nonmedia bytes fail without publication fallback', async () => {
  let calls = 0;
  const assets = {
    async readForWorld() {
      calls++;
      return png;
    },
  };
  for (const revision of [null, '0', '-1', '1.5', 'NaN', '9007199254740992'])
    await assert.rejects(readTrialRuntimeAsset(owner, world, asset, revision, assets), {
      code: 'NOT_FOUND',
    });
  await assert.rejects(readTrialRuntimeAsset(owner, world, 'not-id', '1', assets), {
    code: 'NOT_FOUND',
  });
  assert.equal(calls, 0);
  await assert.rejects(
    readTrialRuntimeAsset(owner, world, asset, '1', {
      async readForWorld() {
        return Buffer.from('<html>not image</html>');
      },
    }),
    { code: 'NOT_FOUND' },
  );
});
test('underlying ownership or wrong-world denial propagates without another read or broader fallback', async () => {
  const error = Object.assign(Error('not found'), { code: 'NOT_FOUND' });
  let calls = 0;
  await assert.rejects(
    readTrialRuntimeAsset(owner, world, asset, '1', {
      async readForWorld() {
        calls++;
        throw error;
      },
    }),
    (result) => result === error,
  );
  assert.equal(calls, 1);
});
