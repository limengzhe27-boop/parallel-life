import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';
import { beatCue } from '../../src/modules/world/domain/clock.ts';
import type { TurnCommand, WorldEvent } from '../../src/modules/world/domain/types.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
test('world build persists genesis, isolates owners, deduplicates and fences cancelled results', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    owner = randomUUID(),
    other = randomUUID();
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const profiles = new ProfileRepository(db);
    let p = await profiles.edit(owner, {
      expectedVersion: 0,
      operation: {
        kind: 'set-fact',
        category: 'identity',
        value: '个人资料\n姓名：资料测试\n生日：1998-06-18\n所在城市：杭州',
      },
    });
    assert.equal((await new ProfileRepository(db).get(owner)).facts[0]?.value, p.facts[0]?.value);
    const seedId = randomUUID();
    const seed = {
      id: seedId,
      createdAt: new Date().toISOString(),
      profileVersion: p.version,
      discoveryVersion: 1,
      directionId: randomUUID(),
      story: {
        title: '如果开一间维修铺',
        premise: '修理社区单车',
        opening: '清晨开门',
        tradeoff: '收入不稳定',
      },
      facts: [],
      people: [],
      portraitAssetId: null,
      assets: [],
    };
    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
        [seedId, owner, p.id, randomUUID(), 'fixture', seed],
      ),
    );
    const builds = new BuildRepository(db),
      tasks = new TaskRepository(db),
      request = { seedId, commandId: randomUUID() };
    const first = await builds.create(owner, request);
    assert.equal((await builds.create(owner, request)).task?.id, first.task?.id);
    assert.equal(
      (await builds.create(owner, { ...request, commandId: randomUUID() })).worldId,
      first.worldId,
    );
    await assert.rejects(builds.create(other, { ...request, commandId: randomUUID() }), {
      code: 'NOT_FOUND',
    });
    assert.deepEqual(await builds.list(other), []);
    await assert.rejects(builds.phone(owner, first.worldId), { code: 'NOT_FOUND' });
    const output = {
      identity: '社区维修铺店主',
      setting: '杭州的清晨',
      actors: ['a', 'b', 'c'].map((key) => ({
        key,
        name: key,
        relationship: '邻居',
        persona: '喜欢骑车',
      })),
      actorTies: [{ fromKey: 'a', toKey: 'b', relationship: '在街角常碰面', mayShare: true }],
      messages: [{ actorKey: 'a', text: '店开了吗？我车胎有点漏气。' }],
      notes: [{ title: '今天', text: '检查工具' }],
    };
    const slow = new WorldPlanner({
      async complete() {
        await tasks.cancel(owner, first.task!.id);
        return JSON.stringify(output);
      },
    });
    await runOne(queue, { 'world-build': buildHandler(queue, slow, 'test-model') });
    assert.equal((await builds.list(owner))[0]?.ready, false);
    assert.equal((await tasks.get(owner, first.task!.id)).status, 'cancelled');
    await tasks.retry(owner, first.task!.id, randomUUID());
    const planner = new WorldPlanner({
      async complete() {
        return JSON.stringify(output);
      },
    });
    await runOne(queue, { 'world-build': buildHandler(queue, planner, 'test-model') });
    const ready = (await new BuildRepository(db).list(owner))[0]!;
    assert.equal(ready.ready, true);
    assert.equal(ready.task?.status, 'succeeded');
    assert.equal(ready.worldId, first.worldId);
    const olderSeed = { ...seed, id: randomUUID(), directionId: randomUUID() };
    const olderWorldId = randomUUID();
    await db.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
        [olderSeed.id, owner, p.id, randomUUID(), 'older-build-fixture', olderSeed],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id) VALUES($1,$2,$3)',
        [olderSeed.id, owner, olderWorldId],
      );
    });
    const olderBuild = (await builds.list(owner)).find((item) => item.seedId === olderSeed.id);
    assert.equal(olderBuild?.worldId, olderWorldId);
    assert.equal(olderBuild?.task, null, 'a legacy build without a task still appears');
    const phone = await new BuildRepository(db).phone(owner, first.worldId);
    assert.equal(phone.messages.length, 1);
    assert.equal(phone.actors.length, 3);
    const builtState = await new PostgresWorldRepository(db).get({ userId: owner }, first.worldId);
    assert.deepEqual(builtState.actorTies, [
      {
        fromActorId: phone.actors[0]!.id,
        toActorId: phone.actors[1]!.id,
        relationship: '在街角常碰面',
        mayShare: true,
      },
    ]);
    assert.equal(phone.notes[0]?.title, '今天');
    const actorId = phone.actors[0]!.id;
    const worlds = new PostgresWorldRepository(db);
    const choiceCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 0,
      actorId,
      text: '我决定先把短片剪到十五分钟。',
    };
    const choiceEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 1,
      commandId: choiceCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        userText: choiceCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '剪完发我看看。' },
          {
            type: 'choice.recorded',
            id: randomUUID(),
            quote: '我决定先把短片剪到十五分钟',
            intent: '完成十五分钟版本',
          },
        ],
      },
    };
    const chosen = await worlds.commit({ userId: owner }, choiceCommand, choiceEvent);
    const invitationId = randomUUID();
    const invitationAt = new Date(Date.now() + 86_400_000).toISOString();
    const followCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 1,
      actorId,
      origin: 'director',
      text: beatCue(chosen.state, actorId),
    };
    assert.match(followCommand.text, new RegExp(`\\[choice:${chosen.state.choices![0]!.id}\\]`));
    const followEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 2,
      commandId: followCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        origin: 'director',
        userText: followCommand.text,
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId,
            text: '明天一起看初剪？我留一小时。',
          },
          {
            type: 'choice.next_step',
            id: randomUUID(),
            choiceId: chosen.state.choices![0]!.id,
            quote: '明天一起看初剪？我留一小时',
          },
          {
            type: 'appointment.proposed',
            id: invitationId,
            title: '一起看初剪',
            at: invitationAt,
            participantIds: [actorId],
          },
        ],
      },
    };
    await worlds.commit({ userId: owner }, followCommand, followEvent);
    const proposedPhone = await builds.phone(owner, first.worldId);
    assert.deepEqual(proposedPhone.choices?.[0]?.nextStep?.calendar, {
      id: invitationId,
      title: '一起看初剪',
      at: invitationAt,
      status: 'proposed',
    });
    assert.equal(
      proposedPhone.invitations?.find((item) => item.id === invitationId)?.status,
      'proposed',
    );
    const acceptCommand = {
      commandId: randomUUID(),
      worldId: first.worldId,
      id: invitationId,
      expectedVersion: 2,
      operation: 'accept' as const,
    };
    const accepted = await worlds.respondToInvitation({ userId: owner }, acceptCommand);
    assert.deepEqual(await worlds.respondToInvitation({ userId: owner }, acceptCommand), accepted);
    const acceptedPhone = await builds.phone(owner, first.worldId);
    assert.equal(acceptedPhone.choices?.[0]?.nextStep?.calendar?.status, 'confirmed');
    assert.equal(
      acceptedPhone.invitations?.find((item) => item.id === invitationId)?.status,
      'confirmed',
    );
    await worlds.respondToInvitation(
      { userId: owner },
      {
        commandId: randomUUID(),
        worldId: first.worldId,
        id: invitationId,
        expectedVersion: 3,
        operation: 'cancel',
      },
    );
    const cancelledPhone = await builds.phone(owner, first.worldId);
    assert.equal(cancelledPhone.choices?.[0]?.nextStep?.calendar?.status, 'cancelled');
    assert.equal(
      cancelledPhone.invitations?.find((item) => item.id === invitationId)?.status,
      'cancelled',
    );
    const reportCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 4,
      actorId,
      text: '我把短片剪完了，十五分钟版本已经导出。',
    };
    const reportEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 5,
      commandId: reportCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        userText: reportCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '发我文件，我看看。' },
          {
            type: 'choice.result_reported',
            id: randomUUID(),
            choiceId: chosen.state.choices![0]!.id,
            quote: '我把短片剪完了，十五分钟版本已经导出',
            outcome: 'reported_done',
          },
        ],
      },
    };
    await worlds.commit({ userId: owner }, reportCommand, reportEvent);
    const storyPhone = await new BuildRepository(db).phone(owner, first.worldId);
    assert.equal(storyPhone.choices?.length, 1);
    assert.equal(storyPhone.choices?.[0]?.sourceEventId, choiceEvent.id);
    assert.equal(storyPhone.choices?.[0]?.nextStep?.sourceEventId, followEvent.id);
    assert.equal(storyPhone.choices?.[0]?.nextStep?.calendar?.status, 'cancelled');
    assert.equal(storyPhone.choices?.[0]?.result?.sourceEventId, reportEvent.id);
    assert.equal(storyPhone.choices?.[0]?.result?.kind, 'reported_done');
    assert.equal(storyPhone.choices?.[0]?.at, choiceEvent.occurredAt);
    assert.equal(storyPhone.choices?.[0]?.result?.at, reportEvent.occurredAt);
    const secondCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 5,
      actorId,
      text: '我决定先把维修铺宣传片剪出一个版本。',
    };
    const secondEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 6,
      commandId: secondCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        userText: secondCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '好，先给我看个初版。' },
          {
            type: 'choice.recorded',
            id: randomUUID(),
            quote: '我决定先把维修铺宣传片剪出一个版本',
            intent: '剪出维修铺宣传片',
          },
        ],
      },
    };
    const second = await worlds.commit({ userId: owner }, secondCommand, secondEvent);
    const blockedChoiceId = second.state.choices!.at(-1)!.id;
    const blockedCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 6,
      actorId,
      text: '我剪宣传片卡住了，开头节奏对不上。',
    };
    const blockedEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 7,
      commandId: blockedCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        userText: blockedCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '卡在哪一段？' },
          {
            type: 'choice.result_reported',
            id: randomUUID(),
            choiceId: blockedChoiceId,
            quote: '我剪宣传片卡住了，开头节奏对不上',
            outcome: 'blocked',
          },
        ],
      },
    };
    const blocked = await worlds.commit({ userId: owner }, blockedCommand, blockedEvent);
    const recoveryCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 7,
      actorId,
      origin: 'director',
      text: beatCue(blocked.state, actorId),
    };
    assert.match(recoveryCommand.text, new RegExp(`\\[choice:${blockedChoiceId}\\]`));
    const recoveryMessageId = randomUUID();
    const recoveryEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 8,
      commandId: recoveryCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        origin: 'director',
        userText: recoveryCommand.text,
        effects: [
          {
            type: 'message.received',
            id: recoveryMessageId,
            actorId,
            text: '我可以帮你看前三分钟，先找能剪掉的镜头。',
          },
          {
            type: 'choice.recovery_step',
            id: randomUUID(),
            choiceId: blockedChoiceId,
            quote: '我可以帮你看前三分钟，先找能剪掉的镜头',
          },
        ],
      },
    };
    const recovered = await worlds.commit({ userId: owner }, recoveryCommand, recoveryEvent);
    assert.deepEqual(
      await worlds.commit({ userId: owner }, recoveryCommand, recoveryEvent),
      recovered,
    );
    const recoveredPhone = await builds.phone(owner, first.worldId);
    const blockedEntry = recoveredPhone.choices?.find((item) => item.id === blockedChoiceId);
    assert.equal(blockedEntry?.result?.kind, 'blocked');
    assert.deepEqual(blockedEntry?.recoveryStep, {
      quote: '我可以帮你看前三分钟，先找能剪掉的镜头',
      at: recoveryEvent.occurredAt,
      sourceEventId: recoveryEvent.id,
      sourceMessageId: recoveryMessageId,
    });
    assert.deepEqual((await builds.phone(owner, first.worldId)).choices, recoveredPhone.choices);
    await assert.rejects(builds.phone(other, first.worldId), { code: 'NOT_FOUND' });
    await assert.rejects(builds.phone(other, first.worldId), { code: 'NOT_FOUND' });
    // Exercise the production command-to-effect ID path, not hand-made UUID fixtures.
    const actualText = '我决定先修理一辆社区单车';
    const actual = await resolveTurn(
      {
        worlds,
        planner: {
          async propose() {
            return {
              schemaVersion: 1,
              effects: [
                {
                  type: 'message.received',
                  id: 'model-reply',
                  actorId,
                  text: '可以先检查前后轮。',
                },
                {
                  type: 'choice.recorded',
                  id: 'model-choice',
                  quote: actualText,
                  intent: '先修理一辆社区单车并检查前后轮',
                },
              ],
            };
          },
        },
        now: () => new Date().toISOString(),
        newId: randomUUID,
      },
      { userId: owner },
      {
        id: randomUUID(),
        worldId: first.worldId,
        expectedVersion: (await worlds.get({ userId: owner }, first.worldId)).version,
        actorId,
        text: actualText,
      },
    );
    const actualChoice = actual.state.choices!.at(-1)!;
    assert.match(actualChoice.id, /_effect_1$/);
    assert.equal((await builds.phone(owner, first.worldId)).choices!.at(-1)!.id, actualChoice.id);
    const nextQuote = '你可以先把前后轮都转一遍，再告诉我有没有异响';
    const followed = await resolveTurn(
      {
        worlds,
        planner: {
          async propose() {
            return {
              schemaVersion: 1,
              effects: [
                { type: 'message.received', id: 'model-reply', actorId, text: nextQuote },
                {
                  type: 'choice.next_step',
                  id: 'model-step',
                  choiceId: actualChoice.id,
                  quote: nextQuote,
                },
                {
                  type: 'appointment.proposed',
                  id: 'model-invite',
                  title: '单车检查',
                  at: new Date(Date.now() + 3600000).toISOString(),
                  participantIds: [actorId],
                },
              ],
            };
          },
        },
        now: () => new Date().toISOString(),
        newId: randomUUID,
      },
      { userId: owner },
      {
        id: randomUUID(),
        worldId: first.worldId,
        expectedVersion: actual.state.version,
        actorId,
        origin: 'director',
        text: `[choice:${actualChoice.id}]`,
      },
    );
    const actualPhone = await builds.phone(owner, first.worldId);
    assert.equal(
      actualPhone.choices!.at(-1)!.nextStep!.sourceMessageId,
      followed.state.choices!.at(-1)!.nextStep!.sourceMessageId,
    );
    assert.match(actualPhone.choices!.at(-1)!.nextStep!.sourceMessageId, /_effect_0$/);
    assert.match(actualPhone.choices!.at(-1)!.nextStep!.calendar!.id, /_effect_2$/);
    assert.equal(actualPhone.choices!.at(-1)!.nextStep!.calendar!.status, 'proposed');
    const snapshot = (
      await admin.query(
        'SELECT state,approved_seed FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
        [first.worldId],
      )
    ).rows[0];
    assert.equal(snapshot.state.version, 0);
    assert.deepEqual(snapshot.approved_seed, seed);
    assert.equal((await builds.create(owner, { ...request, commandId: randomUUID() })).ready, true);
    assert.equal(
      (
        await admin.query('SELECT count(*)::int count FROM parallel_life.worlds WHERE id=$1', [
          first.worldId,
        ])
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
  }
});
