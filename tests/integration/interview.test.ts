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
import { interviewHandler } from '../../src/modules/profile/infrastructure/interview-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { MemoryCandidateRepository } from '../../src/modules/memory/infrastructure/candidate-repository.ts';
import { InterviewQuestionRepository } from '../../src/modules/memory/infrastructure/question-repository.ts';
test('interview chain persists user message before generation, recovers, and preserves concurrent profile edits', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    id = randomUUID();
  try {
    await new IdentityRepository(db).ensureGuest(id);
    const repo = new InterviewRepository(db);
    const command = { commandId: randomUUID(), expectedVersion: 0, text: '我喜欢修车' };
    const sent = await repo.send(id, command);
    assert.equal(sent.interview.messages.length, 1);
    assert.equal((await repo.send(id, command)).task.id, sent.task.id);
    const planner = new InterviewPlanner({
      async complete() {
        const source = (await repo.get(id)).interview.messages.at(-1)!.id;
        return JSON.stringify({
          reply: '想修怎样的车？',
          question: { text: '你最想把这件事带到哪一步？', target: 'wish' },
          facts: [{ category: 'interest', value: '喜欢修车', sourceMessageIds: [source] }],
          events: [],
        });
      },
    });
    await runOne(queue, { interview: interviewHandler(queue, planner, 'test-model') });
    const saved = await new InterviewRepository(db).get(id);
    assert.equal(saved.interview.messages.length, 2);
    assert.equal(saved.profile.facts.length, 0);
    assert.equal(saved.profile.events.length, 0);
    assert.equal(saved.interview.openQuestion?.version, 0);
    const candidates = new MemoryCandidateRepository(db);
    const suggested = (await candidates.list(id))[0]!;
    assert.equal(suggested.status, 'suggested');
    assert.equal(saved.profile.facts.length, 0);
    const confirmationCommand = randomUUID();
    const confirmed = await candidates.confirm(id, suggested.id, confirmationCommand);
    assert.equal(confirmed.status, 'confirmed');
    const confirmationReplay = await candidates.confirm(id, suggested.id, confirmationCommand);
    assert.equal(confirmationReplay.id, confirmed.id);
    assert.equal((await repo.get(id)).profile.facts.length, 1);
    assert.equal(saved.interview.activeTask?.status, 'succeeded');
    await repo.send(id, {
      commandId: randomUUID(),
      expectedVersion: saved.interview.version,
      text: '想开自己的店',
      questionId: saved.interview.openQuestion!.id,
      questionVersion: saved.interview.openQuestion!.version,
    });
    const slow = new InterviewPlanner({
      async complete() {
        const source = (await repo.get(id)).interview.messages.at(-1)!.id;
        await db.transaction(id, (sql) =>
          sql.query('UPDATE parallel_life.profiles SET version=version+1 WHERE owner_id=$1', [id]),
        );
        return JSON.stringify({
          reply: '想让店里有怎样的氛围？',
          question: { text: '你想先聊聊哪段经历？', target: 'interest' },
          facts: [{ category: 'wish', value: '自己的店', sourceMessageIds: [source] }],
          events: [],
        });
      },
    });
    await runOne(queue, { interview: interviewHandler(queue, slow, 'test-model') });
    const updated = await repo.get(id);
    assert.equal(updated.interview.messages.length, 4);
    assert.equal(updated.profile.facts.length, 1);
    assert.equal((await candidates.list(id)).length, 2);
    const questions = new InterviewQuestionRepository(db);
    const open = (await questions.open(id, updated.interview.id))!;
    const blockCommandId = randomUUID();
    const blocked = await questions.block(id, open.id, open.version, blockCommandId);
    assert.equal(blocked.status, 'dismissed');
    assert.deepEqual((await repo.get(id)).interview.blockedTargets, ['interest']);
    const replay = await questions.block(id, open.id, open.version, blockCommandId);
    assert.equal(replay.id, blocked.id);
    assert.equal(replay.version, blocked.version);
    await assert.rejects(repo.get(randomUUID()), { code: 'NOT_FOUND' });
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [id]);
    await admin.end();
  }
});
