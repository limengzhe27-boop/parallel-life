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
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { sceneMatterId } from '../../src/modules/world/domain/scene-matter-policy.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import {
  replayWorldHistory,
  type WorldHistoryEvent,
} from '../../src/modules/world/domain/world-history.ts';
import { SceneProposalSchema } from '../../src/modules/world/infrastructure/scene-planner.ts';
import type { SceneProposal } from '../../src/modules/world/application/scene-ports.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

// Real transactions, synthetic labelled planner outputs. No AI/production calls.
test('real PostgreSQL cumulative player steps, bounded NPC receipt, completion and follow-up', async (t) => {
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
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db);
  await new IdentityRepository(db).ensureGuest(owner);
  await new IdentityRepository(db).ensureGuest(other);
  const run = (taskId: string, p: SceneProposal) =>
    runOne(
      {
        claim: (key) => queue.claimForOwner(taskId, owner, key),
        renew: (l) => queue.renew(l),
        finish: (l, o) => queue.finish(l, o),
      },
      {
        world: sceneTaskHandler(
          queue,
          {
            async propose() {
              return p;
            },
          },
          'synthetic-no-model',
        ),
      },
    );
  try {
    const start = await new OfficialLifeRepository(db, officialLifeCatalog).start(
      owner,
      'county-yellow-hair',
      { commandId: randomUUID(), version: 3 },
    );
    const worldId = start.worldId;
    let world = await worlds.get({ userId: owner }, worldId);
    const trigger = world.matters!.find(
      (m) => m.source.kind === 'preset' && m.source.matterKey === 'deliver_r17',
    )!;
    const actor = world.actors.find((a) => a.name === '老周')!,
      absent = world.actors.find((a) => a.name === '林悦')!;
    const invitation = world.appointments.find((a) => a.id === trigger.relatedInvitationId)!;
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
    const entered = await scenes.enterPlace(owner, worldId, {
        commandId: randomUUID(),
        expectedVersion: world.version,
        placeId: 'repair_shop',
      }),
      sceneId = entered.sceneId!;
    const base: SceneProposal = {
      location: '老周修车铺',
      narration: '合成测试：工作台上放着R17单据。',
      presentActorIds: [actor.id],
      outcome: null,
      observation: null,
      matterTitle: null,
      initialMatters: [],
      matterUpdates: [],
      dialogues: [],
    };
    await run(entered.task!.id, SceneProposalSchema.parse(base));
    assert.equal((await scenes.read(owner, worldId)).task?.status, 'succeeded');
    assert.ok((await scenes.read(owner, worldId)).entries.length > 0);
    const enqueue = async (text: string, target = trigger.id) => {
      const view = await scenes.read(owner, worldId),
        request = {
          commandId: randomUUID(),
          expectedVersion: view.worldVersion,
          text,
          relatedMatterIds: [sceneMatterId(sceneId, target)],
        };
      const command = await scenes.input(owner, worldId, sceneId, request);
      return { request, command };
    };
    const state = () => worlds.get({ userId: owner }, worldId);
    const target = async () => (await state()).matters!.find((m) => m.id === trigger.id)!;
    const counts = async () =>
      (
        await admin.query(
          `SELECT version,(SELECT count(*) FROM parallel_life.world_events WHERE world_id=w.id) events,(SELECT count(*) FROM parallel_life.scene_items WHERE world_id=w.id) items,(SELECT count(*) FROM parallel_life.memory_records WHERE branch_id=w.id) memories,(SELECT count(*) FROM parallel_life.scene_receipts WHERE world_id=w.id) receipts FROM parallel_life.worlds w WHERE id=$1`,
          [worldId],
        )
      ).rows[0];
    await t.test(
      'a future plan with schema-default empty step arrays stays unexecuted',
      async () => {
        const a = await enqueue('我打算明天核对R17维修单。');
        await run(a.command.task!.id, SceneProposalSchema.parse(base));
        assert.equal((await scenes.read(owner, worldId)).task?.status, 'succeeded');
        assert.equal((await target()).stepProgress, undefined);
        assert.equal((await target()).status, 'in_progress');
      },
    );
    await t.test(
      'partial verified steps persist through fresh repository reads without resetting prior steps',
      async () => {
        let text = '我核对R17维修单。',
          observation = '你核对R17维修单。';
        const a = await enqueue(text);
        await run(a.command.task!.id, {
          ...base,
          outcome: 'partial',
          observation,
          stepProposals: [
            {
              matterId: trigger.id,
              stepId: 'order_reviewed',
              inputQuote: text,
              observationQuote: observation,
            },
          ],
        });
        assert.equal((await target()).status, 'in_progress');
        const first = (await target()).stepProgress!.steps[0]!;
        assert.equal(first.stepId, 'order_reviewed');
        text = '我向老周说明电源接头检修细节，并填写交接记录。';
        observation = '你向老周说明电源接头检修细节，并填写交接记录。';
        const b = await enqueue(text);
        await run(b.command.task!.id, {
          ...base,
          outcome: 'partial',
          observation,
          stepProposals: [
            {
              matterId: trigger.id,
              stepId: 'repair_explained',
              inputQuote: text,
              observationQuote: observation,
              receiverId: actor.id,
            },
            {
              matterId: trigger.id,
              stepId: 'record_written',
              inputQuote: text,
              observationQuote: observation,
            },
          ],
        });
        assert.deepEqual((await target()).stepProgress!.steps[0], first);
        assert.equal((await target()).stepProgress!.steps.length, 3);
        assert.equal((await target()).status, 'in_progress');
        await assert.rejects(scenes.read(other, worldId), { code: 'NOT_FOUND' });
      },
    );
    const text = '我将R17钥匙与维修单交给老周。',
      observation = '你将R17钥匙与维修单交给老周。',
      quote = '我接过R17钥匙和维修单，单子放这儿。';
    const final: SceneProposal = {
      ...base,
      outcome: 'partial',
      observation,
      stepProposals: [
        {
          matterId: trigger.id,
          stepId: 'handed_over',
          inputQuote: text,
          observationQuote: observation,
          receiverId: actor.id,
        },
      ],
      npcActions: [{ matterId: trigger.id, actorId: actor.id, kind: 'receive_r17', quote }],
      dialogues: [{ actorId: actor.id, text: quote }],
    };
    await t.test(
      'late failure after provisional completion rolls back step, NPC effects, opportunity and receipts',
      async () => {
        const a = await enqueue(text),
          before = await counts(),
          beforeWorld = await state();
        await run(a.command.task!.id, {
          ...final,
          dialogues: [...final.dialogues, { actorId: absent.id, text: '合成非法离场对白。' }],
        });
        assert.equal((await scenes.read(owner, worldId)).task?.status, 'failed');
        assert.deepEqual(await counts(), before);
        assert.deepEqual((await state()).matters, beforeWorld.matters);
      },
    );
    await t.test(
      'NPC actually receives the handed objects; overall completion does not rewrite partial player action',
      async () => {
        const a = await enqueue(text);
        await run(a.command.task!.id, final);
        const view = await scenes.read(owner, worldId);
        assert.equal(view.task?.status, 'succeeded');
        const m = await target();
        assert.equal(m.status, 'completed');
        assert.equal(m.evidence?.kind, 'scene_steps');
        assert.equal(view.actions.at(-1)?.resolution?.outcome, 'partial');
        const received = m.stepProgress!.steps.find((e) => e.stepId === 'received')!;
        assert.equal(received.actorId, actor.id);
        assert.equal(received.inputQuote, text);
        assert.equal(received.sceneId, sceneId);
        assert.ok(
          view.entries.some(
            (e) => e.kind === 'narration' && e.text === '老周接过了R17钥匙与维修单。',
          ),
        );
        assert.equal(
          view.matters.find((m) => m.id === sceneMatterId(sceneId, trigger.id))?.status,
          'completed',
        );
        const current = await state(),
          pursuit = current.matters!.find((m) => m.span === 'pursuit')!,
          op = current.matters!.find((m) => m.opportunity)!;
        assert.equal(pursuit.pursuitProgress!.milestones.length, 1);
        assert.equal(op.status, 'not_started');
        const visible = actorContext(current, actor.id, '刚才交车之后下一步是什么？');
        assert.ok(visible.facts.some((f) => f.id.startsWith('matter_result:')));
        assert.ok(visible.matters?.some((m) => m.id === op.id));
        const invisible = actorContext(current, absent.id, '下一步是什么？');
        assert.ok(!invisible.facts.some((f) => f.id.startsWith('matter_result:')));
        assert.ok(!invisible.matters?.some((m) => m.id === op.id));
        const before = await counts();
        assert.deepEqual(await scenes.input(owner, worldId, sceneId, a.request), a.command);
        await run(a.command.task!.id, final);
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      'opportunity requires another actual action and adds only one new stage; replay preserves all sources',
      async () => {
        const current = await state(),
          op = current.matters!.find((m) => m.opportunity)!;
        const text = '我整理R17记录，写清接头检查和验收信息。',
          observation = '你整理R17记录，写清接头检查和验收信息。';
        const a = await enqueue(text, op.id);
        await run(a.command.task!.id, {
          ...base,
          outcome: 'succeeded',
          observation,
          matterUpdates: [{ id: sceneMatterId(sceneId, op.id), status: 'completed' }],
        });
        const after = await state();
        assert.equal(after.matters!.find((m) => m.id === op.id)?.status, 'completed');
        assert.equal(
          after.matters!.find((m) => m.span === 'pursuit')?.pursuitProgress?.milestones.length,
          2,
        );
        assert.equal(after.matters!.find((m) => m.span === 'pursuit')?.status, 'in_progress');
        const initial = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [worldId],
          )
        ).rows[0].state as WorldState;
        const history = (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
            [worldId],
          )
        ).rows.map((r) => r.payload as WorldHistoryEvent);
        const replay = replayWorldHistory(initial, history);
        assert.deepEqual(replay.world.matters, after.matters);
        assert.deepEqual(
          replay.world.matters!.find((m) => m.id === trigger.id)?.stepProgress,
          (await target()).stepProgress,
        );
        const npc = await admin.query(
          "SELECT text FROM parallel_life.memory_records WHERE branch_id=$1 AND character_id=$2 AND kind='episode' AND text LIKE '%接过了R17%'",
          [worldId, actor.id],
        );
        assert.ok(npc.rowCount! > 0);
      },
    );
  } finally {
    for (const id of [owner, other])
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [id]);
    await db.close();
    await queue.close();
    await admin.end();
  }
});
