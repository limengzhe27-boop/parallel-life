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
test('pursuit and follow-up records are sourced from real committed scene tasks (real PostgreSQL)', async (t) => {
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
    const finish = async (id: string, text: string, observation: string) => {
      const read = await scenes.read(owner, worldId);
      const request = {
        commandId: randomUUID(),
        expectedVersion: read.worldVersion,
        text,
        relatedMatterIds: [sceneMatterId(entry.sceneId!, id)],
      };
      const command = await scenes.input(owner, worldId, entry.sceneId!, request);
      const result = await run(command.task!.id, {
        ...base,
        outcome: 'succeeded',
        observation,
        matterUpdates: [{ id: sceneMatterId(entry.sceneId!, id), status: 'completed' }],
      });
      assert.equal(result, true);
      return { command, request };
    };
    const first = await finish(
      matter.id,
      '我核对R17工单，解释电源接头检修细节并交付车辆。',
      '你完成R17接头检查及车辆交付，工单已签收。',
    );
    let current = await worlds.get({ userId: owner }, worldId);
    const pursuit = current.matters!.find((m) => m.span === 'pursuit')!;
    const opportunity = current.matters!.find((m) => m.opportunity)!;
    await t.test(
      'read includes the objective milestone and a real unstarted next step',
      async () => {
        assert.equal(pursuit.pursuitProgress!.milestones.length, 1);
        assert.equal(pursuit.status, 'in_progress');
        assert.equal(opportunity.status, 'not_started');
        const view = await records.read(owner, worldId);
        const long = view.about.find((r) => r.span === 'pursuit')!;
        assert.equal(long.progress!.milestones.length, 1);
        assert.equal(long.progress!.opportunities.length, 1);
        const next = view.current.find((r) => r.opportunity)!;
        assert.equal(next.state, 'not_started');
        assert.equal(long.progress!.opportunities[0]!.recordId, next.id);
        assert.equal(next.opportunity!.pursuitRecordId, long.id);
        assert.ok(view.history.some((r) => r.id === next.opportunity!.triggerRecordId));
        const read = await scenes.read(owner, worldId);
        assert.ok(read.matters.some((m) => m.id === sceneMatterId(entry.sceneId!, opportunity.id)));
      },
    );
    await t.test(
      'same command and repeated reads cannot accept or repeat the opportunity',
      async () => {
        const version = current.version;
        const repeated = await scenes.input(owner, worldId, entry.sceneId!, first.request);
        assert.deepEqual(repeated, first.command);
        assert.deepEqual(await records.read(owner, worldId), await records.read(owner, worldId));
        current = await worlds.get({ userId: owner }, worldId);
        assert.equal(current.version, version);
        assert.equal(current.matters!.filter((m) => m.opportunity).length, 1);
        assert.equal(current.matters!.find((m) => m.id === opportunity.id)!.status, 'not_started');
      },
    );
    await finish(
      opportunity.id,
      '我整理R17交接记录，写清接头检查和验收信息。',
      '你已整理R17交接记录，接头检查和验收信息均已写清。',
    );
    await t.test(
      'actual follow-up becomes the second milestone, without completing the whole pursuit',
      async () => {
        current = await worlds.get({ userId: owner }, worldId);
        assert.equal(
          current.matters!.find((m) => m.id === pursuit.id)!.pursuitProgress!.milestones.length,
          2,
        );
        assert.equal(current.matters!.find((m) => m.id === pursuit.id)!.status, 'in_progress');
        assert.equal(current.matters!.filter((m) => m.opportunity).length, 1);
        const view = await records.read(owner, worldId),
          long = view.about.find((r) => r.span === 'pursuit')!;
        assert.equal(long.progress!.milestones.length, 2);
        assert.deepEqual(long.progress!.opportunities, []);
        assert.ok(view.history.some((r) => r.opportunity && r.state === 'completed'));
        const stored = await admin.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [worldId],
        );
        assert.equal(stored.rows[0]!.state.matters.length, 3);
        assert.ok(
          stored.rows[0]!.state.matters.every(
            (m: { pursuitProgress?: unknown; opportunity?: unknown }) =>
              !m.pursuitProgress && !m.opportunity,
          ),
        );
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
