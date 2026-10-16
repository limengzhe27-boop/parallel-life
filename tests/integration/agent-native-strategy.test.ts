import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
  type AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { readNativeAgentSnapshot } from '../../src/modules/world/infrastructure/agent-channel-snapshot.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { readActorStrategyBasis } from '../../src/modules/world/infrastructure/agent-source-resolver.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { authorizeWorldCommandInTransaction } from '../../src/modules/world/infrastructure/world-command-uow.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const at = '2026-10-15T07:00:00.000Z';
test('native strategy retains only historically authenticated own provenance across channels', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.AGENT_NATIVE_STRATEGY_TEST_PORT ?? 55503));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    store = new PostgresAgentRuntimeRepository(db),
    groups = new PostgresGroupRepository(db);
  async function fixture() {
    const owner = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: randomUUID(),
      ownerId: owner,
      title: 'Synthetic native strategy',
      version: 0,
      time: at,
      actors: [
        { id: a, name: '甲', persona: '有自己的安排' },
        { id: b, name: '乙', persona: '独立的人物' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
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
    let privateInputId = '';
    const privateService = npcAgentServices(db, () => ({
      async complete(messages) {
        const payload = JSON.parse(messages[1]!.content);
        privateInputId = payload.input.sourceId;
        return JSON.stringify({
          statements: [{ text: '先按自己的安排来。', dependsOnActionIds: [] }],
          goals: [
            {
              id: 'private_goal',
              summary: '保留自己的安排',
              status: 'active',
              sourceIds: [privateInputId],
              resultIds: [],
            },
          ],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        });
      },
    }));
    await privateService.sendMessageIfEnabled(owner, {
      id: randomUUID(),
      worldId: world.id,
      expectedVersion: 0,
      actorId: a,
      text: 'PRIVATE_ORIGINAL_TEXT 先说说你的安排',
    });
    const g = await groups.create(owner, {
      worldId: world.id,
      commandId: randomUUID(),
      expectedVersion: 1,
      title: '原群',
      actorIds: [a, b],
    });
    const commandId = randomUUID();
    const sent = await groups.send(owner, {
      worldId: world.id,
      commandId,
      expectedVersion: 2,
      groupId: g.groupId,
      text: 'NATIVE_PRIVATE_BODY_A 合成群聊原话',
    });
    const input = (
      await admin.query(
        'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
        [world.id, commandId],
      )
    ).rows[0].document as AgentInputReceipt;
    const current = await worlds.get({ userId: owner }, world.id),
      state = (await store.read(owner, { worldId: world.id, actorId: a }))!;
    const snapshot = await readNativeAgentSnapshot(
      db,
      owner,
      current,
      a,
      input,
      current.time,
      state,
    );
    const groupSource = snapshot.sources.find((s) => s.kind === 'group_message')!;
    const proposal: AgentProposal = {
      statements: [{ text: 'NATIVE_OWN_REPLY 我会记着自己的安排。', dependsOnActionIds: [] }],
      goals: [
        {
          id: 'native_goal',
          summary: '继续自己的安排',
          status: 'active',
          resultIds: [],
          sourceIds: [groupSource.id, input.id],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    };
    await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return proposal;
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      owner,
      {
        id: randomUUID(),
        commandId: randomUUID(),
        inputReceiptId: input.id,
        inputHash: input.inputHash,
        worldId: world.id,
        actorId: a,
        engineEpoch: 2,
        expectedWorldVersion: current.version,
        expectedActorRevision: state.revision,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    await new TaskRepository(db).cancel(owner, sent.task.id);
    return {
      owner,
      a,
      b,
      worldId: world.id,
      groupId: g.groupId,
      input,
      groupSource,
      privateInputId,
    };
  }
  async function privateView(f: Awaited<ReturnType<typeof fixture>>, actor = f.a) {
    const world = await worlds.get({ userId: f.owner }, f.worldId),
      state = (await store.read(f.owner, { worldId: f.worldId, actorId: actor }))!;
    return (await readPrivateAgentSnapshot(db, f.owner, world, actor, null, world.time, state))
      .snapshot;
  }
  await t.test(
    'actual native committed goal survives returning to private chat without importing transcript',
    async () => {
      const f = await fixture(),
        snapshot = await privateView(f);
      assert.ok(
        snapshot.sources.some((s) => s.id === f.groupSource.id && s.usage === 'private_strategy'),
      );
      assert.ok(
        snapshot.sources.some((s) => s.id === f.input.id && s.usage === 'private_strategy'),
      );
      assert.ok(snapshot.viewState.goals.some((g) => g.id === 'native_goal'));
      assert.equal(
        snapshot.observations.some((o) => o.text.includes('NATIVE_PRIVATE_BODY_A')),
        false,
      );
    },
  );
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function basis(f: Fixture, actor = f.a, extra: string[] = []) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: actor }))!;
    state.knowledgeSourceIds.push(...extra);
    return db.transaction(f.owner, (sql) =>
      readActorStrategyBasis(sql, f.owner, state, world.version, world.time),
    );
  }
  async function payload(snapshot: AgentSnapshot) {
    let value: unknown;
    await new NpcAgentModel({
      async complete(messages) {
        value = JSON.parse(messages[1]!.content);
        return '{}';
      },
    }).decide(snapshot);
    return value;
  }
  async function forget(f: Fixture, id: string) {
    await admin.query(
      "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Synthetic forgotten metadata',$5,'agent_inference',$6,'forgotten')",
      [randomUUID(), f.owner, f.a, f.worldId, randomUUID(), JSON.stringify([id])],
    );
  }
  async function syntheticScene(f: Fixture) {
    // Explicit synthetic historical scene: actual entered/opened receipts, no inferred NPC movement.
    const world = await worlds.get({ userId: f.owner }, f.worldId),
      sceneId = randomUUID(),
      enteredId = randomUUID(),
      openedId = randomUUID();
    const enteredVersion = world.version + 1,
      openedVersion = world.version + 2;
    const entered = { sourceEventId: enteredId, sourceVersion: enteredVersion };
    const opened = { sourceEventId: openedId, sourceVersion: openedVersion };
    const scene = {
      id: sceneId,
      ownerId: f.owner,
      worldId: f.worldId,
      title: '合成历史现场',
      status: 'active',
      ...entered,
      presence: [
        { participant: { kind: 'player' }, joinedVersion: enteredVersion, ...entered },
        { participant: { kind: 'actor', actorId: f.a }, joinedVersion: openedVersion, ...opened },
      ],
    };
    await db.transaction(f.owner, async (sql) => {
      await authorizeWorldCommandInTransaction(sql, f.owner, {
        worldId: f.worldId,
        expectedWorldVersion: world.version,
        commandId: randomUUID(),
        kind: 'scene_enter',
      });
      for (const spec of [
        { id: enteredId, version: enteredVersion, type: 'scene.entered', data: { sceneId } },
        {
          id: openedId,
          version: openedVersion,
          type: 'scene.opened',
          data: {
            sceneId,
            proposal: { narration: '合成场景', dialogues: [] },
            worldResults: { scene },
          },
        },
      ]) {
        const commandId = randomUUID(),
          event = {
            schemaVersion: 1,
            ...spec,
            worldId: f.worldId,
            commandId,
            occurredAt: world.time,
            storyAt: world.time,
          };
        await sql.query(
          "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,'{}','queued')",
          [
            commandId,
            f.worldId,
            f.owner,
            spec.version - 1,
            createHash('sha256').update(commandId).digest('hex'),
          ],
        );
        await sql.query(
          'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [spec.id, f.worldId, f.owner, spec.version, commandId, event, world.time],
        );
        const next = { ...world, version: spec.version };
        await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
          f.worldId,
          spec.version,
          next,
        ]);
        await sql.query(
          "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
          [f.worldId, commandId, spec.id, next],
        );
      }
      await sql.query(
        'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [sceneId, f.worldId, f.owner, enteredId, scene],
      );
      const item = {
        id: randomUUID(),
        ownerId: f.owner,
        worldId: f.worldId,
        sceneId,
        ...opened,
        observableTo: [{ kind: 'player' }, { kind: 'actor', actorId: f.a }],
        kind: 'time_place',
        storyAt: world.time,
        location: '合成现场',
      };
      await sql.query(
        "INSERT INTO parallel_life.scene_items(id,world_id,owner_id,scene_id,source_event_id,kind,document) VALUES($1,$2,$3,$4,$5,'entry',$6)",
        [item.id, f.worldId, f.owner, sceneId, openedId, item],
      );
      await sql.query(
        'INSERT INTO parallel_life.player_experiences(world_id,owner_id,current_scene_id,document) VALUES($1,$2,$3,$4) ON CONFLICT(world_id) DO UPDATE SET current_scene_id=excluded.current_scene_id,document=excluded.document',
        [
          f.worldId,
          f.owner,
          sceneId,
          {
            worldId: f.worldId,
            ownerId: f.owner,
            currentSceneId: sceneId,
            view: { kind: 'scene', sceneId },
          },
        ],
      );
    });
    return sceneId;
  }
  async function sceneTurn(f: Fixture) {
    const sceneId = await syntheticScene(f),
      scenes = new SceneRepository(db);
    let world = await worlds.get({ userId: f.owner }, f.worldId);
    const commandId = randomUUID();
    const accepted = await scenes.input(f.owner, f.worldId, sceneId, {
      commandId,
      expectedVersion: world.version,
      text: 'NATIVE_SCENE_BODY_A 我们看看眼下的安排',
      relatedMatterIds: [],
    });
    const input = (
      await admin.query(
        'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
        [f.worldId, commandId],
      )
    ).rows[0].document as AgentInputReceipt;
    world = await worlds.get({ userId: f.owner }, f.worldId);
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
    const snapshot = await readNativeAgentSnapshot(
      db,
      f.owner,
      world,
      f.a,
      input,
      world.time,
      state,
    );
    assert.ok(snapshot.viewState.goals.some((g) => g.id === 'native_goal'));
    assert.ok(snapshot.viewState.goals.some((g) => g.id === 'private_goal'));
    const source = snapshot.sources.find(
      (s) =>
        s.kind === 'scene_entry' &&
        snapshot.observations.some(
          (o) => o.sourceId === s.id && o.text.includes('NATIVE_SCENE_BODY_A'),
        ),
    )!;
    assert.ok(source);
    const p: AgentProposal = {
      statements: [{ text: 'NATIVE_SCENE_REPLY 你想先看哪一项？', dependsOnActionIds: [] }],
      goals: [
        {
          id: 'scene_goal',
          summary: '处理眼前的事',
          status: 'active',
          sourceIds: [source.id, input.id],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    };
    await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return p;
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      f.owner,
      {
        id: randomUUID(),
        commandId: randomUUID(),
        inputReceiptId: input.id,
        inputHash: input.inputHash,
        worldId: f.worldId,
        actorId: f.a,
        engineEpoch: 2,
        expectedWorldVersion: world.version,
        expectedActorRevision: state.revision,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    if (accepted.task) await new TaskRepository(db).cancel(f.owner, accepted.task.id);
    return { sceneId, input, source, snapshot };
  }

  await t.test(
    'private→group→scene→private keeps goals and final kernel source validation without importing old channel text',
    async () => {
      const f = await fixture(),
        native = await sceneTurn(f);
      const scenePayload = JSON.stringify(await payload(native.snapshot));
      assert.equal(scenePayload.includes('PRIVATE_ORIGINAL_TEXT'), false);
      assert.equal(scenePayload.includes('NATIVE_PRIVATE_BODY_A'), false);
      const snapshot = await privateView(f);
      for (const id of [
        f.privateInputId,
        f.groupSource.id,
        f.input.id,
        native.source.id,
        native.input.id,
      ])
        assert.ok(snapshot.sources.some((s) => s.id === id));
      for (const id of ['private_goal', 'native_goal', 'scene_goal'])
        assert.ok(snapshot.viewState.goals.some((g) => g.id === id));
      const privatePayload = JSON.stringify(await payload(snapshot));
      for (const marker of [
        'NATIVE_PRIVATE_BODY_A',
        'NATIVE_SCENE_BODY_A',
        'NATIVE_OWN_REPLY',
        'NATIVE_SCENE_REPLY',
      ])
        assert.equal(privatePayload.includes(marker), false);
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const p: AgentProposal = {
        statements: [{ text: '继续处理自己的安排。', dependsOnActionIds: [] }],
        goals: [
          {
            id: 'crosschannel_followup',
            summary: '继续先前的工作',
            status: 'active',
            sourceIds: [f.groupSource.id, native.source.id],
            resultIds: [],
          },
        ],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
      };
      await npcAgentServices(db, () => ({
        async complete() {
          return JSON.stringify(p);
        },
      })).sendMessageIfEnabled(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        expectedVersion: world.version,
        actorId: f.a,
        text: '之后你准备怎么做？',
      });
      assert.ok(
        (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!.goals.some(
          (g) => g.id === 'crosschannel_followup',
        ),
      );
    },
  );
  await t.test(
    'current cast/group membership does not grant another actor an unprocessed native input or scene goal',
    async () => {
      const f = await fixture(),
        native = await sceneTurn(f);
      const refs = await basis(f, f.b, [
        f.groupSource.id,
        f.input.id,
        native.source.id,
        native.input.id,
      ]);
      assert.equal(
        refs.some((s) =>
          [f.groupSource.id, f.input.id, native.source.id, native.input.id].includes(s.id),
        ),
        false,
      );
    },
  );
  await t.test(
    'left group retains earlier lawful strategy but gets no absence-period or later content on rejoin',
    async () => {
      const f = await fixture();
      let world = await worlds.get({ userId: f.owner }, f.worldId);
      await groups.membership(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: world.version,
        groupId: f.groupId,
        participant: { kind: 'actor', actorId: f.a },
        action: 'leave',
      });
      assert.ok((await basis(f)).some((s) => s.id === f.groupSource.id));
      world = await worlds.get({ userId: f.owner }, f.worldId);
      const commandId = randomUUID();
      const sent = await groups.send(f.owner, {
        worldId: f.worldId,
        commandId,
        expectedVersion: world.version,
        groupId: f.groupId,
        text: 'ABSENCE_FUTURE_SECRET',
      });
      await new TaskRepository(db).cancel(f.owner, sent.task.id);
      const row = (
        await admin.query(
          'SELECT id FROM parallel_life.world_group_messages WHERE world_id=$1 AND source_version=$2',
          [f.worldId, sent.version],
        )
      ).rows[0];
      const input = (
        await admin.query(
          'SELECT id FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
          [f.worldId, commandId],
        )
      ).rows[0];
      world = await worlds.get({ userId: f.owner }, f.worldId);
      await groups.membership(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: world.version,
        groupId: f.groupId,
        participant: { kind: 'actor', actorId: f.a },
        action: 'join',
      });
      const refs = await basis(f, f.a, ['group:' + row.id, input.id]);
      assert.ok(refs.some((s) => s.id === f.groupSource.id));
      assert.equal(
        refs.some((s) => s.id === 'group:' + row.id || s.id === input.id),
        false,
      );
    },
  );
  for (const alias of ['group', 'receipt', 'command', 'event'] as const)
    await t.test('forget ' + alias + ' revokes native strategy aliases', async () => {
      const f = await fixture();
      const original = (
        await admin.query(
          'SELECT source_event_id FROM parallel_life.world_group_messages WHERE world_id=$1 AND id=$2',
          [f.worldId, f.groupSource.recordId],
        )
      ).rows[0];
      await forget(
        f,
        alias === 'group'
          ? f.groupSource.id
          : alias === 'receipt'
            ? f.input.id
            : alias === 'command'
              ? f.input.commandId
              : original.source_event_id,
      );
      const refs = await basis(f);
      assert.equal(
        refs.some((s) => s.id === f.groupSource.id || s.id === f.input.id),
        false,
      );
      assert.equal(
        (await privateView(f)).viewState.goals.some((g) => g.id === 'native_goal'),
        false,
      );
    });
  await t.test(
    'question and resolution handles recover only own spoken/source metadata, including withdrawal ref',
    async () => {
      const f = await fixture(),
        native = await sceneTurn(f);
      const spoken = (
        await admin.query(
          "SELECT id,source_event_id,document FROM parallel_life.scene_items WHERE world_id=$1 AND kind='entry' AND document->>'kind'='dialogue' ORDER BY ordinal DESC LIMIT 1",
          [f.worldId],
        )
      ).rows[0];
      const world = await worlds.get({ userId: f.owner }, f.worldId),
        state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
      state.goals = [];
      state.plans = [];
      state.actions = [];
      state.responsibilities = [];
      state.decisions = [];
      state.knowledgeSourceIds = [];
      state.focus = null;
      state.questions = [
        {
          id: 'q',
          channel: 'scene',
          threadId: native.sceneId,
          sourceId: 'scene:' + spoken.id,
          text: '你想先看哪一项？',
          askedAt: world.time,
          status: 'withdrawn',
          resolution: {
            sourceId: native.input.id,
            at: world.time,
            kind: 'withdrawal',
            reason: '换个时间再谈',
          },
        },
      ];
      const refs = await db.transaction(f.owner, (sql) =>
        readActorStrategyBasis(sql, f.owner, state, world.version, world.time),
      );
      assert.ok(refs.some((s) => s.id === 'scene:' + spoken.id && s.usage === 'private_strategy'));
      assert.ok(refs.some((s) => s.id === native.input.id));
      assert.equal(JSON.stringify(refs).includes('NATIVE_SCENE_REPLY'), false);
      await forget(f, spoken.source_event_id);
      const after = await db.transaction(f.owner, (sql) =>
        readActorStrategyBasis(sql, f.owner, state, world.version, world.time),
      );
      assert.equal(
        after.some((s) => s.id === 'scene:' + spoken.id),
        false,
      );
    },
  );
  await t.test(
    'owner/world/time bounds cannot recover another world or future native exposure',
    async () => {
      const f = await fixture(),
        other = await fixture();
      const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const foreign = await db.transaction(other.owner, (sql) =>
        readActorStrategyBasis(sql, other.owner, state, world.version, world.time),
      );
      assert.deepEqual(foreign, []);
      for (const [version, storyAt] of [
        [2, world.time],
        [world.version, '2026-10-14T00:00:00.000Z'],
      ] as const) {
        const refs = await db.transaction(f.owner, (sql) =>
          readActorStrategyBasis(sql, f.owner, state, version, storyAt),
        );
        assert.equal(
          refs.some((s) => s.id === f.groupSource.id || s.id === f.input.id),
          false,
        );
      }
    },
  );
  for (const alias of ['scene', 'receipt'] as const)
    await t.test(
      'forget ' + alias + ' revokes original scene input and its retained goal',
      async () => {
        const f = await fixture(),
          native = await sceneTurn(f);
        await forget(f, alias === 'scene' ? native.source.id : native.input.id);
        const refs = await basis(f);
        assert.equal(
          refs.some((s) => s.id === native.source.id || s.id === native.input.id),
          false,
        );
        assert.equal(
          (await privateView(f)).viewState.goals.some((g) => g.id === 'scene_goal'),
          false,
        );
      },
    );
  await t.test(
    'another group receives strategy metadata but neither old group nor private transcript',
    async () => {
      const f = await fixture();
      let world = await worlds.get({ userId: f.owner }, f.worldId);
      const other = await groups.create(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: world.version,
        title: '另一个群',
        actorIds: [f.a, f.b],
      });
      const commandId = randomUUID();
      const sent = await groups.send(f.owner, {
        worldId: f.worldId,
        commandId,
        expectedVersion: other.version,
        groupId: other.groupId,
        text: 'OTHER_GROUP_CURRENT_BODY',
      });
      const input = (
        await admin.query(
          'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
          [f.worldId, commandId],
        )
      ).rows[0].document as AgentInputReceipt;
      world = await worlds.get({ userId: f.owner }, f.worldId);
      const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
      const snapshot = await readNativeAgentSnapshot(
        db,
        f.owner,
        world,
        f.a,
        input,
        world.time,
        state,
      );
      assert.ok(snapshot.viewState.goals.some((g) => g.id === 'native_goal'));
      const body = JSON.stringify(await payload(snapshot));
      assert.equal(body.includes('NATIVE_PRIVATE_BODY_A'), false);
      assert.equal(body.includes('PRIVATE_ORIGINAL_TEXT'), false);
      assert.equal(body.includes('OTHER_GROUP_CURRENT_BODY'), true);
      const proposal: AgentProposal = {
        statements: [{ text: '我接着安排自己的事。', dependsOnActionIds: [] }],
        goals: [
          {
            id: 'other_group_goal',
            summary: '保留自己的工作',
            status: 'active',
            sourceIds: [f.groupSource.id, input.id],
            resultIds: [],
          },
        ],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
      };
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return proposal;
            },
          },
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        f.owner,
        {
          id: randomUUID(),
          commandId: randomUUID(),
          inputReceiptId: input.id,
          inputHash: input.inputHash,
          worldId: f.worldId,
          actorId: f.a,
          engineEpoch: 2,
          expectedWorldVersion: world.version,
          expectedActorRevision: state.revision,
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 120000).toISOString(),
        },
        snapshot,
      );
      await new TaskRepository(db).cancel(f.owner, sent.task.id);
      assert.ok((await privateView(f)).viewState.goals.some((g) => g.id === 'other_group_goal'));
    },
  );
});
