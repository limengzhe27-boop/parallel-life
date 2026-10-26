import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresOutboxScopeDiscovery } from '../src/modules/tasks/infrastructure/outbox-scope-discovery.ts';

test('global Outbox discovery cannot use app, worker or administrator credentials', () => {
  for (const role of ['pl_app', 'pl_worker', 'pl_admin', 'postgres'])
    assert.throws(
      () => new PostgresOutboxScopeDiscovery(`postgresql://${role}:private@127.0.0.1:1/test`),
      { message: 'OUTBOX_DISCOVERY_SCHEDULER_ROLE_REQUIRED' },
    );
  assert.throws(() => new PostgresOutboxScopeDiscovery('invalid-secret-bearing-value'), {
    message: 'OUTBOX_DISCOVERY_NOT_CONFIGURED',
  });
});
test('discovery rejects invalid batch sizes before opening a database connection', async () => {
  const discovery = new PostgresOutboxScopeDiscovery(
    'postgresql://pl_scheduler:private@127.0.0.1:1/test',
  );
  try {
    for (const limit of [0, 33, -1, 1.5, NaN, Infinity])
      await assert.rejects(discovery.read(limit), { message: 'INVALID_OUTBOX_DISCOVERY_LIMIT' });
  } finally {
    await discovery.close();
  }
});
