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
    /* 提炼后直接写入真实档案：用户要的是"聊完就沉淀好"，不再逐条采纳 */
    assert.equal(saved.profile.facts.length, 1);
    assert.equal(saved.profile.facts[0]!.value, '喜欢修车');
    assert.equal(saved.profile.facts[0]!.status, 'confirmed');
    assert.ok(saved.profile.facts[0]!.sourceMessageIds.length > 0);
    assert.equal(saved.profile.events.length, 0);
    assert.equal(saved.interview.openQuestion?.version, 0);
    /* 不再留下需要用户确认的候选 */
    const candidates = new MemoryCandidateRepository(db);
    assert.equal((await candidates.list(id)).length, 0);
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
    assert.equal(updated.profile.facts.length, 2);
    assert.equal((await candidates.list(id)).length, 0);
    const questions = new InterviewQuestionRepository(db);
    const open = (await questions.open(id, updated.interview.id))!;
    const blockCommandId = randomUUID();
    const blocked = await questions.block(id, open.id, open.version, blockCommandId);
    assert.equal(blocked.status, 'dismissed');
    assert.deepEqual((await repo.get(id)).interview.blockedTargets, ['interest']);
    const replay = await questions.block(id, open.id, open.version, blockCommandId);
    assert.equal(replay.id, blocked.id);
    assert.equal(replay.version, blocked.version);

    /* 同一件事换个说法再说一次：合并来源，不再新增一条（不重复沉淀） */
    const beforeRepeat = await repo.get(id);
    const mergedSources = beforeRepeat.profile.facts.find((fact) => fact.value === '喜欢修车')!
      .sourceMessageIds.length;
    await repo.send(id, {
      commandId: randomUUID(),
      expectedVersion: beforeRepeat.interview.version,
      text: '我还是很喜欢修车',
    });
    await runOne(queue, {
      interview: interviewHandler(
        queue,
        new InterviewPlanner({
          async complete() {
            const source = (await repo.get(id)).interview.messages.at(-1)!.id;
            return JSON.stringify({
              reply: '修车这件事陪了你很久。',
              facts: [{ category: 'interest', value: '喜欢修车', sourceMessageIds: [source] }],
              events: [],
            });
          },
        }),
        'test-model',
      ),
    });
    const afterRepeat = await repo.get(id);
    assert.equal(afterRepeat.profile.facts.length, 2);
    assert.equal(
      afterRepeat.profile.facts.find((fact) => fact.value === '喜欢修车')!.sourceMessageIds.length,
      mergedSources + 1,
    );
    await assert.rejects(repo.get(randomUUID()), { code: 'NOT_FOUND' });
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [id]);
    await admin.end();
  }
});

test('both streaming and queued interviews preserve birthdays across unrelated years', async () => {
  const admin = await adminClient('parallel_life_test');
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID();
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const repo = new InterviewRepository(db);
    const planner = new InterviewPlanner({
      async complete() {
        return JSON.stringify({
          reply: '记下了。',
          facts: [],
          events: [],
          basicInfo: { birthdate: '2020' },
        });
      },
    });
    let version = 0;
    for (const text of ['我是1998年的', '2020年毕业', '我朋友2005年出生']) {
      const state = await repo.sendStreaming(
        owner,
        { commandId: randomUUID(), expectedVersion: version, text },
        planner,
        () => {},
      );
      version = state.interview.version;
      const saved = await repo.get(owner);
      const basics = saved.profile.facts.find((f) => f.value.startsWith('个人资料\n'))?.value ?? '';
      assert.match(basics, /1998/);
      assert.doesNotMatch(basics, /2020|2005/);
    }
    await repo.send(owner, {
      commandId: randomUUID(),
      expectedVersion: version,
      text: '2021年参加工作',
    });
    await runOne(queue, { interview: interviewHandler(queue, planner, 'test-model') });
    const saved = await repo.get(owner);
    const basics = saved.profile.facts.find((f) => f.value.startsWith('个人资料\n'))?.value ?? '';
    assert.match(basics, /1998/);
    assert.doesNotMatch(basics, /2020|2021/);
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});

