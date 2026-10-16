import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { InterviewRepository } from '../../src/modules/profile/infrastructure/interview-repository.ts';
import { InterviewPlanner } from '../../src/modules/profile/infrastructure/interview-planner.ts';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';

const fullReply = JSON.stringify({ reply: '我们可以从你的想法开始。', facts: [], events: [] });
const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: fullReply } }] })}\n\n`;

for (const mode of ['eof', 'stall', 'length', 'complete'] as const) {
  test(`real PostgreSQL interview ${mode}: terminal state and replay preserve original input`, async () => {
    const admin = await adminClient('parallel_life_test');
    await migrate(admin);
    const c = await localConfig();
    const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
    const owner = randomUUID();
    let calls = 0,
      cancelled = 0;
    try {
      await new IdentityRepository(db).ensureGuest(owner);
      const repo = new InterviewRepository(db);
      const before = (await repo.get(owner)).profile;
      const command = {
        commandId: randomUUID(),
        expectedVersion: 0,
        text: '独立合成：我想体验修车店的生活。',
      };
      const planner = new InterviewPlanner(
        new YibuTextModel(
          {
            apiKey: 'test-only',
            model: 'test-model',
            baseUrl: 'https://yibuapi.com',
            timeoutMs: 100,
          },
          async () => {
            calls++;
            if (mode === 'stall')
              return new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode(chunk));
                  },
                  cancel() {
                    cancelled++;
                  },
                }),
              );
            return new Response(
              chunk +
                (mode === 'complete'
                  ? 'data: [DONE]\n\n'
                  : mode === 'length'
                    ? 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
                    : ''),
            );
          },
        ),
      );
      if (mode === 'complete') await repo.sendStreaming(owner, command, planner, () => {});
      else
        await assert.rejects(
          repo.sendStreaming(owner, command, planner, () => {}),
          {
            code:
              mode === 'stall' ? 'TIMEOUT' : mode === 'length' ? 'TRUNCATED' : 'UPSTREAM_FAILED',
          },
        );
      const after = await repo.get(owner);
      assert.equal(after.interview.messages.length, mode === 'complete' ? 2 : 1);
      assert.equal(after.interview.messages[0]!.text, command.text);
      assert.equal(
        after.interview.activeTask?.status,
        mode === 'complete' ? 'succeeded' : 'unknown',
      );
      assert.deepEqual(after.profile, before);
      const replay = await repo.sendStreaming(owner, command, planner, () => {});
      assert.equal(replay.replay, true);
      assert.equal(replay.task.id, after.interview.activeTask!.id);
      assert.equal(calls, 1);
      assert.equal((await repo.get(owner)).interview.messages.length, mode === 'complete' ? 2 : 1);
      if (mode === 'stall') assert.equal(cancelled, 1);
    } finally {
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
      await admin.end();
    }
  });
}
