import { readActorEpisodeParticipations } from '../../src/modules/world/infrastructure/episode-lifecycle-repository.ts';
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
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import {
  admitNewAgentNarrativeInTransaction,
  createEpisodeRequestsInTransaction,
} from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { DirectorDecision } from '../../src/modules/world/domain/director-runtime.ts';

// Isolated local fixtures: real application roles, Director/NPC commits and authenticated receipts.
// No provider calls or user worlds; never turn a seeded JSON participation into execution evidence.
test('Director observes authoritative participation across ordinary actor commits', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_PARTICIPATION41_TEST_PORT ?? 55641));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    snapshots = new PostgresDirectorSnapshotRepository(db),
    directors = new PostgresDirectorRuntimeRepository(db);
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  async function fixture() {
    const owner = randomUUID(),
      id = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: '41-A isolated receipt read',
      time: '2026-10-16T00:00:00.000Z',
      actors: [
        { id: randomUUID(), name: '甲', persona: '自主决定是否参加' },
        { id: randomUUID(), name: '乙', persona: '独立参与' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const actor of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId: id, actorId: actor.id },
            agentDefinitionRef(world, actor.id),
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
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, world };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function read(f: F, epoch = 2) {
    return snapshots.read(f.owner, {
      worldId: f.id,
      engineEpoch: epoch,
      worldVersion: (await worlds.get({ userId: f.owner }, f.id)).version,
      candidates: [],
      blockers: [],
    });
  }
  async function handoff(f: F) {
    const snapshot = await read(f);
    let { attempt } = await directors.claim(
      f.owner,
      {
        id: randomUUID(),
        worldId: f.id,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: 0,
        inputHash: directorSnapshotInputHash(snapshot),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    attempt = await directors.mark(f.owner, attempt, 'request_sent');
    attempt = await directors.saveResponse(f.owner, attempt, { synthetic: 'direct typed fixture' });
    const d: DirectorDecision = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: 0,
      inputHash: directorSnapshotInputHash(snapshot),
      evaluatedThroughVersion: 0,
      mode: 'bounded_opportunity',
      authoredAssessments: [],
      selectedCandidateIds: [],
      deferred: [],
      nudges: [],
      opportunities: [
        {
          id: randomUUID(),
          title: '自选讨论机会',
          description: '讨论已有世界内的安排',
          playerImpact: '玩家自由决定',
          participantActorIds: f.world.actors.map((a) => a.id),
          placeIds: [],
          activity: 'conversation',
          basisSourceIds: [`genesis:${f.id}`],
          stagingIntents: f.world.actors.map((a) => ({
            actorId: a.id,
            kind: 'future_task' as const,
            task: '自行决定是否讨论安排',
          })),
        },
      ],
      audit: { reason: 'fixture', basisSourceIds: [`genesis:${f.id}`] },
    };
    await directors.commit(f.owner, attempt, snapshot, d);
    return db.transaction(f.owner, (sql) =>
      createEpisodeRequestsInTransaction(sql, f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        decision: d,
      }),
    );
  }
  async function send(f: F, actorId: string, choice?: 'quiet' | 'decline' | 'need_information') {
    const service = npcAgentServices(db, () => ({
      async complete(messages) {
        const p = JSON.parse(messages[1]!.content);
        // The current input's source handle is resolved against its real accepted receipt.
        const row = (
          await db.transaction(f.owner, (sql) =>
            sql.query(
              "SELECT id FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND document->>'recipientActorId'=$2 AND document->>'text'=$3 ORDER BY created_at DESC LIMIT 1",
              [f.id, actorId, p.input.text],
            ),
          )
        ).rows[0];
        assert.ok(row);
        return JSON.stringify({
          statements: [{ text: '我听到了。', dependsOnActionIds: [] }],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
          ...(choice
            ? {
                episodeDecision: {
                  requestId: p.episodeManifest.requestId,
                  choice,
                  reason: `本人选择${choice}`,
                  sourceIds: [row.id, 'episode-intent:' + p.episodeManifest.requestId],
                },
              }
            : {}),
        });
      },
    }));
    const result = await service.sendMessageIfEnabled(f.owner, {
      id: randomUUID(),
      worldId: f.id,
      actorId,
      expectedVersion: (await worlds.get({ userId: f.owner }, f.id)).version,
      text: '了解你当前的想法 ' + randomUUID(),
    });
    assert.equal(result?.status, 'committed');
  }
  await t.test(
    'quiet and decline survive JSON retirement and another normal chat; forged JSON never enters',
    async () => {
      const f = await fixture();
      await handoff(f);
      for (const [i, choice] of ['quiet', 'decline'].entries())
        await send(f, f.world.actors[i]!.id, choice as 'quiet' | 'decline');
      const before = await read(f);
      assert.deepEqual(
        before.actorStates.flatMap((s) => s.episodeParticipations!.map((p) => p.choice)).sort(),
        ['decline', 'quiet'],
      );
      const persisted = (
        await admin.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
          [f.id],
        )
      ).rows;
      assert.ok(persisted.every((r) => !('episodeParticipations' in r.document)));
      for (const actor of f.world.actors) await send(f, actor.id);
      assert.deepEqual(
        (await read(f)).actorStates.map((s) => s.episodeParticipations),
        before.actorStates.map((s) => s.episodeParticipations),
      );
      await admin.query(
        "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{episodeParticipations}',$2::jsonb) WHERE world_id=$1",
        [
          f.id,
          JSON.stringify([
            {
              id: 'forged',
              choice: 'engage',
              reason: 'FORGED',
              sourceIds: [],
              recordedAtVersion: 0,
            },
          ]),
        ],
      );
      assert.deepEqual(
        (await read(f)).actorStates.map((s) => s.episodeParticipations),
        before.actorStates.map((s) => s.episodeParticipations),
      );
      const projected = await read(f);
      const { attempt } = await directors.claim(
        f.owner,
        {
          id: randomUUID(),
          worldId: f.id,
          commandId: randomUUID(),
          engineEpoch: 2,
          expectedWorldVersion: projected.worldVersion,
          inputHash: directorSnapshotInputHash(projected),
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 120000).toISOString(),
        },
        projected,
      );
      assert.equal(attempt.status, 'reserved');
      await directors.mark(f.owner, attempt, 'cancelled_before_send');
      const foreign = randomUUID();
      await new IdentityRepository(db).ensureGuest(foreign);
      await assert.rejects(
        snapshots.read(foreign, {
          worldId: f.id,
          engineEpoch: 2,
          worldVersion: (await worlds.get({ userId: f.owner }, f.id)).version,
          candidates: [],
          blockers: [],
        }),
      );
    },
  );
  await t.test(
    'need_information remains explicit and previous engine receipts are excluded',
    async () => {
      const f = await fixture();
      await handoff(f);
      await send(f, f.world.actors[0]!.id, 'need_information');
      const before = await read(f);
      assert.equal(
        before.actorStates.find((s) => s.actorId === f.world.actors[0]!.id)!
          .episodeParticipations![0]!.choice,
        'need_information',
      );
      await db.transaction(f.owner, (sql) =>
        switchAgentEngineEpochInTransaction(sql, f.owner, {
          worldId: f.id,
          expectedWorldVersion: before.worldVersion,
          expectedEpoch: 2,
          nextEpoch: 3,
        }),
      );
      const after = await db.transaction(f.owner, async (sql) => {
        const rows = (
          await sql.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2',
            [f.id, f.owner],
          )
        ).rows;
        const projected = [];
        for (const row of rows)
          projected.push(await readActorEpisodeParticipations(sql, f.owner, row.document));
        return projected;
      });
      assert.ok(after.every((participations) => participations.length === 0));
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_episode_receipts WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        1,
        'historical receipt not deleted',
      );
    },
  );
  await t.test('receipt reason inconsistent with committed event is rejected', async () => {
    const f = await fixture();
    await handoff(f);
    await send(f, f.world.actors[0]!.id, 'quiet');
    await admin.query(
      "UPDATE parallel_life.agent_episode_receipts SET reason='FORGED' WHERE world_id=$1",
      [f.id],
    );
    await assert.rejects(read(f), { code: 'EPISODE_LIFECYCLE_SOURCE_CONFLICT' });
  });
});