test('streaming and queued interview paths suggest conflicting birthdays without changing the current one', async () => {
  const admin = await adminClient('parallel_life_test');
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID();
  const planner = new InterviewPlanner({
    async complete() {
      return JSON.stringify({ reply: '我记下了，你可以核对资料。', facts: [], events: [] });
    },
  });
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const repo = new InterviewRepository(db);
    const candidates = new MemoryCandidateRepository(db);
    let state = await repo.sendStreaming(
      owner,
      { commandId: randomUUID(), expectedVersion: 0, text: '我是2005年的' },
      planner,
      () => {},
    );
    assert.match((await repo.get(owner)).profile.facts[0]!.value, /生日：2005(?:\n|$)/u);
    state = await repo.sendStreaming(
      owner,
      {
        commandId: randomUUID(),
        expectedVersion: state.interview.version,
        text: '我出生于2000年1月1日',
      },
      planner,
      () => {},
    );
    assert.match((await repo.get(owner)).profile.facts[0]!.value, /生日：2005(?:\n|$)/u);
    assert.equal(
      (await candidates.list(owner, 'suggested')).some(
        (candidate) => candidate.text === '生日：2000-01-01',
      ),
      true,
    );
    await repo.send(owner, {
      commandId: randomUUID(),
      expectedVersion: state.interview.version,
      text: '我出生于2003年3月3日',
    });
    await runOne(queue, { interview: interviewHandler(queue, planner, 'test-model') });
    assert.match((await repo.get(owner)).profile.facts[0]!.value, /生日：2005(?:\n|$)/u);
    const pending = await candidates.list(owner, 'suggested');
    assert.equal(
      pending.some((candidate) => candidate.text === '生日：2003-03-03'),
      true,
    );
    const accepted = pending.find((candidate) => candidate.text === '生日：2000-01-01')!;
    await candidates.confirm(owner, accepted.id, randomUUID());
    assert.match((await repo.get(owner)).profile.facts[0]!.value, /生日：2000-01-01/u);
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});

test('streaming and queued interviews keep distinct interests, wishes and experiences while merging a real repeat', async () => {
  const admin = await adminClient('parallel_life_test');
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID();
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const repo = new InterviewRepository(db);
    const planner = new InterviewPlanner({
      async complete() {
        const last = (await repo.get(owner)).interview.messages
          .filter((m) => m.role === 'user')
          .at(-1)!;
        if (last.text.includes('上大学'))
          return JSON.stringify({
            reply: '我记下了。',
            facts: [],
            events: [{ title: last.text, date: null, sourceMessageIds: [last.id] }],
          });
        const value = last.text.includes('旅行')
          ? '喜欢旅行'
          : last.text.includes('音乐家')
            ? '想成为音乐家'
            : last.text.includes('摄影师')
              ? '想成为摄影师'
              : '喜欢摄影';
        return JSON.stringify({
          reply: '我记下了。',
          facts: [
            {
              category: value.startsWith('想') ? 'wish' : 'interest',
              value,
              sourceMessageIds: [last.id],
            },
          ],
          events: [],
        });
      },
    });
    for (const [index, text] of [
      '我喜欢摄影',
      '我喜欢旅行',
      '我还是很喜欢摄影',
      '我想成为摄影师',
      '我想成为音乐家',
      '我在上海上大学',
      '我在北京上大学',
    ].entries()) {
      const version = (await repo.get(owner)).interview.version;
      const input = { commandId: randomUUID(), expectedVersion: version, text };
      if (index % 2 === 0) await repo.sendStreaming(owner, input, planner, () => {});
      else {
        await repo.send(owner, input);
        await runOne(queue, { interview: interviewHandler(queue, planner, 'test-model') });
      }
    }
    const profile = (await repo.get(owner)).profile;
    assert.deepEqual(
      profile.facts.map((fact) => [fact.category, fact.value]),
      [
        ['interest', '喜欢摄影'],
        ['interest', '喜欢旅行'],
        ['wish', '想成为摄影师'],
        ['wish', '想成为音乐家'],
      ],
    );
    assert.equal(profile.facts[0]!.sourceMessageIds.length, 2);
    assert.equal(profile.facts[1]!.sourceMessageIds.length, 1);
    assert.deepEqual(
      profile.events.map((event) => event.title),
      ['我在上海上大学', '我在北京上大学'],
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
