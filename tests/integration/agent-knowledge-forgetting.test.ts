import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  emptyActorAgentState,
  type AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
  attachAgentWorldContext,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { forgottenAgentSourceIds } from '../../src/modules/world/infrastructure/agent-source-authorization.ts';
import { readNativeAgentSnapshot } from '../../src/modules/world/infrastructure/agent-channel-snapshot.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { sceneEnvironmentTaskHandler } from '../../src/modules/world/infrastructure/agent-scene-environment.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import {
  projectCommittedWorldAwareness,
  PostgresWorldAwarenessRepository,
} from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { authorizeWorldCommandInTransaction } from '../../src/modules/world/infrastructure/world-command-uow.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const at = '2026-10-15T07:00:00.000Z';
const secret = '我在咖啡馆。合成私聊暗号FORGET_SECRET';
const reply = () => ({
  statements: [{ text: '知道了，先聊别的。', dependsOnActionIds: [] }],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});
test('forgotten lineage cannot return through late knowledge or self-position attachment', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, 55503);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await queue.pool.end();
    await worker.close();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    store = new PostgresAgentRuntimeRepository(db),
    awareness = new PostgresWorldAwarenessRepository(db);
  async function fixture() {
    const owner = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const world: WorldState = {
      schemaVersion: 1,
      id: randomUUID(),
      ownerId: owner,
      title: 'Knowledge fixture',
      version: 0,
      time: at,
      actors: [
        { id: a, name: '甲', persona: '有自己的生活' },
        { id: b, name: '乙', persona: '不知道甲的私聊' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        places: ['home', 'cafe'].map((id) => ({
          id,
          name: id,
          description: '公开地图地点',
          source,
          contactActorIds: [],
          appointmentIds: [],
        })),
        routes: [],
        currentPlaceId: 'home',
        positionSource: source,
      },
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const actorId of [a, b])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId: world.id, actorId },
            agentDefinitionRef(world, actorId),
            0,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: world.id,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    const service = npcAgentServices(db, () => ({
      async complete(messages) {
        const p = JSON.parse(messages[1]!.content);
        if (p.input.text === secret)
          return JSON.stringify({
            ...reply(),
            goals: [
              {
                id: 'secret-goal',
                summary: secret,
                status: 'active',
                sourceIds: [p.input.sourceId],
                resultIds: [],
              },
            ],
            locationReports: [
              {
                subject: { kind: 'player' },
                placeId: 'cafe',
                sourceId: p.input.sourceId,
                quote: '我在咖啡馆',
                assertion: 'reported',
              },
            ],
          });
        return JSON.stringify(reply());
      },
    }));
    await service.sendMessageIfEnabled(owner, {
      id: randomUUID(),
      worldId: world.id,
      actorId: a,
      expectedVersion: 0,
      text: secret,
    });
    const current = await worlds.get({ userId: owner }, world.id),
      message = current.messages.find((m) => m.role === 'user')!;
    const e = (
      await admin.query(
        'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version=1',
        [world.id],
      )
    ).rows[0]!.payload;
    return {
      owner,
      a,
      b,
      world,
      current,
      message,
      event: e,
      inputId: e.data.agentRuntime.inputReceiptId as string,
    };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function forget(f: F, source: string, actor = f.a) {
    await admin.query(
      "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Synthetic forgotten provenance',$5,'agent_inference',$6,'forgotten')",
      [randomUUID(), f.owner, actor, f.world.id, randomUUID(), JSON.stringify([source])],
    );
  }
  async function privateSnapshot(f: F, actor = f.a) {
    const world = await worlds.get({ userId: f.owner }, f.world.id);
    const state = (await store.read(f.owner, { worldId: f.world.id, actorId: actor }))!;
    return (await readPrivateAgentSnapshot(db, f.owner, world, actor, null, world.time, state))
      .snapshot;
  }
  async function modelPayload(snapshot: AgentSnapshot) {
    let payload: any;
    await new NpcAgentModel({
      async complete(messages) {
        payload = JSON.parse(messages[1]!.content);
        return '{}';
      },
    }).decide(snapshot);
    return payload;
  }
  await t.test(
    'actual report before forgetting is unverified and another actor never learns the private statement',
    async () => {
      const f = await fixture();
      const s = await privateSnapshot(f);
      assert.equal(s.worldContext?.knowledge[0]?.placeId, 'cafe');
      assert.equal(s.worldContext?.knowledge[0]?.sourceKind, 'player_report');
      assert.deepEqual(
        (await awareness.readActorAwareness(f.owner, f.world.id, f.b)).knowledge,
        [],
      );
      assert.equal(
        JSON.stringify(await modelPayload(await privateSnapshot(f, f.b))).includes('FORGET_SECRET'),
        false,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT 1 FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key='player'",
            [f.world.id],
          )
        ).rowCount,
        0,
      );
    },
  );
  for (const alias of [
    'message',
    'message_handle',
    'event',
    'event_handle',
    'input',
    'input_handle',
    'knowledge',
  ] as const)
    await t.test(`late attach suppresses report/state from forgotten ${alias} source`, async () => {
      const f = await fixture();
      const before = await privateSnapshot(f);
      const source =
        alias === 'message'
          ? f.message.id
          : alias === 'message_handle'
            ? `message:${f.message.id}`
            : alias === 'event'
              ? f.event.id
              : alias === 'event_handle'
                ? `event:${f.event.id}`
                : alias === 'input'
                  ? f.inputId
                  : alias === 'input_handle'
                    ? `input:${f.inputId}`
                    : `knowledge:${f.event.id}:player:report`;
      await forget(f, source);
      const blocked = await db.transaction(f.owner, (sql) =>
        forgottenAgentSourceIds(sql, f.owner, f.world.id, f.a),
      );
      assert.ok(blocked.has(f.event.id));
      assert.ok(blocked.has(f.inputId));
      assert.ok(blocked.has(f.message.id));
      // Simulate an earlier loader that read before forgetting; late attachment must re-filter it too.
      const late = await attachAgentWorldContext(db, f.owner, before);
      assert.deepEqual(late.worldContext?.knowledge, []);
      assert.equal(
        late.sources.some((s) => [f.event.id, f.inputId, f.message.id].includes(s.recordId)),
        false,
      );
      const payload = await modelPayload(await privateSnapshot(f));
      assert.equal(JSON.stringify(payload).includes('FORGET_SECRET'), false);
      assert.equal(JSON.stringify(payload).includes('我在咖啡馆'), false);
      assert.deepEqual(payload.worldContext.knowledge, []);
      assert.deepEqual(payload.state.goals, []);
      // cafe remains an ordinary public map ID; its existence is not the forgotten player-location binding.
      assert.ok(payload.worldContext.boundary.placeIds.includes('cafe'));
      assert.equal(
        (await store.read(f.owner, { worldId: f.world.id, actorId: f.a }))!.goals[0]?.summary,
        secret,
      );
      assert.equal(
        (await awareness.readActorAwareness(f.owner, f.world.id, f.a)).knowledge.length,
        1,
      );
    });
  await t.test(
    'next actual private service request is clean before model invocation, not merely rejected by final kernel',
    async () => {
      const f = await fixture();
      await forget(f, f.message.id);
      let captured = false;
      const service = npcAgentServices(db, () => ({
        async complete(messages) {
          captured = true;
          const p = JSON.parse(messages[1]!.content);
          assert.equal(JSON.stringify(p).includes('FORGET_SECRET'), false);
          assert.deepEqual(p.worldContext.knowledge, []);
          return JSON.stringify(reply());
        },
      }));
      await service.sendMessageIfEnabled(f.owner, {
        id: randomUUID(),
        worldId: f.world.id,
        actorId: f.a,
        expectedVersion: 1,
        text: '聊聊别的安排',
      });
      assert.equal(captured, true);
    },
  );
  await t.test(
    'native group snapshots do not resurrect forgotten private report, nor disclose it to another actor',
    async () => {
      const f = await fixture();
      const groups = new PostgresGroupRepository(db);
      const g = await groups.create(f.owner, {
        worldId: f.world.id,
        commandId: randomUUID(),
        expectedVersion: 1,
        title: '合成群',
        actorIds: [f.a, f.b],
      });
      const commandId = randomUUID();
      await groups.send(f.owner, {
        worldId: f.world.id,
        commandId,
        expectedVersion: 2,
        groupId: g.groupId,
        text: '各自聊聊安排',
      });
      const receipt = (
        await db.transaction(f.owner, (sql) =>
          sql.query(
            'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
            [f.world.id, f.owner, commandId],
          ),
        )
      ).rows[0]!.document as AgentInputReceipt;
      await forget(f, `message:${f.message.id}`);
      const world = await worlds.get({ userId: f.owner }, f.world.id);
      for (const actor of [f.a, f.b]) {
        const state = (await store.read(f.owner, { worldId: f.world.id, actorId: actor }))!;
        const s = await readNativeAgentSnapshot(
          db,
          f.owner,
          world,
          actor,
          receipt,
          world.time,
          state,
        );
        const payload = await modelPayload(s);
        assert.equal(JSON.stringify(payload).includes('FORGET_SECRET'), false);
        assert.deepEqual(payload.worldContext.knowledge, []);
      }
      const msg = (
        await admin.query(
          'SELECT id,source_event_id FROM parallel_life.world_group_messages WHERE world_id=$1',
          [f.world.id],
        )
      ).rows[0]!;
      await forget(f, `group:${msg.id}`);
      const blocked = await db.transaction(f.owner, (sql) =>
        forgottenAgentSourceIds(sql, f.owner, f.world.id, f.a),
      );
      assert.ok(blocked.has(receipt.id));
      assert.ok(blocked.has(msg.source_event_id));
      await assert.rejects(
        readNativeAgentSnapshot(
          db,
          f.owner,
          world,
          f.a,
          receipt,
          world.time,
          (await store.read(f.owner, { worldId: f.world.id, actorId: f.a }))!,
        ),
        /FORBIDDEN/,
      );
    },
  );
  async function presence(f: F, placeId: string) {
    const current = await worlds.get({ userId: f.owner }, f.world.id);
    const event = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: f.world.id,
      commandId: randomUUID(),
      version: current.version + 1,
      occurredAt: new Date().toISOString(),
      storyAt: current.time,
      type: 'scene.opened',
      data: { sceneId: randomUUID() },
    };
    await db.transaction(f.owner, async (sql) => {
      await authorizeWorldCommandInTransaction(sql, f.owner, {
        worldId: f.world.id,
        commandId: event.commandId,
        expectedWorldVersion: current.version,
        kind: 'scene_enter',
      });
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,'fixture',$5,'queued')",
        [event.commandId, f.world.id, f.owner, current.version, {}],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, f.world.id, f.owner, event.version, event.commandId, event, event.occurredAt],
      );
      const compact = {
        ...current,
        version: event.version,
        messages: [],
        facts: [],
        appointments: [],
        mediaRequests: [],
      };
      await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        f.world.id,
        event.version,
        compact,
      ]);
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
        [f.world.id, event.commandId, event.id, compact],
      );
      const scene = {
        id: event.data.sceneId,
        ownerId: f.owner,
        worldId: f.world.id,
        title: '实际在场夹具',
        status: 'active',
        placeId,
        sourceEventId: event.id,
        sourceVersion: event.version,
        presence: [
          {
            participant: { kind: 'actor', actorId: f.a },
            joinedVersion: event.version,
            sourceEventId: event.id,
            sourceVersion: event.version,
          },
        ],
      };
      await sql.query(
        'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [scene.id, f.world.id, f.owner, event.id, scene],
      );
      await projectCommittedWorldAwareness(sql, f.owner, event);
    });
    return event;
  }
  await t.test(
    'forgotten own-position source yields unknown, while a later independent physical source remains usable',
    async () => {
      const f = await fixture();
      const e = await presence(f, 'home');
      assert.equal((await privateSnapshot(f)).worldContext?.selfPosition.placeId, 'home');
      await forget(f, e.id);
      const s = await privateSnapshot(f);
      assert.equal(s.worldContext?.selfPosition.status, 'unknown');
      assert.equal(s.worldContext?.selfPosition.placeId, null);
      assert.equal(
        s.sources.some((source) => source.id === `self-position:${e.id}`),
        false,
      );
      const next = await presence(f, 'cafe');
      const independent = await privateSnapshot(f);
      assert.equal(independent.worldContext?.selfPosition.placeId, 'cafe');
      assert.equal(independent.worldContext?.selfPosition.sourceId, `self-position:${next.id}`);
    },
  );
  await t.test(
    'scene alias graph suppresses only that actual native input lineage and grants no source to other actors',
    async () => {
      const f = await fixture();
      const scenes = new SceneRepository(db);
      const entered = await scenes.enterPlace(f.owner, f.world.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        placeId: 'home',
      });
      const lease = await queue.claimForOwner(entered.task!.id, f.owner, ['world']);
      assert.ok(lease);
      assert.equal(
        await sceneEnvironmentTaskHandler(db)(lease, new AbortController().signal),
        true,
      );
      const current = await worlds.get({ userId: f.owner }, f.world.id);
      const commandId = randomUUID();
      await scenes.input(f.owner, f.world.id, entered.sceneId, {
        commandId,
        expectedVersion: current.version,
        text: '有人吗',
        relatedMatterIds: [],
      });
      const receipt = (
        await admin.query(
          'SELECT id FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
          [f.world.id, commandId],
        )
      ).rows[0]!;
      const entry = (
        await admin.query(
          "SELECT id,source_event_id FROM parallel_life.scene_items WHERE world_id=$1 AND kind='entry' AND document->>'kind'='user_action'",
          [f.world.id],
        )
      ).rows[0]!;
      await forget(f, `scene:${entry.id}`);
      const blocked = await db.transaction(f.owner, (sql) =>
        forgottenAgentSourceIds(sql, f.owner, f.world.id, f.a),
      );
      assert.ok(blocked.has(entry.source_event_id));
      assert.ok(blocked.has(receipt.id));
      assert.equal(blocked.has(f.event.id), false);
      assert.equal(
        (
          await db.transaction(f.owner, (sql) =>
            forgottenAgentSourceIds(sql, f.owner, f.world.id, f.b),
          )
        ).size,
        0,
      );
      assert.equal(
        JSON.stringify(await modelPayload(await privateSnapshot(f, f.b))).includes('FORGET_SECRET'),
        false,
      );
    },
  );
  await t.test(
    'worker table ACLs remain unchanged; foreign world lineage does not suppress an unrelated world',
    async () => {
      const f = await fixture(),
        other = await fixture();
      await forget(f, f.message.id);
      const otherBlocked = await db.transaction(other.owner, (sql) =>
        forgottenAgentSourceIds(sql, other.owner, other.world.id, other.a),
      );
      assert.equal(otherBlocked.size, 0);
      const privileges = (
        await admin.query(
          "SELECT has_table_privilege('pl_worker','parallel_life.actor_position_knowledge','SELECT') AS knowledge,has_table_privilege('pl_worker','parallel_life.agent_input_receipts','SELECT') AS inputs",
        )
      ).rows[0]!;
      assert.equal(privileges.knowledge, false);
      assert.equal(privileges.inputs, false);
    },
  );
});
