import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { InterviewRepository } from '../../src/modules/profile/infrastructure/interview-repository.ts';
import {
  ProfileRepository,
  applyConfirmedCandidateInTransaction,
  groundBasicInfoAtMessage,
} from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { interviewHandler } from '../../src/modules/profile/infrastructure/interview-handler.ts';
import type { InterviewPlanner } from '../../src/modules/profile/infrastructure/interview-planner.ts';

test('real PG: final streaming persistence and candidate confirmation reject fictional identity across turns', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    other = randomUUID();
  const repo = new InterviewRepository(db),
    profiles = new ProfileRepository(db);
  const identity = new IdentityRepository(db);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  // Deliberately bypass planner parsing: the transaction must reject an untrusted proposal itself.
  const planner = {
    async propose() {
      return {
        reply: '测试替身回应',
        facts: [],
        events: [],
        basicInfo: { occupation: '摄影师', birthdate: '2001' },
      };
    },
    async proposeStream() {
      return {
        reply: '测试替身回应',
        facts: [],
        events: [],
        basicInfo: { occupation: '摄影师', birthdate: '2001' },
      };
    },
  } as unknown as InterviewPlanner;
  async function send(text: string) {
    const state = await repo.get(owner);
    return repo.sendStreaming(
      owner,
      { commandId: randomUUID(), expectedVersion: state.interview.version, text },
      planner,
      () => {},
    );
  }
  try {
    await send('故事里第一张是小芳，我的职业是摄影师，我是2001年的');
    await send('我的职业是摄影师，我是2001年的');
    let state = await repo.get(owner);
    assert.equal(state.profile.facts.length, 0);
    const source = state.interview.messages.filter((m) => m.role === 'user').at(-1)!;
    await assert.rejects(
      db.transaction(owner, (sql) =>
        applyConfirmedCandidateInTransaction(sql, owner, {
          category: 'identity',
          text: '生日：2001',
          eventDate: null,
          sourceMessageIds: [source.id],
        }),
      ),
      { code: 'INVALID_INPUT' },
    );
    await assert.rejects(
      db.transaction(other, (sql) => groundBasicInfoAtMessage(sql, other, source.id)),
      { code: 'INVALID_INPUT' },
    );
    for (const history of [
      ['故事里我当摄影师', '不要回到现实'],
      ['故事里我当摄影师', '不想回到现实'],
      ['假如我当摄影师，接下来演这个身份'],
    ]) {
      for (const text of history) await send(text);
      const before = await profiles.get(owner);
      await send('我的职业是摄影师，我是2001年的');
      const streamed = await repo.get(owner);
      assert.deepEqual(streamed.profile, before);
      const fictionalSource = streamed.interview.messages.filter((m) => m.role === 'user').at(-1)!;
      await assert.rejects(
        db.transaction(owner, (sql) =>
          applyConfirmedCandidateInTransaction(sql, owner, {
            category: 'identity',
            text: '生日：2001',
            eventDate: null,
            sourceMessageIds: [fictionalSource.id],
          }),
        ),
        { code: 'INVALID_INPUT' },
      );
      assert.deepEqual(await profiles.get(owner), before);
      const submitted = await repo.send(owner, {
        commandId: randomUUID(),
        expectedVersion: streamed.interview.version,
        text: '我的职业是摄影师，我是2001年的',
      });
      await runOne(
        {
          claim: (kinds) => queue.claimForOwner(submitted.task.id, owner, kinds),
          renew: (task) => queue.renew(task),
          finish: (task, outcome) => queue.finish(task, outcome),
        },
        { interview: interviewHandler(queue, planner, 'fixture-only') },
      );
      const queued = await repo.get(owner);
      assert.equal(queued.interview.activeTask?.status, 'succeeded');
      assert.deepEqual(queued.profile, before);
    }
    await send('现实中我的职业是工程师，我是2002年的');
    const p = await profiles.get(owner);
    assert(p.facts.some((f) => f.value.includes('工程师') && f.value.includes('2002')));
    assert(!p.facts.some((f) => f.value.includes('摄影师') || f.value.includes('2001')));
    assert.equal((await profiles.get(other)).facts.length, 0);
    const current = await repo.get(owner);
    await repo.send(owner, {
      commandId: randomUUID(),
      expectedVersion: current.interview.version,
      text: '故事里我的职业是摄影师，我是2001年的',
    });
    await runOne(queue, { interview: interviewHandler(queue, planner, 'fixture-only') });
    const workerSaved = await repo.get(owner);
    assert.equal(workerSaved.interview.activeTask?.status, 'succeeded');
    assert(
      !workerSaved.profile.facts.some(
        (f) => f.value.includes('摄影师') || f.value.includes('2001'),
      ),
    );
    // Attribution remains durable when the creative turn falls outside readWorkspace's 200-message window.
    const iid = state.interview.id;
    await admin.query(
      `INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,'user','故事里继续创作')`,
      [randomUUID(), owner, iid],
    );
    for (let i = 0; i < 201; i++)
      await admin.query(
        `INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,'user','继续')`,
        [randomUUID(), owner, iid],
      );
    const target = randomUUID();
    await admin.query(
      `INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text) VALUES($1,$2,$3,'user','我的职业是摄影师')`,
      [target, owner, iid],
    );
    assert.deepEqual(
      await db.transaction(owner, (sql) => groundBasicInfoAtMessage(sql, owner, target)),
      {},
    );
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await queue.close();
    await db.close();
    await admin.end();
  }
});
