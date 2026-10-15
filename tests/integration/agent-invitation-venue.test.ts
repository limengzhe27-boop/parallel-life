import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import type { SqlClient } from '../../src/modules/storage/infrastructure/postgres.ts';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresAppointmentWaitRepository } from '../../src/modules/world/infrastructure/appointment-wait-repository.ts';
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
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import {
  nativeNpcTaskHandler,
  nativeAgentCommandId,
} from '../../src/server/npc-agent-channel-services.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import {
  replayWorldHistory,
  type WorldHistoryEvent,
} from '../../src/modules/world/domain/world-history.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

// Actual SQL/app/worker/model adapter/kernel and projection. Explicit local fictional fixtures only.
const at = '2026-10-16T09:00:00.000Z',
  appointmentAt = '2026-10-16T10:00:00.000Z';
const successfulSpeech = 'VENUE78_DEPENDENT_SUCCESS',
  independentSpeech = 'VENUE78_INDEPENDENT_REPLY';
const empty = (): AgentProposal => ({
  statements: [],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});
const code = (value: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === value;
const api = (value: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'apiCode' in error && error.apiCode === value;
function proposal(sourceId: string, placeId?: string, silent = false): AgentProposal {
  return {
    ...empty(),
    goals: [
      {
        id: 'invite_goal',
        summary: 'Consider a voluntary future meeting',
        status: 'active',
        sourceIds: [sourceId],
        resultIds: [],
      },
    ],
    actions: [
      {
        id: 'invite_action',
        goalId: 'invite_goal',
        capability: 'appointment.propose',
        status: 'ready',
        targetIds: [],
        parameters: {
          title: 'Explicit local optional invitation',
          at: appointmentAt,
          ...(placeId === undefined ? {} : { placeId }),
        },
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        sourceIds: [sourceId],
      },
    ],
    statements: silent
      ? []
      : [
          { text: successfulSpeech, dependsOnActionIds: ['invite_action'] },
          { text: independentSpeech, dependsOnActionIds: [] },
        ],
  };
}

test('NPC invitation venues use actual event/map/calendar projections without inventing attendance', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_INVITATION_VENUE_TEST_PORT ?? 55505));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    actors = new PostgresAgentRuntimeRepository(db),
    groups = new PostgresGroupRepository(db),
    tasks = new TaskRepository(db),
    space = new PostgresWorldSpace(db, {
      list() {
        return [];
      },
      get() {
        return undefined;
      },
    }),
    wait = new PostgresAppointmentWaitRepository(db),
    snapshots = new PostgresDirectorSnapshotRepository(db);
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  async function fixture(silent = false) {
    const owner = randomUUID(),
      id = randomUUID(),
      actor = randomUUID(),
      other = randomUUID(),
      source = { kind: 'seed_genesis' as const, seedId: randomUUID(), snapshotVersion: 0 as const };
    await new IdentityRepository(db).ensureGuest(owner);
    owned.push({ owner, id });
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      time: at,
      title: 'Explicit local invitation venue',
      actors: [
        { id: actor, name: '甲', persona: 'Voluntary, independent plans.' },
        { id: other, name: '乙', persona: 'Independent plans.' },
      ],
      facts: [
        {
          id: 'basis',
          kind: 'canonical',
          text: 'A synthetic starting basis for an independent future invitation.',
          visibility: { kind: 'world' },
          sourceEventId: `genesis:${id}`,
        },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'home',
        positionSource: source,
        places: ['home', 'cafe'].map((id) => ({
          id,
          name: id === 'home' ? 'Local home' : 'Local cafe',
          description: 'Explicit known fictional place',
          source,
          contactActorIds: [],
          appointmentIds: [],
        })),
        routes: [
          {
            id: 'home_cafe',
            fromPlaceId: 'home',
            toPlaceId: 'cafe',
            durationMinutes: 5,
            modeLabel: 'Walk',
            source,
          },
        ],
      },
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const a of world.actors) {
        const state = emptyActorAgentState(
          { worldId: id, actorId: a.id },
          agentDefinitionRef(world, a.id),
          0,
        );
        if (silent && a.id === actor) {
          const p = proposal('fact:basis', 'cafe', true);
          state.goals = p.goals;
          state.actions = p.actions;
          state.plans.push({
            id: 'invite_plan',
            goalId: 'invite_goal',
            summary: 'Consider my own future invitation',
            status: 'active',
            sourceIds: ['fact:basis'],
            actionIds: ['invite_action'],
            nextActionId: 'invite_action',
            triggers: [],
            missingConditions: [],
          });
        }
        await initializeActorAgentStateInTransaction(sql, owner, state);
      }
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    await clocks.write(owner, id, {
      storyNow: at,
      speed: 0,
      paused: false,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    return {
      owner,
      id,
      actor,
      other,
      world,
      command: {
        id: randomUUID(),
        worldId: id,
        actorId: actor,
        expectedVersion: 0,
        text: 'Consider a future meeting only if you want to.',
      },
    };
  }
  async function publishedHiddenFixture() {
    class LocalPublisher extends PostgresDatabase {
      override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
        return super.transaction(owner, async (sql) => {
          await sql.query('SET LOCAL ROLE pl_publisher');
          return run(sql);
        });
      }
    }
    const pub = new LocalPublisher(
      `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
    t.after(() => pub.close());
    const staff = randomUUID();
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [staff, 'Explicit local hidden venue fixture'],
    );
    const trialReceipt = randomUUID(),
      works = new PublicationRepository(pub, {
        async review({ content }) {
          return {
            reviewerVersion: 'EXPLICIT_LOCAL_VENUE78_FIXTURE',
            runtimeCapabilities: new Set(
              inspectPublishedWorldSupport(content).requiredCapabilities,
            ),
            media: { verified: true, manifestHash: 'a'.repeat(64) },
            trial: { verified: true, receiptId: trialReceipt },
          };
        },
      });
    const compiler: PublicationWorldCompilerPort = {
      prepare(input) {
        const r = compilePublicationGenesis({
          ...input,
          originKind: input.originKind === 'trial' ? 'trial' : 'published',
          newId: randomUUID,
        });
        assert.equal(r.status, 'compiled');
        if (r.status !== 'compiled') throw Error('EXPLICIT_VENUE78_COMPILER_FAILURE');
        return {
          world: r.world,
          opening: r.opening,
          seed: {
            id: input.seedId,
            createdAt: new Date().toISOString(),
            source: {
              kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
              ...input.origin,
            },
            identity: r.opening.identity,
            situation: r.opening.situation,
            setting: r.opening.setting,
            experienceNote: r.opening.experienceNote,
          },
        };
      },
    };
    const raw = await readFile(
        new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
        'utf8',
      ),
      content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
    content.world.startAt = at;
    content.places.push({
      key: 'hidden_place',
      name: 'VENUE78_REAL_AUTHOR_HIDDEN_PLACE',
      description: 'Author-only unrevealed venue',
      knownAtStart: false,
    });
    content.candidates = [
      {
        key: 'opening',
        kind: 'candidate',
        title: 'Explicit opening',
        editorialIntent: 'Only a local fixture',
        actorKeys: [],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
      },
    ];
    content.openingEventKey = 'opening';
    const work = await works.create(staff, {
        commandId: randomUUID(),
        title: 'Only local hidden venue',
        content: PublishedWorldContentSchema.parse(content),
      }),
      checked = await works.check(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
      });
    assert.equal(checked.status, 'ready');
    await works.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: checked.id,
    });
    const owner = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const { worldId: id } = await new PublicationWorldRepository(db, compiler).startPublished(
      owner,
      work.id,
      { commandId: randomUUID(), publicationVersion: 1 },
    );
    owned.push({ owner, id });
    const world = await worlds.get({ userId: owner }, id),
      actor = world.actors[0]!.id,
      other = world.actors[1]!.id;
    assert.equal(
      world.space!.places.some((p) => p.id === 'hidden_place'),
      false,
    );
    await db.transaction(owner, async (sql) => {
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId: id, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    await clocks.write(owner, id, {
      storyNow: at,
      speed: 0,
      paused: false,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    return {
      owner,
      id,
      actor,
      other,
      world,
      command: {
        id: randomUUID(),
        worldId: id,
        actorId: actor,
        expectedVersion: 0,
        text: 'Consider a future meeting only if you want to.',
      },
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function attempts(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 ORDER BY created_at,id',
        [f.id],
      )
    ).rows;
  }
  async function events(f: Fixture) {
    return (
      await admin.query(
        'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
        [f.id],
      )
    ).rows.map((r) => r.payload as WorldHistoryEvent);
  }
  async function business(f: Fixture) {
    const out: Record<string, unknown> = {
      world: (
        await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [f.id])
      ).rows,
    };
    for (const table of [
      'world_events',
      'world_messages',
      'world_appointments',
      'actor_agent_states',
      'agent_action_results',
      'commands',
      'world_group_messages',
      'world_notes',
      'npc_journeys',
    ])
      out[table] = (
        await admin.query(
          `SELECT to_jsonb(x) row FROM parallel_life.${table} x WHERE world_id=$1 ORDER BY to_jsonb(x)::text`,
          [f.id],
        )
      ).rows;
    return out;
  }
  function service(placeId?: string) {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      api: npcAgentServices(db, () => ({
        async complete(messages) {
          calls++;
          assert.equal(db.pool.totalCount, db.pool.idleCount);
          const p = JSON.parse(messages[1]!.content);
          if (placeId === 'hidden_place') {
            assert.equal(messages[1]!.content.includes('VENUE78_REAL_AUTHOR_HIDDEN_PLACE'), false);
            assert.equal(p.worldContext.boundary.placeIds.includes(placeId), false);
          }
          return JSON.stringify(proposal(p.input.sourceId, placeId));
        },
      })),
    };
  }
  async function assertVenue(f: Fixture, eventId: string, type: string, venue = 'cafe') {
    const world = await worlds.get({ userId: f.owner }, f.id);
    assert.equal(world.appointments.length, 1);
    const ap = world.appointments[0]!;
    assert.equal(ap.status, 'proposed');
    assert.equal(ap.at, appointmentAt);
    assert.deepEqual(ap.participantIds, [f.actor]);
    assert.equal(ap.sourceEventId, eventId);
    assert.equal(ap.responseVersion, undefined);
    assert.equal(ap.responseAt, undefined);
    assert.equal(world.space!.currentPlaceId, 'home');
    assert.equal(world.time, at);
    assert.deepEqual(
      world.space!.places.map((p) => p.id),
      ['home', 'cafe'],
    );
    assert.deepEqual(
      world.space!.places.filter((p) => p.appointmentIds.includes(ap.id)).map((p) => p.id),
      [venue],
    );
    const event = (await events(f)).find((e) => e.id === eventId)!;
    assert.equal(event.type, type);
    const data = event.data as {
      effects?: { type: string; id: string; placeId?: string }[];
      agentRuntime?: {
        results: {
          outcome: string;
          outputRefs: { kind: string; id: string }[];
          completedGoalIds: string[];
        }[];
      };
    };
    const effect = data.effects!.find((e) => e.type === 'appointment.proposed')!;
    assert.equal(effect.id, ap.id);
    assert.equal(effect.placeId, venue);
    const result = data.agentRuntime!.results[0]!;
    assert.equal(result.outcome, 'succeeded');
    assert.deepEqual(result.outputRefs, [{ kind: 'appointment', id: ap.id }]);
    assert.deepEqual(result.completedGoalIds, []);
    const state = (await actors.read(f.owner, { worldId: f.id, actorId: f.actor }))!;
    assert.equal(state.goals.find((g) => g.id === 'invite_goal')!.status, 'active');
    const responsibility = state.responsibilities.find((r) => r.subject.id === ap.id)!;
    assert.equal(responsibility.status, 'waiting');
    assert.equal(responsibility.waitingOn, 'player');
    assert.equal(responsibility.deadline, undefined);
    assert.deepEqual(responsibility.nextCheck, []);
    assert.deepEqual(state.decisions, []);
    assert.equal((await clocks.read(f.owner, f.id)).storyNow, at);
    const map = await space.read(f.owner, f.id);
    assert.equal(map.currentPlaceId, 'home');
    assert.deepEqual(
      map.places.filter((p) => p.appointmentIds.includes(ap.id)).map((p) => p.id),
      [venue],
    );
    const replay = replayWorldHistory(f.world, await events(f)).world;
    assert.deepEqual(replay.appointments, world.appointments);
    assert.deepEqual(replay.space, world.space);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.npc_journeys WHERE world_id=$1',
          [f.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key LIKE 'actor:%'",
          [f.id],
        )
      ).rows[0].n,
      0,
    );
    return { world, ap, event };
  }
  async function execution(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.id),
      state = (await actors.read(f.owner, { worldId: f.id, actorId: f.actor }))!,
      text = f.command.text,
      input: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.id,
        commandId: f.command.id,
        channel: 'private',
        threadId: f.actor,
        recipientActorId: f.actor,
        expectedWorldVersion: world.version,
        origin: 'player',
        text,
        inputHash: createHash('sha256').update(text).digest('hex'),
        receivedAt: new Date().toISOString(),
        storyAt: world.time,
      };
    await actors.accept(f.owner, input);
    const { snapshot } = await readPrivateAgentSnapshot(
      db,
      f.owner,
      world,
      f.actor,
      input,
      world.time,
      state,
    );
    const claim = {
      id: randomUUID(),
      worldId: f.id,
      actorId: f.actor,
      commandId: input.commandId,
      inputReceiptId: input.id,
      inputHash: input.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    };
    return { input, snapshot, claim };
  }

  await t.test(
    'actual private invitation binds known venue in the same event, map and proposed calendar; exact replay is free',
    async () => {
      const f = await fixture(),
        h = service('cafe'),
        beforeClock = await clocks.read(f.owner, f.id),
        r = await h.api.sendMessageIfEnabled(f.owner, f.command);
      assert.equal(h.calls, 1);
      const { ap } = await assertVenue(f, r!.eventId, 'turn.resolved');
      const projection = (
        await admin.query(
          'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 AND id=$2',
          [f.id, ap.id],
        )
      ).rows[0].document;
      assert.equal(projection.sourceEventId, r!.eventId);
      const before = await business(f),
        afterClock = await clocks.read(f.owner, f.id);
      assert.equal(afterClock.storyNow, beforeClock.storyNow);
      assert.equal(afterClock.speed, beforeClock.speed);
      assert.equal(afterClock.paused, beforeClock.paused);
      assert.deepEqual(await h.api.sendMessageIfEnabled(f.owner, f.command), r);
      assert.equal(h.calls, 1);
      assert.deepEqual(await business(f), before);
      assert.deepEqual(await clocks.read(f.owner, f.id), afterClock);
      assert.equal((await attempts(f)).length, 1);
    },
  );
  await t.test(
    'silent actual advance commits venue association without making a private message or advancing time',
    async () => {
      const f = await fixture(true);
      let calls = 0;
      const h = npcAgentAdvanceServices(
        db,
        () => ({
          async complete(messages) {
            calls++;
            assert.equal(db.pool.totalCount, db.pool.idleCount);
            const p = JSON.parse(messages[1]!.content);
            assert.match(p.promptVersion, /^npc-agent-/);
            assert.equal(p.input.origin, 'wake');
            return JSON.stringify({
              ...empty(),
              goals: p.state.goals,
              plans: p.state.plans,
              actions: p.state.actions,
            });
          },
        }),
        snapshots,
      );
      const result = await h.advanceIfEnabled(f.owner, f.id);
      assert.equal(result?.played, 0);
      assert.deepEqual(result?.actors, []);
      assert.equal(calls, 1);
      const a = (await attempts(f))[0];
      assert.equal(a.status, 'committed');
      await assertVenue(f, a.event_id, 'agent.state_committed');
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'actual native group task uses the same venue effect and history projection without private-message fallback',
    async () => {
      const f = await fixture(),
        g = await groups.create(f.owner, {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          title: 'Local venue group',
          actorIds: [f.actor, f.other],
        }),
        sent = await groups.send(f.owner, {
          worldId: f.id,
          groupId: g.groupId,
          commandId: randomUUID(),
          expectedVersion: g.version,
          text: '@甲 Consider a later meeting.',
        }),
        lease = (await queue.claimForOwner(sent.task.id, f.owner, ['world']))!;
      let calls = 0;
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete(messages) {
          calls++;
          assert.equal(db.pool.totalCount, db.pool.idleCount);
          const p = JSON.parse(messages[1]!.content);
          assert.equal(p.channel.kind, 'group');
          return JSON.stringify(proposal(p.input.sourceId, 'cafe'));
        },
      }));
      await handler(lease, new AbortController().signal);
      assert.equal(calls, 1);
      const a = (await actors.lookup(f.owner, f.id, nativeAgentCommandId(sent.task.id, f.actor)))!;
      await assertVenue(f, a.eventId!, 'group.turn_resolved');
      assert.equal((await tasks.get(f.owner, sent.task.id)).status, 'succeeded');
      const read = await groups.read(f.owner, f.id, g.groupId);
      assert.ok(read.messages.some((m) => m.text.includes(successfulSpeech)));
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(handler(lease, new AbortController().signal), code('NOT_FOUND'));
      assert.equal(calls, 1);
      assert.equal((await attempts(f)).length, 1);
    },
  );
  await t.test(
    'omitting placeId preserves the old successful invitation shape and creates no inferred venue',
    async () => {
      const f = await fixture(),
        h = service(),
        r = await h.api.sendMessageIfEnabled(f.owner, f.command),
        world = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(h.calls, 1);
      assert.equal(world.appointments.length, 1);
      assert.equal(world.appointments[0]!.status, 'proposed');
      assert.deepEqual(world.space, f.world.space);
      const event = (await events(f)).find((e) => e.id === r!.eventId)!;
      const effect = (event.data as any).effects.find(
        (e: { type: string }) => e.type === 'appointment.proposed',
      );
      assert.equal('placeId' in effect, false);
      assert.deepEqual(replayWorldHistory(f.world, await events(f)).world.space, f.world.space);
    },
  );
  for (const venue of ['unknown_place', 'hidden_place'])
    await t.test(
      `${venue} fails only its action, hides dependent success speech, retains independent valid reply`,
      async () => {
        const f = venue === 'hidden_place' ? await publishedHiddenFixture() : await fixture(),
          h = service(venue),
          r = await h.api.sendMessageIfEnabled(f.owner, f.command);
        assert.equal(h.calls, 1);
        assert.equal(r?.status, 'committed');
        const world = await worlds.get({ userId: f.owner }, f.id);
        assert.deepEqual(world.space, f.world.space);
        assert.deepEqual(world.appointments, []);
        assert.deepEqual(world.facts, f.world.facts);
        assert.equal(world.time, at);
        assert.equal(
          world.messages.some((m) => m.text.includes(successfulSpeech)),
          false,
        );
        assert.ok(world.messages.some((m) => m.text.includes(independentSpeech)));
        const state = (await actors.read(f.owner, { worldId: f.id, actorId: f.actor }))!;
        assert.equal(state.actions[0]!.status, 'failed');
        assert.equal(state.goals[0]!.status, 'active');
        assert.equal(state.responsibilities.length, 0);
        const results = (
          await admin.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1',
            [f.id],
          )
        ).rows;
        assert.equal(results.length, 1);
        assert.equal(results[0].document.outcome, 'failed');
        assert.equal(results[0].document.failureCode, 'APPOINTMENT_PLACE_NOT_AVAILABLE');
        assert.deepEqual(results[0].document.outputRefs, []);
        assert.deepEqual(results[0].document.completedGoalIds, []);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM parallel_life.world_appointments WHERE world_id=$1',
              [f.id],
            )
          ).rows[0].n,
          0,
        );
      },
    );
  for (const forged of ['remove_actual', 'add_nonexistent'] as const)
    await t.test(`prepared snapshot ${forged} cannot grant venue authority by itself`, async () => {
      const f = await fixture(),
        e = await execution(f);
      assert.ok(e.snapshot.worldContext);
      const venue = forged === 'remove_actual' ? 'cafe' : 'forged_place';
      e.snapshot.worldContext.boundary.placeIds =
        forged === 'remove_actual'
          ? e.snapshot.worldContext.boundary.placeIds.filter((p) => p !== 'cafe')
          : [...e.snapshot.worldContext.boundary.placeIds, venue];
      let calls = 0;
      const r = await runNpcAgent(
        {
          attempts: actors,
          model: new NpcAgentModel({
            async complete() {
              calls++;
              return JSON.stringify(proposal(e.input.id, venue));
            },
          }),
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        f.owner,
        e.claim,
        e.snapshot,
      );
      assert.equal(calls, 1);
      assert.equal(r.results[0]!.outcome, 'failed');
      assert.equal(r.results[0]!.failureCode, 'APPOINTMENT_PLACE_NOT_AVAILABLE');
      const world = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(world.appointments.length, 0);
      assert.deepEqual(world.space, f.world.space);
      assert.equal(
        world.messages.some((m) => m.text.includes(successfulSpeech)),
        false,
      );
    });
  await t.test(
    'late actual action-result SQL fault rolls back venue/calendar/message/state and recovers identical protected raw free',
    async () => {
      const f = await fixture(),
        h = service('cafe'),
        name = `venue78_${randomUUID().replaceAll('-', '')}`,
        before = await business(f);
      await admin.query(
        `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VENUE78_LATE_RESULT_FAILURE'; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.agent_action_results FOR EACH ROW WHEN (NEW.world_id='${f.id}') EXECUTE FUNCTION parallel_life.${name}()`,
      );
      try {
        await assert.rejects(h.api.sendMessageIfEnabled(f.owner, f.command), api('UNKNOWN'));
        const row = (await attempts(f))[0];
        assert.equal(row.status, 'response_received');
        assert.ok(row.sent_at);
        assert.ok(row.response_hash);
        assert.deepEqual(await business(f), before);
        assert.equal(h.calls, 1);
      } finally {
        await admin.query(`DROP TRIGGER ${name} ON parallel_life.agent_action_results`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
      }
      const old = (await attempts(f))[0],
        saved = await actors.readResponse(
          f.owner,
          (await actors.lookup(f.owner, f.id, f.command.id))!,
        );
      const r = await h.api.sendMessageIfEnabled(f.owner, f.command);
      assert.equal(h.calls, 1);
      const now = (await attempts(f))[0];
      assert.equal(now.id, old.id);
      assert.equal(now.input_receipt_id, old.input_receipt_id);
      assert.equal(now.response_hash, old.response_hash);
      assert.deepEqual(
        await actors.readResponse(f.owner, (await actors.lookup(f.owner, f.id, f.command.id))!),
        saved,
      );
      await assertVenue(f, r!.eventId, 'turn.resolved');
      assert.equal((await attempts(f)).length, 1);
    },
  );
  await t.test(
    'old map/calendar/wait interfaces consume the link only after explicit player accept and actual travel; waiting is not attendance',
    async () => {
      const f = await fixture(),
        h = service('cafe'),
        r = await h.api.sendMessageIfEnabled(f.owner, f.command),
        { ap } = await assertVenue(f, r!.eventId, 'turn.resolved');
      await assert.rejects(
        wait.wait(f.owner, f.id, {
          commandId: randomUUID(),
          expectedVersion: 1,
          invitationId: ap.id,
        }),
        (e) => !!e && typeof e === 'object' && 'reason' in e && e.reason === 'UNCONFIRMED',
      );
      let world = await worlds.respondToInvitation(
        { userId: f.owner },
        {
          commandId: randomUUID(),
          worldId: f.id,
          expectedVersion: 1,
          id: ap.id,
          operation: 'accept',
        },
      );
      assert.equal(world.appointments[0]!.status, 'confirmed');
      assert.equal(world.space!.currentPlaceId, 'home');
      await assert.rejects(
        wait.wait(f.owner, f.id, {
          commandId: randomUUID(),
          expectedVersion: world.version,
          invitationId: ap.id,
        }),
        (e) => !!e && typeof e === 'object' && 'reason' in e && e.reason === 'NOT_AT_PLACE',
      );
      const moved = await space.travel(f.owner, f.id, {
          commandId: randomUUID(),
          expectedVersion: world.version,
          routeId: 'home_cafe',
        }),
        input = { commandId: randomUUID(), expectedVersion: moved.version, invitationId: ap.id },
        waited = await wait.wait(f.owner, f.id, input);
      assert.equal(waited.placeId, 'cafe');
      assert.equal(waited.storyNow, appointmentAt);
      assert.deepEqual(await wait.wait(f.owner, f.id, input), waited);
      world = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(world.appointments[0]!.status, 'confirmed');
      assert.equal(world.space!.currentPlaceId, 'cafe');
      assert.equal(
        (await actors.read(f.owner, { worldId: f.id, actorId: f.actor }))!.goals[0]!.status,
        'active',
      );
      const replay = replayWorldHistory(f.world, await events(f)).world;
      assert.deepEqual(replay.space, world.space);
      assert.deepEqual(replay.appointments, world.appointments);
      assert.equal(h.calls, 1);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.npc_journeys WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});
