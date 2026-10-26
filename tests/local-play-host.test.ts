import test from 'node:test';
import assert from 'node:assert/strict';
import { localPlayOrigin, acceptsLocalPlayRequest } from '../scripts/local-play-host.mjs';
test('localhost and existing loopback sessions stay on their own host without redirects', () => {
  for (const host of ['localhost:3218', 'play.localhost:3218', '127.0.0.1:3218', '[::1]:3218']) {
    assert.equal(acceptsLocalPlayRequest(host, 'http://' + host, 3218), true);
    assert.equal(acceptsLocalPlayRequest(host, undefined, 3218), true);
  }
  assert.equal(localPlayOrigin('localhost:3218', 3218), 'http://localhost:3218');
  assert.equal(
    acceptsLocalPlayRequest('localhost:3218', 'http://play.localhost:3218', 3218),
    false,
  );
  for (const host of [
    'evil.example:3218',
    'localhost:9999',
    'localhost:3218@evil.example',
    'localhost:3218/path',
  ])
    assert.equal(acceptsLocalPlayRequest(host, undefined, 3218), false);
});
