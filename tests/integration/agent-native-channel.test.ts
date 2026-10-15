import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
  loadScene,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  beginAgentCommitInTransaction,
  finishAgentCommitInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentInputReceipt,
  type AgentStatement,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentRuntimeTransition } from '../../src/modules/world/domain/agent-state-event.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { projectNativeAgentChannelInTransaction } from '../../src/modules/world/infrastructure/agent-channel-projector.ts';
import { readNativeAgentSnapshot } from '../../src/modules/world/infrastructure/agent-channel-snapshot.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import {
  applyWorldHistoryEvent,
  type WorldHistoryEvent,
} from '../../src/modules/world/domain/world-history.ts';
import type { WorldState, WorldEffect } from '../../src/modules/world/domain/types.ts';

test('native channels use actual PostgreSQL projections and one actor/world UoW without models', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, 55565, 'isolated assigned PostgreSQL only');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:55565/parallel_life_test`,
  );
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
      await db.close();
      await admin.end();
    }
  });
  const worlds = new PostgresWorldRepository(db),
    groups = new PostgresGroupRepository(db),
    scenes = new SceneRepository(db);
  const store = new PostgresAgentRuntimeRepository(db),
    tasks = new TaskRepository(db);

  async function fixture(channel: 'group' | 'scene', privateStrategy = false) {
    const owner = randomUUID(),
      actor = randomUUID(),
      other = randomUUID(),
      worldId = randomUUID();
    owners.push(owner);
    await new IdentityRepository(db).ensureGuest(owner);
    const now = new Date().toISOString(),
      appointmentId = randomUUID();
    const initial: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Native synthetic fixture',
      time: now,
      actors: [
        { id: actor, name: '甲', persona: '认真，有独立安排。' },
        { id: other, name: '乙', persona: '独立生活。' },
      ],
      facts: [],
      messages: [],
      mediaRequests: [],
      appointments:
        channel === 'scene'
          ? [
              {
                id: appointmentId,
                title: '当面聊聊',
                at: now,
                participantIds: [actor],
                status: 'confirmed',
                sourceEventId: `genesis:${worldId}`,
              },
            ]
          : [],
    };
    if (channel === 'scene') {
      // Synthetic authored genesis fixture, persisted through the real owner connection.
      await db.transaction(owner, async (sql) => {
        await sql.query(
          'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
          [worldId, owner, initial.title, initial],
        );
        await sql.query(
          'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
          [worldId, owner, initial, {}],
        );
      });
    } else await worlds.initialize({ userId: owner }, initial);
    let privateBasis: AgentInputReceipt | undefined;
    if (privateStrategy) {
      privateBasis = {
        id: randomUUID(),
        worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('private strategy input').digest('hex'),
        channel: 'private',
        threadId: actor,
        recipientActorId: actor,
        expectedWorldVersion: 0,
        origin: 'player',
        text: 'ORIGINAL_PRIVATE_QUOTE_DO_NOT_SERIALIZE',
        receivedAt: now,
        storyAt: now,
      };
      await store.accept(owner, privateBasis);
    }
    let thread: string, version: number;
    if (channel === 'group') {
      const created = await groups.create(owner, {
        worldId,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: '测试群',
        actorIds: [actor, other],
      });
      thread = created.groupId;
      version = created.version;
    } else {
      const entered = await scenes.enter(owner, worldId, {
        commandId: randomUUID(),
        expectedVersion: 0,
        appointmentId,
      });
      thread = entered.sceneId;
      await tasks.cancel(owner, entered.task!.id);
      version = await db.transaction(owner, (sql) =>
        commitSceneProposal(
          sql,
          owner,
          worldId,
          { type: 'scene', sceneId: thread, actionId: null, expectedVersion: entered.version },
          {
            location: '会客室',
            narration: '桌边的灯亮着。',
            presentActorIds: [actor],
            outcome: null,
            observation: null,
            matterTitle: null,
            initialMatters: [],
            matterUpdates: [],
            dialogues: [{ actorId: actor, text: '你到了。' }],
          },
          randomUUID(),
        ),
      );
    }
    const parentCommand = randomUUID(),
      text = '我在火星边上，先聊聊。';
    const accepted =
      channel === 'group'
        ? await groups.send(owner, {
            worldId,
            groupId: thread,
            commandId: parentCommand,
            expectedVersion: version,
            text,
          })
        : await scenes.input(owner, worldId, thread, {
            commandId: parentCommand,
            expectedVersion: version,
            text,
            relatedMatterIds: [],
          });
    await tasks.cancel(owner, accepted.task!.id);
    const world = await worlds.get({ userId: owner }, worldId);
    const event = (
      await admin.query(
        'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND command_id=$2',
        [worldId, parentCommand],
      )
    ).rows[0].payload;
    const state = emptyActorAgentState(
      { worldId, actorId: actor },
      agentDefinitionRef(world, actor),
      world.version,
    );
    state.goals.push({
      id: 'private-goal',
      summary: 'PRIVATE_TRANSCRIPT_NEVER_IN_NATIVE_VIEW',
      status: 'active',
      sourceIds: ['private-source'],
      resultIds: [],
    });
    if (privateBasis) {
      state.goals[0]!.sourceIds = [privateBasis.id];
      state.goals[0]!.summary = 'Own continuing goal';
      state.plans.push({
        id: 'own-plan',
        goalId: state.goals[0]!.id,
        summary: 'Find an alternative without pressure',
        status: 'waiting',
        sourceIds: [privateBasis.id],
        actionIds: [],
        nextActionId: null,
        triggers: [],
        missingConditions: [],
      });
      state.responsibilities.push({
        id: 'private-request',
        revision: 0,
        subject: { kind: 'request', id: 'own-request' },
        summary: 'Respect the previous refusal',
        status: 'deferred',
        waitingOn: null,
        sourceIds: [privateBasis.id],
        nextCheck: [],
      });
      state.decisions.push({
        id: 'private-decision',
        responsibilityId: 'private-request',
        responsibilityRevision: 0,
        kind: 'declined',
        sourceId: privateBasis.id,
        quote: privateBasis.text,
      });
    }
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, owner, state);
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState(
          { worldId, actorId: other },
          agentDefinitionRef(world, other),
          world.version,
        ),
      );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: world.version,
      });
    });
    const input: AgentInputReceipt = {
      id: randomUUID(),
      worldId,
      commandId: parentCommand,
      inputHash: createHash('sha256')
        .update(JSON.stringify([parentCommand, text]))
        .digest('hex'),
      channel,
      threadId: thread,
      recipientActorId: null,
      expectedWorldVersion: world.version,
      origin: 'player',
      text,
      receivedAt: new Date().toISOString(),
      storyAt: event.storyAt,
    };
    await store.accept(owner, input);
    const snapshot = await readNativeAgentSnapshot(
      db,
      owner,
      world,
      actor,
      input,
      world.time,
      state,
    );
    const claim = {
      id: randomUUID(),
      worldId,
      actorId: actor,
      commandId: randomUUID(),
      inputReceiptId: input.id,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: 0,
      inputHash: input.inputHash,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    let attempt = (await store.claim(owner, claim)).attempt;
    attempt = await store.mark(owner, attempt, 'request_sent');
    attempt = await store.saveResponse(owner, attempt, { fixtureOnly: true });
    return { owner, actor, other, world, thread, input, snapshot, state, attempt };
  }

  for (const channel of ['group', 'scene'] as const)
    await t.test(`${channel}: native replies, proposed calendar, replay and rollback`, async () => {
      const f = await fixture(channel);
      assert.equal(f.snapshot.state.goals.length, 1);
      assert.equal(f.snapshot.viewState.goals.length, 0);
      assert(
        !JSON.stringify([f.snapshot.viewState, f.snapshot.observations]).includes(
          'PRIVATE_TRANSCRIPT',
        ),
      );
      assert(f.snapshot.observations.some((o) => o.text.includes('火星') && o.kind === 'speech'));
      assert(!f.snapshot.observations.some((o) => o.text.includes('火星') && o.kind === 'fact'));
      const statements: AgentStatement[] = [
        { text: '我听到了。', dependsOnActionIds: [] },
        { text: '我们再商量。', dependsOnActionIds: [] },
      ];
      const eventId = randomUUID(),
        storyAt = f.world.time;
      const after = structuredClone(f.state);
      after.revision++;
      after.projectedWorldVersion++;
      const transition: AgentRuntimeTransition = {
        schemaVersion: 1,
        engineEpoch: 2,
        inputReceiptId: f.input.id,
        inputStoryAt: f.input.storyAt,
        inputWorldVersion: f.input.expectedWorldVersion,
        actorRevisionBefore: 0,
        actorRevisionAfter: 1,
        proposal: {
          statements,
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        },
        results: [],
        stateAfter: after,
      };
      const invite: WorldEffect = {
        type: 'appointment.proposed',
        id: randomUUID(),
        title: '下次再聊',
        at: new Date(Date.parse(storyAt) + 3600000).toISOString(),
        participantIds: [f.actor],
      };
      const data = {
        attempt: f.attempt,
        snapshot: f.snapshot,
        transition,
        eventId,
        occurredAt: new Date().toISOString(),
        storyAt,
        effects: [invite],
        statements,
      };
      const beforeScene =
        channel === 'scene'
          ? await db.transaction(f.owner, (sql) => loadScene(sql, f.world.id, f.thread))
          : null;
      await assert.rejects(
        db.transaction(f.owner, async (sql) => {
          await beginAgentCommitInTransaction(sql, f.owner, f.attempt);
          await projectNativeAgentChannelInTransaction(sql, f.owner, data);
          throw Error('ROLLBACK_NATIVE');
        }),
        /ROLLBACK_NATIVE/,
      );
      assert.equal((await worlds.get({ userId: f.owner }, f.world.id)).version, f.world.version);
      assert.equal(
        (await admin.query('SELECT 1 FROM parallel_life.world_events WHERE id=$1', [eventId]))
          .rowCount,
        0,
      );
      await db.transaction(f.owner, async (sql) => {
        await beginAgentCommitInTransaction(sql, f.owner, f.attempt);
        await projectNativeAgentChannelInTransaction(sql, f.owner, data);
        await finishAgentCommitInTransaction(sql, f.owner, {
          attempt: f.attempt,
          eventId,
          state: after,
          results: [],
        });
      });
      const event = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [eventId])
      ).rows[0].payload as WorldHistoryEvent;
      assert.equal(
        event.type,
        channel === 'group' ? 'group.turn_resolved' : 'scene.reaction_recorded',
      );
      assert.equal(
        (
          await admin.query(
            "SELECT 1 FROM parallel_life.world_messages WHERE world_id=$1 AND document->>'sourceEventId'=$2",
            [f.world.id, eventId],
          )
        ).rowCount,
        0,
      );
      const persisted = await worlds.get({ userId: f.owner }, f.world.id);
      assert.equal(persisted.version, f.world.version + 1);
      assert(persisted.appointments.some((a) => a.id === invite.id && a.status === 'proposed'));
      const replayed = applyWorldHistoryEvent(f.world, event).state;
      assert.deepEqual(replayed.appointments, persisted.appointments);
      assert.equal(
        (await store.lookup(f.owner, f.world.id, f.attempt.commandId))!.status,
        'committed',
      );
      assert.equal(
        (await store.read(f.owner, { worldId: f.world.id, actorId: f.actor }))!.goals[0]!.summary,
        f.state.goals[0]!.summary,
      );
      if (channel === 'group') {
        const read = await groups.read(f.owner, f.world.id, f.thread);
        assert(read.messages.some((m) => m.text === statements.map((s) => s.text).join('\n')));
      } else {
        const read = await db.transaction(f.owner, (sql) => loadScene(sql, f.world.id, f.thread));
        assert.deepEqual(read.scene.presence, beforeScene!.scene.presence);
        assert.deepEqual(read.actions, beforeScene!.actions);
        assert.deepEqual(
          read.entries
            .filter((e) => e.sourceEventId === eventId)
            .map((e) => ('text' in e ? e.text : '')),
          statements.map((s) => s.text),
        );
      }
    });

  await t.test(
    'forged source text or mismatched state is rejected before a model or write',
    async () => {
      const f = await fixture('group');
      await assert.rejects(
        readNativeAgentSnapshot(
          db,
          f.owner,
          f.world,
          f.actor,
          { ...f.input, text: 'forged' },
          f.world.time,
          f.state,
        ),
      );
      await assert.rejects(
        readNativeAgentSnapshot(db, f.owner, f.world, f.other, f.input, f.world.time, f.state),
      );
    },
  );

  await t.test(
    'native group RLS rejects missing UoW, fake actor/body/thread and unfinished commits',
    async () => {
      const f = await fixture('group');
      const eventId = randomUUID(),
        statements: AgentStatement[] = [{ text: 'Actual actor reply.', dependsOnActionIds: [] }];
      const after = structuredClone(f.state);
      after.revision++;
      after.projectedWorldVersion++;
      const transition: AgentRuntimeTransition = {
        schemaVersion: 1,
        engineEpoch: 2,
        inputReceiptId: f.input.id,
        inputStoryAt: f.input.storyAt,
        inputWorldVersion: f.input.expectedWorldVersion,
        actorRevisionBefore: 0,
        actorRevisionAfter: 1,
        stateAfter: after,
        results: [],
        proposal: {
          statements,
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        },
      };
      const data = {
        attempt: f.attempt,
        snapshot: f.snapshot,
        transition,
        eventId,
        occurredAt: new Date().toISOString(),
        storyAt: f.world.time,
        effects: [],
        statements,
      };
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          projectNativeAgentChannelInTransaction(sql, f.owner, data),
        ),
        /AGENT_UOW_REQUIRED/,
      );
      for (const mutation of ['actor', 'body', 'thread', 'attempt'] as const) {
        await assert.rejects(
          db.transaction(f.owner, async (sql) => {
            await beginAgentCommitInTransaction(sql, f.owner, f.attempt);
            const proxy = Object.create(sql) as SqlClient;
            proxy.query = ((query: string, args?: unknown[]) => {
              if (query.includes('INSERT INTO parallel_life.world_group_messages')) {
                const values = [...args!],
                  doc = structuredClone(values[6]) as {
                    text: string;
                    sender: { actorId: string };
                    conversationId: string;
                  };
                if (mutation === 'actor') doc.sender.actorId = f.other;
                if (mutation === 'body') doc.text = 'Forged text';
                if (mutation === 'thread') {
                  values[3] = randomUUID();
                  doc.conversationId = String(values[3]);
                }
                values[6] = doc;
                if (mutation === 'attempt')
                  return sql
                    .query("SELECT set_config('app.agent_commit_attempt_id',$1,true)", [
                      randomUUID(),
                    ])
                    .then(() => sql.query(query, values));
                return sql.query(query, values);
              }
              return sql.query(query, args);
            }) as SqlClient['query'];
            await projectNativeAgentChannelInTransaction(proxy, f.owner, data);
          }),
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            ['42501', '23514', '23503'].includes(String(error.code)),
          mutation,
        );
      }
      await assert.rejects(
        db.transaction(f.owner, async (sql) => {
          await beginAgentCommitInTransaction(sql, f.owner, f.attempt);
          await projectNativeAgentChannelInTransaction(sql, f.owner, data);
        }),
        /AGENT_NATIVE_COMMIT_INCOMPLETE/,
      );
      assert.equal((await worlds.get({ userId: f.owner }, f.world.id)).version, f.world.version);
      assert.equal(
        (await admin.query('SELECT 1 FROM parallel_life.world_events WHERE id=$1', [eventId]))
          .rowCount,
        0,
      );
    },
  );

  await t.test(
    'own private strategy and refusal survive a group snapshot without the DM quote or another actor seeing them',
    async () => {
      const f = await fixture('group', true);
      assert.equal(f.snapshot.viewState.goals[0]!.summary, 'Own continuing goal');
      assert.equal(f.snapshot.viewState.plans[0]!.id, 'own-plan');
      assert.equal(f.snapshot.viewState.decisions[0]!.kind, 'declined');
      assert(f.snapshot.sources.some((s) => s.usage === 'private_strategy'));
      assert(!JSON.stringify(f.snapshot.observations).includes('ORIGINAL_PRIVATE_QUOTE'));
      let captured = '';
      const model = new NpcAgentModel({
        async complete(messages) {
          captured = messages[1]!.content;
          return '{"statements":[],"goals":[],"plans":[],"actions":[],"responsibilities":[],"decisions":[]}';
        },
      });
      await model.decide(f.snapshot);
      assert(!captured.includes('ORIGINAL_PRIVATE_QUOTE'));
      const payload = JSON.parse(captured);
      assert.equal(payload.state.decisions[0].kind, 'declined');
      assert.equal(payload.state.decisions[0].quote, '');
      assert.equal(payload.state.goals[0].summary, 'Own continuing goal');
      assert(f.snapshot.worldContext);
      const otherState = (await store.read(f.owner, { worldId: f.world.id, actorId: f.other }))!;
      const otherSnapshot = await readNativeAgentSnapshot(
        db,
        f.owner,
        f.world,
        f.other,
        f.input,
        f.world.time,
        otherState,
      );
      assert.equal(otherSnapshot.viewState.goals.length, 0);
      assert.equal(otherSnapshot.viewState.decisions.length, 0);
      assert(!otherSnapshot.sources.some((s) => s.usage === 'private_strategy'));
      assert.equal(f.snapshot.state.decisions[0]!.quote, 'ORIGINAL_PRIVATE_QUOTE_DO_NOT_SERIALIZE');
    },
  );
});
