import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { projectAgentWorldChange } from '../../src/modules/world/infrastructure/world-awareness-commit.ts';
import { updateClockActivity } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { commitDueAgentArrival } from '../../src/modules/world/infrastructure/agent-arrival-continuation.ts';
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
  PostgresAgentJourneyRepository,
} from '../../src/modules/world/infrastructure/agent-journey-repository.ts';
const at = '2026-10-15T09:00:00.000Z',
  due = '2026-10-15T09:15:00.000Z';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('actual server arrival continuation authenticates clock, due journey and atomic world projection without models', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.AGENT_ARRIVAL_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const owned: string[] = [];
  t.after(async () => {
    await admin.query(
      'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=ANY($1::text[])',
      [owned],
    );
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
    owned.push(worldId);
    await admin.query(
      'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
      [worldId, owner, world, {}],
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
          schemaVersion: 1,
          occurredAt: at,
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
  // Departure helpers above are the existing SQL80 authenticated synthetic history fixture.
  // They do not claim to exercise the production travel.begin capability/kernel.
  async function ready() {
    const f = await fixture();
    await app.transaction(f.owner, async (sql) => {
      await departure(sql, f);
      await inTransit(sql, f);
      await projectAgentWorldChange(sql, f.owner, f.worldId, f.result.eventId);
    });
    return f;
  }
  const call = (f: Fixture, realNow = due, version = 2) =>
    commitDueAgentArrival(app, f.owner, {
      worldId: f.worldId,
      engineEpoch: 2,
      expectedWorldVersion: version,
      realNow,
    });
  async function rows(f: Fixture) {
    return (
      await admin.query(
        `SELECT w.version,w.state,
    (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=w.id) events,
    (SELECT count(*)::int FROM parallel_life.commands WHERE world_id=w.id) commands,
    (SELECT count(*)::int FROM parallel_life.agent_action_results WHERE world_id=w.id) results,
    (SELECT count(*)::int FROM parallel_life.agent_attempts WHERE world_id=w.id) attempts,
    (SELECT count(*)::int FROM parallel_life.world_messages WHERE world_id=w.id) messages,
    (SELECT count(*)::int FROM parallel_life.outbox_jobs WHERE world_id=w.id) outbox,
    (SELECT count(*)::int FROM parallel_life.actor_position_knowledge WHERE world_id=w.id) knowledge
    FROM parallel_life.worlds w WHERE w.id=$1`,
        [f.worldId],
      )
    ).rows[0];
  }
  async function clock(f: Fixture) {
    return (
      await admin.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1', [f.worldId])
    ).rows[0];
  }
  await t.test(
    'due real continuation saves exact event, original journey, own arrival position and durable pending reason only',
    async () => {
      const f = await ready(),
        before = await rows(f),
        actor = (
          await admin.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
            [f.worldId],
          )
        ).rows;
      const r = await call(f);
      assert.equal(r.status, 'arrived');
      if (r.status !== 'arrived') throw Error('Expected arrival');
      assert.equal(r.worldVersion, 3);
      assert.equal(r.storyAt, due);
      assert.equal(r.actorId, f.actor);
      const event = (
        await admin.query(
          'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND id=$2',
          [f.worldId, r.eventId],
        )
      ).rows[0].payload;
      assert.deepEqual(
        Object.keys(event.data).sort(),
        ['actorId', 'journeyId', 'departureEventId', 'route', 'arrival'].sort(),
      );
      assert.equal(event.commandId, 'arrival_' + f.journey.id);
      assert.deepEqual(event.data.route, f.journey.route);
      const j = (await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }))[0]!;
      assert.equal(j.status, 'arrived');
      assert(j.status === 'arrived');
      assert.equal(j.arrival.eventId, r.eventId);
      const position = (
        await admin.query(
          'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
          [f.worldId, 'actor:' + f.actor],
        )
      ).rows[0].document;
      assert.deepEqual(position, {
        worldId: f.worldId,
        subject: { kind: 'actor', actorId: f.actor },
        status: 'at',
        placeId: 'park',
        sourceEventId: r.eventId,
        worldVersion: 3,
        occurredAt: due,
      });
      const after = await rows(f);
      assert.equal(after.events, before.events + 1);
      assert.equal(after.commands, before.commands + 1);
      for (const key of ['results', 'attempts', 'messages', 'outbox', 'knowledge'])
        assert.equal(after[key], before[key], key);
      assert.deepEqual(after.state.space, before.state.space);
      assert.deepEqual(after.state.appointments, before.state.appointments);
      assert.deepEqual(
        (
          await admin.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
            [f.worldId],
          )
        ).rows,
        actor,
      );
      const pending = (
        await admin.query(
          'SELECT document FROM parallel_life.director_pending_reasons WHERE world_id=$1 AND source_event_id=$2',
          [f.worldId, r.eventId],
        )
      ).rows;
      assert(pending.some((p) => p.document.kind === 'new_condition'));
      assert.deepEqual(await call(f, due, 3), { status: 'quiet' });
      assert.equal((await rows(f)).events, after.events);
      await assert.rejects(call(f), { code: 'VERSION_CONFLICT' });
    },
  );
  await t.test(
    'too early, absent clock and zero due journeys are quiet and never invent world events',
    async () => {
      const empty = await fixture(),
        emptyBefore = await rows(empty);
      assert.deepEqual(await call(empty, at, 1), { status: 'quiet' });
      assert.deepEqual(await rows(empty), emptyBefore);
      const f = await ready(),
        before = await rows(f);
      assert.deepEqual(await call(f, '2026-10-15T09:14:59.999Z'), { status: 'quiet' });
      assert.deepEqual(await rows(f), before);
      await admin.query('DELETE FROM parallel_life.world_clock WHERE world_id=$1', [f.worldId]);
      assert.deepEqual(await call(f), { status: 'quiet' });
      assert.deepEqual(await rows(f), before);
    },
  );
  await t.test(
    'continuous offline absence commits an already departed NPC arrival once without models',
    async () => {
      const f = await ready();
      await admin.query(
        "UPDATE parallel_life.world_clock SET continuity_mode='continuous',managed=true,paused=false,active_until=$2 WHERE world_id=$1",
        [f.worldId, '2026-10-15T09:00:45.000Z'],
      );
      const result = await call(f);
      assert.equal(result.status, 'arrived');
      assert.equal((await call(f, due, 3)).status, 'quiet');
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='agent.arrival_committed'",
            [f.worldId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'paused and expired managed leases remain quiet even if wall time has passed ETA',
    async () => {
      for (const mode of ['paused', 'expired', 'away']) {
        const f = await ready(),
          before = await rows(f);
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=$2,managed=$3,active_until=$4 WHERE world_id=$1',
          [
            f.worldId,
            mode === 'paused',
            mode !== 'paused',
            mode === 'expired' ? '2026-10-15T09:10:00.000Z' : null,
          ],
        );
        const c = await clock(f);
        assert.deepEqual(await call(f), { status: 'quiet' });
        assert.deepEqual(await rows(f), before);
        assert.deepEqual(await clock(f), c);
      }
    },
  );
  await t.test(
    'normal browsing acceleration is projected, late arrival is committed now instead of backdated',
    async () => {
      const f = await ready();
      await admin.query('UPDATE parallel_life.world_clock SET speed=12 WHERE world_id=$1', [
        f.worldId,
      ]);
      const r = await call(f, '2026-10-15T09:02:00.000Z');
      assert.equal(r.status, 'arrived');
      if (r.status !== 'arrived') throw Error('Expected arrival');
      assert.equal(r.storyAt, '2026-10-15T09:24:00.000Z');
      const j = (await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }))[0]!;
      assert.equal(j.plannedArrivalAt, due);
      assert(j.status === 'arrived');
      assert.equal(j.arrival.at, r.storyAt);
    },
  );
  await t.test(
    'active managed arrival never extends its lease, changes speed or restarts its clock',
    async () => {
      const f = await ready();
      await admin.query(
        'UPDATE parallel_life.world_clock SET managed=true,story_now=$2,last_tick_at=$2,active_until=$3 WHERE world_id=$1',
        [f.worldId, '2026-10-15T09:14:30.000Z', '2026-10-15T09:15:15.000Z'],
      );
      const c = await clock(f);
      assert.equal((await call(f)).status, 'arrived');
      const next = await clock(f);
      assert.equal(
        new Date(next.active_until).toISOString(),
        new Date(c.active_until).toISOString(),
      );
      assert.equal(next.speed, c.speed);
      assert.equal(next.paused, false);
      assert.equal(next.managed, true);
    },
  );
  await t.test(
    'managed confirmed appointment cap prevents crossing its stop to reach later ETA',
    async () => {
      const f = await ready();
      // A real source-qualified projected calendar item, not a mutable genesis edit.
      await admin.query(
        'UPDATE parallel_life.world_clock SET managed=true,active_until=$2 WHERE world_id=$1',
        [f.worldId, '2026-10-15T10:00:00.000Z'],
      );
      await app.transaction(f.owner, async (sql) => {
        const eventId = randomUUID(),
          commandId = randomUUID();
        await sql.query(
          "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch','2',true)",
          [f.worldId],
        );
        await event(sql, f, {
          id: eventId,
          commandId,
          version: 3,
          storyAt: at,
          type: 'test.fixture_appointment',
          data: {},
        });
        await sql.query(
          'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
          [
            randomUUID(),
            f.worldId,
            f.owner,
            {
              id: 'stop',
              title: 'Explicit sourced fixture appointment',
              at: '2026-10-15T09:10:00.000Z',
              participantIds: [f.actor],
              status: 'confirmed',
              sourceEventId: eventId,
            },
          ],
        );
      });
      const before = await rows(f);
      assert.deepEqual(await call(f, due, 3), { status: 'quiet' });
      assert.deepEqual(await rows(f), before);
      assert.equal(
        new Date((await clock(f)).active_until).toISOString(),
        '2026-10-15T09:10:00.000Z',
      );
      assert.equal(
        (await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }))[0]!.status,
        'in_transit',
      );
    },
  );
  await t.test(
    'pinned route survives current route edits and goal withdrawal does not strand an authenticated trip',
    async () => {
      const f = await ready();
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch','2',true)",
          [f.worldId],
        );
        await sql.query(
          "UPDATE parallel_life.worlds SET state=jsonb_set(state,'{space,routes}', $2) WHERE id=$1",
          [
            f.worldId,
            JSON.stringify([
              { ...f.journey.route, durationMinutes: 120, modeLabel: 'Changed after departure' },
            ]),
          ],
        );
      });
      // Explicit local state fixture for a purpose withdrawn after an already authenticated departure.
      await admin.query(
        "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{goals,0,status}','\"withdrawn\"'::jsonb) WHERE world_id=$1",
        [f.worldId],
      );
      const r = await call(f);
      assert.equal(r.status, 'arrived');
      if (r.status !== 'arrived') throw Error('Expected arrival');
      const e = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [r.eventId])
      ).rows[0].payload;
      assert.deepEqual(e.data.route, f.journey.route);
      assert.equal(
        (
          await admin.query(
            "SELECT document->'goals'->0->>'status' status FROM parallel_life.actor_agent_states WHERE world_id=$1",
            [f.worldId],
          )
        ).rows[0].status,
        'withdrawn',
      );
    },
  );
  await t.test(
    'same-frame concurrent callers produce one arrival and one CAS conflict',
    async () => {
      const f = await ready(),
        outcomes = await Promise.allSettled([call(f), call(f)]);
      assert.equal(
        outcomes.filter((r) => r.status === 'fulfilled' && r.value.status === 'arrived').length,
        1,
      );
      assert.equal(
        outcomes.filter((r) => r.status === 'rejected' && r.reason.code === 'VERSION_CONFLICT')
          .length,
        1,
      );
      assert.equal((await rows(f)).events, 3);
    },
  );
  await t.test(
    'wrong own position is a known source error and every anchor/command/event mutation rolls back',
    async () => {
      const f = await ready();
      await admin.query(
        'UPDATE parallel_life.world_authoritative_positions SET source_event_id=$3,source_version=1,document=$4 WHERE world_id=$1 AND subject_key=$2',
        [f.worldId, 'actor:' + f.actor, f.position.sourceEventId, f.position],
      );
      const before = await rows(f),
        c = await clock(f);
      await assert.rejects(call(f), {
        code: 'INVALID_PROPOSAL',
        message: 'AGENT_ARRIVAL_POSITION_MISMATCH',
      });
      assert.deepEqual(await rows(f), before);
      assert.deepEqual(await clock(f), c);
    },
  );
  await t.test(
    'a failure after ledger arrival but before awareness projection rolls back clock, event, command and journey',
    async () => {
      const f = await ready(),
        before = await rows(f),
        c = await clock(f);
      class ProjectionFault extends PostgresDatabase {
        override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
          return super.transaction(owner, async (sql) => {
            const proxy = new Proxy(sql, {
              get(target, property, receiver) {
                if (property === 'query')
                  return async (statement: string, values?: unknown[]) => {
                    if (statement.includes('SELECT payload FROM parallel_life.world_events'))
                      throw Error('EXPLICIT_TEST_PROJECTION_FAILURE');
                    return target.query(statement, values);
                  };
                return Reflect.get(target, property, receiver);
              },
            });
            return run(proxy);
          });
        }
      }
      const broken = new ProjectionFault(
        `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
      );
      try {
        await assert.rejects(
          commitDueAgentArrival(broken, f.owner, {
            worldId: f.worldId,
            engineEpoch: 2,
            expectedWorldVersion: 2,
            realNow: due,
          }),
          /EXPLICIT_TEST_PROJECTION_FAILURE/,
        );
      } finally {
        await broken.close();
      }
      assert.deepEqual(await rows(f), before);
      assert.deepEqual(await clock(f), c);
      assert.equal(
        (await repo.readOwn(f.owner, { worldId: f.worldId, actorId: f.actor }))[0]!.status,
        'in_transit',
      );
      assert.equal((await call(f)).status, 'arrived');
    },
  );
  await t.test(
    'foreign owner, worker, stale epoch/frame and mixed NPC attempt are fenced before writes',
    async () => {
      const f = await ready(),
        before = await rows(f);
      const foreign = randomUUID();
      await new IdentityRepository(app).ensureGuest(foreign);
      await assert.rejects(
        commitDueAgentArrival(app, foreign, {
          worldId: f.worldId,
          engineEpoch: 2,
          expectedWorldVersion: 2,
          realNow: due,
        }),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        commitDueAgentArrival(worker, f.owner, {
          worldId: f.worldId,
          engineEpoch: 2,
          expectedWorldVersion: 2,
          realNow: due,
        }),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        commitDueAgentArrival(app, f.owner, {
          worldId: f.worldId,
          engineEpoch: 3,
          expectedWorldVersion: 2,
          realNow: due,
        }),
        { code: 'ENGINE_EPOCH_CONFLICT' },
      );
      await assert.rejects(call(f, due, 1), { code: 'VERSION_CONFLICT' });
      class Mixed extends PostgresDatabase {
        override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
          return super.transaction(owner, async (sql) => {
            await sql.query("SELECT set_config('app.agent_commit_attempt_id','unexpected',true)");
            return run(sql);
          });
        }
      }
      const mixed = new Mixed(
        `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
      );
      try {
        await assert.rejects(
          commitDueAgentArrival(mixed, f.owner, {
            worldId: f.worldId,
            engineEpoch: 2,
            expectedWorldVersion: 2,
            realNow: due,
          }),
          { code: 'INVALID_COMMAND', message: 'AGENT_ARRIVAL_MIXED_ATTEMPT' },
        );
      } finally {
        await mixed.close();
      }
      assert.deepEqual(await rows(f), before);
    },
  );
  await t.test(
    'default now waits for a real world lock and later legitimate heartbeat; explicit old ISO remains rejected',
    async () => {
      const f = await ready(),
        holder = await app.pool.connect();
      let enteredAt = 0,
        reportPid!: (pid: number) => void;
      const backend = new Promise<number>((resolve) => {
        reportPid = resolve;
      });
      class ObservedArrival extends PostgresDatabase {
        override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
          // The former default-now sampler ran before this synchronous entry.
          enteredAt = Date.now();
          return super.transaction(owner, async (sql) => {
            reportPid(Number((await sql.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
            return run(sql);
          });
        }
      }
      const arriving = new ObservedArrival(
        `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
      );
      let locked = true;
      let pending:
        | Promise<
            | { ok: true; value: Awaited<ReturnType<typeof commitDueAgentArrival>> }
            | { ok: false; error: unknown }
          >
        | undefined;
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT set_config('app.user_id',$1,true)", [f.owner]);
        const holderPid = Number(
          (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        await holder.query(
          'SELECT id FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [f.worldId, f.owner],
        );
        pending = commitDueAgentArrival(arriving, f.owner, {
          worldId: f.worldId,
          engineEpoch: 2,
          expectedWorldVersion: 2,
        }).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        );
        const arrivalPid = await Promise.race([
          backend,
          pending.then((result) => {
            if (!result.ok) throw result.error;
            throw Error('Arrival unexpectedly completed without waiting for the locked world');
          }),
        ]);
        let observedWait = false;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const row = (
            await admin.query(
              'SELECT wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1',
              [arrivalPid],
            )
          ).rows[0];
          if (row?.wait_event_type === 'Lock' && row.blockers.includes(holderPid)) {
            observedWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(
          observedWait,
          true,
          'The actual arrival backend must be blocked by this exact world-lock holder',
        );
        while (Date.now() <= enteredAt && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 1));
        assert(
          Date.now() > enteredAt,
          'The new anchor must be strictly after the former pre-lock sample',
        );
        const heartbeatAt = new Date().toISOString();
        await updateClockActivity(
          holder,
          f.owner,
          f.worldId,
          { clientId: randomUUID(), sequence: 0, mode: 'browsing' },
          heartbeatAt,
        );
        const anchor = (
          await holder.query(
            'SELECT last_tick_at FROM parallel_life.world_clock WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].last_tick_at;
        assert(new Date(anchor).getTime() > enteredAt);
        assert.equal(
          (await holder.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
            .rows[0].version,
          2,
        );
        await holder.query('COMMIT');
        locked = false;
        const result = await pending;
        if (!result.ok) throw result.error;
        assert.equal(result.value.status, 'arrived');
        if (result.value.status !== 'arrived')
          throw Error('Expected arrival after the legitimate clock update');
        assert.equal(result.value.worldVersion, 3);
        const before = await rows(f),
          currentClock = await clock(f);
        // The production path resamples; an explicit server/test instant is never silently rewritten.
        await assert.rejects(
          commitDueAgentArrival(app, f.owner, {
            worldId: f.worldId,
            engineEpoch: 2,
            expectedWorldVersion: 3,
            realNow: new Date(enteredAt).toISOString(),
          }),
          { code: 'INVALID_COMMAND', message: 'AGENT_ARRIVAL_CLOCK_REGRESSION' },
        );
        assert.deepEqual(await rows(f), before);
        assert.deepEqual(await clock(f), currentClock);
        assert.equal(before.events, 3);
        assert.equal(before.results, 1);
        assert.equal(before.attempts, 1);
      } finally {
        if (locked) await holder.query('ROLLBACK').catch(() => {});
        holder.release();
        if (pending) await pending;
        await arriving.close();
      }
    },
  );
});
