import { resultAckText } from '../../src/modules/world/domain/matter-progression.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { countyYellowHair } from '../../src/modules/settings/infrastructure/official-presets/county-yellow-hair.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { sceneMatterId } from '../../src/modules/world/domain/scene-matter-policy.ts';
import {
  replayWorldHistory,
  type WorldHistoryEvent,
} from '../../src/modules/world/domain/world-history.ts';
import { buildAgenda } from '../../src/modules/world/domain/agenda.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { SceneProposal } from '../../src/modules/world/application/scene-ports.ts';

test('NAR-03 real PostgreSQL atomic scene results, conditions, witnesses and replay (synthetic planner, zero models)', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const cfg = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    identities = new IdentityRepository(db),
    scenes = new SceneRepository(db);
  const owners: string[] = [];
  const fixture = async (witness = true, extraGoal = true) => {
    const owner = randomUUID();
    owners.push(owner);
    await identities.ensureGuest(owner);
    // The actual published v3 opening supplies the R17 appointment; extra pursuit is test-only.
    const pack = structuredClone(countyYellowHair);
    if (extraGoal)
      pack.opening.matters!.push({
        key: 'long_repair_goal',
        title: 'Long-term professional reputation',
        description: 'Requires repeated deliveries and cannot complete in one action',
        span: 'pursuit',
        relatedPlaceKey: 'repair_shop',
        relatedActorKeys: ['laozhou'],
      });
    const repo = new OfficialLifeRepository(db, {
      list: () => [pack],
      get: (id) => (id === pack.card.id ? pack : undefined),
    });
    const start = await repo.start(owner, pack.card.id, { commandId: randomUUID(), version: 3 });
    const worldId = start.worldId;
    const read = async () =>
      db.transaction(owner, async (sql) => {
        const row = (
          await sql.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [worldId])
        ).rows[0];
        return { ...row.state, version: row.version } as WorldState;
      });
    const initial = (
      await admin.query(
        'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
        [worldId],
      )
    ).rows[0].state as WorldState;
    const actorId = initial.actors.find((a) => a.name === '老周')!.id,
      matterId = initial.matters!.find(
        (m) => m.source.kind === 'preset' && m.source.matterKey === 'deliver_r17',
      )!.id,
      pursuitId =
        initial.matters!.find(
          (m) => m.source.kind === 'preset' && m.source.matterKey === 'long_repair_goal',
        )?.id ?? '';
    const appointment = initial.appointments.find(
      (a) => a.id === initial.matters!.find((m) => m.id === matterId)!.relatedInvitationId,
    )!;
    await new PostgresWorldRepository(db).respondToInvitation(
      { userId: owner },
      {
        worldId,
        id: appointment.id,
        commandId: randomUUID(),
        expectedVersion: 0,
        operation: 'accept',
      },
    );
    await db.transaction(owner, async (sql) => {
      await sql.query(
        'UPDATE parallel_life.world_clock SET speed=0,paused=false,story_now=$2 WHERE world_id=$1',
        [worldId, appointment.at],
      );
    });
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      placeId: 'repair_shop',
    });
    const run = async (taskId: string, proposal: SceneProposal) =>
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
            'explicit-synthetic-no-model',
          ),
        },
      );
    const base: SceneProposal = {
      location: '老周修车铺',
      narration: '修车铺里停着待交接的车辆。',
      presentActorIds: witness ? [actorId] : [],
      outcome: null,
      observation: null,
      matterTitle: null,
      initialMatters: [],
      matterUpdates: [],
      dialogues: [],
    };
    await run(entered.task!.id, base);
    const snapshot = await scenes.read(owner, worldId);
    assert.equal(snapshot.scene!.id, entered.sceneId);
    const localId = sceneMatterId(entered.sceneId, matterId),
      localPursuitId = sceneMatterId(entered.sceneId, pursuitId);
    assert.ok(snapshot.matters.some((m) => m.id === localId));
    const attempt = async (text: string, related = [localId]) => {
      const before = await scenes.read(owner, worldId);
      return scenes.input(owner, worldId, entered.sceneId, {
        commandId: randomUUID(),
        expectedVersion: before.worldVersion,
        text,
        relatedMatterIds: related,
      });
    };
    return {
      owner,
      worldId,
      initial,
      actorId,
      matterId,
      pursuitId,
      localId,
      localPursuitId,
      entered,
      run,
      read,
      attempt,
      base,
    };
  };
  try {
    await t.test(
      'unmodified official v3 opening has a sourced R17 meeting and witnessed result agenda',
      async () => {
        const f = await fixture(true, false);
        assert.equal(f.initial.appointments.length, 3);
        assert.equal(f.initial.matters!.length, 3);
        const i = await f.attempt('我核对R17工单，解释电源接头检修细节并交付车辆。');
        await f.run(i.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation: '你完成R17接头检查及车辆交付，工单已签收。',
          matterUpdates: [{ id: f.localId, status: 'completed' }],
        });
        const phone = await new PostgresWorldRepository(db).get({ userId: f.owner }, f.worldId);
        assert.equal(phone!.matters!.find((m) => m.id === f.matterId)!.status, 'completed');
        assert.ok(
          buildAgenda(phone!, 30).some(
            (a) => a.kind === 'matter_result' && a.actorId === f.actorId,
          ),
        );
        assert.equal(
          phone!.appointments.find((a) => a.title === 'R17车辆交接')!.status,
          'attended',
        );
      },
    );
    await t.test(
      'finite follow-up is projected unstarted in the same scene; explicit saved attempt succeeds, replays and repeats without duplicates',
      async () => {
        const f = await fixture(true, false);
        const input = await f.attempt('我核对R17工单，检查接头并交付车辆。');
        await f.run(input.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation: '你核对R17接头并交付车辆，工单已签收。',
          matterUpdates: [{ id: f.localId, status: 'completed' }],
        });
        const first = await f.read(),
          op = first.matters!.find((m) => m.opportunity)!,
          pursuit = first.matters!.find((m) => m.pursuitProgress)!;
        assert.equal(op.status, 'not_started');
        assert.equal(pursuit.pursuitProgress!.milestones.length, 1);
        const known = await new PostgresWorldRepository(db).get({ userId: f.owner }, f.worldId);
        assert.ok(actorContext(known, f.actorId).matters?.some((m) => m.id === op.id));
        for (const blocked of [f.matterId, pursuit.id])
          assert.ok(
            !actorContext(known, f.actorId, '', [], new Set([blocked])).matters?.some(
              (m) => m.id === op.id,
            ),
          );
        const snap = await scenes.read(f.owner, f.worldId),
          local = sceneMatterId(snap.scene!.id, op.id);
        assert.equal(snap.matters.find((m) => m.id === local)!.status, 'not_started');
        const counts = (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n;
        await scenes.read(f.owner, f.worldId);
        await new PostgresWorldRepository(db).get({ userId: f.owner }, f.worldId);
        assert.equal((await f.read()).matters!.find((m) => m.id === op.id)!.status, 'not_started');
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n,
          counts,
        );
        const next = await f.attempt('我整理R17记录，写清接头检查和验收信息。', [local]);
        const proposal = {
          ...f.base,
          outcome: 'succeeded' as const,
          observation: '你整理R17记录，写下接头检查和验收信息。',
          matterUpdates: [{ id: local, status: 'completed' as const }],
        };
        await f.run(next.task!.id, proposal);
        const end = await f.read();
        assert.equal(end.matters!.find((m) => m.id === op.id)!.status, 'completed');
        assert.equal(end.matters!.find((m) => m.id === pursuit.id)!.status, 'in_progress');
        assert.equal(
          end.matters!.find((m) => m.id === pursuit.id)!.pursuitProgress!.milestones.length,
          2,
        );
        assert.equal(end.matters!.filter((m) => m.opportunity).length, 1);
        const evts = (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
            [f.worldId],
          )
        ).rows.map((r) => r.payload) as WorldHistoryEvent[];
        assert.deepEqual(replayWorldHistory(f.initial, evts).world.matters, end.matters);
        await f.run(next.task!.id, proposal);
        assert.deepEqual((await f.read()).matters, end.matters);
        const initial = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].state;
        assert.ok(!initial.matters.some((m: { opportunity?: unknown }) => m.opportunity));
        const repository = new PostgresWorldRepository(db),
          hydrated = await repository.get({ userId: f.owner }, f.worldId),
          pf = hydrated.facts.find((f) => f.id.startsWith('pursuit_result:'))!;
        const command = {
          id: randomUUID(),
          worldId: f.worldId,
          expectedVersion: hydrated.version,
          actorId: f.actorId,
          text: '合成承接测试，不调用模型',
        };
        await repository.commit({ userId: f.owner }, command, {
          schemaVersion: 1,
          id: randomUUID(),
          worldId: f.worldId,
          version: hydrated.version + 1,
          commandId: command.id,
          occurredAt: new Date().toISOString(),
          storyAt: hydrated.time,
          type: 'turn.resolved',
          data: {
            actorId: f.actorId,
            userText: command.text,
            effects: [
              {
                type: 'message.received',
                id: randomUUID(),
                actorId: f.actorId,
                text: '合成回复只证明来源收据持久化，不证明自然叙事质量。',
              },
              {
                type: 'belief.recorded',
                id: randomUUID(),
                actorId: f.actorId,
                text: resultAckText(pf),
              },
            ],
          },
        });
        const memoryCount = (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.memory_records WHERE owner_id=$1 AND text LIKE $2',
            [f.owner, '[scene-result-ack:%'],
          )
        ).rows[0].n;
        assert.equal(memoryCount, 0);
        const after = await repository.get({ userId: f.owner }, f.worldId);
        assert.ok(after.facts.some((f) => f.text === resultAckText(pf)));
        assert.ok(
          !actorContext(after, f.actorId).facts.some((f) =>
            f.text.startsWith('[scene-result-ack:'),
          ),
        );
      },
    );
    await t.test(
      'only requested target completes; attended arrival is separate; persisted sources replay exactly; duplicate worker produces no second result',
      async () => {
        const f = await fixture();
        const opening = await scenes.read(f.owner, f.worldId);
        const attendance = (
          await admin.query('SELECT document FROM parallel_life.world_appointments WHERE id=$1', [
            f.initial.appointments.find((a) => a.title === 'R17车辆交接')!.id,
          ])
        ).rows[0].document;
        assert.equal(attendance.status, 'attended');
        const phone = await new PostgresWorldRepository(db).get({ userId: f.owner }, f.worldId);
        assert.equal(
          phone!.appointments.find((a) => a.title === 'R17车辆交接')!.status,
          'attended',
        );
        assert.equal(
          (await f.read()).matters!.find((m) => m.id === f.matterId)!.status,
          'in_progress',
        );
        const input = await f.attempt('我核对R17工单，解释电源接头检修细节并交付车辆。', [
          f.localId,
          f.localPursuitId,
        ]);
        const proposal = {
          ...f.base,
          outcome: 'succeeded' as const,
          observation: '你完成R17接头检查及车辆交付，工单已签收。',
          matterUpdates: [{ id: f.localId, status: 'completed' as const }],
        };
        await f.run(input.task!.id, proposal);
        const state = await f.read(),
          matter = state.matters!.find((m) => m.id === f.matterId)!;
        assert.equal(matter.status, 'completed');
        assert.equal(matter.assertion, 'world_verified');
        assert.equal(state.matters!.find((m) => m.id === f.pursuitId)!.status, 'in_progress');
        const evts = (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
            [f.worldId],
          )
        ).rows.map((r) => r.payload) as WorldHistoryEvent[];
        const projectedAppointments = (
          await admin.query(
            'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1',
            [f.worldId],
          )
        ).rows.map((r) => r.document);
        const observerFacts = (
          await admin.query('SELECT document FROM parallel_life.world_facts WHERE world_id=$1', [
            f.worldId,
          ])
        ).rows.map((r) => r.document);
        // Synthetic confirmed fixture predates the first scene event; it is explicit in this replay baseline.
        const initial = structuredClone(f.initial);
        const rebuilt = replayWorldHistory(initial, evts).world;
        assert.deepEqual(rebuilt.matters, state.matters);
        assert.equal(
          rebuilt.appointments.find((a) => a.title === 'R17车辆交接')!.status,
          'attended',
        );
        assert.equal(rebuilt.facts.filter((x) => x.id.startsWith('matter_result:')).length, 1);
        for (const change of ['extra_fact', 'cross_scene', 'stale_target']) {
          const forged = structuredClone(evts) as any[];
          const result = forged.find((e) => e.type === 'scene.action_resolved');
          if (change === 'extra_fact') result.data.worldResults.observerFacts[0].secret = 'forged';
          if (change === 'cross_scene') result.data.worldResults.action.sceneId = randomUUID();
          if (change === 'stale_target')
            result.data.worldResults.updates[0].expectedMatterVersion++;
          assert.throws(() => replayWorldHistory(initial, forged), { code: 'INVALID_PROPOSAL' });
        }
        const hydrated = {
          ...state,
          appointments: projectedAppointments,
          facts: [...f.initial.facts, ...observerFacts],
          messages: f.initial.messages,
        };
        assert.ok(
          buildAgenda(hydrated, 30).some(
            (a) => a.kind === 'matter_result' && a.actorId === f.actorId,
          ),
        );
        const otherActor = f.initial.actors.find((a) => a.id !== f.actorId)!.id;
        assert.ok(
          !buildAgenda(hydrated, 30).some(
            (a) => a.kind === 'matter_result' && a.actorId === otherActor,
          ),
        );
        const source = matter.evidence!;
        assert.ok('eventId' in source);
        assert.ok(
          !actorContext(hydrated, f.actorId, '', [], new Set([source.eventId])).matters!.some(
            (m) => m.id === matter.id,
          ),
        );
        const witnessFact = observerFacts.find((x) => x.id.startsWith('matter_result:'))!;
        assert.ok(
          !actorContext(hydrated, f.actorId, '', [], new Set([witnessFact.id])).matters!.some(
            (m) => m.id === matter.id,
          ),
        );
        const afterReply = {
          ...hydrated,
          messages: [
            ...hydrated.messages,
            {
              id: randomUUID(),
              role: 'assistant' as const,
              actorId: f.actorId,
              text: '明确的合成反馈测试，不是真实模型回复',
              at: state.time,
              sourceEventId: randomUUID(),
              sourceVersion: state.version + 1,
            },
          ],
        };
        assert.ok(
          buildAgenda(afterReply, 30).some(
            (a) => a.kind === 'matter_result' && a.actorId === f.actorId,
          ),
        );
        const pf = hydrated.facts.find((f) => f.id.startsWith('pursuit_result:'))!;
        afterReply.facts = [
          ...afterReply.facts,
          {
            id: randomUUID(),
            kind: 'belief',
            believedByActorId: f.actorId,
            text: resultAckText(pf),
            sourceEventId: afterReply.messages.at(-1)!.sourceEventId,
            visibility: { kind: 'actors', actorIds: [f.actorId] },
          },
        ];
        assert.ok(
          !buildAgenda(afterReply, 30).some(
            (a) => a.kind === 'matter_result' && a.actorId === f.actorId,
          ),
        );
        const beforeCount = evts.length;
        await f.run(input.task!.id, proposal);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n,
          beforeCount,
        );
        assert.equal((await scenes.read(f.owner, f.worldId)).worldVersion, state.version);
        assert.equal(opening.matters.find((m) => m.id === f.localId)!.status, 'in_progress');
      },
    );
    await t.test(
      'greeting succeeds without changing selected matters; empty target list does not complete anything',
      async () => {
        for (const related of [true, false]) {
          const f = await fixture();
          const i = await f.attempt(
            '我向老周打招呼。',
            related ? [f.localId, f.localPursuitId] : [],
          );
          await f.run(i.task!.id, {
            ...f.base,
            outcome: 'succeeded',
            observation: '你完成了打招呼的动作。',
          });
          assert.ok((await f.read()).matters!.every((m) => m.status === 'in_progress'));
        }
      },
    );
    await t.test(
      'false, partial, quoted or unsupported completion rolls back result event/matter/receipt together',
      async () => {
        for (const kind of ['wrong_action', 'partial', 'npc_quote', 'pursuit']) {
          const f = await fixture();
          const i = await f.attempt(
            kind === 'wrong_action'
              ? '我看了一眼R17。'
              : '我核对R17工单，解释电源接头检修细节并交付车辆。',
            [f.localId, f.localPursuitId],
          );
          const before = await f.read();
          await f.run(i.task!.id, {
            ...f.base,
            outcome: kind === 'partial' ? 'partial' : 'succeeded',
            observation:
              kind === 'npc_quote'
                ? '老周说R17接头已交付签收。'
                : '你完成R17接头检查及车辆交付，工单已签收。',
            matterUpdates: [
              { id: kind === 'pursuit' ? f.localPursuitId : f.localId, status: 'completed' },
            ],
          });
          assert.equal((await f.read()).version, before.version);
          assert.deepEqual((await f.read()).matters, before.matters);
          const task = (
            await admin.query('SELECT status,error_code FROM parallel_life.tasks WHERE id=$1', [
              i.task!.id,
            ])
          ).rows[0];
          assert.equal(task.status, 'failed');
          assert.equal(task.error_code, 'INVALID_AI_OUTPUT');
          const count = (
            await admin.query(
              "SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='scene.action_resolved'",
              [f.worldId],
            )
          ).rows[0].n;
          assert.equal(count, 0);
        }
      },
    );
    await t.test(
      'zero actual witnesses generate zero result knowledge or NPC agenda; read side performs no item writes',
      async () => {
        const f = await fixture(false);
        const i = await f.attempt('我核对R17工单，解释电源接头检修细节并交付车辆。');
        await f.run(i.task!.id, {
          ...f.base,
          outcome: 'succeeded',
          observation: '你完成R17接头检查及车辆交付，工单已签收。',
          matterUpdates: [{ id: f.localId, status: 'completed' }],
        });
        const facts = (
          await admin.query('SELECT document FROM parallel_life.world_facts WHERE world_id=$1', [
            f.worldId,
          ])
        ).rows.map((r) => r.document);
        assert.equal(facts.length, 0);
        const state = {
          ...(await f.read()),
          facts,
          messages: f.initial.messages,
          appointments: f.initial.appointments,
        };
        assert.ok(!buildAgenda(state, 30).some((x) => x.kind === 'matter_result'));
        const before = (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.scene_items WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n;
        await scenes.read(f.owner, f.worldId);
        await scenes.history(f.owner, f.worldId);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM parallel_life.scene_items WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n,
          before,
        );
      },
    );
    await t.test('cross-owner scene/rows are invisible', async () => {
      const f = await fixture(),
        other = randomUUID();
      owners.push(other);
      await identities.ensureGuest(other);
      await assert.rejects(scenes.read(other, f.worldId), { code: 'NOT_FOUND' });
      assert.equal(
        (
          await db.transaction(other, (sql) =>
            sql.query('SELECT id FROM parallel_life.scene_items WHERE world_id=$1', [f.worldId]),
          )
        ).rowCount,
        0,
      );
    });
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
    await queue.close();
    await db.close();
    await admin.end();
  }
});
