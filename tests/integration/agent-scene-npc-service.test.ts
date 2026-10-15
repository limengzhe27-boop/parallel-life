import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { projectAgentWorldChange } from '../../src/modules/world/infrastructure/world-awareness-commit.ts';
import { sceneEnvironmentTaskHandler } from '../../src/modules/world/infrastructure/agent-scene-environment.ts';
import {
  nativeNpcTaskHandler,
  nativeAgentCommandId,
} from '../../src/server/npc-agent-channel-services.ts';
import { SceneClient } from '../../src/features/phone/scenes/client.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('actual deterministic environment → saved scene input → leased native NPC → phone scene DTO (real PostgreSQL, no real models)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_SCENE_NPC_TEST_PORT ?? 55565));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db),
    tasks = new TaskRepository(db),
    store = new PostgresAgentRuntimeRepository(db);
  const owners: string[] = [];
  t.after(async () => {
    try {
      for (const owner of owners) {
        await admin.query('DELETE FROM parallel_life.agent_runtime_worlds WHERE owner_id=$1', [
          owner,
        ]);
        await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
      }
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });

  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actor = randomUUID(),
      contact = randomUUID();
    owners.push(owner);
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const initial: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic scene-to-NPC fixture',
      time: new Date().toISOString(),
      actors: [
        { id: actor, name: '甲', persona: '有自己的生活，现场自然交谈。' },
        { id: contact, name: '乙', persona: '只有地点关联，没有到场证据。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'room',
        positionSource: source,
        places: [
          {
            id: 'room',
            name: '虚构客厅',
            description: '乙可能会来。',
            source,
            contactActorIds: [actor, contact],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, initial);
    // Persist explicit synthetic historical presence with the existing epoch-1 writer.
    // No ScenePlanner/model is invoked and the new runtime never falls back to this path.
    const old = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 0,
      placeId: 'room',
    });
    const oldLease = (await queue.claimForOwner(old.task!.id, owner, ['world']))!;
    const version = await db.transaction(owner, (sql) =>
      commitSceneProposal(
        sql,
        owner,
        worldId,
        oldLease.input as Parameters<typeof commitSceneProposal>[3],
        {
          location: '虚构客厅',
          narration: '合成的已保存历史场景。',
          presentActorIds: [actor],
          outcome: null,
          observation: null,
          matterTitle: null,
          initialMatters: [],
          matterUpdates: [],
          dialogues: [],
          stepProposals: [],
          npcActions: [],
        },
        randomUUID(),
      ),
    );
    await queue.finish(oldLease, { status: 'succeeded', resultVersion: version });
    await scenes.navigate(
      owner,
      worldId,
      old.sceneId,
      { commandId: randomUUID(), expectedVersion: version },
      true,
    );
    const before = await worlds.get({ userId: owner }, worldId);
    await db.transaction(owner, async (sql) => {
      for (const id of [actor, contact])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId: id },
            agentDefinitionRef(initial, id),
            before.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: before.version,
      });
      const latest = (
        await sql.query(
          'SELECT id FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version DESC LIMIT 1',
          [worldId],
        )
      ).rows[0];
      await projectAgentWorldChange(sql, owner, worldId, latest.id);
    });
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: before.version,
      placeId: 'room',
    });
    const envLease = (await queue.claimForOwner(entered.task!.id, owner, ['world']))!;
    assert.equal(
      await sceneEnvironmentTaskHandler(db)(envLease, new AbortController().signal),
      true,
    );
    const opened = await scenes.read(owner, worldId, entered.sceneId);
    assert.equal(opened.task!.status, 'succeeded');
    assert.deepEqual(
      opened.entries.map((e) => e.kind),
      ['time_place'],
    );
    assert.deepEqual(
      opened.scene!.presence.map((p) => p.participant),
      [{ kind: 'player' }, { kind: 'actor', actorId: actor }],
    );
    assert.equal(
      (await admin.query('SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1', [worldId]))
        .rowCount,
      0,
      'environment makes zero NPC/model attempts',
    );
    const envEvent = (
      await admin.query(
        "SELECT id,payload FROM parallel_life.world_events WHERE world_id=$1 AND payload->'data'->'environment' IS NOT NULL",
        [worldId],
      )
    ).rows[0];
    const command = {
      commandId: randomUUID(),
      expectedVersion: opened.worldVersion,
      text: '@甲 我想问问你的近况。',
      relatedMatterIds: [],
    };
    const accepted = await scenes.input(owner, worldId, entered.sceneId, command);
    return { owner, worldId, actor, contact, entered, envEvent, opened, command, accepted };
  }

  async function phone(owner: string, worldId: string, sceneId: string) {
    const dto = await scenes.read(owner, worldId, sceneId);
    const client = new SceneClient(
      (async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/session') ? { kind: 'guest', csrfToken: 'x'.repeat(48) } : dto,
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as typeof fetch,
    );
    return client.read(worldId, sceneId);
  }
  async function run(f: Awaited<ReturnType<typeof fixture>>) {
    let modelCalls = 0,
      failure: Error | undefined,
      outerFinishes = 0;
    const handler = nativeNpcTaskHandler(db, () => ({
      async complete(messages) {
        modelCalls++;
        assert.equal(db.pool.totalCount, db.pool.idleCount, 'model call holds no SQL connection');
        const payload = JSON.parse(messages[1]!.content);
        assert.equal(payload.state.actorId, f.actor);
        assert.equal(payload.input.text, f.command.text);
        return JSON.stringify({
          statements: [
            {
              text: '这两天在整理自己的安排，你呢？',
              dependsOnActionIds: [],
              requestsPlayerReply: true,
            },
          ],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        });
      },
    }));
    const attempted = await runOne(
      {
        claim: (k) => queue.claimForOwner(f.accepted.task!.id, f.owner, k),
        renew: (l) => queue.renew(l),
        finish: async (l, o) => {
          outerFinishes++;
          await queue.finish(l, o);
        },
      },
      {
        world: async (l, s) => {
          try {
            assert.equal(await handler(l, s), true);
          } catch (error) {
            failure = error as Error;
            throw error;
          }
        },
      },
    );
    return { modelCalls, failure, outerFinishes, attempted };
  }

  await t.test(
    'native scene NPC actually answers once after deterministic environment and the phone reads its real scene entry',
    async () => {
      const f = await fixture();
      const result = await run(f);
      if (result.failure) t.diagnostic(result.failure.stack ?? result.failure.message);
      assert.equal(result.failure, undefined);
      assert.equal(result.attempted, true);
      assert.equal(result.modelCalls, 1);
      assert.equal(result.outerFinishes, 0);
      const task = await tasks.get(f.owner, f.accepted.task!.id);
      assert.equal(task.status, 'succeeded');
      assert.equal(task.resultVersion, f.accepted.version + 1);
      const read = await phone(f.owner, f.worldId, f.entered.sceneId);
      const dialogues = read.entries.filter((e) => e.kind === 'dialogue');
      assert.equal(dialogues.length, 1);
      const dialogue = dialogues[0]!;
      assert.equal(dialogue.text, '这两天在整理自己的安排，你呢？');
      assert.deepEqual(dialogue.speaker, { kind: 'actor', actorId: f.actor });
      assert.equal(dialogue.sourceVersion, task.resultVersion);
      const attempt = await store.lookup(
        f.owner,
        f.worldId,
        nativeAgentCommandId(task.id, f.actor),
      );
      assert.equal(attempt!.status, 'committed');
      assert.equal(attempt!.eventId, dialogue.sourceEventId);
      assert.equal(
        (await store.read(f.owner, { worldId: f.worldId, actorId: f.actor }))!.focus!
          .questionSourceId,
        `scene:${dialogue.id}`,
      );
      assert.equal(
        (await store.read(f.owner, { worldId: f.worldId, actorId: f.contact }))!.revision,
        0,
      );
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.world_messages WHERE world_id=$1', [
            f.worldId,
          ])
        ).rowCount,
        0,
        'scene speech is not manufactured as private phone messages',
      );
      const stored = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
          attempt!.eventId,
        ])
      ).rows[0].payload;
      assert.equal(stored.type, 'scene.reaction_recorded');
      assert.equal(stored.data.agentRuntime.actorRevisionAfter, 1);
      assert.equal(
        read.actions[0]!.resolution,
        undefined,
        'NPC answer does not falsely certify a physical player action',
      );
      assert.equal(
        (await scenes.input(f.owner, f.worldId, f.entered.sceneId, f.command)).task!.id,
        f.accepted.task!.id,
      );
      const repeated = await run(f);
      assert.equal(repeated.attempted, false);
      assert.equal(repeated.modelCalls, 0);
      await assert.rejects(phone(randomUUID(), f.worldId, f.entered.sceneId));
    },
  );

  for (const attack of [
    'fake_producer',
    'no_earlier_proof',
    'wrong_task_result',
    'current_actor_elsewhere',
    'actor_left_presence',
  ] as const)
    await t.test(
      `${attack}: forbidden environment/presence never becomes a paid scene NPC call`,
      async () => {
        const f = await fixture();
        if (attack === 'fake_producer')
          await admin.query(
            "UPDATE parallel_life.world_events SET payload=jsonb_set(payload,'{data,environment,producer}','\"fake\"'::jsonb) WHERE id=$1",
            [f.envEvent.id],
          );
        else if (attack === 'no_earlier_proof') {
          const payload = structuredClone(f.envEvent.payload);
          const proof = payload.data.environment.presenceProofs.find(
            (p: { subject: { kind: string } }) => p.subject.kind === 'actor',
          );
          proof.sourceEventId = f.opened.scene!.sourceEventId;
          proof.worldVersion = f.opened.scene!.sourceVersion;
          await admin.query('UPDATE parallel_life.world_events SET payload=$2 WHERE id=$1', [
            f.envEvent.id,
            payload,
          ]);
        } else if (attack === 'wrong_task_result')
          await admin.query(
            'UPDATE parallel_life.tasks SET result_version=result_version+1 WHERE id=$1',
            [f.entered.task!.id],
          );
        else if (attack === 'current_actor_elsewhere')
          await admin.query(
            "UPDATE parallel_life.world_authoritative_positions SET document=jsonb_set(jsonb_set(document,'{status}','\"unknown\"'::jsonb),'{placeId}','null'::jsonb) WHERE world_id=$1 AND subject_key=$2",
            [f.worldId, `actor:${f.actor}`],
          );
        else {
          const read = await scenes.read(f.owner, f.worldId, f.entered.sceneId);
          const updated = structuredClone(read.scene!);
          updated.presence.find((p) => p.participant.kind === 'actor')!.leftVersion =
            f.accepted.version;
          await admin.query(
            'UPDATE parallel_life.scene_sessions SET document=$2 WHERE world_id=$1 AND id=$3',
            [f.worldId, updated, f.entered.sceneId],
          );
        }
        const result = await run(f);
        assert(result.failure);
        assert.equal(result.modelCalls, 0);
        if (attack !== 'actor_left_presence')
          assert.match(result.failure.message, /INPUT_SCOPE_FORBIDDEN/);
        const task = await tasks.get(f.owner, f.accepted.task!.id);
        assert.equal(task.status, 'failed');
        assert.equal(task.resultVersion, null);
        assert.equal(
          (await worlds.get({ userId: f.owner }, f.worldId)).version,
          f.accepted.version,
        );
        assert.equal(
          (await scenes.read(f.owner, f.worldId, f.entered.sceneId)).entries.filter(
            (e) => e.kind === 'dialogue',
          ).length,
          0,
        );
        assert.equal(
          (
            await admin.query('SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
              f.worldId,
              nativeAgentCommandId(task.id, f.actor),
            ])
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await admin.query('SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1', [
              f.worldId,
            ])
          ).rowCount,
          0,
        );
      },
    );

  await t.test(
    'a lease lost at actual NPC task finalization rolls back speech and state, then reuses the protected response without a second model call',
    async () => {
      const f = await fixture();
      const lease = (await queue.claimForOwner(f.accepted.task!.id, f.owner, ['world']))!;
      let calls = 0;
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete() {
          calls++;
          return JSON.stringify({
            statements: [{ text: '这条现场回复应与任务原子保存。', dependsOnActionIds: [] }],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          });
        },
      }));
      const name = `scene_npc_test_${randomUUID().replaceAll('-', '')}`;
      await admin.query(
        `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${lease.id}' AND NEW.status='succeeded' THEN NEW.lease_until=clock_timestamp()-interval '1 second'; END IF; RETURN NEW; END $$`,
      );
      try {
        await admin.query(
          `CREATE TRIGGER ${name} BEFORE UPDATE ON parallel_life.tasks FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}()`,
        );
        await assert.rejects(handler(lease, new AbortController().signal), /LEASE_LOST/);
        assert.equal(calls, 1);
        assert.equal((await tasks.get(f.owner, lease.id)).status, 'running');
        assert.equal(
          (await worlds.get({ userId: f.owner }, f.worldId)).version,
          f.accepted.version,
        );
        assert.equal(
          (await phone(f.owner, f.worldId, f.entered.sceneId)).entries.filter(
            (e) => e.kind === 'dialogue',
          ).length,
          0,
        );
        assert.equal(
          (await store.read(f.owner, { worldId: f.worldId, actorId: f.actor }))!.revision,
          0,
        );
        const attempt = await store.lookup(
          f.owner,
          f.worldId,
          nativeAgentCommandId(lease.id, f.actor),
        );
        assert.equal(attempt!.status, 'response_received');
        assert.equal(
          (
            await admin.query('SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
              f.worldId,
              nativeAgentCommandId(lease.id, f.actor),
            ])
          ).rowCount,
          0,
        );
      } finally {
        await admin.query(`DROP TRIGGER IF EXISTS ${name} ON parallel_life.tasks`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
      }
      assert.equal(await handler(lease, new AbortController().signal), true);
      assert.equal(calls, 1, 'protected original response is recovered without paying twice');
      assert.equal((await tasks.get(f.owner, lease.id)).status, 'succeeded');
      assert.equal(
        (await store.read(f.owner, { worldId: f.worldId, actorId: f.actor }))!.revision,
        1,
      );
      assert.equal(
        (await phone(f.owner, f.worldId, f.entered.sceneId)).entries.filter(
          (e) => e.kind === 'dialogue',
        ).length,
        1,
      );
    },
  );
});
