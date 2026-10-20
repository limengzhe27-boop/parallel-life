import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { authorizeWorldCommandInTransaction } from '../../src/modules/world/infrastructure/world-command-uow.ts';
import { projectCommittedWorldAwareness } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import {
  readDirectorAuthoredSpeechSources,
  PostgresDirectorSnapshotRepository,
} from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import type {
  DirectorSnapshot,
  DirectorDecision,
} from '../../src/modules/world/domain/director-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const at = '2026-10-15T08:00:00.000Z';
test('real director snapshot is one coherent readonly fictional-world view with exact evidence', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.DIRECTOR_SNAPSHOT_TEST_PORT ?? 55503));
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
  const repo = new PostgresDirectorSnapshotRepository(app);
  async function fixture() {
    const owner = randomUUID(),
      foreign = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    await new IdentityRepository(app).ensureGuest(foreign);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '虚构县城',
      time: at,
      actors: [
        { id: a, name: 'A', persona: '直率的虚构人物', sourcePersonId: 'REAL_PERSON_IDENTIFIER' },
        { id: b, name: 'B', persona: '慢热的虚构人物' },
      ],
      facts: [
        {
          id: randomUUID(),
          text: '共同的虚构街道',
          kind: 'canonical',
          sourceEventId: `genesis:${worldId}`,
          visibility: { kind: 'world' },
        },
      ],
      messages: [
        {
          id: randomUUID(),
          actorId: a,
          role: 'assistant',
          text: 'UNRELATED_AUTHORED_HISTORY',
          at,
          sourceEventId: `genesis:${worldId}`,
        },
      ],
      appointments: [],
      mediaRequests: [],
      space: {
        places: ['from', 'to'].map((id) => ({
          id,
          name: id,
          description: '虚构地点',
          source,
          contactActorIds: [a, b],
          appointmentIds: [],
        })),
        routes: [],
        currentPlaceId: 'from',
        positionSource: source,
      },
    };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [worldId, owner, world.title, { ...world, facts: [], messages: [] }],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
      [worldId, owner, world, { privateInterview: 'REAL_PRIVATE_SENTINEL' }],
    );
    await admin.query('UPDATE parallel_life.profiles SET document=$2 WHERE owner_id=$1', [
      owner,
      { interview: 'REAL_PRIVATE_SENTINEL' },
    ]);
    const states = [a, b].map((actorId) => {
      const s = emptyActorAgentState({ worldId, actorId }, 'fictional-definition', 0);
      s.goals = [
        {
          id: 'g',
          summary: '自己的目标',
          status: 'active' as const,
          sourceIds: [`genesis:${worldId}`],
          resultIds: [],
        },
      ];
      s.plans = [
        {
          id: 'p',
          goalId: 'g',
          summary: `只属于${actorId}的计划`,
          status: 'waiting' as const,
          sourceIds: [`genesis:${worldId}`],
          actionIds: [],
          nextActionId: null,
          triggers: [],
          missingConditions: [],
        },
      ];
      return s;
    });
    await app.transaction(owner, async (sql) => {
      for (const s of states) await initializeActorAgentStateInTransaction(sql, owner, s);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    return { owner, foreign, worldId, a, b, world, states };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  const input = (f: F, worldVersion = 0) => ({
    worldId: f.worldId,
    engineEpoch: 2,
    worldVersion,
    candidates: [],
    blockers: [],
  });
  async function write(
    f: F,
    type = 'turn.resolved',
    data: unknown = { actorId: f.a, userText: '本次原话', effects: [] },
    extra?: (sql: any, event: any) => Promise<void>,
  ) {
    const current = (
      await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [f.worldId])
    ).rows[0]!;
    const e = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      version: current.version + 1,
      occurredAt: new Date().toISOString(),
      storyAt: at,
      type,
      data,
    };
    await app.transaction(f.owner, async (sql) => {
      await authorizeWorldCommandInTransaction(sql, f.owner, {
        worldId: f.worldId,
        commandId: e.commandId,
        expectedWorldVersion: current.version,
        kind: 'note_save',
      });
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,'fixture',$5,'queued')",
        [e.commandId, f.worldId, f.owner, current.version, {}],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [e.id, f.worldId, f.owner, e.version, e.commandId, e, e.occurredAt],
      );
      const state = { ...current.state, version: e.version, time: at };
      await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        f.worldId,
        e.version,
        state,
      ]);
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
        [f.worldId, e.commandId, e.id, state],
      );
      if (extra) await extra(sql, e);
      await projectCommittedWorldAwareness(sql, f.owner, e);
    });
    return e;
  }
  async function count(f: F) {
    return (
      await admin.query(
        `SELECT (SELECT count(*) FROM parallel_life.world_events WHERE world_id=$1) events,
   (SELECT count(*) FROM parallel_life.director_observed_states WHERE world_id=$1) cursors,
   (SELECT count(*) FROM parallel_life.director_runtime_attempts WHERE world_id=$1) attempts`,
        [f.worldId],
      )
    ).rows[0];
  }
  await t.test(
    'authored speech references keep bounded original exchanges, exact sources and owner/actor isolation',
    async () => {
      const f = await fixture();
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        const id = randomUUID();
        ids.push(id);
        await write(f, undefined, undefined, async (sql, event) => {
          const m = {
            id,
            actorId: f.a,
            role: i % 2 ? 'assistant' : 'user',
            text: `BOUNDED_EXCHANGE_${i}`,
            at,
            sourceEventId: event.id,
          };
          await sql.query(
            'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
            [id, f.worldId, f.owner, f.a, m],
          );
        });
      }
      const read = (owner: string, actorIds: string[], worldVersion = 7) =>
        app.transaction(owner, (sql) =>
          readDirectorAuthoredSpeechSources(sql, owner, {
            worldId: f.worldId,
            worldVersion,
            actorIds,
          }),
        );
      const sources = await read(f.owner, [f.a]);
      assert.equal(sources.length, 5); // Four current messages plus the one current opening.
      for (const id of ids.slice(-4)) assert(sources.includes(`message:${id}`));
      for (const id of ids.slice(0, 3)) assert(!sources.includes(`message:${id}`));
      assert(sources.includes(`message:${f.world.messages[0]!.id}`));
      assert.deepEqual(await read(f.owner, [f.b]), []);
      assert.deepEqual(await read(f.foreign, [f.a]), []);
      const older = await read(f.owner, [f.a], 3);
      assert(older.includes(`message:${ids[2]}`));
      assert(!older.includes(`message:${ids[3]}`));
      const raw = await repo.readEvidence(f.owner, { ...input(f, 7), sourceIds: sources });
      assert.equal(raw.filter((r) => r.kind === 'speech').length, 5);
      for (const record of raw) assert.deepEqual(record.knownByActorIds, [f.a]);
      assert.equal(JSON.stringify(raw).includes('REAL_PRIVATE_SENTINEL'), false);
      assert.equal(JSON.stringify(raw).includes('BOUNDED_EXCHANGE_0'), false);
    },
  );
  await t.test(
    'pure genesis read keeps full cast/state and fictional baseline without reading real profile/approved seed',
    async () => {
      const f = await fixture(),
        before = await count(f);
      const s = await repo.read(f.owner, input(f));
      assert.equal(s.actorStates.length, 2);
      assert.equal(s.cast?.length, 2);
      assert.equal(s.observedThroughVersion, 0);
      assert.equal(s.evaluatedThroughVersion, 0);
      assert.equal(JSON.stringify(s).includes('REAL_PRIVATE_SENTINEL'), false);
      assert.equal(JSON.stringify(s).includes('REAL_PERSON_IDENTIFIER'), false);
      assert.equal(JSON.stringify(s).includes('UNRELATED_AUTHORED_HISTORY'), false);
      const setting = JSON.parse(s.worldSetting!);
      assert.equal(setting.genesis.mapConfiguration.places[0].description, '虚构地点');
      assert.equal(setting.genesis.mapConfiguration.places[0].contactActorIds, undefined);
      assert.match(setting.genesis.mapConfiguration.meaning, /不代表/);
      assert.deepEqual(await count(f), before);
      const raw = await repo.readEvidence(f.owner, {
        ...input(f),
        sourceIds: [`genesis:${f.worldId}`],
      });
      assert.equal(JSON.stringify(raw).includes('REAL_PRIVATE_SENTINEL'), false);
      assert.equal(JSON.stringify(raw).includes('REAL_PERSON_IDENTIFIER'), false);
    },
  );
  await t.test(
    'all pending (>50) is retained, current facts differ from beliefs and private original speech remains speech',
    async () => {
      const f = await fixture();
      const messageId = randomUUID(),
        factId = randomUUID(),
        beliefId = randomUUID();
      const e = await write(f, undefined, undefined, async (sql, event) => {
        const m = {
          id: messageId,
          actorId: f.a,
          role: 'assistant',
          text: 'PRIVATE_A_ORIGINAL',
          at,
          sourceEventId: event.id,
          sourceVersion: event.version,
        };
        await sql.query(
          'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
          [messageId, f.worldId, f.owner, f.a, m],
        );
        for (const [id, kind, text] of [
          [factId, 'canonical', '实际虚构事实'],
          [beliefId, 'belief', 'B的看法'],
        ])
          await sql.query(
            'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,1,$4)',
            [
              id,
              f.worldId,
              f.owner,
              {
                id,
                kind,
                text,
                sourceEventId: event.id,
                visibility: { kind: 'actors', actorIds: [f.b] },
                ...(kind === 'belief' ? { believedByActorId: f.b } : {}),
              },
            ],
          );
        for (let i = 0; i < 106; i++) {
          const id = `reason-${String(i).padStart(3, '0')}`;
          await sql.query(
            'INSERT INTO parallel_life.director_pending_reasons(world_id,owner_id,id,source_event_id,source_version,document) VALUES($1,$2,$3,$4,1,$5)',
            [
              f.worldId,
              f.owner,
              id,
              event.id,
              {
                id,
                eventId: event.id,
                worldVersion: 1,
                kind: 'new_condition',
                ref: { kind: 'event', id: event.id },
              },
            ],
          );
        }
      });
      const s = await repo.read(f.owner, input(f, 1));
      assert.equal(s.changes.length, 106);
      assert.equal(
        s.observations.find((o) => o.sourceId === `message:${messageId}`)?.kind,
        'speech',
      );
      assert.deepEqual(
        s.observations.find((o) => o.sourceId === `message:${messageId}`)?.knownByActorIds,
        [f.a],
      );
      const speech = JSON.parse(
        s.observations.find((o) => o.sourceId === `message:${messageId}`)!.text,
      );
      assert.deepEqual(speech.speaker, { kind: 'actor', actorId: f.a });
      assert.equal(speech.conversationActorId, f.a);
      assert.equal(Object.hasOwn(speech, 'origin'), false);
      assert.equal(s.observations.find((o) => o.sourceId === `fact:${factId}`)?.kind, 'fact');
      assert.equal(s.observations.find((o) => o.sourceId === `fact:${beliefId}`)?.kind, 'belief');
      const raw = await repo.readEvidence(f.owner, {
        ...input(f, 1),
        sourceIds: [`event:${e.id}`, `message:${messageId}`],
      });
      assert.deepEqual(raw[0]?.record, e);
      assert.equal((raw[1]?.record as any).text, 'PRIVATE_A_ORIGINAL');
    },
  );
  await t.test(
    'unrelated old chat is omitted until candidate/exact raw source requests it',
    async () => {
      const f = await fixture();
      const id = randomUUID();
      await write(f, undefined, undefined, async (sql, e) =>
        sql.query(
          'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
          [
            id,
            f.worldId,
            f.owner,
            f.a,
            {
              id,
              actorId: f.a,
              role: 'assistant',
              text: 'OLD_SOURCE_EXACT',
              at,
              sourceEventId: e.id,
            },
          ],
        ),
      );
      assert.equal(
        JSON.stringify(await repo.read(f.owner, input(f, 1))).includes('OLD_SOURCE_EXACT'),
        false,
      );
      const candidate = {
        id: 'candidate',
        worldId: f.worldId,
        actorId: f.a,
        source: 'actor_plan' as const,
        episodeId: null,
        actionId: null,
        resourceIds: [],
        channel: 'private' as const,
        threadId: f.a,
        sourceIds: [`message:${id}`],
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        priority: 1,
        reason: 'Own request',
        requiresCoordination: false,
      };
      const s = await repo.read(f.owner, { ...input(f, 1), candidates: [candidate] });
      assert.equal(s.observations.find((o) => o.sourceId === `message:${id}`)?.kind, 'speech');
      await assert.rejects(
        repo.read(f.owner, {
          ...input(f, 1),
          candidates: [{ ...candidate, actorId: f.b, threadId: f.b }],
        }),
        /CANDIDATE_SOURCE_FORBIDDEN/,
      );
      assert.equal(
        (await repo.readEvidence(f.owner, { ...input(f, 1), sourceIds: [`message:${id}`] })).length,
        1,
      );
    },
  );
  await t.test(
    'actual player location is director-only; witnessed departure knowledge is actor-specific and stale-qualified',
    async () => {
      const f = await fixture();
      await write(
        f,
        'travel.completed',
        {
          fromPlaceId: 'from',
          toPlaceId: 'to',
          departedAt: at,
          arrivedAt: at,
          leftSceneId: 'scene',
        },
        async (sql, e) => {
          for (const [subject_key, subject, placeId] of [
            ['player', { kind: 'player' }, 'to'],
            [`actor:${f.a}`, { kind: 'actor', actorId: f.a }, 'from'],
          ] as const) {
            const d = {
              worldId: f.worldId,
              subject,
              status: 'at',
              placeId,
              sourceEventId: e.id,
              worldVersion: 1,
              occurredAt: at,
            };
            await sql.query(
              'INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,$3,$4,1,$5)',
              [f.worldId, f.owner, subject_key, e.id, d],
            );
          }
          const k = {
            worldId: f.worldId,
            observerActorId: f.b,
            subject: { kind: 'player' },
            kind: 'left',
            placeId: 'from',
            sourceKind: 'direct',
            occurredAt: at,
            learnedAt: at,
            sourceEventId: e.id,
            worldVersion: 1,
            possiblyStale: true,
          };
          await sql.query(
            "INSERT INTO parallel_life.actor_position_knowledge(world_id,owner_id,observer_actor_id,subject_key,kind,source_event_id,source_version,document) VALUES($1,$2,$3,'player','left',$4,1,$5)",
            [f.worldId, f.owner, f.b, e.id, k],
          );
        },
      );
      const s = await repo.read(f.owner, input(f, 1));
      assert.deepEqual(
        s.observations.find((o) => o.sourceId === 'actual-position:player')?.knownByActorIds,
        [],
      );
      const knowledge = s.observations.find((o) => o.sourceId.startsWith('position-knowledge:'));
      assert.deepEqual(knowledge?.knownByActorIds, [f.b]);
      assert.equal(knowledge?.text.includes('"placeId":"from"'), true);
      assert.equal(knowledge?.text.includes('"placeId":"to"'), false);
    },
  );
  await t.test(
    'read uses true RR/READ ONLY despite existing owner-setup wrapper; concurrent committed write does not mix versions',
    async () => {
      const f = await fixture();
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          sql.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'),
        ),
        /before any query/,
      );
      let checked = false,
        advanced = false;
      const sqls: string[] = [];
      const instrumented = {
        pool: {
          connect: async () => {
            const client = await app.pool.connect();
            return {
              release: () => client.release(),
              query: async (text: string, args?: any[]) => {
                sqls.push(text);
                const result = await client.query(text, args);
                if (text.includes('FROM parallel_life.worlds') && !checked) {
                  checked = true;
                  const settings = (await client.query('SHOW transaction_isolation')).rows[0];
                  assert.equal(settings.transaction_isolation, 'repeatable read');
                  assert.equal(
                    (await client.query('SHOW transaction_read_only')).rows[0]
                      .transaction_read_only,
                    'on',
                  );
                }
                if (text.includes('FROM parallel_life.actor_agent_states') && !advanced) {
                  advanced = true;
                  await write(f);
                }
                return result;
              },
            };
          },
        },
      } as unknown as PostgresDatabase;
      const s = await new PostgresDirectorSnapshotRepository(instrumented).read(f.owner, input(f));
      assert.equal(s.worldVersion, 0);
      assert.equal(s.observedThroughVersion, 0);
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0]!.version,
        1,
      );
      assert.equal(
        sqls.some((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)),
        false,
      );
    },
  );
  await t.test(
    'epoch/version/stale cursor/boundary/uninitialized cast and future wallclock fail without repair writes',
    async () => {
      const f = await fixture();
      await assert.rejects(
        repo.read(f.owner, { ...input(f), engineEpoch: 3 }),
        /ENGINE_EPOCH_CONFLICT/,
      );
      await assert.rejects(repo.read(f.owner, input(f, 1)), /VERSION_CONFLICT/);
      await assert.rejects(
        repo.read(f.owner, { ...input(f), now: new Date(Date.now() + 60000).toISOString() }),
        /CLOCK_CONFLICT/,
      );
      await admin.query(
        'DELETE FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
        [f.worldId, f.b],
      );
      await assert.rejects(repo.read(f.owner, input(f)), /ACTOR_STATE_INCOMPLETE/);
      const g = await fixture();
      await write(g);
      await admin.query('DELETE FROM parallel_life.world_awareness_boundaries WHERE world_id=$1', [
        g.worldId,
      ]);
      await assert.rejects(repo.read(g.owner, input(g, 1)), /BOUNDARY_STALE/);
      const h = await fixture();
      await write(h);
      await admin.query(
        'UPDATE parallel_life.director_observed_states SET observed_through_version=0,observed_event_id=NULL WHERE world_id=$1',
        [h.worldId],
      );
      await assert.rejects(repo.read(h.owner, input(h, 1)), /OBSERVATION_STALE/);
    },
  );
  await t.test(
    'raw evidence rejects foreign worlds/owners, arbitrary real-profile handles, and worker access',
    async () => {
      const f = await fixture(),
        g = await fixture();
      await assert.rejects(repo.read(f.foreign, input(f)), /NOT_FOUND/);
      await assert.rejects(
        repo.readEvidence(f.owner, { ...input(f), sourceIds: [`genesis:${g.worldId}`] }),
        /SOURCE_NOT_FOUND/,
      );
      await assert.rejects(
        repo.readEvidence(f.owner, { ...input(f), sourceIds: ['profile:real', 'interview:real'] }),
        /SOURCE_NOT_FOUND/,
      );
      await assert.rejects(
        new PostgresDirectorSnapshotRepository(worker).read(f.owner, input(f)),
        /NOT_FOUND|permission denied/,
      );
    },
  );
  await t.test(
    'business attention/candidate scope is validated and no focus is inferred from last message',
    async () => {
      const f = await fixture();
      assert.deepEqual((await repo.read(f.owner, input(f))).focus, []);
      const now = new Date().toISOString(),
        clientId = randomUUID();
      await new PostgresClockActivityRepository(app).update(
        f.owner,
        f.worldId,
        {
          clientId,
          sequence: 1,
          mode: 'conversation',
          focus: { channel: 'private', threadId: f.a },
          resume: true,
        },
        now,
      );
      assert.deepEqual(
        (
          await repo.read(f.owner, {
            ...input(f),
            now,
            focus: [{ channel: 'private', threadId: f.a, actorIds: [f.a] }],
          })
        ).focus,
        [{ channel: 'private', threadId: f.a, actorIds: [f.a] }],
      );
      await assert.rejects(
        repo.read(f.owner, {
          ...input(f),
          focus: [{ channel: 'private', threadId: f.a, actorIds: [f.b] }],
        }),
        /ATTENTION_SCOPE/,
      );
      await assert.rejects(
        repo.read(f.owner, {
          ...input(f),
          focus: [{ channel: 'group', threadId: 'nonexistent', actorIds: [f.a] }],
        }),
        /ATTENTION_SCOPE/,
      );
    },
  );
  await t.test(
    'real attention changes while a director response is pending fence its late result without losing raw or paying again',
    async () => {
      const f = await fixture(),
        activity = new PostgresClockActivityRepository(app),
        clientId = randomUUID();
      await activity.update(f.owner, f.worldId, {
        clientId,
        sequence: 1,
        mode: 'conversation',
        focus: { channel: 'private', threadId: f.a },
        resume: true,
      });
      const s = await repo.read(f.owner, input(f)),
        store = new PostgresDirectorRuntimeRepository(app);
      let a = (
        await store.claim(
          f.owner,
          {
            id: randomUUID(),
            commandId: randomUUID(),
            worldId: f.worldId,
            engineEpoch: 2,
            expectedWorldVersion: 0,
            inputHash: directorSnapshotInputHash(s),
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 60000).toISOString(),
          },
          s,
        )
      ).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      const raw = {
        mode: 'quiet',
        selectedCandidateIds: [],
        deferred: [],
        nudges: [],
        opportunities: [],
        audit: { reason: '合成安静决定', basisSourceIds: [] },
      };
      a = await store.saveResponse(f.owner, a, raw);
      await activity.update(f.owner, f.worldId, { clientId, sequence: 2, mode: 'browsing' });
      await assert.rejects(
        runDirectorAgent(
          {
            attempts: store,
            model: {
              async decide() {
                throw Error('MUST_NOT_REPAY');
              },
            },
            parse: (snapshot, _raw, attempt) => ({
              ...raw,
              schemaVersion: 1,
              id: randomUUID(),
              worldId: f.worldId,
              engineEpoch: 2,
              worldVersion: snapshot.worldVersion,
              inputHash: attempt.inputHash,
              evaluatedThroughVersion: snapshot.observedThroughVersion,
              mode: 'quiet' as const,
            }),
          },
          f.owner,
          a,
          s,
        ),
        /DIRECTOR_ATTENTION_CONFLICT/,
      );
      const stale = (await store.lookup(f.owner, f.worldId, a.commandId))!;
      assert.equal(stale.status, 'stale_discarded');
      assert.equal((await store.readCompletion(f.owner, stale)).found, true);
      assert.equal((await repo.read(f.owner, input(f))).focus.length, 0);
    },
  );
  await t.test(
    'snapshot is accepted by actual75 repository; proposed shared episodes remain full and non-executed',
    async () => {
      const f = await fixture();
      const s = await repo.read(f.owner, input(f));
      const store = new PostgresDirectorRuntimeRepository(app);
      let attempt = (
        await store.claim(
          f.owner,
          {
            id: randomUUID(),
            worldId: f.worldId,
            commandId: randomUUID(),
            engineEpoch: 2,
            expectedWorldVersion: 0,
            inputHash: directorSnapshotInputHash(s),
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 60000).toISOString(),
          },
          s,
        )
      ).attempt;
      attempt = await store.mark(f.owner, attempt, 'request_sent');
      attempt = await store.saveResponse(f.owner, attempt, { synthetic: true });
      const decision: DirectorDecision = {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: f.worldId,
        engineEpoch: 2,
        worldVersion: 0,
        inputHash: directorSnapshotInputHash(s),
        evaluatedThroughVersion: 0,
        mode: 'bounded_opportunity',
        selectedCandidateIds: [],
        deferred: [],
        nudges: [],
        opportunities: [
          {
            id: randomUUID(),
            title: '新的虚构机会',
            description: '在既有地点聊聊',
            playerImpact: '可参与也可不参与',
            participantActorIds: [f.a],
            placeIds: ['from'],
            activity: 'conversation',
            basisSourceIds: [`genesis:${f.worldId}`],
          },
        ],
        audit: { reason: '可选择的机会', basisSourceIds: [`genesis:${f.worldId}`] },
      };
      await store.commit(f.owner, attempt, s, decision);
      const after = await repo.read(f.owner, input(f));
      assert.equal(after.episodes.length, 1);
      assert.equal(after.episodes[0]?.status, 'proposed');
      assert.deepEqual(after.episodes[0]?.sourceEventIds, []);
      assert.equal((await count(f)).events, '0');
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.shared_episodes SET document=jsonb_set(document,'{status}','\"active\"') WHERE world_id=$1",
            [f.worldId],
          ),
        ),
        /INVALID_EPISODE_PROGRESS/,
      );
      assert.deepEqual((await repo.read(f.owner, input(f))).episodes, after.episodes);
      assert.equal((await count(f)).events, '0');
    },
  );
  await t.test(
    'actual native group history knows its historical audience, not only current membership',
    async () => {
      const f = await fixture();
      const groups = new PostgresGroupRepository(app, () => new Date().toISOString());
      const g = await groups.create(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: '合成验证群',
        actorIds: [f.a, f.b],
      });
      await groups.send(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: 1,
        groupId: g.groupId,
        text: 'GROUP_EXACT_ORIGINAL',
      });
      const id = (
        await admin.query('SELECT id FROM parallel_life.world_group_messages WHERE world_id=$1', [
          f.worldId,
        ])
      ).rows[0]!.id;
      await groups.membership(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: 2,
        groupId: g.groupId,
        participant: { kind: 'actor', actorId: f.b },
        action: 'leave',
      });
      const raw = await repo.readEvidence(f.owner, {
        ...input(f, 3),
        sourceIds: [`group-message:${id}`],
      });
      assert.equal(raw[0]?.kind, 'speech');
      assert.deepEqual(raw[0]?.knownByActorIds, [f.a, f.b].sort());
      await assert.rejects(
        repo.read(f.owner, {
          ...input(f, 3),
          focus: [{ channel: 'group', threadId: g.groupId, actorIds: [f.b] }],
        }),
        /ATTENTION_SCOPE/,
      );
    },
  );
  await t.test(
    'scene narration is not adjudication and only actual observable audience knows it',
    async () => {
      const f = await fixture(),
        sceneId = randomUUID(),
        entryId = randomUUID();
      await write(f, 'scene.opened', { sceneId }, async (sql, e) => {
        const scene = {
          id: sceneId,
          ownerId: f.owner,
          worldId: f.worldId,
          sourceEventId: e.id,
          sourceVersion: 1,
          title: '现场',
          status: 'active',
          placeId: 'from',
          presence: [
            {
              participant: { kind: 'player' },
              joinedVersion: 1,
              sourceEventId: e.id,
              sourceVersion: 1,
            },
            {
              participant: { kind: 'actor', actorId: f.a },
              joinedVersion: 1,
              sourceEventId: e.id,
              sourceVersion: 1,
            },
          ],
        };
        await sql.query(
          'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
          [sceneId, f.worldId, f.owner, e.id, scene],
        );
        const doc = {
          id: entryId,
          ownerId: f.owner,
          worldId: f.worldId,
          sceneId,
          sourceEventId: e.id,
          sourceVersion: 1,
          kind: 'narration',
          perspective: 'observable',
          text: '未被判定的现场描述',
          observableTo: [{ kind: 'actor', actorId: f.a }],
        };
        await sql.query(
          "INSERT INTO parallel_life.scene_items(id,world_id,owner_id,scene_id,source_event_id,kind,document) VALUES($1,$2,$3,$4,$5,'entry',$6)",
          [entryId, f.worldId, f.owner, sceneId, e.id, doc],
        );
      });
      const s = await repo.read(f.owner, input(f, 1)),
        o = s.observations.find((x) => x.sourceId === `scene-entry:${entryId}`);
      assert.equal(o?.kind, 'belief');
      assert.deepEqual(o?.knownByActorIds, [f.a]);
    },
  );
  await t.test(
    'budget failure is explicit and does not truncate or write a smaller snapshot',
    async () => {
      const f = await fixture();
      await write(f, undefined, undefined, async (sql, e) => {
        for (let i = 0; i < 360; i++) {
          const id = randomUUID();
          await sql.query(
            'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,$4,$5)',
            [
              id,
              f.worldId,
              f.owner,
              i,
              {
                id,
                kind: 'canonical',
                text: 'x'.repeat(3000),
                visibility: { kind: 'world' },
                sourceEventId: e.id,
              },
            ],
          );
        }
      });
      const before = await count(f);
      await assert.rejects(repo.read(f.owner, input(f, 1)), /SNAPSHOT_BUDGET_EXCEEDED/);
      assert.deepEqual(await count(f), before);
    },
  );
});
