import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  emptyActorAgentState,
  type AgentInputReceipt,
  type AgentActionResult,
  type AgentAction,
  type AgentAttempt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  prepareAgentTravel,
  commitAgentDeparture,
  evaluateAgentArrival,
  commitAgentArrival,
  agentArrivalCommandId,
  type AgentJourney,
} from '../../src/modules/world/domain/agent-travel.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  beginAgentCommitInTransaction,
  finishAgentCommitInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  recordAgentDepartureInTransaction,
  recordAgentArrivalInTransaction,
  PostgresAgentJourneyRepository,
} from '../../src/modules/world/infrastructure/agent-journey-repository.ts';
const at = '2026-10-15T09:00:00.000Z',
  due = '2026-10-15T09:15:00.000Z';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('journey ledger authenticates physical travel and independent arrival in real transactions', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.AGENT_JOURNEY_TEST_PORT ?? 55503));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await worker.close();
    await app.close();
    await admin.end();
  });
  const store = new PostgresAgentRuntimeRepository(app),
    repo = new PostgresAgentJourneyRepository(app);
  async function fixture(routeEvent?: 'setup' | { eventId: string; eventVersion: number }) {
    const owner = randomUUID(),
      actor = randomUUID(),
      worldId = randomUUID(),
      setup = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const route = {
      id: 'route',
      fromPlaceId: 'shop',
      toPlaceId: 'park',
      durationMinutes: 15,
      modeLabel: '步行',
      source: routeEvent
        ? {
            kind: 'world_event' as const,
            snapshotVersion: 0 as const,
            eventId: routeEvent === 'setup' ? setup : routeEvent.eventId,
            eventVersion: routeEvent === 'setup' ? 1 : routeEvent.eventVersion,
          }
        : source,
    };
    const world = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: 'Synthetic journey persistence fixture',
      version: 0,
      time: at,
      actors: [{ id: actor, name: '甲', persona: '有自己的安排' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        places: ['shop', 'park'].map((id) => ({
          id,
          name: id,
          description: '合成地点',
          source,
          contactActorIds: [],
          appointmentIds: [],
        })),
        routes: [route],
        currentPlaceId: 'shop',
        positionSource: source,
      },
    };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [worldId, owner, world.title, world],
    );
    const setupCommand = randomUUID();
    await admin.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,0,$4,'{}','running')",
      [setupCommand, worldId, owner, hash('setup')],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,$4,$5,$6)',
      [
        setup,
        worldId,
        owner,
        setupCommand,
        {
          id: setup,
          worldId,
          commandId: setupCommand,
          version: 1,
          type: 'test.fixture_setup',
          storyAt: at,
          data: { actorId: actor },
        },
        at,
      ],
    );
    const current = { ...world, version: 1 };
    await admin.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
      [worldId, setupCommand, setup, current],
    );
    await admin.query('UPDATE parallel_life.worlds SET version=1,state=$2 WHERE id=$1', [
      worldId,
      current,
    ]);
    const state = emptyActorAgentState({ worldId, actorId: actor }, 'authored:journey_fixture', 1);
    state.goals.push({
      id: 'goal',
      summary: '去公园',
      status: 'active',
      sourceIds: [],
      resultIds: [],
    });
    const position = {
      worldId,
      subject: { kind: 'actor' as const, actorId: actor },
      status: 'at' as const,
      placeId: 'shop',
      sourceEventId: setup,
      worldVersion: 1,
      occurredAt: at,
    };
    await app.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, owner, state);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });
      await sql.query(
        'INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,$3,$4,1,$5)',
        [worldId, owner, 'actor:' + actor, setup, position],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at) VALUES($1,$2,$3,1,false,$3)',
        [worldId, owner, at],
      );
    });
    const input: AgentInputReceipt = {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: hash('actual synthetic input'),
      channel: 'private',
      threadId: actor,
      recipientActorId: actor,
      expectedWorldVersion: 1,
      receivedAt: at,
      storyAt: at,
      origin: 'player',
      text: '你按自己的安排出门吧。',
    };
    await store.accept(owner, input);
    let attempt = (
      await store.claim(owner, {
        id: randomUUID(),
        worldId,
        actorId: actor,
        commandId: randomUUID(),
        inputReceiptId: input.id,
        engineEpoch: 2,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: input.inputHash,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      })
    ).attempt;
    attempt = await store.mark(owner, attempt, 'request_sent');
    attempt = await store.saveResponse(owner, attempt, { syntheticLocalProposal: true });
    const action: AgentAction = {
      id: randomUUID(),
      goalId: 'goal',
      capability: 'travel.begin',
      targetIds: [],
      parameters: { routeId: route.id },
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      status: 'proposed',
      sourceIds: [],
    };
    const p = prepareAgentTravel({
      frame: { worldId, actorId: actor, worldVersion: 1, storyAt: at },
      boundary: {
        worldId,
        actorIds: [actor],
        placeIds: ['shop', 'park'],
        capabilityIds: ['travel.begin'],
        extensionPermission: 'none',
        createdFromVersion: 1,
        sourceEventId: setup,
      },
      ownPosition: position,
      routes: [route],
      intent: { journeyId: randomUUID(), actionId: action.id, routeId: route.id },
      existingJourneys: [],
    });
    if (p.status !== 'ready') throw Error('plan not ready');
    const result: AgentActionResult = {
      worldId,
      actorId: actor,
      id: randomUUID(),
      actionId: action.id,
      eventId: randomUUID(),
      worldVersion: 2,
      at,
      outcome: 'succeeded',
      handledResponsibilityIds: [],
      evidenceSourceIds: [setup],
    };
    const start = commitAgentDeparture(p.plan, result);
    if (start.status !== 'in_transit') throw Error('start not ready');
    return {
      owner,
      actor,
      worldId,
      state,
      world: current,
      position,
      input,
      attempt,
      action,
      result,
      journey: start.journey,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function event(
    sql: SqlClient,
    f: Fixture,
    input: {
      id: string;
      commandId: string;
      version: number;
      storyAt: string;
      type: string;
      data: unknown;
    },
  ) {
    const next = { ...f.world, version: input.version, time: input.storyAt };
    await sql.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,'{}','running')",
      [input.commandId, f.worldId, f.owner, input.version - 1, hash(input.commandId)],
    );
    await sql.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        input.id,
        f.worldId,
        f.owner,
        input.version,
        input.commandId,
        { schemaVersion: 1, ...input, worldId: f.worldId, occurredAt: at },
        at,
      ],
    );
    await sql.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
      [f.worldId, input.commandId, input.id, next],
    );
    await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
      f.worldId,
      input.version,
      next,
    ]);
    await sql.query(
      'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), f.worldId, f.owner, input.id, { kind: 'journey_fixture' }],
    );
  }
  async function departure(
    sql: SqlClient,
    f: Fixture,
    options: {
      capability?: string;
      omitEffect?: boolean;
      effectJourney?: AgentJourney;
      omitFinish?: boolean;
      record?: boolean;
      additional?: { action: AgentAction; result: AgentActionResult; journey: AgentJourney };
    } = {},
  ) {
    await beginAgentCommitInTransaction(sql, f.owner, f.attempt);
    const proposed = { ...f.action, capability: options.capability ?? f.action.capability };
    const actions = [proposed, ...(options.additional ? [options.additional.action] : [])];
    const results = [f.result, ...(options.additional ? [options.additional.result] : [])];
    const stateAfter = {
      ...f.state,
      revision: 1,
      projectedWorldVersion: 2,
      actions: actions.map((action, i) => ({
        ...action,
        status: 'succeeded' as const,
        resultId: results[i]!.id,
      })),
    };
    const runtime = {
      schemaVersion: 1,
      engineEpoch: 2,
      inputReceiptId: f.input.id,
      inputStoryAt: at,
      inputWorldVersion: 1,
      actorRevisionBefore: 0,
      actorRevisionAfter: 1,
      proposal: {
        statements: [],
        goals: [],
        plans: [],
        actions,
        responsibilities: [],
        decisions: [],
      },
      results,
      stateAfter,
      departures: options.omitEffect
        ? []
        : [
            options.effectJourney ?? f.journey,
            ...(options.additional ? [options.additional.journey] : []),
          ],
    };
    await event(sql, f, {
      id: f.result.eventId,
      commandId: f.attempt.commandId,
      version: 2,
      storyAt: at,
      type: 'agent.state_committed',
      data: { actorId: f.actor, agentRuntime: runtime },
    });
    if (!options.omitFinish)
      await finishAgentCommitInTransaction(sql, f.owner, {
        attempt: f.attempt,
        eventId: f.result.eventId,
        state: stateAfter,
        results,
      });
    if (options.record !== false)
      return recordAgentDepartureInTransaction(sql, f.owner, {
        attempt: f.attempt,
        journey: f.journey,
      });
  }
  async function inTransit(sql: SqlClient, f: Fixture) {
    const position = {
      ...f.position,
      status: 'in_transit',
      placeId: null,
      sourceEventId: f.result.eventId,
      worldVersion: 2,
      occurredAt: at,
    };
    await sql.query(
      'UPDATE parallel_life.world_authoritative_positions SET source_event_id=$4,source_version=2,document=$5 WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3',
      [f.worldId, f.owner, 'actor:' + f.actor, f.result.eventId, position],
    );
  }
  function arrival(f: Fixture, storyAt = due): AgentJourney {
    const evaluated = evaluateAgentArrival({
      frame: { worldId: f.worldId, actorId: f.actor, worldVersion: 2, storyAt },
      journey: f.journey,
      ownPosition: {
        ...f.position,
        status: 'in_transit',
        placeId: null,
        sourceEventId: f.result.eventId,
        worldVersion: 2,
        occurredAt: at,
      },
    });
    if (evaluated.status !== 'ready') throw Error('arrival not ready');
    const done = commitAgentArrival(evaluated.continuation, {
      worldId: f.worldId,
      actorId: f.actor,
      id: randomUUID(),
      commandId: agentArrivalCommandId(f.journey.id),
      eventId: randomUUID(),
      worldVersion: 3,
      at: storyAt,
      journeyId: f.journey.id,
    });
    if (done.status !== 'arrived') throw Error('arrival not committed');
    return done.journey;
  }
  async function arrivalEvent(
    sql: SqlClient,
    f: Fixture,
    journey: AgentJourney,
    options: {
      wrongType?: boolean;
      wrongRoute?: boolean;
      wrongSource?: boolean;
      clockAt?: string;
      paused?: boolean;
    } = {},
  ) {
    if (journey.status !== 'arrived') throw Error('not arrived');
    await sql.query(
      "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch','2',true),set_config('app.agent_commit_attempt_id','',true)",
      [f.worldId],
    );
    await sql.query(
      'UPDATE parallel_life.world_clock SET story_now=$3,paused=$4 WHERE world_id=$1 AND owner_id=$2',
      [f.worldId, f.owner, options.clockAt ?? journey.arrival.at, options.paused ?? false],
    );
    await event(sql, f, {
      id: journey.arrival.eventId,
      commandId: journey.arrival.commandId,
      version: 3,
      storyAt: journey.arrival.at,
      type: options.wrongType ? 'turn.resolved' : 'agent.arrival_committed',
      data: {
        actorId: f.actor,
        journeyId: f.journey.id,
        departureEventId: options.wrongSource ? 'made_up' : f.result.eventId,
        route: options.wrongRoute
          ? { ...f.journey.route, toPlaceId: 'elsewhere' }
          : f.journey.route,
        arrival: journey.arrival,
      },
    });
  }
  await t.test(
    'actual finished travel effect stores one immutable departure, replay is read-only',
    async () => {
      const f = await fixture();
      const result = await app.transaction(f.owner, async (sql) => {
        const r = await departure(sql, f);
        await inTransit(sql, f);
        return r;
      });
      assert.equal(result?.status, 'recorded');
      const replay = await app.transaction(f.owner, (sql) =>
        recordAgentDepartureInTransaction(sql, f.owner, { attempt: f.attempt, journey: f.journey }),
      );
      assert.equal(replay.status, 'replayed');
      assert.deepEqual(await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }), [
        f.journey,
      ]);
      assert.deepEqual(await repo.readOwn(f.owner, { worldId: f.worldId, actorId: 'other' }), []);
      assert.deepEqual(await repo.readDue(f.owner, { worldId: f.worldId, storyAt: at }), []);
      await assert.rejects(
        () => repo.readDue(f.owner, { worldId: f.worldId, storyAt: due }),
        /JOURNEY_TIME_NOT_ANCHORED/,
      );
    },
  );
  for (const [label, options] of [
    ['unregistered nontravel result', { capability: 'plan.record' }],
    ['omitted server departure effect', { omitEffect: true }],
    ['unfinished attempt/result', { omitFinish: true }],
  ] as const) {
    await t.test(
      label + ' cannot certify departure and rolls back event/state/outbox',
      async () => {
        const f = await fixture();
        await assert.rejects(() => app.transaction(f.owner, (sql) => departure(sql, f, options)));
        const w = await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [
          f.worldId,
        ]);
        assert.equal(w.rows[0].version, 1);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int AS n FROM parallel_life.npc_journeys WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int AS n FROM parallel_life.outbox_jobs WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n,
          0,
        );
      },
    );
  }
  await t.test(
    'wrong token, foreign owner and absent commit marker cannot create a journey',
    async () => {
      const f = await fixture();
      await app.transaction(f.owner, (sql) => departure(sql, f, { record: false }));
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            recordAgentDepartureInTransaction(sql, f.owner, {
              attempt: { ...f.attempt, token: randomUUID() },
              journey: f.journey,
            }),
          ),
        /INVALID_JOURNEY_ATTEMPT/,
      );
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            recordAgentDepartureInTransaction(sql, f.owner, {
              attempt: f.attempt,
              journey: f.journey,
            }),
          ),
        /INVALID_JOURNEY_DEPARTURE_SOURCE/,
      );
      const other = randomUUID();
      await new IdentityRepository(app).ensureGuest(other);
      assert.deepEqual(await repo.readOwn(other, { worldId: f.worldId, actorId: f.actor }), []);
      await assert.rejects(
        () =>
          app.transaction(other, (sql) =>
            recordAgentDepartureInTransaction(sql, other, {
              attempt: f.attempt,
              journey: f.journey,
            }),
          ),
        /NOT_FOUND/,
      );
    },
  );
  await t.test(
    'actual due arrival commits independent receipt and exact replay, with no new action result',
    async () => {
      const f = await fixture();
      await app.transaction(f.owner, async (sql) => {
        await departure(sql, f);
        await inTransit(sql, f);
      });
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.world_clock SET story_now=$3 WHERE world_id=$1 AND owner_id=$2',
          [f.worldId, f.owner, due],
        ),
      );
      assert.deepEqual(
        await repo.readDue(f.owner, { worldId: f.worldId, actorId: f.actor, storyAt: due }),
        [f.journey],
      );
      const finished = arrival(f);
      const result = await app.transaction(f.owner, async (sql) => {
        await arrivalEvent(sql, f, finished);
        return recordAgentArrivalInTransaction(sql, f.owner, { journey: finished });
      });
      assert.equal(result.status, 'recorded');
      assert.equal(
        (
          await app.transaction(f.owner, (sql) =>
            recordAgentArrivalInTransaction(sql, f.owner, { journey: finished }),
          )
        ).status,
        'replayed',
      );
      assert.equal(
        (
          await app.transaction(f.owner, (sql) =>
            recordAgentDepartureInTransaction(sql, f.owner, {
              attempt: f.attempt,
              journey: f.journey,
            }),
          )
        ).journey.status,
        'arrived',
      );
      assert.deepEqual(await repo.readDue(f.owner, { worldId: f.worldId, storyAt: due }), []);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM parallel_life.agent_action_results WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  for (const [label, options] of [
    ['wrong event type', { wrongType: true }],
    ['wrong pinned route', { wrongRoute: true }],
    ['unrelated departure source', { wrongSource: true }],
    ['unanchored future time', { clockAt: at }],
    ['paused world', { paused: true }],
  ] as const) {
    await t.test(
      label + ' cannot settle arrival and leaves original journey in transit',
      async () => {
        const f = await fixture();
        await app.transaction(f.owner, async (sql) => {
          await departure(sql, f);
          await inTransit(sql, f);
        });
        const finished = arrival(f);
        await assert.rejects(
          () =>
            app.transaction(f.owner, async (sql) => {
              await arrivalEvent(sql, f, finished, options);
              await recordAgentArrivalInTransaction(sql, f.owner, { journey: finished });
            }),
          /INVALID_JOURNEY_ARRIVAL_SOURCE/,
        );
        assert.equal(
          (await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }))[0]?.status,
          'in_transit',
        );
        assert.equal(
          (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
            .rows[0].version,
          2,
        );
      },
    );
  }
  await t.test(
    'wrong original journey proof fails before write; late lawful settlement is not backdated',
    async () => {
      const f = await fixture();
      await app.transaction(f.owner, async (sql) => {
        await departure(sql, f);
        await inTransit(sql, f);
      });
      const late = arrival(f, '2026-10-15T10:00:00.000Z');
      await app.transaction(f.owner, async (sql) => {
        await arrivalEvent(sql, f, late);
        await recordAgentArrivalInTransaction(sql, f.owner, { journey: late });
      });
      const saved = (await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }))[0]!;
      assert.equal(saved.plannedArrivalAt, due);
      assert.equal(saved.status === 'arrived' && saved.arrival.at, '2026-10-15T10:00:00.000Z');
      if (late.status !== 'arrived') throw Error('expected arrival');
      const changed = { ...late, arrival: { ...late.arrival, id: randomUUID() } };
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            recordAgentArrivalInTransaction(sql, f.owner, { journey: changed }),
          ),
        /IDEMPOTENCY_CONFLICT/,
      );
    },
  );
  await t.test('RLS, immutable update and worker ACL are actual database constraints', async () => {
    const f = await fixture();
    await app.transaction(f.owner, async (sql) => {
      await departure(sql, f);
      await inTransit(sql, f);
    });
    await assert.rejects(
      () =>
        app.transaction(f.owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.npc_journeys SET document=jsonb_set(document,'{route,toPlaceId}','\"elsewhere\"') WHERE world_id=$1",
            [f.worldId],
          ),
        ),
      /IMMUTABLE_JOURNEY_BASIS/,
    );
    await assert.rejects(
      () =>
        app.transaction(f.owner, (sql) =>
          sql.query('DELETE FROM parallel_life.npc_journeys WHERE world_id=$1', [f.worldId]),
        ),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        worker.transaction(f.owner, (sql) =>
          sql.query('SELECT * FROM parallel_life.npc_journeys WHERE world_id=$1', [f.worldId]),
        ),
      /permission denied/,
    );
    const r = await admin.query(
      "SELECT has_table_privilege('pl_worker','parallel_life.npc_journeys','SELECT') AS worker,has_table_privilege('pl_publisher','parallel_life.npc_journeys','SELECT') AS publisher,relforcerowsecurity FROM pg_class WHERE oid='parallel_life.npc_journeys'::regclass",
    );
    assert.equal(r.rows[0].worker, false);
    assert.equal(r.rows[0].publisher, false);
    assert.equal(r.rows[0].relforcerowsecurity, true);
  });
  await t.test(
    'database active-actor uniqueness rejects two separately sourced simultaneous journeys',
    async () => {
      const f = await fixture();
      const action = { ...f.action, id: randomUUID() };
      const result = { ...f.result, id: randomUUID(), actionId: action.id };
      const journey: AgentJourney = {
        ...f.journey,
        id: randomUUID(),
        beginActionId: action.id,
        departure: { ...f.journey.departure, id: result.id, actionId: action.id },
      };
      await assert.rejects(
        () =>
          app.transaction(f.owner, async (sql) => {
            await departure(sql, f, { additional: { action, result, journey } });
            await recordAgentDepartureInTransaction(sql, f.owner, { attempt: f.attempt, journey });
          }),
        /npc_journey_one_active_actor/,
      );
      assert.deepEqual(await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }), []);
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].version,
        1,
      );
    },
  );
  await t.test(
    'concurrent arrival deliveries serialize to one commit and one exact replay',
    async () => {
      const f = await fixture();
      await app.transaction(f.owner, async (sql) => {
        await departure(sql, f);
        await inTransit(sql, f);
      });
      const finished = arrival(f);
      let held!: () => void, release!: () => void;
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = app.transaction(f.owner, async (sql) => {
        await arrivalEvent(sql, f, finished);
        const saved = await recordAgentArrivalInTransaction(sql, f.owner, { journey: finished });
        held();
        await barrier;
        return saved;
      });
      await Promise.race([
        holding,
        first.then(() => {
          throw Error('did not hold');
        }),
      ]);
      const second = app.transaction(f.owner, (sql) =>
        recordAgentArrivalInTransaction(sql, f.owner, { journey: finished }),
      );
      release();
      const results = await Promise.all([first, second]);
      assert.deepEqual(
        results.map((r) => r.status),
        ['recorded', 'replayed'],
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1 AND version=3',
            [f.worldId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'paused due reads are quiet and wrong own physical proof cannot settle',
    async () => {
      const f = await fixture();
      await app.transaction(f.owner, async (sql) => {
        await departure(sql, f);
        await inTransit(sql, f);
      });
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.world_clock SET story_now=$3,paused=true WHERE world_id=$1 AND owner_id=$2',
          [f.worldId, f.owner, due],
        ),
      );
      assert.deepEqual(await repo.readDue(f.owner, { worldId: f.worldId, storyAt: due }), []);
      const finished = arrival(f);
      await assert.rejects(
        () =>
          app.transaction(f.owner, async (sql) => {
            await arrivalEvent(sql, f, finished);
            await sql.query(
              'UPDATE parallel_life.world_authoritative_positions SET source_event_id=$4,source_version=1,document=$5 WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3',
              [f.worldId, f.owner, 'actor:' + f.actor, f.position.sourceEventId, f.position],
            );
            await recordAgentArrivalInTransaction(sql, f.owner, { journey: finished });
          }),
        /JOURNEY_POSITION_SOURCE_MISMATCH/,
      );
    },
  );
  await t.test('event-authored route retains same-world source FK through arrival', async () => {
    const f = await fixture('setup');
    await app.transaction(f.owner, async (sql) => {
      await departure(sql, f);
      await inTransit(sql, f);
    });
    const source = (
      await admin.query(
        'SELECT route_source_event_id,route_source_version FROM parallel_life.npc_journeys WHERE world_id=$1',
        [f.worldId],
      )
    ).rows[0];
    assert.equal(source.route_source_event_id, f.position.sourceEventId);
    assert.equal(source.route_source_version, 1);
    const finished = arrival(f);
    await app.transaction(f.owner, async (sql) => {
      await arrivalEvent(sql, f, finished);
      await recordAgentArrivalInTransaction(sql, f.owner, { journey: finished });
    });
    assert.equal(
      (await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }))[0]?.status,
      'arrived',
    );
  });
  await t.test(
    'route provenance pointing into another owner/world fails an actual FK and rolls back',
    async () => {
      const other = await fixture();
      const f = await fixture({ eventId: other.position.sourceEventId, eventVersion: 1 });
      await assert.rejects(
        () => app.transaction(f.owner, (sql) => departure(sql, f)),
        /foreign key constraint/,
      );
      assert.deepEqual(await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }), []);
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].version,
        1,
      );
    },
  );
});
