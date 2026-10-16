import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  PostgresWorldAwarenessRepository,
  projectCommittedWorldAwareness,
  markDirectorEvaluated,
} from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { CommittedAwarenessEvent } from '../../src/modules/world/domain/world-awareness.ts';
const departedAt = '2026-10-15T07:00:00.000Z';
const arrivedAt = '2026-10-15T07:10:00.000Z';

test('world awareness: real event transactions, provenance, observer isolation and independent director cursors', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.WORLD_AWARENESS_TEST_PORT ?? 55503));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await worker.close();
    await admin.end();
  });
  const repo = new PostgresWorldAwarenessRepository(app);
  async function fixture() {
    const owner = randomUUID(),
      foreign = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    await new IdentityRepository(app).ensureGuest(foreign);
    const source = {
      kind: 'system_policy' as const,
      policy: 'default_travel_v1' as const,
      snapshotVersion: 0 as const,
    };
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Awareness integration fixture',
      time: departedAt,
      actors: ['watcher', 'absent'].map((id) => ({ id, name: id, persona: id })),
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'from',
        positionSource: source,
        routes: [],
        places: ['from', 'to'].map((id) => ({
          id,
          name: id,
          description: '',
          source,
          contactActorIds: ['absent'],
          appointmentIds: [],
        })),
      },
    };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [worldId, owner, world.title, world],
    );
    return { owner, foreign, worldId, world };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function save(
    f: Fixture,
    type: string,
    data: unknown,
    options: { project?: boolean; version?: number; status?: string } = {},
  ) {
    const current = (
      await admin.query('SELECT version,state FROM parallel_life.worlds WHERE id=$1', [f.worldId])
    ).rows[0]!;
    const event: CommittedAwarenessEvent = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      version: options.version ?? current.version + 1,
      occurredAt: arrivedAt,
      storyAt: arrivedAt,
      type,
      data,
    };
    await app.transaction(f.owner, async (sql) => {
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [event.commandId, f.worldId, f.owner, event.version - 1, 'fixture', {}],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, f.worldId, f.owner, event.version, event.commandId, event, event.occurredAt],
      );
      const next = { ...current.state, version: event.version, time: arrivedAt };
      await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        f.worldId,
        event.version,
        next,
      ]);
      if (options.status !== 'queued')
        await sql.query(
          "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
          [f.worldId, event.commandId, event.id, next],
        );
      if (options.project !== false) await projectCommittedWorldAwareness(sql, f.owner, event);
    });
    return event;
  }
  function travel(id: string) {
    return {
      fromPlaceId: 'from',
      toPlaceId: 'to',
      departedAt,
      arrivedAt,
      leftSceneId: 'scene',
      departureObservation: {
        sourceEventId: id,
        kind: 'canonical',
        visibility: { kind: 'actors', actorIds: ['watcher'] },
      },
    };
  }
  async function saveTravel(f: Fixture) {
    // The actual event ID is fixed before the observed departure fact is authored.
    const event: CommittedAwarenessEvent = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      version: 1,
      occurredAt: arrivedAt,
      storyAt: arrivedAt,
      type: 'travel.completed',
      data: null,
    };
    event.data = travel(event.id);
    await app.transaction(f.owner, async (sql) => {
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,0,'fixture',$4,'queued')",
        [event.commandId, f.worldId, f.owner, {}],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,$4,$5,$6)',
        [event.id, f.worldId, f.owner, event.commandId, event, arrivedAt],
      );
      const next = {
        ...f.world,
        version: 1,
        time: arrivedAt,
        space: {
          ...f.world.space!,
          currentPlaceId: 'to',
          positionSource: { kind: 'travel', eventId: event.id, eventVersion: 1 },
        },
      };
      await sql.query('UPDATE parallel_life.worlds SET version=1,state=$2 WHERE id=$1', [
        f.worldId,
        next,
      ]);
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
        [f.worldId, event.commandId, event.id, next],
      );
      await projectCommittedWorldAwareness(sql, f.owner, event);
    });
    return event;
  }
  await t.test('genesis read is pure, finite boundary and actor own position unknown', async () => {
    const f = await fixture();
    const view = await repo.readActorAwareness(f.owner, f.worldId, 'watcher');
    assert.equal(view.boundary.sourceEventId, null);
    assert.equal(view.boundary.createdFromVersion, 0);
    assert.equal(view.ownPosition.status, 'unknown');
    assert.deepEqual(view.time, {
      storyAt: departedAt,
      timeZone: 'UTC+08:00',
      localDateTime: '2026-10-15T15:00:00',
    });
    assert.equal(
      (
        await admin.query(
          'SELECT 1 FROM parallel_life.director_observed_states WHERE world_id=$1',
          [f.worldId],
        )
      ).rowCount,
      0,
    );
  });
  await t.test(
    'real travel commits own actual arrival; only explicit watcher learns departure, never destination',
    async () => {
      const f = await fixture();
      await saveTravel(f);
      const actual = (
        await admin.query(
          'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0]!.document;
      assert.equal(actual.placeId, 'to');
      assert.equal(actual.occurredAt, arrivedAt);
      const watcher = await repo.readActorAwareness(f.owner, f.worldId, 'watcher');
      assert.equal(watcher.ownPosition.status, 'unknown');
      assert.equal(watcher.knowledge.length, 1);
      assert.equal(watcher.knowledge[0]!.placeId, 'from');
      assert.equal(watcher.knowledge[0]!.learnedAt, departedAt);
      assert.equal(watcher.knowledge[0]!.kind, 'left');
      assert.equal('positions' in watcher, false);
      assert.equal('playerPosition' in watcher, false);
      const absent = await repo.readActorAwareness(f.owner, f.worldId, 'absent');
      assert.deepEqual(absent.knowledge, []);
      assert.equal(
        (await repo.readDirectorObservedState(f.owner, f.worldId)).evaluatedThroughVersion,
        0,
      );
    },
  );
  await t.test(
    'idempotent exact replay does not duplicate knowledge/reasons and fabricated payload is rejected',
    async () => {
      const f = await fixture();
      const e = await saveTravel(f);
      await app.transaction(f.owner, (sql) => projectCommittedWorldAwareness(sql, f.owner, e));
      assert.equal(
        (
          await admin.query(
            'SELECT 1 FROM parallel_life.actor_position_knowledge WHERE world_id=$1',
            [f.worldId],
          )
        ).rowCount,
        1,
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          projectCommittedWorldAwareness(sql, f.owner, { ...e, data: { fake: true } }),
        ),
        /MISMATCH/,
      );
    },
  );
  await t.test(
    'ordinary speech observes continuity but neither evaluates nor forces a director call',
    async () => {
      const f = await fixture();
      await save(f, 'turn.resolved', { actorId: 'watcher', userText: '我在to，你不在家' });
      const state = await repo.readDirectorObservedState(f.owner, f.worldId);
      assert.equal(state.observedThroughVersion, 1);
      assert.equal(state.evaluatedThroughVersion, 0);
      assert.equal(state.needsEvaluation, false);
      assert.equal(
        (
          await admin.query(
            'SELECT 1 FROM parallel_life.world_authoritative_positions WHERE world_id=$1',
            [f.worldId],
          )
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    'continuous catchup includes earlier actual events and preserves pending changes across pages',
    async () => {
      const f = await fixture();
      await save(f, 'turn.resolved', { userText: 'hello' }, { project: false });
      const state = emptyActorAgentState({ worldId: f.worldId, actorId: 'watcher' }, 'def', 2);
      state.plans = Array.from({ length: 105 }, (_, i) => ({
        id: `p${String(i).padStart(3, '0')}`,
        goalId: 'g',
        summary: '安排',
        status: 'waiting',
        actionIds: [],
        nextActionId: null,
        triggers: [],
        missingConditions: [],
        sourceIds: [],
      }));
      state.decisions = [
        {
          id: 'declined',
          responsibilityId: 'r',
          sourceId: 'input',
          kind: 'declined',
          quote: '不参加',
        },
      ];
      await save(f, 'agent.state_committed', {
        actorId: 'watcher',
        agentRuntime: { stateAfter: state, proposal: { decisions: state.decisions }, results: [] },
      });
      const first = await repo.readDirectorObservedState(f.owner, f.worldId, { limit: 100 });
      assert.equal(first.observedThroughVersion, 2);
      assert.equal(first.pendingReasons.length, 100);
      assert.ok(first.nextCursor);
      const rest = await repo.readDirectorObservedState(f.owner, f.worldId, {
        after: first.nextCursor!,
        limit: 100,
      });
      assert.equal(rest.pendingReasons.length, 6);
      assert.equal(rest.nextCursor, null);
      assert.equal(
        new Set([...first.pendingReasons, ...rest.pendingReasons].map((r) => r.id)).size,
        106,
      );
    },
  );
  await t.test(
    'quiet evaluation is explicit, leaves observations intact and does not invent missed/expiry',
    async () => {
      const f = await fixture();
      await saveTravel(f);
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          markDirectorEvaluated(sql, f.owner, f.worldId, {
            expectedObservedThroughVersion: 0,
            throughVersion: 1,
            result: 'quiet',
          }),
        ),
        /CONFLICT/,
      );
      await app.transaction(f.owner, (sql) =>
        markDirectorEvaluated(sql, f.owner, f.worldId, {
          expectedObservedThroughVersion: 1,
          throughVersion: 1,
          result: 'quiet',
        }),
      );
      const state = await repo.readDirectorObservedState(f.owner, f.worldId);
      assert.equal(state.lastEvaluation, 'quiet');
      assert.equal(state.evaluatedThroughVersion, 1);
      assert.equal(state.observedThroughVersion, 1);
      assert.equal(state.needsEvaluation, false);
      assert.equal(
        (
          await admin.query(
            'SELECT 1 FROM parallel_life.director_pending_reasons WHERE world_id=$1',
            [f.worldId],
          )
        ).rowCount,
        1,
      );
    },
  );
  await t.test(
    'version gaps and queued receipt fail atomically without advancing cursor',
    async () => {
      const f = await fixture();
      await assert.rejects(save(f, 'turn.resolved', {}, { version: 2 }), /GAP/);
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0]!.version,
        0,
      );
      await assert.rejects(save(f, 'turn.resolved', {}, { status: 'queued' }), /NOT_COMMITTED/);
      assert.equal(
        (await repo.readDirectorObservedState(f.owner, f.worldId)).observedThroughVersion,
        0,
      );
    },
  );
  await t.test('owner isolation and worker grants are enforced by real RLS', async () => {
    const f = await fixture();
    await saveTravel(f);
    await assert.rejects(repo.readActorAwareness(f.foreign, f.worldId, 'watcher'), /NOT_FOUND/);
    await assert.rejects(repo.readDirectorObservedState(f.foreign, f.worldId), /NOT_FOUND/);
    await app.transaction(f.foreign, async (sql) => {
      for (const name of [
        'world_awareness_boundaries',
        'world_authoritative_positions',
        'actor_position_knowledge',
        'director_observed_states',
        'director_pending_reasons',
      ])
        assert.equal(
          (await sql.query(`SELECT * FROM parallel_life.${name} WHERE world_id=$1`, [f.worldId]))
            .rowCount,
          0,
        );
    });
    await assert.rejects(
      worker.transaction(f.owner, (sql) =>
        sql.query('SELECT * FROM parallel_life.world_authoritative_positions'),
      ),
      /permission denied/,
    );
  });
  await t.test(
    'source FK binds exact owner/event/version and malformed documents are rejected',
    async () => {
      const f = await fixture();
      const e = await saveTravel(f);
      const doc = {
        worldId: f.worldId,
        subject: { kind: 'actor', actorId: 'watcher' },
        status: 'at',
        placeId: 'from',
        sourceEventId: e.id,
        worldVersion: 2,
        occurredAt: arrivedAt,
      };
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          sql.query(
            `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,'actor:watcher',$3,2,$4)`,
            [f.worldId, f.owner, e.id, doc],
          ),
        ),
        /foreign key/,
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          sql.query(
            `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,'actor:watcher',$3,1,$4)`,
            [f.worldId, f.owner, e.id, {}],
          ),
        ),
        /check constraint/,
      );
      for (const patch of [
        { worldId: null },
        { subject: null },
        { status: null },
        { occurredAt: null },
      ]) {
        await assert.rejects(
          app.transaction(f.owner, (sql) =>
            sql.query(
              `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,'actor:watcher',$3,1,$4)`,
              [f.worldId, f.owner, e.id, { ...doc, worldVersion: 1, ...patch }],
            ),
          ),
          /check constraint/,
        );
      }
    },
  );
  await t.test(
    'scene presence establishes only actual present subjects and no automatic shared knowledge',
    async () => {
      const f = await fixture();
      const sceneId = randomUUID();
      const e = await save(f, 'scene.opened', { sceneId }, { project: false });
      const scene = {
        id: sceneId,
        worldId: f.worldId,
        ownerId: f.owner,
        sourceEventId: e.id,
        sourceVersion: 1,
        title: '现场',
        placeId: 'from',
        status: 'active',
        presence: [
          {
            participant: { kind: 'actor', actorId: 'watcher' },
            joinedVersion: 1,
            sourceEventId: e.id,
            sourceVersion: 1,
          },
        ],
      };
      await admin.query(
        'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [sceneId, f.worldId, f.owner, e.id, scene],
      );
      await app.transaction(f.owner, (sql) => projectCommittedWorldAwareness(sql, f.owner, e));
      const watcher = await repo.readActorAwareness(f.owner, f.worldId, 'watcher');
      assert.equal(watcher.ownPosition.placeId, 'from');
      assert.deepEqual(watcher.knowledge, []);
      const absent = await repo.readActorAwareness(f.owner, f.worldId, 'absent');
      assert.equal(absent.ownPosition.status, 'unknown');
    },
  );
  await t.test(
    'registered capability set survives actor read; evaluation cannot regress or acknowledge future versions',
    async () => {
      const f = await fixture();
      const e = await saveTravel(f);
      await app.transaction(f.owner, (sql) =>
        projectCommittedWorldAwareness(sql, f.owner, e, { capabilityIds: [] }),
      );
      assert.deepEqual(
        (await repo.readActorAwareness(f.owner, f.worldId, 'watcher')).boundary.capabilityIds,
        [],
      );
      await app.transaction(f.owner, (sql) =>
        markDirectorEvaluated(sql, f.owner, f.worldId, {
          expectedObservedThroughVersion: 1,
          throughVersion: 1,
          result: 'quiet',
        }),
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          markDirectorEvaluated(sql, f.owner, f.worldId, {
            expectedObservedThroughVersion: 1,
            throughVersion: 0,
            result: 'quiet',
          }),
        ),
        /CONFLICT/,
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          markDirectorEvaluated(sql, f.owner, f.worldId, {
            expectedObservedThroughVersion: 1,
            throughVersion: 2,
            result: 'quiet',
          }),
        ),
        /INVALID/,
      );
    },
  );
  await t.test(
    'foreign owner insert is rejected by RLS WITH CHECK, not just filtered reads',
    async () => {
      const f = await fixture();
      const e = await saveTravel(f);
      const doc = {
        worldId: f.worldId,
        subject: { kind: 'actor', actorId: 'intruder' },
        status: 'at',
        placeId: 'from',
        sourceEventId: e.id,
        worldVersion: 1,
        occurredAt: arrivedAt,
      };
      await assert.rejects(
        app.transaction(f.foreign, (sql) =>
          sql.query(
            `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,'actor:intruder',$3,1,$4)`,
            [f.worldId, f.owner, e.id, doc],
          ),
        ),
        /row-level security/,
      );
    },
  );
});
