import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
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
    snapshots = new PostgresDirectorSnapshotRepository(db);
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
  function harness(
    f: Fixture,
    options: {
      firstChoice?: 'quiet' | 'decline';
      directorUnknown?: boolean;
      npcUnknown?: boolean;
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
