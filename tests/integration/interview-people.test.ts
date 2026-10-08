import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  ProfileRepository,
  applyPeopleInTransaction,
} from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { InterviewRepository } from '../../src/modules/profile/infrastructure/interview-repository.ts';
import { InterviewPlanner } from '../../src/modules/profile/infrastructure/interview-planner.ts';
import { interviewHandler } from '../../src/modules/profile/infrastructure/interview-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';

test('real PostgreSQL, fixture model: both interview paths persist attributed people atomically, deduplicate, isolate and preserve manual corrections', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owners = [randomUUID(), randomUUID()];
  const owner = owners[0]!,
    other = owners[1]!;
  const dir = await mkdtemp(path.join(tmpdir(), 'pl-interview-people-'));
  try {
    const identity = new IdentityRepository(db);
    for (const id of owners) await identity.ensureGuest(id);
    const repo = new InterviewRepository(db),
      profiles = new ProfileRepository(db);
    let calls = 0;
    let response = '我记下的是你的描述。';
    let description = '对我好，但会干涉我的职业选择。';
    let subject = '表姐';
    let beforeReturn: (() => Promise<void>) | undefined;
    const planner = new InterviewPlanner({
      async complete(context) {
        calls++;
        const input = JSON.parse(context[1]!.content);
        const latest = input.messages.at(-1);
        if (beforeReturn) await beforeReturn();
        return JSON.stringify({
          reply: response,
          facts: [],
          events: [],
          people: [
            {
              subject,
              messageId: latest.id,
              quote: latest.text,
              ...(description ? { description } : {}),
              ...(latest.text.includes('毕业时') ? { experience: '毕业时陪我去面试。' } : {}),
              ...(latest.hasPhoto ? { associatePhoto: true } : {}),
            },
          ],
        });
      },
    });
    const text = '我表姐对我好，但会干涉我的职业选择。毕业时陪我去面试。';
    let command = { commandId: randomUUID(), expectedVersion: 0, text };
    await repo.sendStreaming(owner, command, planner, () => {});
    let state = await repo.get(owner);
    assert.equal(state.profile.people.length, 1);
    const person = state.profile.people[0]!;
    assert.equal(person.knownName, null);
    assert.equal(person.relationship, '表姐');
    assert.equal(person.interaction, '我表姐对我好，但会干涉我的职业选择。');
    assert.equal(person.experiences?.[0]?.text, '毕业时陪我去面试。');
    assert.equal(person.sourceQuotes?.[0]?.quote, text);
    assert.equal(person.origin, 'interview');
    await repo.sendStreaming(owner, command, planner, () => {});
    assert.equal(calls, 1);
    command = { commandId: randomUUID(), expectedVersion: state.interview.version, text };
    await repo.send(owner, command);
    await runOne(queue, { interview: interviewHandler(queue, planner, 'fixture-model') });
    state = await repo.get(owner);
    assert.equal(state.profile.people.length, 1);
    assert.equal(state.profile.people[0]!.experiences?.length, 1);
    assert.equal(state.interview.activeTask?.status, 'succeeded');
    assert.deepEqual((await repo.get(other)).profile.people, []);
    // Owner/scope/role checks run again at persistence, not just at model parsing.
    const userId = state.interview.messages.find((m) => m.role === 'user')!.id;
    const proposal = { subject: '表姐', messageId: userId, quote: text, description };
    const unchanged = state.profile;
    await db.transaction(other, (sql) =>
      applyPeopleInTransaction(sql, other, state.interview.id, userId, 0, [proposal]),
    );
    assert.deepEqual((await profiles.get(other)).people, []);
    await db.transaction(owner, (sql) =>
      applyPeopleInTransaction(sql, owner, randomUUID(), userId, state.profile.version, [proposal]),
    );
    const assistantId = state.interview.messages.find((m) => m.role === 'assistant')!.id;
    await db.transaction(owner, (sql) =>
      applyPeopleInTransaction(sql, owner, state.interview.id, assistantId, state.profile.version, [
        { ...proposal, messageId: assistantId },
      ]),
    );
    assert.deepEqual(await profiles.get(owner), unchanged);
    // Ordinary attachment association comes only from this stored user message.
    const assets = new AssetRepository(db, new PrivateDiskStore(dir));
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#557788' },
    })
      .png()
      .toBuffer();
    const photo = await assets.upload(owner, bytes);
    await profiles.edit(owner, {
      expectedVersion: state.profile.version,
      operation: { kind: 'add-reference-photo', assetId: photo.id },
    });
    description = '';
    await repo.sendStreaming(
      owner,
      {
        commandId: randomUUID(),
        expectedVersion: state.interview.version,
        text: '这是我表姐的头像。',
        photoAssetId: photo.id,
      },
      planner,
      () => {},
    );
    state = await repo.get(owner);
    assert.equal(state.profile.people[0]!.assetId, photo.id);
    // A stale model result cannot overwrite or recreate a manually edited person.
    description = '总是催我换工作。';
    beforeReturn = async () => {
      const p = await profiles.get(owner);
      const old = p.people[0]!;
      await profiles.edit(owner, {
        expectedVersion: p.version,
        operation: {
          kind: 'set-person',
          person: {
            id: old.id,
            name: old.name,
            knownName: old.knownName,
            temporaryLabel: old.temporaryLabel,
            relationship: old.relationship,
            assetId: old.assetId,
            interaction: '我亲自纠正的描述',
            experiences: old.experiences,
          },
        },
      });
    };
    await repo.sendStreaming(
      owner,
      {
        commandId: randomUUID(),
        expectedVersion: state.interview.version,
        text: '我表姐总是催我换工作。',
      },
      planner,
      () => {},
    );
    state = await repo.get(owner);
    assert.equal(state.profile.people[0]!.interaction, '我亲自纠正的描述');
    // Exercise the worker with the same slow-model/manual-edit race.
    await repo.send(owner, {
      commandId: randomUUID(),
      expectedVersion: state.interview.version,
      text: '我表姐总是催我换工作。',
    });
    await runOne(queue, { interview: interviewHandler(queue, planner, 'fixture-model') });
    state = await repo.get(owner);
    assert.equal(state.profile.people[0]!.interaction, '我亲自纠正的描述');
    beforeReturn = undefined;
    // Fiction cannot turn a real leader into a subordinate.
    subject = '下属';
    description = '服从我的安排。';
    await repo.sendStreaming(
      owner,
      {
        commandId: randomUUID(),
        expectedVersion: state.interview.version,
        text: '如果平行人生里我的领导成为我的下属，服从我的安排。',
      },
      planner,
      () => {},
    );
    state = await repo.get(owner);
    assert.equal(state.profile.people.length, 1);
    // An interrupt after reply tokens leaves the user input but no new person/assistant write.
    subject = '朋友';
    description = '很会画画。';
    const before = state.profile;
    await assert.rejects(
      repo.sendStreaming(
        owner,
        {
          commandId: randomUUID(),
          expectedVersion: state.interview.version,
          text: '我朋友很会画画。',
        },
        planner,
        () => {
          throw new Error('fixture-disconnect');
        },
      ),
    );
    state = await repo.get(owner);
    assert.deepEqual(state.profile, before);
    assert.equal(state.interview.messages.at(-1)!.role, 'user');
    assert.equal(state.interview.activeTask?.status, 'unknown');
    // After the person write, an assistant insert failure rolls the entire commit back.
    response = 'PEOPLE02-ROLLBACK';
    await admin.query(
      "ALTER TABLE parallel_life.interview_messages ADD CONSTRAINT people02_reply_failure CHECK(text <> 'PEOPLE02-ROLLBACK')",
    );
    await assert.rejects(
      repo.sendStreaming(
        owner,
        {
          commandId: randomUUID(),
          expectedVersion: state.interview.version,
          text: '我朋友很会画画。',
        },
        planner,
        () => {},
      ),
      { code: '23514' },
    );
    assert.deepEqual((await repo.get(owner)).profile, before);
  } finally {
    await admin.query(
      'ALTER TABLE parallel_life.interview_messages DROP CONSTRAINT IF EXISTS people02_reply_failure',
    );
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
    await admin.end();
    await rm(dir, { recursive: true });
  }
});

