import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { readWorldAttentionInTransaction } from '../../src/modules/world/infrastructure/world-attention-repository.ts';
import { requireEpisodeDeliveryInTransaction } from '../../src/modules/world/infrastructure/agent-episode-attention.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  admitNewAgentNarrativeInTransaction,
  readPendingEpisodeRequestsInTransaction,
} from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresDirectorRuntimeRepository } from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  emptyActorAgentState,
  type ActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import {
  npcAgentAdvanceServices,
  readNpcAgentStoryProgressIfEnabled,
} from '../../src/server/npc-agent-advance-services.ts';

const empty = (): AgentProposal => ({
  statements: [],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});
type NpcPayload = {
  promptVersion: string;
  state: ActorAgentState;
  worldVersion: number;
  input: { sourceId: string; text: string; origin: string };
};

// Real owner-RLS stores, director snapshot, advance, NPC runner and kernel. All models below
// are explicit synthetic fixtures; no handcrafted epoch-2 events or live model success claims.
test('actual advance bootstraps admitted genesis and dispatches independent episode considerations', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_EPISODE_ADVANCE_TEST_PORT ?? 55503));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    actors = new PostgresAgentRuntimeRepository(db),
    directors = new PostgresDirectorRuntimeRepository(db),
    clocks = new PostgresClockStore(db),
    snapshots = new PostgresDirectorSnapshotRepository(db),
    activity = new PostgresClockActivityRepository(db);
  const owned: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned) await clocks.setClock(f.owner, f.worldId, { paused: true });
    } finally {
      await db.close();
      await admin.end();
    }
  });
  async function fixture(admitted = true) {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Explicit actual handoff advance fixture',
      time: '2026-10-16T00:00:00.000Z',
      actors: [
        { id: randomUUID(), name: '甲', persona: '有自己的安排，独立决定是否参加。' },
        { id: randomUUID(), name: '乙', persona: '尊重他人安排，可以参与讨论。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    owned.push({ owner, worldId });
    await db.transaction(owner, async (sql) => {
      for (const actor of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId: actor.id },
            agentDefinitionRef(world, actor.id),
            0,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      if (admitted)
        await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await clocks.setClock(owner, worldId, { paused: false, speed: 0 });
    return { owner, worldId, world };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function count(f: Fixture, table: string) {
    assert.ok(
      [
        'world_events',
        'world_messages',
        'commands',
        'agent_episode_receipts',
        'agent_episode_requests',
        'publication_story_plans',
        'agent_input_receipts',
        'agent_attempts',
        'director_runtime_attempts',
        'director_decisions',
        'outbox_jobs',
      ].includes(table),
    );
    return Number(
      (
        await admin.query(`SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`, [
          f.worldId,
        ])
      ).rows[0].n,
    );
  }
  const pending = (f: Fixture) =>
    db.transaction(f.owner, (sql) =>
      readPendingEpisodeRequestsInTransaction(sql, f.owner, { worldId: f.worldId, engineEpoch: 2 }),
    );
  const state = (f: Fixture, actorId: string) =>
    actors.read(f.owner, { worldId: f.worldId, actorId });
  async function receipts(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.agent_episode_receipts WHERE world_id=$1 ORDER BY world_version,id',
        [f.worldId],
      )
    ).rows;
  }
  async function frozenWorldRows(f: Fixture) {
    const tables = [
      'worlds',
      'world_events',
      'world_messages',
      'commands',
      'actor_agent_states',
      'agent_episode_receipts',
      'agent_episode_requests',
      'shared_episodes',
      'outbox_jobs',
    ];
    const rows: Record<string, unknown> = {};
    for (const table of tables)
      rows[table] = (
        await admin.query(
          `SELECT to_jsonb(t) document FROM parallel_life.${table} t WHERE ${table === 'worlds' ? 'id' : 'world_id'}=$1 ORDER BY to_jsonb(t)::text`,
          [f.worldId],
        )
      ).rows;
    return rows;
  }
  async function attemptRows(f: Fixture) {
    return (
      await admin.query(
        `SELECT a.*,r.document input FROM parallel_life.agent_attempts a
       JOIN parallel_life.agent_input_receipts r ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
       WHERE a.world_id=$1 ORDER BY a.created_at,a.id`,
        [f.worldId],
      )
    ).rows;
  }
  const attention = (f: Fixture) =>
    db.transaction(f.owner, (sql) =>
      readWorldAttentionInTransaction(sql, f.owner, { worldId: f.worldId, worldVersion: 0 }),
    );
  async function noNpcCommit(f: Fixture, requestsCreated = true) {
    assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, 0);
    for (const table of [
      'world_events',
      'world_messages',
      'commands',
      'agent_episode_receipts',
      'outbox_jobs',
    ])
      assert.equal(await count(f, table), 0, table);
    for (const actor of f.world.actors) {
      assert.equal((await state(f, actor.id))?.revision, 0);
      assert.equal((await state(f, actor.id))?.episodeParticipations, undefined);
    }
    if (!requestsCreated) {
      assert.deepEqual(await pending(f), []);
      assert.deepEqual(await directors.readEpisodes(f.owner, f.worldId), []);
      return;
    }
    assert.equal((await pending(f)).length, 2);
    assert.ok((await pending(f)).every((r) => r.inputReceiptId === null && r.receiptId === null));
    assert.equal((await directors.readEpisodes(f.owner, f.worldId))[0]?.status, 'proposed');
  }
  async function deliveryBoundary(
    f: Fixture,
    boundary: 'pause' | 'managed_inactive' | 'managed_expired',
    client: string,
  ) {
    if (boundary === 'pause') return clocks.setClock(f.owner, f.worldId, { paused: true });
    await activity.update(f.owner, f.worldId, {
      clientId: client,
      sequence: 0,
      mode: boundary === 'managed_inactive' ? 'away' : 'browsing',
    });
    if (boundary === 'managed_expired') {
      // Controlled expiration of a real persisted business lease. paused stays false,
      // so the guard must independently enforce managed active_until; no world event is fabricated.
      await admin.query(
        "UPDATE parallel_life.world_clock SET active_until=clock_timestamp()-interval '1 second' WHERE world_id=$1 AND owner_id=$2",
        [f.worldId, f.owner],
      );
      const actual = (
        await admin.query(
          'SELECT paused,managed,active_until<clock_timestamp() expired FROM parallel_life.world_clock WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0];
      assert.deepEqual(actual, { paused: false, managed: true, expired: true });
    }
  }
  function harness(
    f: Fixture,
    options: {
      firstChoice?: 'quiet' | 'decline';
      directorUnknown?: boolean;
      npcUnknown?: boolean;
      duringDirector?: () => Promise<void>;
      duringNpc?: (payload: NpcPayload, index: number) => Promise<void>;
    } = {},
  ) {
    const calls: { kind: 'director' | 'npc'; payload: any }[] = [];
    const model: TextModel = {
      async complete(messages: ModelMessage[]) {
        const payload = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        const kind = payload.promptVersion.startsWith('director-') ? 'director' : 'npc';
        calls.push({ kind, payload });
        assert.equal(
          db.pool.totalCount,
          db.pool.idleCount,
          'no model call may hold an app transaction',
        );
        await admin.query('SELECT id FROM parallel_life.worlds WHERE id=$1 FOR UPDATE NOWAIT', [
          f.worldId,
        ]);
        if (kind === 'director') {
          if (options.directorUnknown) throw Error('EXPLICIT_DIRECTOR_TRANSPORT_UNKNOWN');
          const initial = calls.filter((c) => c.kind === 'director').length === 1;
          if (initial) await options.duringDirector?.();
          return JSON.stringify({
            mode: initial ? 'bounded_opportunity' : 'quiet',
            selectedCandidateIds: [],
            deferred: [],
            nudges: [],
            opportunities: initial
              ? [
                  {
                    id: randomUUID(),
                    title: '各自决定是否讨论',
                    description: 'DIRECTOR_GLOBAL_DESTINATION_PRIVATE',
                    playerImpact: '主角仍可自行选择',
                    participantActorIds: f.world.actors.map((a) => a.id),
                    placeIds: [],
                    activity: 'conversation',
                    basisSourceIds: [`genesis:${f.worldId}`],
                  },
                ]
              : [],
            audit: {
              reason: 'DIRECTOR_GLOBAL_AUDIT_PRIVATE',
              basisSourceIds: [`genesis:${f.worldId}`],
            },
          });
        }
        assert.match(payload.promptVersion, /^npc-agent-/);
        const npc = payload as NpcPayload;
        const intent = JSON.parse(npc.input.text);
        assert.deepEqual(
          Object.keys(intent).sort(),
          ['type', 'requestId', 'revision', 'activity', 'placeOptionIds', 'basisSourceIds'].sort(),
        );
        assert.equal(intent.type, 'npc_episode_consideration');
        assert.equal(npc.input.origin, 'coordination');
        assert.deepEqual(intent.placeOptionIds, []);
        assert.deepEqual(intent.basisSourceIds, [`definition:${npc.state.definitionRef}`]);
        assert.doesNotMatch(
          JSON.stringify(payload),
          /DIRECTOR_GLOBAL_DESTINATION_PRIVATE|DIRECTOR_GLOBAL_AUDIT_PRIVATE/,
        );
        const npcIndex = calls.filter((c) => c.kind === 'npc').length;
        if (npcIndex === 1 && options.npcUnknown) throw Error('EXPLICIT_NPC_TRANSPORT_UNKNOWN');
        await options.duringNpc?.(npc, npcIndex);
        const first = npcIndex === 1;
        return JSON.stringify({
          ...empty(),
          statements: first
            ? []
            : [{ text: '我愿意参加讨论，但尚未实际完成事件。', dependsOnActionIds: [] }],
          episodeDecision: {
            requestId: intent.requestId,
            choice: first ? (options.firstChoice ?? 'decline') : 'engage',
            reason: first ? 'OWN_PRIVATE_DECLINE_REASON' : '我愿意按自己的安排参与。',
            sourceIds: [npc.input.sourceId, `definition:${npc.state.definitionRef}`],
          },
        });
      },
    };
    return {
      calls,
      npcCalls: () => calls.filter((c) => c.kind === 'npc'),
      directorCalls: () => calls.filter((c) => c.kind === 'director'),
      service: npcAgentAdvanceServices(db, () => model, snapshots),
    };
  }

  await t.test(
    'unadmitted empty worlds remain quiet without a Director call or old plan initialization',
    async () => {
      const f = await fixture(false),
        h = harness(f);
      for (let i = 0; i < 3; i++) {
        const result = await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(result?.played, 0);
        assert.deepEqual(result?.actors, []);
      }
      assert.equal(h.calls.length, 0);
      for (const table of [
        'world_events',
        'agent_attempts',
        'director_decisions',
        'publication_story_plans',
      ])
        assert.equal(await count(f, table), 0);
    },
  );

  await t.test(
    'one genesis bootstrap dispatches silent quiet/decline then another actor engages at the new version; replay and idle do not repurchase',
    async () => {
      for (const firstChoice of ['quiet', 'decline'] as const) {
        const f = await fixture(),
          h = harness(f, { firstChoice });
        const first = await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(first?.changed, true);
        assert.equal(first?.worldVersion, 1);
        assert.equal(first?.played, 0);
        assert.equal(h.directorCalls().length, 1);
        assert.equal(h.directorCalls()[0]!.payload.evaluationCause.kind, 'bootstrap');
        assert.deepEqual(h.directorCalls()[0]!.payload.candidates, []);
        assert.equal(h.npcCalls().length, 1);
        const a = h.npcCalls()[0]!.payload as NpcPayload;
        assert.equal(a.worldVersion, 0);
        assert.deepEqual(a.state.plans, []);
        assert.equal(
          (await state(f, a.state.actorId))?.episodeParticipations?.[0]?.choice,
          firstChoice,
        );
        assert.equal((await pending(f)).length, 1);
        assert.equal(await count(f, 'world_messages'), 0);
        assert.equal((await directors.readEpisodes(f.owner, f.worldId))[0]?.status, 'proposed');
        const second = await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(second?.worldVersion, 2);
        assert.equal(second?.played, 1);
        assert.equal(
          h.directorCalls().length,
          1,
          'pending second actor precedes one coalesced global evaluation',
        );
        const b = h.npcCalls()[1]!.payload as NpcPayload;
        assert.notEqual(a.state.actorId, b.state.actorId);
        assert.equal(b.worldVersion, 1);
        assert.doesNotMatch(JSON.stringify(b), /OWN_PRIVATE_DECLINE_REASON/);
        assert.equal(b.state.episodeParticipations, undefined);
        assert.equal((await pending(f)).length, 0);
        assert.deepEqual((await state(f, a.state.actorId))?.decisions, []);
        assert.deepEqual((await state(f, b.state.actorId))?.decisions, []);
        const saved = await receipts(f);
        assert.deepEqual(
          saved.map((r) => [r.actor_id, r.choice, r.world_version]),
          [
            [a.state.actorId, firstChoice, 1],
            [b.state.actorId, 'engage', 2],
          ],
        );
        const [episode] = await directors.readEpisodes(f.owner, f.worldId);
        assert.equal(episode!.status, 'active');
        assert.equal(episode!.sourceEventIds.length, 1);
        assert.deepEqual(episode!.resultIds, []);
        assert.deepEqual(episode!.unresolvedResponsibilityIds, []);
        assert.deepEqual(
          (await readNpcAgentStoryProgressIfEnabled(db, f.owner, f.worldId))?.presented,
          [],
        );
        assert.equal(await count(f, 'publication_story_plans'), 0);
        const beforeReplay = await frozenWorldRows(f);
        const attemptRow = (
          await admin.query(
            'SELECT command_id FROM parallel_life.agent_attempts WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, b.state.actorId],
          )
        ).rows[0];
        const attempt = (await actors.lookup(f.owner, f.worldId, attemptRow.command_id))!;
        await runNpcAgent(
          {
            attempts: actors,
            kernel: new PostgresNpcAgentKernel(db, worlds),
            model: {
              async decide() {
                throw Error('REPLAY_MUST_NOT_CALL_MODEL');
              },
            },
          },
          f.owner,
          attempt,
          null,
        );
        assert.deepEqual(await frozenWorldRows(f), beforeReplay);
        await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(
          h.directorCalls().length,
          2,
          'actual participation changes justify one global assessment',
        );
        assert.equal(h.npcCalls().length, 2);
        const frozen = await frozenWorldRows(f);
        for (let i = 0; i < 3; i++)
          assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.played, 0);
        assert.deepEqual(await frozenWorldRows(f), frozen);
        assert.equal(h.calls.length, 4);
        assert.equal(await count(f, 'director_runtime_attempts'), 2);
      }
    },
  );

  await t.test(
    'unknown Director transport preserves the admitted cause and never buys another bootstrap',
    async () => {
      const f = await fixture(),
        h = harness(f, { directorUnknown: true });
      await assert.rejects(
        h.service.advanceIfEnabled(f.owner, f.worldId),
        /EXPLICIT_DIRECTOR_TRANSPORT_UNKNOWN/,
      );
      for (let i = 0; i < 3; i++)
        await assert.rejects(
          h.service.advanceIfEnabled(f.owner, f.worldId),
          (error: any) => error.code === 'UNKNOWN',
        );
      assert.equal(h.calls.length, 1);
      assert.equal(await count(f, 'director_runtime_attempts'), 1);
      assert.equal(await count(f, 'agent_episode_requests'), 0);
      assert.equal(await count(f, 'world_events'), 0);
      assert.equal(
        (
          await admin.query(
            'SELECT status FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].status,
        'unknown_after_send',
      );
    },
  );

  await t.test(
    'unknown NPC consideration is never rebought while the other actor can independently commit',
    async () => {
      const f = await fixture(),
        h = harness(f, { npcUnknown: true });
      await assert.rejects(
        h.service.advanceIfEnabled(f.owner, f.worldId),
        /EXPLICIT_NPC_TRANSPORT_UNKNOWN/,
      );
      const unknownActor = h.npcCalls()[0]!.payload.state.actorId;
      assert.equal((await pending(f)).length, 2);
      const next = await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(next?.worldVersion, 1);
      assert.equal(h.directorCalls().length, 1);
      assert.equal(h.npcCalls().length, 2);
      assert.notEqual(h.npcCalls()[1]!.payload.state.actorId, unknownActor);
      assert.equal((await state(f, unknownActor))?.episodeParticipations, undefined);
      assert.equal((await pending(f)).length, 1);
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      for (let i = 0; i < 3; i++) await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(h.npcCalls().length, 2);
      assert.equal(h.directorCalls().length, 2);
      assert.equal((await receipts(f)).length, 1);
      const attempts = (
        await admin.query(
          'SELECT actor_id,status FROM parallel_life.agent_attempts WHERE world_id=$1 ORDER BY actor_id',
          [f.worldId],
        )
      ).rows;
      assert.equal(attempts.find((a) => a.actor_id === unknownActor)?.status, 'unknown_after_send');
      assert.equal(attempts.length, 2);
    },
  );

  await t.test(
    'pause or managed inactivity during the real Director call defers all NPC delivery and resumes the original opportunity',
    async () => {
      for (const boundary of ['pause', 'managed_inactive', 'managed_expired'] as const) {
        const f = await fixture(),
          client = randomUUID();
        const h = harness(f, {
          async duringDirector() {
            await deliveryBoundary(f, boundary, client);
          },
        });
        const result = await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(result?.played, 0);
        assert.equal(h.directorCalls().length, 1);
        assert.equal(h.npcCalls().length, 0);
        await noNpcCommit(f, false);
        assert.equal(await count(f, 'agent_attempts'), 0);
        assert.equal(await count(f, 'agent_input_receipts'), 0);
        const original = await directors.readEpisodes(f.owner, f.worldId);
        const requests = await pending(f);
        assert.deepEqual(original, []);
        assert.deepEqual(requests, []);
        const savedDirector = (
          await admin.query(
            'SELECT id,status,sent_at,response_hash,response FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
            [f.worldId],
          )
        ).rows;
        assert.equal(savedDirector.length, 1);
        assert.equal(savedDirector[0].status, 'response_received');
        assert.ok(savedDirector[0].sent_at);
        assert.ok(savedDirector[0].response_hash);
        const savedRaw =
          typeof savedDirector[0].response === 'string'
            ? JSON.parse(savedDirector[0].response)
            : savedDirector[0].response;
        const savedOpportunityId = savedRaw.opportunities[0].id;
        const clock = await clocks.read(f.owner, f.worldId);
        assert.equal(clock.paused, true);
        if (boundary === 'managed_inactive') {
          assert.equal(clock.managed, true);
          assert.equal(clock.activeUntil, null);
        }
        for (let i = 0; i < 2; i++) await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(h.calls.length, 1);
        assert.deepEqual(await pending(f), requests);
        if (boundary === 'pause')
          await clocks.setClock(f.owner, f.worldId, { paused: false, speed: 0 });
        else
          await activity.update(f.owner, f.worldId, {
            clientId: client,
            sequence: 1,
            mode: 'browsing',
            resume: true,
          });
        const recovered = await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(recovered?.worldVersion, 1);
        assert.equal(h.directorCalls().length, 1);
        assert.equal(h.npcCalls().length, 1);
        const resumedEpisodes = await directors.readEpisodes(f.owner, f.worldId);
        assert.equal(resumedEpisodes.length, 1);
        assert.equal(resumedEpisodes[0]!.id, savedOpportunityId);
        assert.equal(resumedEpisodes[0]!.status, 'proposed');
        assert.equal((await receipts(f))[0]!.episode_id, savedOpportunityId);
        const deliveredRequest = (await receipts(f))[0]!.request_id;
        const resumedRequests = (
          await admin.query(
            'SELECT id FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND episode_id=$2',
            [f.worldId, savedOpportunityId],
          )
        ).rows;
        assert.equal(resumedRequests.length, 2);
        assert.ok(resumedRequests.some((request) => request.id === deliveredRequest));
        const sameDirector = (
          await admin.query(
            'SELECT id,response_hash,status FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
            [f.worldId],
          )
        ).rows;
        assert.equal(sameDirector.length, 1);
        assert.equal(sameDirector[0].id, savedDirector[0].id);
        assert.equal(sameDirector[0].response_hash, savedDirector[0].response_hash);
        assert.equal(sameDirector[0].status, 'committed');
      }
    },
  );
  await t.test(
    'a real claim trigger pauses after an eligible pre-read; zero-send cancellation alone permits a stable same-frame retry',
    async () => {
      const f = await fixture(),
        h = harness(f);
      await db.transaction(f.owner, (sql) =>
        requireEpisodeDeliveryInTransaction(sql, f.owner, {
          worldId: f.worldId,
          worldVersion: 0,
          actorId: f.world.actors[0]!.id,
        }),
      );
      assert.deepEqual(await attention(f), { focus: [], conversationWithoutTarget: false });
      const trigger = `zzz_episode_claim_pause_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE FUNCTION parallel_life.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS(SELECT 1 FROM parallel_life.world_clock WHERE world_id=NEW.world_id AND paused) THEN
            RAISE EXCEPTION 'CLAIM_WAS_NOT_ELIGIBLE_BEFORE_TRIGGER';
          END IF;
          UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=NEW.world_id;
          RETURN NEW;
        END $$`);
      await admin.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON parallel_life.agent_attempts
        FOR EACH ROW WHEN (NEW.world_id='${f.worldId}') EXECUTE FUNCTION parallel_life.${trigger}()`);
      try {
        assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.played, 0);
      } finally {
        await admin.query(`DROP TRIGGER ${trigger} ON parallel_life.agent_attempts`);
        await admin.query(`DROP FUNCTION parallel_life.${trigger}()`);
      }
      await noNpcCommit(f);
      assert.equal(h.directorCalls().length, 1);
      assert.equal(h.npcCalls().length, 0);
      const before = await attemptRows(f);
      assert.equal(before.length, 1);
      const cancelled = before[0]!;
      assert.equal(cancelled.status, 'cancelled_before_send');
      assert.equal(cancelled.sent_at, null);
      assert.equal(cancelled.response, null);
      assert.equal(cancelled.expected_world_version, 0);
      assert.equal((await clocks.read(f.owner, f.worldId)).paused, true);
      const requestId = JSON.parse(cancelled.input.text).requestId;
      const command = (zeroSendCancels: number) => {
        const digest = createHash('sha256')
          .update(
            JSON.stringify(['npc-episode-evaluation-v2', f.worldId, requestId, 0, zeroSendCancels]),
          )
          .digest('hex');
        return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      };
      assert.equal(cancelled.command_id, command(0));
      await clocks.setClock(f.owner, f.worldId, { paused: false, speed: 0 });
      assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.worldVersion, 1);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(h.directorCalls().length, 1);
      const after = await attemptRows(f);
      assert.equal(after.length, 2);
      const committed = after.find((attempt) => attempt.status === 'committed')!;
      assert.ok(committed.sent_at);
      assert.equal(committed.expected_world_version, 0);
      assert.equal(committed.actor_id, cancelled.actor_id);
      assert.equal(JSON.parse(committed.input.text).requestId, requestId);
      assert.equal(committed.command_id, command(1));
      assert.notEqual(committed.command_id, cancelled.command_id);
      assert.deepEqual(
        after.find((attempt) => attempt.id === cancelled.id),
        cancelled,
      );
      const frozen = await frozenWorldRows(f);
      const original = (await actors.lookup(f.owner, f.worldId, committed.command_id))!;
      await runNpcAgent(
        {
          attempts: actors,
          kernel: new PostgresNpcAgentKernel(db, worlds),
          model: {
            async decide() {
              throw Error('NO_PAID_RETRY');
            },
          },
        },
        f.owner,
        original,
        null,
      );
      assert.deepEqual(await frozenWorldRows(f), frozen);
      assert.equal((await receipts(f)).length, 1);
      assert.equal(h.npcCalls().length, 1);
    },
  );
  await t.test(
    'a legal unbound conversation lease during NPC completion defers commit and preserves raw until browsing resumes',
    async () => {
      const f = await fixture(),
        client = randomUUID();
      const h = harness(f, {
        async duringNpc(_payload, index) {
          if (index === 1)
            await activity.update(f.owner, f.worldId, {
              clientId: client,
              sequence: 0,
              mode: 'conversation',
              focus: null,
            });
        },
      });
      assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.played, 0);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(h.directorCalls().length, 1);
      assert.deepEqual(await attention(f), { focus: [], conversationWithoutTarget: true });
      const lease = (
        await admin.query(
          'SELECT mode,focus FROM parallel_life.world_clock_activity WHERE world_id=$1 AND client_id=$2',
          [f.worldId, client],
        )
      ).rows[0];
      assert.deepEqual(lease, { mode: 'conversation', focus: null });
      await noNpcCommit(f);
      const [received] = await attemptRows(f);
      assert.equal(received.status, 'response_received');
      assert.ok(received.sent_at);
      assert.ok(received.response_hash);
      assert.equal(received.response.kind, 'npc_agent_completion');
      assert.equal(
        JSON.parse(received.response.response).episodeDecision.reason,
        'OWN_PRIVATE_DECLINE_REASON',
      );
      const frozen = await frozenWorldRows(f);
      for (let i = 0; i < 3; i++)
        assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.played, 0);
      assert.deepEqual(await frozenWorldRows(f), frozen);
      assert.deepEqual((await attemptRows(f))[0], received);
      assert.equal(h.calls.length, 2);
      await activity.update(f.owner, f.worldId, {
        clientId: client,
        sequence: 1,
        mode: 'browsing',
      });
      assert.deepEqual(await attention(f), { focus: [], conversationWithoutTarget: false });
      assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.worldVersion, 1);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(h.directorCalls().length, 1);
      const [committed] = await attemptRows(f);
      assert.equal(committed.status, 'committed');
      for (const key of [
        'id',
        'actor_id',
        'command_id',
        'input_receipt_id',
        'input_hash',
        'sent_at',
        'response_hash',
        'response',
      ])
        assert.deepEqual(committed[key], received[key], key);
      assert.equal((await receipts(f))[0]!.attempt_id, received.id);
      assert.equal((await receipts(f))[0]!.choice, 'decline');
      assert.equal((await pending(f)).length, 1);
    },
  );
  await t.test(
    'pause or managed inactivity after NPC send retains its protected response without consuming or repurchasing',
    async () => {
      for (const boundary of ['pause', 'managed_inactive', 'managed_expired'] as const) {
        const f = await fixture(),
          client = randomUUID();
        const h = harness(f, {
          async duringNpc(_payload, index) {
            if (index !== 1) return;
            await deliveryBoundary(f, boundary, client);
          },
        });
        assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.played, 0);
        await noNpcCommit(f);
        const [received] = await attemptRows(f);
        assert.equal(received.status, 'response_received');
        assert.ok(received.sent_at);
        for (let i = 0; i < 2; i++) await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.deepEqual((await attemptRows(f))[0], received);
        assert.equal(h.npcCalls().length, 1);
        if (boundary === 'pause')
          await clocks.setClock(f.owner, f.worldId, { paused: false, speed: 0 });
        else
          await activity.update(f.owner, f.worldId, {
            clientId: client,
            sequence: 1,
            mode: 'browsing',
            resume: true,
          });
        assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.worldVersion, 1);
        assert.equal(h.npcCalls().length, 1);
        assert.equal(h.directorCalls().length, 1);
        const [committed] = await attemptRows(f);
        assert.equal(committed.id, received.id);
        assert.equal(committed.command_id, received.command_id);
        assert.equal(committed.response_hash, received.response_hash);
        assert.deepEqual(committed.response, received.response);
        assert.equal((await receipts(f))[0]!.attempt_id, received.id);
      }
    },
  );
  await t.test(
    'actual forgetting of a paid consideration source still fences the commit and cannot be renamed into a second paid attempt',
    async () => {
      const f = await fixture();
      const h = harness(f, {
        async duringNpc(payload, index) {
          if (index !== 1) return;
          await admin.query(
            "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Synthetic forgotten episode input',$5,'agent_inference',$6,'forgotten')",
            [
              randomUUID(),
              f.owner,
              payload.state.actorId,
              f.worldId,
              randomUUID(),
              JSON.stringify([payload.input.sourceId]),
            ],
          );
        },
      });
      await assert.rejects(h.service.advanceIfEnabled(f.owner, f.worldId), {
        code: 'INPUT_SCOPE_FORBIDDEN',
      });
      await noNpcCommit(f);
      const [stale] = await attemptRows(f);
      assert.equal(stale.status, 'stale_discarded');
      assert.ok(stale.sent_at);
      assert.ok(stale.response_hash);
      const forgottenActor = stale.actor_id;
      assert.equal((await h.service.advanceIfEnabled(f.owner, f.worldId))?.worldVersion, 1);
      for (let i = 0; i < 3; i++) await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(
        h.npcCalls().filter((call) => call.payload.state.actorId === forgottenActor).length,
        1,
      );
      assert.equal((await state(f, forgottenActor))?.episodeParticipations, undefined);
      const after = await attemptRows(f);
      assert.deepEqual(
        after.find((attempt) => attempt.id === stale.id),
        stale,
      );
      assert.equal(after.filter((attempt) => attempt.actor_id === forgottenActor).length, 1);
      assert.equal((await receipts(f)).length, 1);
      assert.equal((await pending(f)).length, 1);
    },
  );
  await t.test(
    'actual advance receipt fault rolls back the NPC event/state/consume, then recovers protected response without a second model call',
    async () => {
      const f = await fixture(),
        h = harness(f);
      const trigger = `zzz_advance_receipt_${randomUUID().replaceAll('-', '')}`;
      await admin.query(
        `CREATE FUNCTION parallel_life.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_ADVANCE_RECEIPT_FAILURE'; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON parallel_life.agent_episode_receipts FOR EACH ROW WHEN (NEW.world_id='${f.worldId}') EXECUTE FUNCTION parallel_life.${trigger}()`,
      );
      try {
        await assert.rejects(
          h.service.advanceIfEnabled(f.owner, f.worldId),
          /SYNTHETIC_ADVANCE_RECEIPT_FAILURE/,
        );
      } finally {
        await admin.query(`DROP TRIGGER ${trigger} ON parallel_life.agent_episode_receipts`);
        await admin.query(`DROP FUNCTION parallel_life.${trigger}()`);
      }
      assert.equal(h.directorCalls().length, 1);
      assert.equal(h.npcCalls().length, 1);
      assert.equal((await pending(f)).length, 2);
      for (const table of [
        'world_events',
        'world_messages',
        'commands',
        'agent_episode_receipts',
        'outbox_jobs',
      ])
        assert.equal(await count(f, table), 0);
      assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, 0);
      const a = h.npcCalls()[0]!.payload.state.actorId;
      assert.equal((await state(f, a))?.revision, 0);
      assert.equal((await state(f, a))?.episodeParticipations, undefined);
      const recovered = await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(recovered?.worldVersion, 1);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(h.directorCalls().length, 1);
      assert.equal((await receipts(f)).length, 1);
      assert.equal((await pending(f)).length, 1);
      assert.equal((await state(f, a))?.episodeParticipations?.[0]?.choice, 'decline');
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(h.npcCalls().length, 2);
      assert.equal((await receipts(f)).length, 2);
    },
  );
});
