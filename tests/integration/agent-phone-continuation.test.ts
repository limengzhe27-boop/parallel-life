import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { SqlClient } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
import {
  npcAgentAdvanceServices,
  readNpcAgentOpeningStatusIfEnabled,
} from '../../src/server/npc-agent-advance-services.ts';
import { OpeningStatusSchema } from '../../src/contracts/publication-opening.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { ModelMessage, TextModel } from '../../src/modules/ai/application/ports.ts';

test('read-only native phone continuation probes feed the actual protected advance', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_PHONE_CONTINUATION_TEST_PORT ?? 55505));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db),
    snapshots = new PostgresDirectorSnapshotRepository(db),
    directors = new PostgresDirectorRuntimeRepository(db);
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await db.close();
      await admin.end();
    }
  });
  const secret = 'DIRECTOR_PRIVATE_MANUSCRIPT_SECRET_85';
  let totalModelCalls = 0;
  async function fixture(options: { admit?: boolean; epoch?: 1 | 2 } = {}) {
    const owner = randomUUID(),
      id = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      title: 'Only local phone continuation',
      version: 0,
      time: '2026-10-16T00:00:00.000Z',
      actors: [
        { id: randomUUID(), name: '甲', persona: '自主谨慎。允许安静和拒绝。' },
        { id: randomUUID(), name: '乙', persona: '温和直接。自己决定是否继续。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    owned.push({ owner, id });
    if (options.epoch !== 1)
      await db.transaction(owner, async (sql) => {
        for (const a of world.actors)
          await initializeActorAgentStateInTransaction(
            sql,
            owner,
            emptyActorAgentState(
              { worldId: id, actorId: a.id },
              agentDefinitionRef(world, a.id),
              0,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId: id,
          expectedWorldVersion: 0,
          expectedEpoch: 1,
          nextEpoch: 2,
        });
        if (options.admit !== false)
          await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
      });
    return { owner, id, world };
  }
  type Fixture = { owner: string; id: string; world: WorldState };
  const code = (expected: string) => (e: unknown) =>
    !!e && typeof e === 'object' && 'code' in e && e.code === expected;
  async function rows(f: Fixture, table: string) {
    return (
      await admin.query(
        `SELECT to_jsonb(x) AS row FROM parallel_life.${table} x WHERE ${table === 'worlds' ? 'id' : 'world_id'}=$1 ORDER BY to_jsonb(x)::text`,
        [f.id],
      )
    ).rows;
  }
  async function frozen(f: Fixture) {
    const out: Record<string, unknown> = {};
    for (const table of [
      'worlds',
      'world_initial_snapshots',
      'world_clock',
      'world_clock_activity',
      'agent_runtime_worlds',
      'agent_narrative_admissions',
      'actor_agent_states',
      'agent_attempts',
      'agent_input_receipts',
      'agent_action_results',
      'director_runtime_attempts',
      'director_decisions',
      'director_observed_states',
      'director_pending_reasons',
      'shared_episodes',
      'agent_episode_requests',
      'agent_episode_receipts',
      'world_events',
      'commands',
      'world_messages',
      'world_awareness_boundaries',
      'publication_story_plans',
      'publication_story_nodes',
      'publication_story_receipts',
      'publication_story_progress',
      'publication_opening_batches',
      'publication_opening_deliveries',
    ])
      out[table] = await rows(f, table);
    return out;
  }
  async function probe(f: Fixture) {
    const p = await readNpcAgentOpeningStatusIfEnabled(db, f.owner, f.id);
    assert.ok(p);
    OpeningStatusSchema.parse(p);
    assert.deepEqual(
      Object.keys(p).sort(),
      ['runtime', 'phase', 'total', 'delivered', 'retryable', 'continuation'].sort(),
    );
    assert.equal(p.runtime, 'agents');
    assert.equal(p.total, 0);
    assert.equal(p.delivered, 0);
    assert.equal(p.retryable, false);
    assert.equal(JSON.stringify(p).includes(secret), false);
    return p.continuation!;
  }
  async function repeatedProbe(f: Fixture, expected: 'ready' | 'quiet' | 'pending' | 'deferred') {
    const before = await frozen(f),
      calls = totalModelCalls;
    const probes = await Promise.all(Array.from({ length: 5 }, () => probe(f)));
    assert.equal(probes[0]!.status, expected);
    for (const p of probes) assert.deepEqual(p, probes[0]);
    if (probes[0]!.status === 'ready') assert.match(probes[0]!.key, /^[a-f0-9]{64}$/);
    assert.equal(totalModelCalls, calls);
    assert.deepEqual(
      await frozen(f),
      before,
      'probe must not initialize, adopt, claim, renew activity, or write receipts',
    );
    return probes[0]!;
  }
  async function browse(f: Fixture, clientId = randomUUID(), sequence = 0, resume = true) {
    await activity.update(f.owner, f.id, { clientId, sequence, mode: 'browsing', resume });
    await clocks.setClock(f.owner, f.id, { speed: 0 });
    return clientId;
  }
  const quiet = () => ({
    mode: 'quiet',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [],
    audit: { reason: secret, basisSourceIds: [] },
  });
  function harness(
    f: Fixture,
    options: {
      opportunity?: boolean;
      single?: boolean;
      director?: 'unknown' | 'invalid';
      npc?: 'unknown' | 'invalid';
      afterDirector?: () => Promise<void>;
      afterNpc?: () => Promise<void>;
    } = {},
  ) {
    const calls: { kind: 'director' | 'npc'; payload: any }[] = [];
    const model: TextModel = {
      async complete(messages: ModelMessage[]) {
        totalModelCalls++;
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content),
          kind = p.promptVersion.startsWith('director-') ? 'director' : 'npc';
        calls.push({ kind, payload: p });
        assert.equal(
          db.pool.totalCount,
          db.pool.idleCount,
          'model executes outside the app transaction',
        );
        await admin.query('SELECT id FROM parallel_life.worlds WHERE id=$1 FOR UPDATE NOWAIT', [
          f.id,
        ]);
        if (kind === 'director') {
          if (options.director === 'unknown') throw Error('LOCAL_DIRECTOR_TRANSPORT_UNKNOWN_85');
          if (options.director === 'invalid') return 'LOCAL_INVALID_DIRECTOR_JSON';
          await options.afterDirector?.();
          return JSON.stringify(
            options.opportunity && calls.filter((c) => c.kind === 'director').length === 1
              ? {
                  ...quiet(),
                  mode: 'bounded_opportunity',
                  opportunities: [
                    {
                      id: randomUUID(),
                      title: '合成可选话题',
                      description: secret,
                      playerImpact: '自主选择',
                      participantActorIds: options.single
                        ? [f.world.actors[0]!.id]
                        : f.world.actors.map((a) => a.id),
                      placeIds: [],
                      activity: 'conversation',
                      basisSourceIds: [`genesis:${f.id}`],
                    },
                  ],
                }
              : quiet(),
          );
        }
        assert.equal(messages[1]!.content.includes(secret), false);
        const intent = JSON.parse(p.input.text);
        assert.equal(intent.type, 'npc_episode_consideration');
        if (options.npc === 'unknown') throw Error('LOCAL_NPC_TRANSPORT_UNKNOWN_85');
        if (options.npc === 'invalid') return 'LOCAL_INVALID_NPC_JSON';
        await options.afterNpc?.();
        return JSON.stringify({
          statements: [],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
          episodeDecision: {
            requestId: intent.requestId,
            choice: 'quiet',
            reason: '本人考虑后选择安静。',
            sourceIds: [p.input.sourceId],
          },
        });
      },
    };
    const service = npcAgentAdvanceServices(db, () => model, snapshots);
    return {
      calls,
      model,
      advance: () => service.advanceIfEnabled(f.owner, f.id),
      director: () => calls.filter((c) => c.kind === 'director'),
      npc: () => calls.filter((c) => c.kind === 'npc'),
    };
  }
  async function attemptRows(f: Fixture, kind: 'director' | 'npc') {
    return (
      await admin.query(
        `SELECT * FROM parallel_life.${kind === 'director' ? 'director_runtime_attempts' : 'agent_attempts'} WHERE world_id=$1 ORDER BY created_at,id`,
        [f.id],
      )
    ).rows;
  }

  await t.test(
    'fresh admitted world without a clock is deferred and repeated GET probe writes nothing',
    async () => {
      const f = await fixture();
      await repeatedProbe(f, 'deferred');
      assert.equal((await rows(f, 'world_clock')).length, 0);
      assert.equal((await rows(f, 'director_runtime_attempts')).length, 0);
    },
  );
  await t.test(
    'unmanaged or paused clock and expired activity require actual resume rather than GET adoption',
    async () => {
      const f = await fixture();
      await clocks.setClock(f.owner, f.id, { paused: true, speed: 0 });
      await repeatedProbe(f, 'deferred');
      const client = await browse(f);
      await repeatedProbe(f, 'ready');
      await clocks.setClock(f.owner, f.id, { paused: true });
      await activity.update(f.owner, f.id, { clientId: client, sequence: 1, mode: 'browsing' });
      await repeatedProbe(f, 'deferred');
      await browse(f, client, 2, true);
      await repeatedProbe(f, 'ready');
      // Controlled expiry of the real activity clock, not an invented event or attempt.
      await admin.query(
        "UPDATE parallel_life.world_clock SET active_until=clock_timestamp()-interval '1 second' WHERE world_id=$1 AND owner_id=$2",
        [f.id, f.owner],
      );
      await repeatedProbe(f, 'deferred');
      await browse(f, client, 3, false);
      await repeatedProbe(f, 'deferred');
      await browse(f, client, 4, true);
      await repeatedProbe(f, 'ready');
    },
  );
  await t.test(
    'active epoch2 old life without explicit genesis admission stays quiet and is not adopted by reads or advance',
    async () => {
      const f = await fixture({ admit: false });
      await browse(f);
      const h = harness(f),
        before = await frozen(f);
      await repeatedProbe(f, 'quiet');
      await h.advance();
      await h.advance();
      assert.equal(h.calls.length, 0);
      assert.equal((await rows(f, 'agent_narrative_admissions')).length, 0);
      // Normal advance may refresh observation projections, never admission or AI execution.
      for (const table of [
        'director_runtime_attempts',
        'director_decisions',
        'agent_attempts',
        'agent_episode_requests',
      ])
        assert.deepEqual(await rows(f, table), before[table]);
    },
  );
  await t.test(
    'active explicit genesis has a stable opaque key, then one quiet bootstrap and no repeat purchase',
    async () => {
      const f = await fixture();
      await browse(f);
      const first = await repeatedProbe(f, 'ready'),
        h = harness(f);
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal(h.npc().length, 0);
      assert.equal(h.director()[0]!.payload.evaluationCause.kind, 'bootstrap');
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      await repeatedProbe(f, 'quiet');
      await h.advance();
      await h.advance();
      assert.equal(h.calls.length, 1);
      assert.equal((await attemptRows(f, 'director'))[0].status, 'committed');
      const other = await fixture();
      await browse(other);
      assert.notDeepEqual(await repeatedProbe(other, 'ready'), first, 'key is world/epoch scoped');
    },
  );
  await t.test(
    'deep private reading and another live tab defer entry until every conversation returns to browsing',
    async () => {
      const f = await fixture(),
        one = await browse(f),
        two = randomUUID();
      await new PostgresGroupRepository(db).create(f.owner, {
        worldId: f.id,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: '真实建立的合成联系人群',
        actorIds: f.world.actors.map((a) => a.id),
      });
      const original = await repeatedProbe(f, 'ready');
      await activity.update(f.owner, f.id, {
        clientId: one,
        sequence: 1,
        mode: 'conversation',
        focus: { channel: 'private', threadId: f.world.actors[0]!.id },
      });
      await repeatedProbe(f, 'deferred');
      const h = harness(f);
      assert.equal((await h.advance())!.played, 0);
      assert.equal(h.calls.length, 0);
      await activity.update(f.owner, f.id, { clientId: two, sequence: 0, mode: 'browsing' });
      await repeatedProbe(f, 'deferred');
      await activity.update(f.owner, f.id, { clientId: one, sequence: 2, mode: 'browsing' });
      assert.deepEqual(await repeatedProbe(f, 'ready'), original);
      await activity.update(f.owner, f.id, {
        clientId: two,
        sequence: 1,
        mode: 'conversation',
        focus: { channel: 'private', threadId: f.world.actors[1]!.id },
      });
      await repeatedProbe(f, 'deferred');
      await activity.update(f.owner, f.id, { clientId: one, sequence: 3, mode: 'browsing' });
      await repeatedProbe(f, 'deferred');
      await activity.update(f.owner, f.id, { clientId: two, sequence: 2, mode: 'browsing' });
      assert.deepEqual(await repeatedProbe(f, 'ready'), original);
    },
  );
  await t.test(
    'actual bootstrap opportunity dispatches each of two NPC requests once; quiet is consumption, not presentation',
    async () => {
      const f = await fixture();
      await browse(f);
      const h = harness(f, { opportunity: true });
      const first = await repeatedProbe(f, 'ready');
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal(h.npc().length, 1);
      const next = await repeatedProbe(f, 'ready');
      assert.notDeepEqual(next, first);
      const requests = (await rows(f, 'agent_episode_requests')).map((r) => r.row);
      assert.equal(requests.filter((r) => r.status === 'pending').length, 1);
      assert.equal(requests.filter((r) => r.status === 'consumed').length, 1);
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal(h.npc().length, 2);
      assert.equal((await rows(f, 'agent_episode_receipts')).length, 2);
      assert.equal(
        (await rows(f, 'agent_episode_requests')).every((r) => r.row.status === 'consumed'),
        true,
      );
      assert.equal((await rows(f, 'shared_episodes'))[0].row.document.status, 'proposed');
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 2);
      assert.equal((await rows(f, 'world_messages')).length, 0);
      await repeatedProbe(f, 'quiet');
      await h.advance();
      await h.advance();
      assert.equal(h.npc().length, 2);
      assert.equal(h.director().length, 2);
      assert.equal(h.director()[1]!.payload.evaluationCause, undefined);
      assert.ok(h.director()[1]!.payload.changes.every((c: any) => c.kind === 'cross_impact'));
      assert.equal(h.calls.length, 4);
      await h.advance();
      assert.equal(h.calls.length, 4);
    },
  );
  await t.test(
    'a real reserved Director attempt is pending; zero-send cancellation yields one stable new bootstrap key',
    async () => {
      const f = await fixture();
      await browse(f);
      const first = await repeatedProbe(f, 'ready');
      const s = await snapshots.read(f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: 0,
        candidates: [],
        blockers: [],
      });
      const { attempt } = await directors.claim(
        f.owner,
        {
          id: randomUUID(),
          worldId: f.id,
          commandId: randomUUID(),
          engineEpoch: 2,
          expectedWorldVersion: 0,
          inputHash: directorSnapshotInputHash(s),
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 120000).toISOString(),
        },
        s,
      );
      await repeatedProbe(f, 'pending');
      const before = totalModelCalls;
      await directors.mark(f.owner, attempt, 'cancelled_before_send');
      const next = await repeatedProbe(f, 'ready');
      assert.notDeepEqual(next, first);
      assert.equal(totalModelCalls, before);
      const h = harness(f);
      await h.advance();
      assert.equal(h.calls.length, 1);
      await repeatedProbe(f, 'quiet');
    },
  );
  for (const bad of ['unknown', 'invalid'] as const)
    await t.test(
      `paid ${bad} Director is never renamed or falsely offered a fresh bootstrap`,
      async () => {
        const f = await fixture();
        await browse(f);
        const h = harness(f, { director: bad });
        await assert.rejects(
          h.advance(),
          bad === 'unknown'
            ? /LOCAL_DIRECTOR_TRANSPORT_UNKNOWN_85/
            : code('INVALID_DIRECTOR_PROPOSAL'),
        );
        const original = (await attemptRows(f, 'director'))[0];
        assert.ok(original.sent_at);
        await repeatedProbe(f, bad === 'unknown' ? 'pending' : 'quiet');
        try {
          await h.advance();
        } catch (e) {
          assert.ok(bad === 'unknown' && code('UNKNOWN')(e));
        }
        assert.equal(h.calls.length, 1);
        assert.equal((await attemptRows(f, 'director')).length, 1);
        assert.equal((await attemptRows(f, 'director'))[0].command_id, original.command_id);
        assert.equal((await rows(f, 'director_decisions')).length, 0);
      },
    );
  for (const bad of ['unknown', 'invalid'] as const)
    await t.test(
      `paid ${bad} NPC request is not advertised as a new opportunity or purchased again`,
      async () => {
        const f = await fixture();
        await browse(f);
        const h = harness(f, { opportunity: true, single: true, npc: bad });
        await assert.rejects(
          h.advance(),
          bad === 'unknown' ? /LOCAL_NPC_TRANSPORT_UNKNOWN_85/ : code('INVALID_AGENT_PROPOSAL'),
        );
        const original = (await attemptRows(f, 'npc'))[0];
        assert.ok(original.sent_at);
        await repeatedProbe(f, 'quiet');
        await h.advance();
        await h.advance();
        assert.equal(h.director().length, 1);
        assert.equal(h.npc().length, 1);
        assert.equal((await attemptRows(f, 'npc')).length, 1);
        assert.equal((await attemptRows(f, 'npc'))[0].id, original.id);
        assert.equal((await rows(f, 'agent_episode_receipts')).length, 0);
        assert.equal((await rows(f, 'agent_episode_requests'))[0].row.status, 'pending');
      },
    );
  for (const kind of ['director', 'npc'] as const)
    await t.test(
      `${kind} paid raw after pause is offered only as its original free recovery`,
      async () => {
        const f = await fixture(),
          client = await browse(f);
        let paused = false;
        const pause = async () => {
          if (!paused) {
            paused = true;
            await clocks.setClock(f.owner, f.id, { paused: true });
          }
        };
        const h = harness(
          f,
          kind === 'director'
            ? { afterDirector: pause }
            : { opportunity: true, single: true, afterNpc: pause },
        );
        const result = await h.advance();
        assert.equal(result!.played, 0);
        const original = (await attemptRows(f, kind))[0];
        assert.equal(original.status, 'response_received');
        assert.ok(original.response_hash);
        assert.ok(original.sent_at);
        await repeatedProbe(f, 'deferred');
        await browse(f, client, 1, true);
        const ready = await repeatedProbe(f, 'ready');
        assert.equal(ready.status, 'ready');
        const paid = h.calls.length;
        await h.advance();
        assert.equal(h.calls.length, paid);
        const done = (await attemptRows(f, kind))[0];
        assert.equal(done.id, original.id);
        assert.equal(done.command_id, original.command_id);
        assert.equal(done.response_hash, original.response_hash);
        assert.deepEqual(done.response, original.response);
        assert.equal(done.status, 'committed');
        await repeatedProbe(f, 'quiet');
        await h.advance();
        // The newly committed NPC stance is an actual cross_impact, allowing one ordinary quiet coordination.
        assert.equal(h.calls.length, kind === 'npc' ? paid + 1 : paid);
        if (kind === 'npc') {
          assert.equal(h.npc().length, 1);
          assert.equal(h.director()[1]!.payload.evaluationCause, undefined);
        }
        const settled = h.calls.length;
        await h.advance();
        assert.equal(h.calls.length, settled);
      },
    );
  await t.test(
    'late actual NPC receipt SQL rollback is a read-only raw hint, then same-raw free continuation',
    async () => {
      const f = await fixture();
      await browse(f);
      const h = harness(f, { opportunity: true, single: true });
      const name = 'phone85_' + randomUUID().replaceAll('-', '');
      await admin.query(
        `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_PHONE85_LATE_RECEIPT';END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.agent_episode_receipts FOR EACH ROW WHEN(NEW.world_id='${f.id}') EXECUTE FUNCTION parallel_life.${name}()`,
      );
      try {
        await assert.rejects(h.advance(), /LOCAL_PHONE85_LATE_RECEIPT/);
        assert.equal((await rows(f, 'world_events')).length, 0);
        assert.equal((await rows(f, 'agent_episode_receipts')).length, 0);
        assert.equal((await rows(f, 'agent_episode_requests'))[0].row.status, 'pending');
        assert.equal((await attemptRows(f, 'npc'))[0].status, 'response_received');
        await repeatedProbe(f, 'ready');
      } finally {
        await admin.query(`DROP TRIGGER ${name} ON parallel_life.agent_episode_receipts`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
      }
      const original = (await attemptRows(f, 'npc'))[0],
        paid = h.calls.length;
      await h.advance();
      assert.equal(h.calls.length, paid);
      assert.equal((await attemptRows(f, 'npc'))[0].id, original.id);
      assert.equal((await attemptRows(f, 'npc'))[0].response_hash, original.response_hash);
      assert.equal((await rows(f, 'agent_episode_receipts')).length, 1);
      await repeatedProbe(f, 'quiet');
    },
  );
  await t.test(
    'expired paid Director raw cannot advertise a continuation that the original recovery rejects',
    async () => {
      const f = await fixture(),
        client = await browse(f);
      const s = await snapshots.read(f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: 0,
        candidates: [],
        blockers: [],
      });
      const leaseUntil = new Date(Date.now() + 2000).toISOString();
      const claim = {
        id: randomUUID(),
        worldId: f.id,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: 0,
        inputHash: directorSnapshotInputHash(s),
        token: randomUUID(),
        leaseUntil,
      };
      const h = harness(f, {
        afterDirector: async () => {
          await clocks.setClock(f.owner, f.id, { paused: true });
        },
      });
      await assert.rejects(
        runDirectorAgent(
          {
            attempts: directors,
            parse: parseDirectorDecision,
            model: new WorldDirectorAgentModel(h.model),
          },
          f.owner,
          claim,
          s,
        ),
        code('DIRECTOR_DELIVERY_DEFERRED'),
      );
      const raw = (await attemptRows(f, 'director'))[0];
      assert.equal(raw.status, 'response_received');
      assert.ok(raw.response_hash);
      assert.ok(raw.sent_at);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, Date.parse(leaseUntil) - Date.now() + 80)),
      );
      await browse(f, client, 1, true);
      const before = await frozen(f),
        calls = h.calls.length;
      const continuation = await probe(f);
      assert.deepEqual(
        continuation,
        { status: 'pending' },
        'expired protected raw is not recoverable under the original lease',
      );
      assert.deepEqual(await frozen(f), before);
      assert.equal(h.calls.length, calls);
      await assert.rejects(h.advance(), code('VERSION_CONFLICT'));
      assert.equal((await attemptRows(f, 'director'))[0].status, 'stale_discarded');
      assert.equal((await attemptRows(f, 'director'))[0].response_hash, raw.response_hash);
      await repeatedProbe(f, 'quiet');
      assert.equal(h.calls.length, calls);
    },
  );
  await t.test(
    'actual bound publication trial keeps opening phase honest and never leaks manuscript into the probe',
    async () => {
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
      try {
        const staff = randomUUID();
        await admin.query(
          'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
          [staff, 'Only local phone continuation trial'],
        );
        const raw = await readFile(
          new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
          'utf8',
        );
        const content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
        content.candidates = [
          {
            key: 'opening',
            kind: 'candidate',
            title: '合成未演绎开场',
            editorialIntent: secret,
            script: secret,
            sceneText: secret,
            actorKeys: content.actors.map((a: { key: string }) => a.key),
            prerequisites: [],
            mutuallyExclusiveNodeKeys: [],
            intent: { kind: 'director_event' },
          },
        ];
        content.openingEventKey = 'opening';
        const works = new PublicationRepository(pub);
        const work = await works.create(staff, {
          commandId: randomUUID(),
          title: 'Only local phone continuation',
          content,
        });
        const repository = new PublicationWorldRepository(pub, {
          prepare(input) {
            const result = compilePublicationGenesis({
              ...input,
              originKind: input.originKind === 'trial' ? 'trial' : 'published',
              newId: randomUUID,
            });
            assert.equal(result.status, 'compiled');
            if (result.status !== 'compiled') throw Error('LOCAL_PHONE85_COMPILE_FAILED');
            return {
              world: result.world,
              opening: result.opening,
              seed: {
                id: input.seedId,
                createdAt: new Date().toISOString(),
                source: {
                  kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
                  ...input.origin,
                },
                identity: result.opening.identity,
                situation: result.opening.situation,
                setting: result.opening.setting,
                experienceNote: result.opening.experienceNote,
              },
            };
          },
        });
        const start = await repository.startTrial(staff, work.id, {
          commandId: randomUUID(),
          draftVersion: 0,
          contentHash: (await works.get(staff, work.id)).draft.contentHash,
        });
        const session = await repository.trialSession(staff, start.trialId!);
        const owner = session.ownerId,
          id = session.worldId,
          world = await worlds.get({ userId: owner }, id),
          f = { owner, id, world };
        owned.push(f);
        await db.transaction(owner, async (sql) => {
          for (const a of world.actors)
            await initializeActorAgentStateInTransaction(
              sql,
              owner,
              emptyActorAgentState(
                { worldId: id, actorId: a.id },
                agentDefinitionRef(world, a.id),
                0,
              ),
            );
          await switchAgentEngineEpochInTransaction(sql, owner, {
            worldId: id,
            expectedWorldVersion: 0,
            expectedEpoch: 1,
            nextEpoch: 2,
          });
          await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
        });
        const first = await readNpcAgentOpeningStatusIfEnabled(db, owner, id);
        assert.equal(first!.phase, 'unplanned');
        assert.equal(JSON.stringify(first).includes(secret), false);
        await repeatedProbe(f, 'deferred');
        await browse(f);
        await repeatedProbe(f, 'ready');
        const h = harness(f);
        await h.advance();
        assert.equal(h.calls.length, 1);
        assert.ok(h.director()[0]!.payload.authoredMaterials);
        await repeatedProbe(f, 'quiet');
        await h.advance();
        assert.equal(h.calls.length, 1);
        assert.equal((await rows(f, 'publication_story_plans')).length, 0);
        assert.equal((await rows(f, 'publication_opening_batches')).length, 0);
        assert.equal((await readNpcAgentOpeningStatusIfEnabled(db, owner, id))!.phase, 'unplanned');
      } finally {
        await pub.close();
      }
    },
  );
  await t.test(
    'owner isolation and epoch1 do not expose a native continuation or adopt an old runtime',
    async () => {
      const f = await fixture(),
        old = await fixture({ epoch: 1 });
      await browse(f);
      await browse(old);
      const before = await frozen(f),
        oldBefore = await frozen(old),
        calls = totalModelCalls;
      await assert.rejects(
        readNpcAgentOpeningStatusIfEnabled(db, old.owner, f.id),
        code('NOT_FOUND'),
      );
      assert.equal(await readNpcAgentOpeningStatusIfEnabled(db, old.owner, old.id), null);
      const h = harness(old);
      assert.equal(await h.advance(), null);
      assert.equal(h.calls.length, 0);
      assert.equal(totalModelCalls, calls);
      assert.deepEqual(await frozen(f), before);
      assert.deepEqual(await frozen(old), oldBefore);
      const worker = new PostgresDatabase(
        `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      );
      try {
        await assert.rejects(readNpcAgentOpeningStatusIfEnabled(worker, f.owner, f.id));
      } finally {
        await worker.close();
      }
      assert.deepEqual(await frozen(f), before);
    },
  );
});
