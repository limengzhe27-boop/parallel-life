import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import type { WorldState, WorldEvent, TurnCommand } from '../../src/modules/world/domain/types.ts';

test('L-02: History branching - reconstruct version, new life, unrewritten parent history, resource control and multi-tenant isolation', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const url = `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`;
  const db = new PostgresDatabase(url);
  const repo = new PostgresWorldRepository(db);

  const userA = randomUUID();
  const userB = randomUUID();
  const sessionA = { userId: userA };
  const sessionB = { userId: userB };
  const parentWorldId = randomUUID();
  const baseTime = '2026-10-17T10:00:00.000Z';
  const timeV1 = '2026-10-17T11:00:00.000Z';
  const timeV2 = '2026-10-17T12:00:00.000Z';

  const makeTurn = (worldId: string, version: number, userText: string, npcText: string, time: string): { cmd: TurnCommand; evt: WorldEvent } => {
    const cmdId = randomUUID();
    const evtId = randomUUID();
    const cmd: TurnCommand = {
      id: cmdId,
      worldId,
      expectedVersion: version,
      actorId: 'npc_guide',
      text: userText,
    };
    const evt: WorldEvent = {
      schemaVersion: 1,
      id: evtId,
      worldId,
      version: version + 1,
      commandId: cmdId,
      type: 'turn.resolved',
      occurredAt: time,
      storyAt: time,
      data: {
        actorId: 'npc_guide',
        userText,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId: 'npc_guide', text: npcText },
          { type: 'belief.recorded', id: randomUUID(), actorId: 'npc_guide', text: `关于${userText}的想法` },
        ],
      },
    };
    return { cmd, evt };
  };

  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1), ($2)', [userA, userB]);

    // 1. Initialize parent world at version 0
    const parentState: WorldState = {
      schemaVersion: 1,
      id: parentWorldId,
      ownerId: userA,
      version: 0,
      title: '主线人生：出发探索',
      time: baseTime,
      actors: [
        { id: 'npc_guide', name: '向导小安', persona: '热情的向导', relationship: '伙伴' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await repo.initialize(sessionA, parentState);

    // 2. Commit turn 1 (version 0 -> 1)
    const turn1 = makeTurn(parentWorldId, 0, '我想去北京探索', '好啊，那我们一起去北京！', timeV1);
    await repo.commit(sessionA, turn1.cmd, turn1.evt);

    // 3. Commit turn 2 (version 1 -> 2)
    const turn2 = makeTurn(parentWorldId, 1, '我们订高铁票吧', '已订好高铁票，下午出发。', timeV2);
    await repo.commit(sessionA, turn2.cmd, turn2.evt);

    const parentAfterV2 = await repo.get(sessionA, parentWorldId);
    assert.equal(parentAfterV2.version, 2);
    assert.equal(parentAfterV2.messages.length, 4); // 2 user messages + 2 NPC responses

    await t.test('1. getForkCheckpoints inspects history points', async () => {
      const checkpoints = await repo.getForkCheckpoints(userA, parentWorldId);
      assert.equal(checkpoints.worldId, parentWorldId);
      assert.equal(checkpoints.currentVersion, 2);
      assert.equal(checkpoints.title, '主线人生：出发探索');
      assert.equal(checkpoints.checkpoints.length, 3);

      assert.equal(checkpoints.checkpoints[0]?.version, 0);
      assert.equal(checkpoints.checkpoints[0]?.summary, '初始基线');

      assert.equal(checkpoints.checkpoints[1]?.version, 1);
      assert.ok(checkpoints.checkpoints[1]?.summary.includes('我想去北京探索'));

      assert.equal(checkpoints.checkpoints[2]?.version, 2);
      assert.ok(checkpoints.checkpoints[2]?.summary.includes('我们订高铁票吧'));
    });

    let forkedWorldId: string;
    await t.test('2. forkWorld branches from version 1 to create new life', async () => {
      const forkResult = await repo.forkWorld(userA, parentWorldId, 1, {
        title: '平行分支：改去上海',
      });
      forkedWorldId = forkResult.id;
      assert.ok(forkedWorldId);
      assert.notEqual(forkedWorldId, parentWorldId);
      assert.equal(forkResult.parentWorldId, parentWorldId);
      assert.equal(forkResult.forkVersion, 1);
      assert.equal(forkResult.title, '平行分支：改去上海');
      assert.equal(forkResult.version, 0);
      assert.equal(forkResult.status, 'active');

      // Verify state in repository
      const forkedWorld = await repo.get(sessionA, forkedWorldId);
      assert.equal(forkedWorld.id, forkedWorldId);
      assert.equal(forkedWorld.version, 0);
      assert.equal(forkedWorld.title, '平行分支：改去上海');
      // Should contain version 1 messages (2 messages), but NOT version 2 messages
      assert.equal(forkedWorld.messages.length, 2);
      assert.ok(forkedWorld.messages.some((m) => m.text.includes('我想去北京探索')));
      assert.ok(!forkedWorld.messages.some((m) => m.text.includes('我们订高铁票吧')));
    });

    await t.test('3. Old history is never rewritten ("旧历史不改写")', async () => {
      const parentCurrent = await repo.get(sessionA, parentWorldId);
      assert.equal(parentCurrent.version, 2);
      assert.equal(parentCurrent.messages.length, 4);
      assert.ok(parentCurrent.messages.some((m) => m.text.includes('我们订高铁票吧')));

      // Check DB directly
      const parentRow = (
        await admin.query('SELECT version, parent_world_id, fork_version FROM parallel_life.worlds WHERE id=$1', [
          parentWorldId,
        ])
      ).rows[0];
      assert.equal(parentRow.version, 2);
      assert.equal(parentRow.parent_world_id, null);
      assert.equal(parentRow.fork_version, null);

      const eventsCount = (
        await admin.query('SELECT count(*)::int as c FROM parallel_life.world_events WHERE world_id=$1', [
          parentWorldId,
        ])
      ).rows[0].c;
      assert.equal(eventsCount, 2);
    });

    await t.test('4. Branched world progresses independently', async () => {
      // In forkedWorld (version 0), commit a new choice!
      const forkTurn = makeTurn(forkedWorldId, 0, '我不去北京了，我们去上海！', '好主意，去外滩看夜景！', '2026-10-17T11:30:00.000Z');
      await assert.rejects(repo.commit(sessionA, forkTurn.cmd, forkTurn.evt), /ENGINE_EPOCH_CONFLICT/);
      const runtime=npcAgentServices(db,()=>({async complete(){return JSON.stringify({statements:[{text:'好主意，去外滩看夜景！',dependsOnActionIds:[]}],goals:[],plans:[],actions:[],responsibilities:[],decisions:[]});}}));
      const result=await runtime.sendMessageIfEnabled(userA,{...forkTurn.cmd,id:randomUUID()});
      assert.equal(result?.status,'committed');

      const forkedNow = await repo.get(sessionA, forkedWorldId);
      assert.equal(forkedNow.version, 1);
      assert.equal(forkedNow.messages.length, 4); // 2 preserved from v1 + 2 from the new turn
      assert.ok(forkedNow.messages.some((m) => m.text.includes('去外滩看夜景！')));

      // Verify parent world is STILL untouched at version 2
      const parentStill = await repo.get(sessionA, parentWorldId);
      assert.equal(parentStill.version, 2);
      assert.ok(!parentStill.messages.some((m) => m.text.includes('去外滩看夜景！')));
    });

    await t.test('5. Default title derives from parent title', async () => {
      const defaultFork = await repo.forkWorld(userA, parentWorldId, 0);
      assert.equal(defaultFork.title, '主线人生：出发探索 (分支)');
      assert.equal(defaultFork.forkVersion, 0);
    });

    await t.test('6. Multi-tenant isolation and input bounds', async () => {
      // User B cannot inspect checkpoints of User A's world
      await assert.rejects(
        repo.getForkCheckpoints(userB, parentWorldId),
        (err: any) => err.code === 'NOT_FOUND',
      );

      // User B cannot fork User A's world
      await assert.rejects(
        repo.forkWorld(userB, parentWorldId, 1),
        (err: any) => err.code === 'NOT_FOUND',
      );

      // Invalid fork version: negative
      await assert.rejects(
        repo.forkWorld(userA, parentWorldId, -1),
        (err: any) => err.code === 'INVALID_COMMAND',
      );

      // Invalid fork version: greater than parent current version (2)
      await assert.rejects(
        repo.forkWorld(userA, parentWorldId, 99),
        (err: any) => err.code === 'INVALID_COMMAND',
      );

      // Invalid title: empty
      await assert.rejects(
        repo.forkWorld(userA, parentWorldId, 1, { title: '   ' }),
        (err: any) => err.code === 'INVALID_COMMAND',
      );

      // Invalid title: exceeds 60 chars
      await assert.rejects(
        repo.forkWorld(userA, parentWorldId, 1, { title: 'a'.repeat(61) }),
        (err: any) => err.code === 'INVALID_COMMAND',
      );
    });

    await t.test('7. Controlled resource references with asset validation', async () => {
      // Create a test asset for userA
      const assetId = randomUUID();
      await admin.query(
        `INSERT INTO parallel_life.assets(id, owner_id, storage_key, mime_type, byte_length, width, height, origin, status)
         VALUES($1, $2, $3, 'image/webp', 1024, 100, 100, 'upload', 'ready')`,
        [assetId, userA, `test/${assetId}.webp`],
      );

      // Create a world with an approved seed referencing this asset
      const seedWorldId = randomUUID();
      const seedState = {
        schemaVersion: 1,
        id: seedWorldId,
        ownerId: userA,
        version: 0,
        title: '带素材的人生',
        time: baseTime,
        actors: [],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      };
      await admin.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [seedWorldId, userA, '带素材的人生', seedState],
      );
      await admin.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [seedWorldId, userA, seedState, JSON.stringify({ portraitAssetId: assetId, assets: [{ assetId }] })],
      );

      // Fork while asset is ready
      const forkWithAsset = await repo.forkWorld(userA, seedWorldId, 0, { title: '分支有素材' });
      const snapWithAsset = (
        await admin.query('SELECT approved_seed FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
          forkWithAsset.id,
        ])
      ).rows[0].approved_seed;
      assert.equal(snapWithAsset.portraitAssetId, assetId);
      assert.equal(snapWithAsset.assets.length, 1);

      // Delete the asset (status = 'deleted')
      await admin.query("UPDATE parallel_life.assets SET status='deleted' WHERE id=$1", [assetId]);

      // Fork now -> controlled resource logic safely strips reference to the deleted asset
      const forkWithoutAsset = await repo.forkWorld(userA, seedWorldId, 0, { title: '分支无损坏素材' });
      const snapWithoutAsset = (
        await admin.query('SELECT approved_seed FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
          forkWithoutAsset.id,
        ])
      ).rows[0].approved_seed;
      assert.equal(snapWithoutAsset.portraitAssetId, undefined);
      assert.equal(snapWithoutAsset.assets.length, 0);
    });

    await t.test('8. listUserWorlds includes parentWorldId and forkVersion', async () => {
      const worlds = await repo.listUserWorlds(userA);
      const parent = worlds.find((w) => w.id === parentWorldId);
      const child = worlds.find((w) => w.id === forkedWorldId);
      assert.ok(parent);
      assert.ok(child);
      assert.equal(parent.parentWorldId, null);
      assert.equal(parent.forkVersion, null);
      assert.equal(child.parentWorldId, parentWorldId);
      assert.equal(child.forkVersion, 1);
    });
  } finally {
    await db.close();
    await admin.end();
  }
});
