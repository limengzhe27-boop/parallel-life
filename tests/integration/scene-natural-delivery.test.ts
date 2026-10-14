import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import {
  officialLifeCatalog,
  OFFICIAL_LIFE_PACKS,
} from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { ScenePlanner } from '../../src/modules/world/infrastructure/scene-planner.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { sceneTimelineEntries } from '../../src/features/phone/scenes/scene-timeline.ts';

test('visible delivery persists beside independent speech without fabricating outcomes or losing lease/RLS', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
  const owner = randomUUID(),
    other = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);
  await new IdentityRepository(db).ensureGuest(other);
  const pack = OFFICIAL_LIFE_PACKS.find((p) => p.card.id === 'retired-star')!;
  const { worldId } = await new OfficialLifeRepository(db, officialLifeCatalog).start(
    owner,
    pack.card.id,
    { commandId: randomUUID(), version: pack.card.version },
  );
  const space = new PostgresWorldSpace(db, officialLifeCatalog),
    repo = new SceneRepository(db);
  try {
    await new PostgresClockStore(db).setClock(owner, worldId, { speed: 0 });
    const moved = await space.travel(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 0,
      routeId: 'seaside_home_to_cheng_shop',
    });
    const entered = await repo.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: moved.version,
      placeId: 'cheng_shop',
    });
    let turns = 0;
    const actorId = (
      await db.transaction(owner, (sql) =>
        sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [worldId]),
      )
    ).rows[0].state.actors.find((a: { name: string }) => a.name === '程晓').id;
    const planner = new ScenePlanner({
      async complete(messages) {
        if (messages[1]!.content.includes('\nCURRENT TASK:')) {
          const payload = JSON.parse(messages[1]!.content.split('\nCURRENT TASK:')[0]!);
          const opening = !payload.currentAction;
          return JSON.stringify({
            location: '程晓的小店',
            narration: opening ? '门边的纱帘随着海风轻摆。' : '',
            presentActorIds: opening ? [] : [actorId],
            outcome: opening ? null : 'succeeded',
            observation: opening ? null : '你的声音传到柜台后。',
            matterTitle: null,
            initialMatters: [],
            matterUpdates: [],
            dialogues: [],
            stepProposals: [],
            npcActions: [],
          });
        }
        turns++;
        return JSON.stringify(
          turns === 1
            ? { present: true, text: '进来坐，窗边有位置。', delivery: '把手里的笔搁在桌上。' }
            : {
                text: turns === 2 ? '在呢，我刚在柜台这边。' : '晚饭是六点，现在先坐一会儿吧。',
                delivery: turns === 2 ? '抬起头朝门口看了一眼。' : '朝窗边的空椅子示意。',
                actions: [],
              },
        );
      },
    });
    const handler = sceneTaskHandler(queue, planner, 'fixture-not-a-real-model');
    const run = (id: string) =>
      runOne(
        {
          claim: (k) => queue.claimForOwner(id, owner, k),
          renew: (l) => queue.renew(l),
          finish: (l, o) => queue.finish(l, o),
        },
        { world: handler },
      );
    await t.test(
      'opening and two questions save actual source-bound gesture/dialogue order',
      async () => {
        await run(entered.task!.id);
        let read = await repo.read(owner, worldId);
        assert.equal(read.task!.status, 'succeeded');
        for (const text of ['有人吗', '你不是要和我吃饭吗']) {
          const sent = await repo.input(owner, worldId, entered.sceneId, {
            commandId: randomUUID(),
            expectedVersion: read.worldVersion,
            text,
            relatedMatterIds: [],
          });
          await run(sent.task!.id);
          read = await repo.read(owner, worldId);
          assert.equal(read.task!.status, 'succeeded');
        }
        assert.equal(turns, 3);
        assert.equal(
          read.entries.filter(
            (e) => e.kind === 'narration' && e.text === '门边的纱帘随着海风轻摆。',
          ).length,
          1,
        );
        const speech = read.entries.filter((e) => e.kind === 'dialogue');
        assert.equal(speech.length, 3);
        for (const e of speech) {
          const i = read.entries.indexOf(e),
            prior = read.entries[i - 1]!;
          assert.equal(prior.kind, 'narration');
          assert.equal(prior.sourceEventId, e.sourceEventId);
          assert.equal(prior.sourceVersion, e.sourceVersion);
          if (prior.kind === 'narration') assert.ok(prior.text.startsWith('程晓'));
        }
        assert.ok(
          !read.entries.some((e) => 'text' in e && /没有得到回应|尚未获得回应/.test(e.text)),
        );
        assert.equal(
          sceneTimelineEntries(read.entries).filter((e) => e.kind === 'time_place').length,
          1,
        );
        assert.equal(read.matters.filter((m) => m.status === 'completed').length, 0);
        await assert.rejects(repo.read(other, worldId), { code: 'NOT_FOUND' });
      },
    );
    await t.test(
      'forged silence, delivery execution or a nonpresent speaker roll back all result writes',
      async () => {
        const read = await repo.read(owner, worldId);
        const sent = await repo.input(owner, worldId, entered.sceneId, {
          commandId: randomUUID(),
          expectedVersion: read.worldVersion,
          text: '我在窗边问：晚饭几点？',
          relatedMatterIds: [],
        });
        const before = await repo.read(owner, worldId),
          action = before.actions.at(-1)!;
        const input = {
          type: 'scene' as const,
          sceneId: entered.sceneId,
          actionId: action.id,
          expectedVersion: sent.version,
        };
        const valid = {
          location: '程晓的小店',
          narration: '',
          presentActorIds: [actorId],
          outcome: 'succeeded' as const,
          observation: '你的声音传到柜台后。',
          matterTitle: null,
          matterUpdates: [],
          dialogues: [{ actorId, text: '六点。', delivery: '程晓抬起头。' }],
        };
        for (const p of [
          { ...valid, observation: '你问了，但尚未获得明确回应。' },
          {
            ...valid,
            dialogues: [{ actorId, text: '六点。', delivery: '程晓已经收下R17钥匙和维修单。' }],
          },
          {
            ...valid,
            dialogues: [{ actorId: randomUUID(), text: '六点。', delivery: '陌生人抬头。' }],
          },
        ]) {
          await assert.rejects(
            db.transaction(owner, (sql) =>
              commitSceneProposal(sql, owner, worldId, input, p, randomUUID()),
            ),
            { code: 'INVALID_PROPOSAL' },
          );
          assert.deepEqual(await repo.read(owner, worldId), before);
        }
      },
    );
    await t.test(
      'explicit leave stops unknown attempts, replays old leave receipts and permits real travel and entry',
      async () => {
        const read = await repo.read(owner, worldId);
        const lease = await queue.claimForOwner(read.task!.id, owner, ['world']);
        assert.ok(lease);
        await queue.finish(lease, { status: 'unknown', errorCode: 'TIMEOUT' });
        assert.equal((await space.read(owner, worldId)).busy, true);
        const leave = { commandId: randomUUID(), expectedVersion: read.worldVersion };
        const receipt = await repo.navigate(owner, worldId, entered.sceneId, leave, true);
        assert.equal((await repo.read(owner, worldId, entered.sceneId)).task?.status, 'cancelled');
        assert.equal((await space.read(owner, worldId)).busy, false);
        await assert.rejects(
          queue.commit(lease, async () => {
            throw Error('Late application must not run');
          }),
          /LEASE_LOST/,
        );
        // Reproduce an already-saved leave from the older implementation: same audit, uncertain task.
        await admin.query(
          "UPDATE parallel_life.tasks SET status='unknown',error_code='TIMEOUT' WHERE id=$1",
          [lease.id],
        );
        await assert.rejects(repo.navigate(other, worldId, entered.sceneId, leave, true), {
          code: 'NOT_FOUND',
        });
        await assert.rejects(
          repo.navigate(
            owner,
            worldId,
            entered.sceneId,
            { ...leave, expectedVersion: leave.expectedVersion + 1 },
            true,
          ),
          { code: 'IDEMPOTENCY_CONFLICT' },
        );
        assert.equal((await space.read(owner, worldId)).busy, true);
        assert.deepEqual(
          await repo.navigate(owner, worldId, entered.sceneId, leave, true),
          receipt,
        );
        assert.equal((await space.read(owner, worldId)).busy, false);
        const history = await repo.read(owner, worldId, entered.sceneId);
        assert.equal(history.actions.at(-1)?.text, '我在窗边问：晚饭几点？');
        const moved = await space.travel(owner, worldId, {
          commandId: randomUUID(),
          expectedVersion: receipt.version,
          routeId: 'cheng_shop_to_seaside_home',
        });
        const back = await space.travel(owner, worldId, {
          commandId: randomUUID(),
          expectedVersion: moved.version,
          routeId: 'seaside_home_to_cheng_shop',
        });
        const fresh = await repo.enterPlace(owner, worldId, {
          commandId: randomUUID(),
          expectedVersion: back.version,
          placeId: 'cheng_shop',
        });
        assert.notEqual(fresh.sceneId, entered.sceneId);
        assert.equal(fresh.task?.status, 'queued');
      },
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
