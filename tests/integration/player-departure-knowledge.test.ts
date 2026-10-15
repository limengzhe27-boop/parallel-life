import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { sceneEnvironmentTaskHandler } from '../../src/modules/world/infrastructure/agent-scene-environment.ts';
import { PostgresWorldAwarenessRepository } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';
import { buildAgenda } from '../../src/modules/world/domain/agenda.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TravelEvent } from '../../src/modules/world/domain/space.ts';
const at = '2026-10-15T09:00:00.000Z';
test('actual player travel does not certify a scene roster as departure witnesses', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.PLAYER_DEPARTURE_TEST_PORT ?? 55503));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await queue.pool.end();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    space = new PostgresWorldSpace(db, officialLifeCatalog),
    scenes = new SceneRepository(db),
    awareness = new PostgresWorldAwarenessRepository(db),
    agents = new PostgresAgentRuntimeRepository(db);
  async function fixture() {
    const owner = randomUUID(),
      mom = randomUUID(),
      other = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const world: WorldState = {
      schemaVersion: 1,
      id: randomUUID(),
      ownerId: owner,
      title: 'Synthetic departure perception',
      version: 0,
      time: at,
      actors: [
        { id: mom, name: '母亲', persona: '有自己的生活，不知道没有观察到的事情。' },
        { id: other, name: '另一人物', persona: '独立的人物。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        places: [
          {
            id: 'home',
            name: '家',
            description: '同一地图地点不证明看见出门',
            source,
            contactActorIds: [other],
            appointmentIds: [],
          },
          {
            id: 'park',
            name: '公园',
            description: '另一个地图地点',
            source,
            contactActorIds: [],
            appointmentIds: [],
          },
        ],
        routes: [
          {
            id: 'to_park',
            fromPlaceId: 'home',
            toPlaceId: 'park',
            durationMinutes: 15,
            modeLabel: '步行',
            source,
          },
        ],
        currentPlaceId: 'home',
        positionSource: source,
      },
    };
    await worlds.initialize({ userId: owner }, world);
    // Explicit synthetic initial physical truth, not inferred from mother/house/contact labels.
    const setupId = randomUUID(),
      commandId = randomUUID(),
      setup = {
        schemaVersion: 1,
        id: setupId,
        worldId: world.id,
        commandId,
        version: 1,
        occurredAt: at,
        storyAt: at,
        type: 'test.fixture_setup',
        data: { actorId: mom },
      };
    await admin.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,0,$4,'{}','running')",
      [commandId, world.id, owner, createHash('sha256').update(commandId).digest('hex')],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,$4,$5,$6)',
      [setupId, world.id, owner, commandId, setup, at],
    );
    const next = { ...world, version: 1 };
    await admin.query('UPDATE parallel_life.worlds SET version=1,state=$2 WHERE id=$1', [
      world.id,
      next,
    ]);
    await admin.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
      [world.id, commandId, setupId, next],
    );
    await db.transaction(owner, async (sql) => {
      for (const actorId of [mom, other])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId: world.id, actorId },
            agentDefinitionRef(world, actorId),
            1,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: world.id,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });
      const position = {
        worldId: world.id,
        subject: { kind: 'actor', actorId: mom },
        status: 'at',
        placeId: 'home',
        sourceEventId: setupId,
        worldVersion: 1,
        occurredAt: at,
      };
      await sql.query(
        'INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,$3,$4,1,$5)',
        [world.id, owner, 'actor:' + mom, setupId, position],
      );
    });
    await new PostgresClockStore(db).ensureAnchor(owner, world.id, {
      storyNow: at,
      lastTickAt: new Date().toISOString(),
      speed: 0,
      paused: false,
      missedBeats: 0,
      summary: null,
    });
    return { owner, mom, other, worldId: world.id };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function openScene(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const entered = await scenes.enterPlace(f.owner, f.worldId, {
      commandId: randomUUID(),
      expectedVersion: world.version,
      placeId: 'home',
    });
    assert.ok(entered.task);
    const lease = await queue.claimForOwner(entered.task.id, f.owner, ['world']);
    assert.ok(lease);
    assert.equal(await sceneEnvironmentTaskHandler(db)(lease, new AbortController().signal), true);
    const read = await scenes.read(f.owner, f.worldId, entered.sceneId);
    assert.ok(
      read.scene?.presence.some(
        (p) => p.participant.kind === 'actor' && p.participant.actorId === f.mom,
      ),
    );
    assert.equal(
      read.scene?.presence.some(
        (p) => p.participant.kind === 'actor' && p.participant.actorId === f.other,
      ),
      false,
    );
    return entered.sceneId;
  }
  async function travel(f: Fixture) {
    const before = await worlds.get({ userId: f.owner }, f.worldId),
      request = { commandId: randomUUID(), expectedVersion: before.version, routeId: 'to_park' };
    const receipt = await space.travel(f.owner, f.worldId, request);
    const event = (
      await admin.query(
        'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND id=$2',
        [f.worldId, receipt.sourceEventId],
      )
    ).rows[0].payload as TravelEvent;
    assert.equal(Object.hasOwn(event.data, 'departureObservation'), false);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM parallel_life.world_facts WHERE world_id=$1 AND document->>'sourceEventId'=$2",
          [f.worldId, event.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM parallel_life.actor_position_knowledge WHERE world_id=$1 AND source_event_id=$2',
          [f.worldId, event.id],
        )
      ).rows[0].n,
      0,
    );
    const actual = (
      await admin.query(
        "SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key='player'",
        [f.worldId],
      )
    ).rows[0].document;
    assert.equal(actual.placeId, 'park');
    assert.equal(actual.occurredAt, receipt.arrivedAt);
    assert.equal(actual.sourceEventId, event.id);
    const clock = (
      await admin.query('SELECT story_now FROM parallel_life.world_clock WHERE world_id=$1', [
        f.worldId,
      ])
    ).rows[0];
    assert.equal(new Date(clock.story_now).toISOString(), receipt.arrivedAt);
    assert.deepEqual(await space.travel(f.owner, f.worldId, request), receipt);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1 AND command_id=$2',
          [f.worldId, request.commandId],
        )
      ).rows[0].n,
      1,
    );
    return { before, request, receipt, event };
  }
  async function snapshot(f: Fixture, actorId = f.mom) {
    const world = await worlds.get({ userId: f.owner }, f.worldId),
      state = (await agents.read(f.owner, { worldId: f.worldId, actorId }))!;
    return (await readPrivateAgentSnapshot(db, f.owner, world, actorId, null, world.time, state))
      .snapshot;
  }
  async function noMovementKnowledge(f: Fixture, event: TravelEvent) {
    for (const actorId of [f.mom, f.other]) {
      const read = await awareness.readActorAwareness(f.owner, f.worldId, actorId);
      assert.equal(
        read.knowledge.some((k) => k.sourceEventId === event.id),
        false,
      );
      const s = await snapshot(f, actorId);
      assert.equal(
        s.sources.some((source) => source.recordId === event.id),
        false,
      );
      assert.equal(
        s.worldContext?.knowledge.some(
          (k) => k.kind === 'left' || (k.subject.kind === 'player' && k.placeId === 'park'),
        ),
        false,
      );
      assert.equal(
        s.observations.some((o) => o.text.includes('亲眼看到')),
        false,
      );
      const results = await Promise.all(
        createAgentScheduleSources({
          worldId: f.worldId,
          engineEpoch: 2,
          worldVersion: s.worldVersion,
          storyAt: s.storyAt,
          actors: [{ snapshot: s, trustedResults: [], appointments: [] }],
          activeAttempts: [],
          consumedCandidateIds: [],
        }).map((source) => source.source.collect(f.owner, f.worldId)),
      );
      assert.equal(
        results.flatMap((r) => r.candidates).some((c) => c.source === 'observation'),
        false,
      );
    }
  }
  await t.test(
    'same-place actual scene presence does not prove exit visibility; movement and scene exit still commit',
    async () => {
      const f = await fixture(),
        sceneId = await openScene(f);
      const initial = (await scenes.read(f.owner, f.worldId, sceneId)).scene!;
      const result = await travel(f);
      assert.equal(result.receipt.leftSceneId, sceneId);
      assert.equal((await scenes.read(f.owner, f.worldId)).scene, null);
      const persisted = (
        await admin.query(
          'SELECT document FROM parallel_life.scene_sessions WHERE world_id=$1 AND id=$2',
          [f.worldId, sceneId],
        )
      ).rows[0].document;
      assert.equal(persisted.status, 'active');
      assert.equal(
        persisted.presence.find(
          (p: { participant: { kind: string } }) => p.participant.kind === 'player',
        ).leftVersion,
        result.receipt.version,
      );
      assert.deepEqual(
        persisted.presence.filter(
          (p: { participant: { kind: string } }) => p.participant.kind === 'actor',
        ),
        initial.presence.filter((p) => p.participant.kind === 'actor'),
      );
      await noMovementKnowledge(f, result.event);
      assert.equal(
        buildAgenda(await worlds.get({ userId: f.owner }, f.worldId)).some(
          (thread) => thread.kind === 'departure_inquiry',
        ),
        false,
      );
    },
  );
  await t.test(
    'same-place position and contact/role names outside an active scene also do not notify observers',
    async () => {
      const f = await fixture();
      const result = await travel(f);
      assert.equal(result.receipt.leftSceneId, null);
      await noMovementKnowledge(f, result.event);
      const experience = (
        await admin.query(
          'SELECT current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0];
      assert.ok(!experience?.current_scene_id);
    },
  );
  await t.test(
    'actual player report remains reported/stale and does not become direct departure or destination knowledge',
    async () => {
      const f = await fixture();
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      let localCalls = 0;
      const command = {
        id: randomUUID(),
        worldId: f.worldId,
        expectedVersion: world.version,
        actorId: f.mom,
        text: '我在家里，你先忙自己的事。',
      };
      await npcAgentServices(db, () => ({
        async complete(messages) {
          localCalls++;
          const payload = JSON.parse(messages[1]!.content);
          const reply: AgentProposal = {
            statements: [{ text: '知道了，我先做自己的事。', dependsOnActionIds: [] }],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          };
          return JSON.stringify({
            ...reply,
            locationReports: [
              {
                subject: { kind: 'player' },
                placeId: 'home',
                sourceId: payload.input.sourceId,
                quote: '我在家里',
                assertion: 'reported',
              },
            ],
          });
        },
      })).sendMessageIfEnabled(f.owner, command);
      assert.equal(localCalls, 1);
      const prior = (await awareness.readActorAwareness(f.owner, f.worldId, f.mom)).knowledge;
      assert.equal(prior.length, 1);
      assert.equal(prior[0]!.sourceKind, 'player_report');
      assert.equal(prior[0]!.occurredAt, null);
      await openScene(f);
      const moved = await travel(f);
      await noMovementKnowledge(f, moved.event);
      assert.deepEqual(
        (await awareness.readActorAwareness(f.owner, f.worldId, f.mom)).knowledge,
        prior,
      );
      const s = await snapshot(f);
      assert.equal(s.worldContext!.knowledge[0]!.kind, 'report');
      assert.equal(s.worldContext!.knowledge[0]!.placeId, 'home');
      assert.equal(s.worldContext!.knowledge[0]!.reportedQuote, '我在家里');
      assert.equal(s.worldContext!.knowledge[0]!.occurredAt, null);
      assert.equal(
        (await awareness.readActorAwareness(f.owner, f.worldId, f.other)).knowledge.length,
        0,
      );
    },
  );
  await t.test(
    'legacy observation-shaped travel still replays without rewriting its historical event',
    async () => {
      const f = await fixture();
      await openScene(f);
      const moved = await travel(f);
      // Compatibility fixture only; never insert this legacy claim into the new producer/knowledge path.
      const legacy: TravelEvent = {
        ...structuredClone(moved.event),
        data: {
          ...structuredClone(moved.event.data),
          departureObservation: {
            id: randomUUID(),
            text: '合成旧事件：曾按旧政策记录的离开。',
            kind: 'canonical',
            visibility: { kind: 'actors', actorIds: [f.mom] },
            sourceEventId: moved.event.id,
            departure: { fromPlaceName: '家', eventVersion: moved.event.version },
          },
        },
      };
      const original = JSON.stringify(legacy),
        replayed = replayWorldHistory(moved.before, [legacy]).world;
      assert.equal(replayed.space!.currentPlaceId, 'park');
      assert.deepEqual(
        replayed.facts.find((fact) => fact.id === legacy.data.departureObservation!.id),
        legacy.data.departureObservation,
      );
      assert.equal(JSON.stringify(legacy), original);
      assert.equal(
        Object.hasOwn(
          (
            await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
              moved.event.id,
            ])
          ).rows[0].payload.data,
          'departureObservation',
        ),
        false,
      );
    },
  );
});