test(
  'opt-in real model + PostgreSQL: literal cousin description, fictional subordinate, avatar-only and ambiguous same-name people',
  { skip: process.env.PEOPLE_MODEL_EVAL !== '1' },
  async () => {
    const { YibuTextModel } =
      await import('../../src/modules/ai/infrastructure/yibu-text-model.ts');
    const { writeFile } = await import('node:fs/promises');
    const admin = await adminClient('parallel_life_test');
    await migrate(admin);
    const c = await localConfig();
    const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
    const queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
    const dir = await mkdtemp(path.join(tmpdir(), 'pl-people-model-'));
    const owners: string[] = [];
    const results: unknown[] = [];
    const model = new YibuTextModel({
      apiKey: process.env.YIBU_API_KEY ?? '',
      baseUrl: process.env.YIBU_BASE_URL ?? 'https://yibuapi.com',
      model: process.env.YIBU_TEXT_MODEL ?? 'gpt-4o-mini',
      timeoutMs: 85000,
    });
    try {
      const repo = new InterviewRepository(db),
        profiles = new ProfileRepository(db),
        assets = new AssetRepository(db, new PrivateDiskStore(dir));
      const scenarios = [
        {
          key: 'real-cousin',
          text: '我表姐对我很好，但经常干涉我的职业选择。去年我找工作时，她陪我面试。',
          people: 1,
        },
        {
          key: 'fictional-subordinate',
          text: '我想体验另一种人生。如果平行人生里我的领导变成我的下属，那一定很有趣。',
          people: 0,
        },
        { key: 'avatar-only', text: '[照片]', people: 0, photo: true },
        {
          key: 'ambiguous-same-name',
          text: '我有两个朋友都叫小林，一位会画画，但我没说清是哪位。',
          people: 0,
        },
      ];
      for (const [index, scenario] of scenarios.entries()) {
        const owner = randomUUID();
        owners.push(owner);
        await new IdentityRepository(db).ensureGuest(owner);
        let photoAssetId: string | undefined;
        if (scenario.photo) {
          const bytes = await sharp({
            create: { width: 64, height: 64, channels: 3, background: '#6655aa' },
          })
            .png()
            .toBuffer();
          photoAssetId = (await assets.upload(owner, bytes)).id;
          await profiles.edit(owner, {
            expectedVersion: 0,
            operation: { kind: 'add-reference-photo', assetId: photoAssetId },
          });
        }
        let calls = 0;
        let rawOutput = '';
        const instrumented = {
          complete: async (...args: Parameters<typeof model.complete>) => {
            calls++;
            rawOutput = await model.complete(...args);
            return rawOutput;
          },
          streamComplete: async function* (
            ...args: Parameters<NonNullable<typeof model.streamComplete>>
          ) {
            calls++;
            for await (const chunk of model.streamComplete(...args)) {
              rawOutput += chunk;
              yield chunk;
            }
          },
        };
        const planner = new InterviewPlanner(instrumented);
        const input = {
          commandId: randomUUID(),
          expectedVersion: 0,
          text: scenario.text,
          ...(photoAssetId ? { photoAssetId } : {}),
        };
        if (index === 0) await repo.sendStreaming(owner, input, planner, () => {});
        else {
          const sent = await repo.send(owner, input);
          const lease = await queue.claimForOwner(sent.task.id, owner, ['interview']);
          assert(lease);
          await interviewHandler(
            queue,
            planner,
            process.env.YIBU_TEXT_MODEL ?? 'real-model',
          )(lease, new AbortController().signal);
        }
        const state = await repo.get(owner);
        results.push({
          rawOutput,
          scenario: scenario.key,
          calls,
          task: state.interview.activeTask?.status,
          people: state.profile.people.map(
            ({ name, relationship, interaction, experiences, sourceQuotes, assetId }) => ({
              name,
              relationship,
              myDescription: interaction,
              experiences,
              quotes: sourceQuotes?.map((q) => q.quote),
              hasPhoto: Boolean(assetId),
            }),
          ),
          reply: state.interview.messages.filter((m) => m.role === 'assistant').at(-1)?.text,
          question: state.interview.openQuestion?.id,
        });
        assert.equal(calls, 1);
        assert.equal(state.interview.activeTask?.status, 'succeeded');
        assert.equal(state.profile.people.length, scenario.people, scenario.key);
        if (index === 0) {
          const person = state.profile.people[0]!;
          assert.equal(person.relationship, '表姐');
          assert.equal(person.knownName, null);
          assert(person.interaction?.includes('干涉'));
          assert(person.interaction?.includes('对我很好'));
          assert(person.sourceQuotes?.length);
        }
      }
    } finally {
      await writeFile(
        '.local/people02-model-eval.json',
        JSON.stringify({ model: process.env.YIBU_TEXT_MODEL, results }, null, 2),
      );
      await db.close();
      await queue.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
      await admin.end();
      await rm(dir, { recursive: true });
    }
  },
);
