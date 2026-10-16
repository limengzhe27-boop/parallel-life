import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { sceneMatterId } from '../../src/modules/world/domain/scene-matter-policy.ts';
import type { SceneProposal } from '../../src/modules/world/application/scene-ports.ts';

// Uses the unmodified editorial package and actual transactions. Synthetic adjudication,
// explicitly zero model calls: this verifies persistence/provenance, not model quality.
test('scene consequences remain coherent in readonly phone records and invitation history (real PostgreSQL)', async (t) => {
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
  try {
    const identities = new IdentityRepository(db);
    await identities.ensureGuest(owner);
    await identities.ensureGuest(other);
    const start = await new OfficialLifeRepository(db, officialLifeCatalog).start(
      owner,
      'county-yellow-hair',
      { commandId: randomUUID(), version: 3 },
    );
    const worldId = start.worldId;
    const worlds = new PostgresWorldRepository(db),
      scenes = new SceneRepository(db),
      records = new PostgresPlayerRecords(db);
    let world = await worlds.get({ userId: owner }, worldId);
    const matter = world.matters!.find(
      (m) => m.source.kind === 'preset' && m.source.matterKey === 'deliver_r17',
    )!;
    const actor = world.actors.find((a) => a.name === '老周')!;
    const invitation = world.appointments.find((a) => a.id === matter.relatedInvitationId)!;
    assert.ok(invitation);
    await worlds.respondToInvitation(
      { userId: owner },
      {
        commandId: randomUUID(),
        worldId,
        expectedVersion: world.version,
        id: invitation.id,
        operation: 'accept',
      },
    );
    await db.transaction(owner, (sql) =>
      sql.query('UPDATE parallel_life.world_clock SET story_now=$1,speed=0 WHERE world_id=$2', [
        invitation.at,
        worldId,
      ]),
    );
    world = await worlds.get({ userId: owner }, worldId);
    const entry = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: world.version,
      placeId: 'repair_shop',
    });
    const base: SceneProposal = {
      location: '老周修车铺',
      narration: '合成验收：R17工单在工作台上。',
      presentActorIds: [actor.id],
      outcome: null,
      observation: null,
      matterTitle: null,
      initialMatters: [],
      matterUpdates: [],
      dialogues: [],
    };
    const run = (taskId: string, proposal: SceneProposal) =>
      runOne(
        {
          claim: (k) => queue.claimForOwner(taskId, owner, k),
          renew: (l) => queue.renew(l),
          finish: (l, o) => queue.finish(l, o),
        },
        {
          world: sceneTaskHandler(
            queue,
            {
              async propose() {
                return proposal;
              },
            },
            'synthetic-no-model',
          ),
        },
      );
    await run(entry.task!.id, base);
    const localId = sceneMatterId(entry.sceneId!, matter.id);
    await t.test(
      'arrival history is backed by the actual scene event; older acceptance cannot overwrite it',
      async () => {
        const view = await records.read(owner, worldId);
        const attended = view.history.find(
          (r) =>
            r.kind === 'invitation' &&
            r.navigation?.app === 'calendar' &&
            r.navigation.invitationId === invitation.id,
        );
        assert.equal(attended?.state, 'attended');
        assert.equal(
          (await worlds.get({ userId: owner }, worldId)).appointments.find(
            (a) => a.id === invitation.id,
          )?.status,
          'attended',
        );
      },
    );
    await t.test('failed attempt stays current with an observable obstacle', async () => {
      const before = await scenes.read(owner, worldId);
      const command = await scenes.input(owner, worldId, entry.sceneId!, {
        commandId: randomUUID(),
        expectedVersion: before.worldVersion,
        text: '我核对R17工单，尝试交接车辆。',
        relatedMatterIds: [localId],
      });
      await run(command.task!.id, {
        ...base,
        outcome: 'failed',
        observation: '你核对R17时发现签收编号不符，暂时没有交付车辆。',
        matterUpdates: [{ id: localId, status: 'blocked' }],
      });
      const view = await records.read(owner, worldId);
      const record = view.current.find(
        (r) => r.source.kind === 'world_matter' && r.source.matterId === matter.id,
      );
      assert.equal(record?.state, 'blocked');
      assert.equal(record?.assertion, 'world_verified');
      assert.match(record!.text, /签收编号不符/);
      assert.ok(
        !view.history.some(
          (r) => r.source.kind === 'world_matter' && r.source.matterId === matter.id,
        ),
      );
    });
    await t.test(
      'verified delivery moves only the linked task to history and preserves the actual consequence',
      async () => {
        const before = await scenes.read(owner, worldId);
        const command = await scenes.input(owner, worldId, entry.sceneId!, {
          commandId: randomUUID(),
          expectedVersion: before.worldVersion,
          text: '我核对R17工单，解释电源接头检修细节并交付车辆。',
          relatedMatterIds: [localId],
        });
        await run(command.task!.id, {
          ...base,
          outcome: 'succeeded',
          observation: '你完成R17接头检查及车辆交付，工单已签收。',
          matterUpdates: [{ id: localId, status: 'completed' }],
        });
        const view = await records.read(owner, worldId);
        const record = view.history.find(
          (r) => r.source.kind === 'world_matter' && r.source.matterId === matter.id,
        );
        assert.equal(record?.state, 'completed');
        assert.match(record!.text, /这次行动的反馈：你完成R17接头检查及车辆交付，工单已签收/);
        assert.ok(view.current.some((r) => r.source.kind === 'world_matter'));
        assert.ok(
          !view.current.some(
            (r) => r.source.kind === 'world_matter' && r.source.matterId === matter.id,
          ),
        );
      },
    );
    await t.test(
      'repeated phone reads are stable, leave no tasks or events, and hide another owner',
      async () => {
        const counts = async () =>
          (
            await admin.query(
              'SELECT version,(SELECT count(*) FROM parallel_life.world_events e WHERE e.world_id=w.id) events,(SELECT count(*) FROM parallel_life.scene_items s WHERE s.world_id=w.id) items FROM parallel_life.worlds w WHERE id=$1',
              [worldId],
            )
          ).rows[0];
        const before = await counts();
        const a = await records.read(owner, worldId),
          b = await records.read(owner, worldId);
        assert.deepEqual(a, b);
        assert.deepEqual(await counts(), before);
        await assert.rejects(records.read(other, worldId), { code: 'NOT_FOUND' });
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
