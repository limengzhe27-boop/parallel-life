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
import {
  replayWorldHistory,
  type WorldHistoryEvent,
} from '../../src/modules/world/domain/world-history.ts';
import type { SceneProposal } from '../../src/modules/world/application/scene-ports.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

// Independent runtime audit. The planner supplies labelled synthetic adjudications;
// all ownership, queues, reducers, transactions, receipts and projections are real.
// No model calls, production data or existing test accounts are used.
test('independent progression negative audit on real PostgreSQL', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const accounts: string[] = [];
  const worlds = new PostgresWorldRepository(db);
  const scenes = new SceneRepository(db);
  const records = new PostgresPlayerRecords(db);
  const identity = new IdentityRepository(db);
  const run = (owner: string, taskId: string, proposal: SceneProposal) =>
    runOne(
      {
        claim: (key) => queue.claimForOwner(taskId, owner, key),
        renew: (lease) => queue.renew(lease),
        finish: (lease, outcome) => queue.finish(lease, outcome),
      },
      {
        world: sceneTaskHandler(
          queue,
          {
            async propose() {
              return proposal;
            },
          },
          'q-synthetic-no-model',
        ),
      },
    );
  const setup = async () => {
    const owner = randomUUID();
    accounts.push(owner);
    await identity.ensureGuest(owner);
    const start = await new OfficialLifeRepository(db, officialLifeCatalog).start(
      owner,
      'county-yellow-hair',
      { commandId: randomUUID(), version: 3 },
    );
    const worldId = start.worldId;
    let world = await worlds.get({ userId: owner }, worldId);
    const trigger = world.matters!.find(
      (matter) => matter.source.kind === 'preset' && matter.source.matterKey === 'deliver_r17',
    )!;
    const actor = world.actors.find((actor) => actor.name === '老周')!;
    const invitation = world.appointments.find(
      (appointment) => appointment.id === trigger.relatedInvitationId,
    )!;
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
    // Synthetic clock control only, never an invented completion or source event.
    await db.transaction(owner, (sql) =>
      sql.query('UPDATE parallel_life.world_clock SET story_now=$1,speed=0 WHERE world_id=$2', [
        invitation.at,
        worldId,
      ]),
    );
    world = await worlds.get({ userId: owner }, worldId);
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: world.version,
      placeId: 'repair_shop',
    });
    const sceneId = entered.sceneId!;
    const base: SceneProposal = {
      location: '老周修车铺',
      narration: 'Q合成裁定：R17工单在工作台上。',
      presentActorIds: [actor.id],
      outcome: null,
      observation: null,
      matterTitle: null,
      initialMatters: [],
      matterUpdates: [],
      dialogues: [],
    };
    await run(owner, entered.task!.id, base);
    const counts = async () =>
      (
        await admin.query(
          `SELECT version,
      (SELECT count(*) FROM parallel_life.world_events e WHERE e.world_id=w.id) events,
      (SELECT count(*) FROM parallel_life.scene_items s WHERE s.world_id=w.id) items,
      (SELECT count(*) FROM parallel_life.memory_records m WHERE m.branch_id=w.id) memories,
      (SELECT count(*) FROM parallel_life.commands c WHERE c.world_id=w.id) commands,
      (SELECT count(*) FROM parallel_life.scene_receipts r WHERE r.world_id=w.id) receipts,
      (SELECT count(*) FROM parallel_life.outbox_jobs o WHERE o.world_id=w.id) outbox,
      (SELECT count(*) FROM parallel_life.tasks t WHERE t.scope_id=w.id) tasks
      FROM parallel_life.worlds w WHERE w.id=$1`,
          [worldId],
        )
      ).rows[0];
    const enqueue = async (text: string, targetId = trigger.id) => {
      const view = await scenes.read(owner, worldId);
      const request = {
        commandId: randomUUID(),
        expectedVersion: view.worldVersion,
        text,
        relatedMatterIds: [sceneMatterId(sceneId, targetId)],
      };
      const command = await scenes.input(owner, worldId, sceneId, request);
      return { request, command };
    };
    const state = () => worlds.get({ userId: owner }, worldId);
    return { owner, worldId, actor, trigger, sceneId, base, counts, enqueue, state };
  };
  const action = '我核对R17工单，解释电源接头检修细节并交付车辆。';
  const observation = '你完成R17接头检查及车辆交付，工单已签收。';
  try {
    for (const outcome of ['failed', 'partial'] as const) {
      await t.test(
        `${outcome} cannot masquerade as a completion or leak a milestone transaction`,
        async () => {
          const f = await setup();
          const { command } = await f.enqueue(action);
          const before = await f.counts(),
            previous = await f.state();
          await run(f.owner, command.task!.id, {
            ...f.base,
            outcome,
            observation,
            matterUpdates: [{ id: sceneMatterId(f.sceneId, f.trigger.id), status: 'completed' }],
          });
          const read = await scenes.read(f.owner, f.worldId);
          assert.equal(read.task?.status, 'failed');
          assert.deepEqual(await f.counts(), before);
          assert.deepEqual((await f.state()).matters, previous.matters);
          assert.ok(
            !(await f.state()).matters!.some(
              (matter) => matter.pursuitProgress || matter.opportunity,
            ),
          );
        },
      );
    }
    for (const text of [
      '我打算核对R17工单并交付车辆。',
      '如果我核对R17工单并交付车辆，会怎样？',
      '我已经完成R17工单交付了。',
    ]) {
      await t.test(`unexecuted input cannot authorize a success: ${text}`, async () => {
        const f = await setup();
        const { command } = await f.enqueue(text);
        const before = await f.counts();
        await run(f.owner, command.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation,
          matterUpdates: [{ id: sceneMatterId(f.sceneId, f.trigger.id), status: 'completed' }],
        });
        assert.equal((await scenes.read(f.owner, f.worldId)).task?.status, 'failed');
        assert.deepEqual(await f.counts(), before);
        assert.ok(
          !(await f.state()).matters!.some(
            (matter) => matter.pursuitProgress || matter.opportunity,
          ),
        );
      });
    }
    await t.test(
      'non-witness dialogue and cross-owner access cannot create private stage evidence',
      async () => {
        const f = await setup();
        const foreign = randomUUID();
        accounts.push(foreign);
        await identity.ensureGuest(foreign);
        await assert.rejects(scenes.read(foreign, f.worldId), { code: 'NOT_FOUND' });
        await assert.rejects(records.read(foreign, f.worldId), { code: 'NOT_FOUND' });
        const { command } = await f.enqueue(action);
        const before = await f.counts();
        const outsider = (await f.state()).actors.find((actor) => actor.id !== f.actor.id)!;
        await run(f.owner, command.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation,
          matterUpdates: [{ id: sceneMatterId(f.sceneId, f.trigger.id), status: 'completed' }],
          dialogues: [{ actorId: outsider.id, text: '我看见了全过程。' }],
        });
        assert.equal((await scenes.read(f.owner, f.worldId)).task?.status, 'failed');
        assert.deepEqual(await f.counts(), before);
        const rls = await db.transaction(foreign, (sql) =>
          sql.query('SELECT id FROM parallel_life.worlds WHERE id=$1', [f.worldId]),
        );
        assert.equal(rls.rows.length, 0);
      },
    );
    await t.test(
      'concurrent expected-version commands admit one action and one bounded milestone',
      async () => {
        const f = await setup();
        const before = await scenes.read(f.owner, f.worldId);
        const request = {
          expectedVersion: before.worldVersion,
          text: action,
          relatedMatterIds: [sceneMatterId(f.sceneId, f.trigger.id)],
        };
        const outcomes = await Promise.allSettled([
          scenes.input(f.owner, f.worldId, f.sceneId, { ...request, commandId: randomUUID() }),
          scenes.input(f.owner, f.worldId, f.sceneId, { ...request, commandId: randomUUID() }),
        ]);
        const accepted = outcomes.filter((outcome) => outcome.status === 'fulfilled');
        assert.equal(accepted.length, 1);
        assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
        const command = accepted[0]!;
        if (command.status !== 'fulfilled') throw Error('missing concurrent winner');
        await run(f.owner, command.value.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation,
          matterUpdates: [{ id: sceneMatterId(f.sceneId, f.trigger.id), status: 'completed' }],
        });
        const current = await f.state();
        assert.equal(
          current.matters!.find((matter) => matter.span === 'pursuit')!.pursuitProgress!.milestones
            .length,
          1,
        );
        assert.equal(current.matters!.filter((matter) => matter.opportunity).length, 1);
        assert.equal(current.matters!.find((matter) => matter.opportunity)!.status, 'not_started');
      },
    );
    await t.test(
      'failed new opportunity remains unachieved; explicit later action advances only one stage, replay stays causal',
      async () => {
        const f = await setup();
        const initial = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0]!.state as WorldState;
        const first = await f.enqueue(action);
        await run(f.owner, first.command.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation,
          matterUpdates: [{ id: sceneMatterId(f.sceneId, f.trigger.id), status: 'completed' }],
        });
        const phaseOne = await f.state();
        const next = phaseOne.matters!.find((matter) => matter.opportunity)!;
        const { actorContext } =
          await import('../../src/modules/world/application/actor-context.ts');
        assert.ok(
          actorContext(phaseOne, f.actor.id).matters?.some((matter) => matter.id === next.id),
        );
        for (const blocked of [f.trigger.id, next.opportunity!.pursuitId]) {
          const context = actorContext(phaseOne, f.actor.id, '', [], new Set([blocked]));
          assert.ok(!context.matters?.some((matter) => matter.id === next.id));
          assert.ok(!context.facts.some((fact) => fact.id.startsWith('pursuit_result:')));
        }

        const beforeRead = await f.counts();
        await scenes.input(f.owner, f.worldId, f.sceneId, first.request);
        assert.deepEqual(
          await records.read(f.owner, f.worldId),
          await records.read(f.owner, f.worldId),
        );
        assert.deepEqual(await f.counts(), beforeRead);
        assert.equal(
          (await f.state()).matters!.find((matter) => matter.id === next.id)!.status,
          'not_started',
        );
        const failed = await f.enqueue('我整理R17交接记录，写清接头检查和验收信息。', next.id);
        await run(f.owner, failed.command.task!.id, {
          ...f.base,
          outcome: 'failed',
          observation: '你检查记录时发现验收签名缺失，记录尚未写完。',
          matterUpdates: [],
        });
        const afterFailure = await f.state();
        assert.equal(
          afterFailure.matters!.find((matter) => matter.span === 'pursuit')!.pursuitProgress!
            .milestones.length,
          1,
        );
        assert.equal(
          afterFailure.matters!.find((matter) => matter.id === next.id)!.status,
          'not_started',
        );
        const retry = await f.enqueue('我整理R17交接记录，写清接头检查和验收信息。', next.id);
        await run(f.owner, retry.command.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation: '你已整理R17交接记录，接头检查和验收信息均已写清。',
          matterUpdates: [{ id: sceneMatterId(f.sceneId, next.id), status: 'completed' }],
        });
        const final = await f.state();
        assert.equal(
          final.matters!.find((matter) => matter.span === 'pursuit')!.pursuitProgress!.milestones
            .length,
          2,
        );
        assert.equal(
          final.matters!.find((matter) => matter.span === 'pursuit')!.status,
          'in_progress',
        );
        assert.equal(final.matters!.filter((matter) => matter.opportunity).length, 1);
        const events = (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
            [f.worldId],
          )
        ).rows.map((row) => row.payload) as WorldHistoryEvent[];
        const replay = replayWorldHistory(initial, events).world;
        assert.deepEqual(replay.matters, final.matters);
        assert.equal(replay.version, final.version);
        const beforeFirst = replayWorldHistory(initial, events, phaseOne.version - 1).world;
        assert.ok(
          !beforeFirst.matters!.some((matter) => matter.pursuitProgress || matter.opportunity),
        );
        assert.deepEqual(
          replayWorldHistory(initial, events, phaseOne.version).world.matters,
          phaseOne.matters,
        );
        assert.deepEqual(replayWorldHistory(initial, events).world, replay);
        assert.deepEqual(
          (
            await admin.query(
              'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0]!.state,
          initial,
        );
        assert.ok(
          initial.matters!.every((matter) => !matter.pursuitProgress && !matter.opportunity),
        );
      },
    );
    await t.test(
      'legacy serialized save without optional progress metadata is not backfilled by repeated reads',
      async () => {
        const owner = randomUUID();
        accounts.push(owner);
        await identity.ensureGuest(owner);
        const id = randomUUID(),
          now = '2026-10-11T12:00:00.000Z';
        // Explicit compatibility fixture, not a historical user's account or model output.
        const legacy: WorldState = {
          schemaVersion: 1,
          id,
          ownerId: owner,
          version: 0,
          title: 'Q legacy compatibility',
          time: now,
          actors: [{ id: randomUUID(), name: '旧存档人物', persona: '兼容夹具' }],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
          matters: [
            {
              id: randomUUID(),
              worldId: id,
              span: 'pursuit',
              title: '旧版长期目标',
              description: '不包含可选阶段字段的存档',
              status: 'in_progress',
              assertion: 'actor_statement',
              visibility: 'player_visible',
              source: { kind: 'genesis', seedId: 'q-legacy' },
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
        await worlds.initialize({ userId: owner }, legacy);
        const rows = async () =>
          (
            await admin.query(
              `SELECT state,version,(SELECT count(*) FROM parallel_life.world_events e WHERE e.world_id=w.id) events,
        (SELECT count(*) FROM parallel_life.tasks t WHERE t.scope_id=w.id) tasks,
        (SELECT count(*) FROM parallel_life.commands c WHERE c.world_id=w.id) commands,
        (SELECT state FROM parallel_life.world_initial_snapshots s WHERE s.world_id=w.id) initial FROM parallel_life.worlds w WHERE id=$1`,
              [id],
            )
          ).rows[0];
        const before = await rows();
        for (let i = 0; i < 3; i++) {
          const state = await worlds.get({ userId: owner }, id);
          assert.ok(
            state.matters!.every((matter) => !matter.pursuitProgress && !matter.opportunity),
          );
          const view = await records.read(owner, id);
          assert.ok(view.about.every((record) => !record.progress));
        }
        assert.deepEqual(await rows(), before);
      },
    );
  } finally {
    // Only accounts created by this test in its local isolated database.
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [accounts]);
    await queue.close();
    await db.close();
    await admin.end();
  }
});
