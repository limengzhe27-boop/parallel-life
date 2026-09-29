import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDailyScheduler } from '../src/modules/world/application/run-daily-scheduler.ts';

test('daily scheduler advances each claimed world once and keeps one failure from blocking another', async () => {
  const seen: string[] = [];
  const result = await runDailyScheduler(
    {
      claimDue: async () => [
        { ownerId: 'one', worldId: 'a' },
        { ownerId: 'two', worldId: 'b' },
      ],
    },
    async (_ownerId, worldId) => {
      seen.push(worldId);
      if (worldId === 'a') throw Object.assign(Error('private text'), { code: 'VERSION_CONFLICT' });
      return { played: 1 };
    },
  );
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(result, { claimed: 2, advanced: 1, messages: 1, failed: 1 });
});
