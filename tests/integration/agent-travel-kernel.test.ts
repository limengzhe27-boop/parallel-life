import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { projectAgentWorldChange } from '../../src/modules/world/infrastructure/world-awareness-commit.ts';
import {
  committedAwarenessDelta,
  type AuthoritativePosition,
} from '../../src/modules/world/domain/world-awareness.ts';
import { scenePresent } from '../../src/modules/world/domain/scene-runtime.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';
import { commitDueAgentArrival } from '../../src/modules/world/infrastructure/agent-arrival-continuation.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';

type Payload = {
  state: AgentSnapshot['state'];
  input: AgentSnapshot['input'];
  worldContext: NonNullable<AgentSnapshot['worldContext']>;
  channel: AgentSnapshot['channel'];
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function departure(payload: Payload, routeId?: string): AgentProposal {
  const self = payload.worldContext.selfPosition.sourceId;
  assert.ok(self, 'actual self-position source must reach the model');
  assert.equal(payload.worldContext.selfPosition.status, 'at');
  const route = payload.worldContext.travelRoutes?.[0];
  assert.ok(route, 'a real authored route must be offered');
  assert.ok(payload.channel.allowedCapabilities.includes('travel.begin'));
  return {
    statements: [
      { text: 'I have my own plans.', dependsOnActionIds: [] },
      { text: 'I am setting off.', dependsOnActionIds: ['depart'] },
    ],
    goals: [
      {
        id: 'go',
        summary: 'Go to the authored destination',
        status: 'active',
        sourceIds: [self, payload.input.sourceId],
        resultIds: [],
      },
    ],
    plans: [],
    actions: [
      {
        id: 'depart',
        goalId: 'go',
        capability: 'travel.begin',
        targetIds: [],
        parameters: { routeId: routeId ?? route.id },
        status: 'proposed',
        sourceIds: [self, payload.input.sourceId],
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
      },
    ],
    responsibilities: [],
    decisions: [],
  };
}

test('actual native departure kernel keeps journey, own position and scene exit atomic (real PG, controlled model)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_TRAVEL_KERNEL_TEST_PORT ?? 55565));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db),
    store = new PostgresAgentRuntimeRepository(db);
  const generated: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    try {
      for (const f of generated)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.worldId, f.owner],
        );
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  type Fixture = { owner: string; worldId: string; a: string; b: string; sceneId: string };
  async function fixture(): Promise<Fixture> {
    const owner = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    generated.push({ owner, worldId });
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const initial: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic pre-migration physical scene',
      time: new Date().toISOString(),
      actors: [
        { id: a, name: 'A', persona: 'A has independent plans.' },
        { id: b, name: 'B', persona: 'B is independent and not present.' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'room',
        positionSource: source,
        places: ['room', 'park'].map((id) => ({
          id,
          name: id,
          description: 'Explicit synthetic authored location',
          source,
          contactActorIds: id === 'room' ? [a] : [],
          appointmentIds: [],
        })),
        routes: [
          {
            id: 'room_park',
            fromPlaceId: 'room',
            toPlaceId: 'park',
            durationMinutes: 15,
            modeLabel: 'Walk',
            source,
          },
        ],
      },
    };
    await worlds.initialize({ userId: owner }, initial);
    const historicalCommand = {
      id: randomUUID(),
      worldId,
      expectedVersion: 0,
      actorId: a,
      text: 'Explicit synthetic historical invitation setup',
    };
    await worlds.commit({ userId: owner }, historicalCommand, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: historicalCommand.id,
      version: 1,
      occurredAt: initial.time,
      type: 'turn.resolved',
      data: {
        actorId: a,
        userText: historicalCommand.text,
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: a,
            text: 'Synthetic historical invitation, not a new NPC response.',
          },
          {
            type: 'appointment.proposed',
            id: randomUUID(),
            title: 'Existing historical dinner proposal',
            at: new Date(Date.parse(initial.time) + 7200000).toISOString(),
            participantIds: [a],
          },
        ],
      },
    });
    // Explicit synthetic historical epoch-1 presence, produced through the existing writer.
    // This is fixture setup, never claimed as an NPC behavior generated by the new engine.
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      placeId: 'room',
    });
    const lease = (await queue.claimForOwner(entered.task!.id, owner, ['world']))!;
    assert.ok(lease);
    const version = await db.transaction(owner, (sql) =>
      commitSceneProposal(
        sql,
        owner,
        worldId,
        lease.input as Parameters<typeof commitSceneProposal>[3],
        {
          location: 'room',
          narration: 'Explicit synthetic historical scene.',
          presentActorIds: [a],
          outcome: null,
          observation: null,
          matterTitle: null,
          initialMatters: [],
          matterUpdates: [],
          dialogues: [],
          stepProposals: [],
          npcActions: [],
        },
        randomUUID(),
      ),
    );
    await queue.finish(lease, { status: 'succeeded', resultVersion: version });
    const world = await worlds.get({ userId: owner }, worldId);
    await db.transaction(owner, async (sql) => {
      for (const actorId of [a, b])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId },
            agentDefinitionRef(world, actorId),
            world.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: world.version,
      });
      const event = (
        await sql.query(
          'SELECT id FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 ORDER BY version DESC LIMIT 1',
          [worldId, owner],
        )
      ).rows[0];
      await projectAgentWorldChange(sql, owner, worldId, event.id);
    });
    const clock = new PostgresClockStore(db);
    await clock.ensureAnchor(owner, worldId, await clock.read(owner, worldId));
    const f = { owner, worldId, a, b, sceneId: entered.sceneId };
    const pos = await positions(f);
    assert.equal(
      pos.find((p) => p.subject.kind === 'actor' && p.subject.actorId === a)?.status,
      'at',
    );
    const historicalScene = (await scenes.read(owner, worldId, entered.sceneId)).scene;
    assert.ok(historicalScene);
    assert.ok(
      scenePresent(historicalScene, world.version).some(
        (p) => p.kind === 'actor' && p.actorId === a,
      ),
    );
    return f;
  }
  async function positions(
    f: Pick<Fixture, 'owner' | 'worldId'>,
  ): Promise<AuthoritativePosition[]> {
    return (
      await db.transaction(f.owner, (sql) =>
        sql.query(
          'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 ORDER BY subject_key',
          [f.worldId, f.owner],
        ),
      )
    ).rows.map((r) => r.document);
  }
  async function physical(f: Fixture) {
    const scene = (await scenes.read(f.owner, f.worldId, f.sceneId)).scene;
    assert.ok(scene);
    return {
      world: await worlds.get({ userId: f.owner }, f.worldId),
      scene,
      positions: await positions(f),
      states: (
        await db.transaction(f.owner, (sql) =>
          sql.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
            [f.worldId, f.owner],
          ),
        )
      ).rows.map((r) => r.document),
      knowledge: (
        await db.transaction(f.owner, (sql) =>
          sql.query(
            'SELECT document FROM parallel_life.actor_position_knowledge WHERE world_id=$1 AND owner_id=$2 ORDER BY observer_actor_id,subject_key,kind',
            [f.worldId, f.owner],
          ),
        )
      ).rows.map((r) => r.document),
    };
  }
  async function counts(f: Fixture) {
    const out: Record<string, number> = {};
    for (const table of [
      'npc_journeys',
      'agent_action_results',
      'world_events',
      'commands',
      'outbox_jobs',
    ])
      out[table] = Number(
        (
          await admin.query(
            `SELECT count(*) AS n FROM parallel_life.${table} WHERE world_id=$1 AND owner_id=$2`,
            [f.worldId, f.owner],
          )
        ).rows[0].n,
      );
    return out;
  }
  function model(make: (p: Payload) => AgentProposal | Promise<AgentProposal>) {
    let calls = 0;
    const inputs: Payload[] = [];
    const value: TextModel = {
      async complete(messages) {
        calls++;
        const payload = JSON.parse(messages.find((m) => m.role === 'user')!.content) as Payload;
        inputs.push(payload);
        return JSON.stringify(await make(payload));
      },
    };
    return {
      value,
      inputs,
      get calls() {
        return calls;
      },
    };
  }
  async function privateCommand(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return {
      id: randomUUID(),
      worldId: f.worldId,
      expectedVersion: world.version,
      actorId: f.a,
      text: 'You can leave according to your own plan.',
    };
  }
  async function directAdmission(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.worldId),
      state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
    const now = new Date().toISOString(),
      clock = await new PostgresClockStore(db).read(f.owner, f.worldId, now);
    const storyAt = new Date(
      Math.max(Date.parse(world.time), Date.parse(projectStoryTime(clock, now))),
    ).toISOString();
    const receipt = (
      await store.accept(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        channel: 'private',
        threadId: f.a,
        recipientActorId: f.a,
        expectedWorldVersion: world.version,
        receivedAt: now,
        storyAt,
        origin: 'player',
        text: 'Leave when you decide.',
        inputHash: hash(randomUUID()),
      })
    ).receipt;
    const snapshot = (
      await readPrivateAgentSnapshot(db, f.owner, world, f.a, receipt, storyAt, state)
    ).snapshot;
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.a,
      commandId: receipt.commandId,
      inputReceiptId: receipt.id,
      inputHash: receipt.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    };
    return { claim, snapshot };
  }
  await t.test(
    'one actual private NPC call commits sourced departure, scene exit and own in-transit state without moving player',
    async () => {
      const f = await fixture(),
        before = await physical(f),
        m = model(departure),
        command = await privateCommand(f);
      const result = await npcAgentServices(db, () => m.value).sendMessageIfEnabled(
        f.owner,
        command,
      );
      assert.equal(result?.status, 'committed');
      assert.equal(m.calls, 1);
      const after = await physical(f),
        attempt = (await store.lookup(f.owner, f.worldId, command.id))!;
      assert.equal(attempt.status, 'committed');
      const row = (
        await admin.query('SELECT document FROM parallel_life.npc_journeys WHERE world_id=$1', [
          f.worldId,
        ])
      ).rows;
      assert.equal(row.length, 1);
      const journey = row[0].document;
      assert.equal(journey.status, 'in_transit');
      assert.equal(journey.actorId, f.a);
      assert.equal(journey.departure.eventId, attempt.eventId);
      assert.equal(
        after.positions.find((p) => p.subject.kind === 'actor' && p.subject.actorId === f.a)!
          .status,
        'in_transit',
      );
      assert.equal(
        after.positions.find((p) => p.subject.kind === 'actor' && p.subject.actorId === f.a)!
          .placeId,
        null,
      );
      assert.deepEqual(
        after.positions.filter((p) => p.subject.kind === 'player'),
        before.positions.filter((p) => p.subject.kind === 'player'),
      );
      assert.deepEqual(after.knowledge, before.knowledge);
      assert.deepEqual(
        after.states.find((s) => s.actorId === f.b),
        before.states.find((s) => s.actorId === f.b),
      );
      assert.deepEqual(after.world.appointments, before.world.appointments);
      assert.equal(
        before.world.appointments.length,
        1,
        'the unchanged appointment assertion must not be vacuous',
      );
      assert.equal(after.world.appointments[0]!.status, 'proposed');
      assert.equal(after.world.space!.currentPlaceId, 'room');
      const presence = after.scene.presence.find(
        (p) => p.participant.kind === 'actor' && p.participant.actorId === f.a,
      )!;
      assert.equal(presence.leftVersion, after.world.version);
      const event = (
        await admin.query(
          'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND id=$2',
          [f.worldId, attempt.eventId],
        )
      ).rows[0].payload;
      assert.equal(event.data.agentRuntime.sceneDepartures[0].sceneId, f.sceneId);
      assert.equal(event.data.agentRuntime.departures[0].id, journey.id);
      assert.equal(event.data.agentRuntime.results[0].outcome, 'succeeded');
      assert.deepEqual(event.data.agentRuntime.results[0].handledResponsibilityIds, []);
      assert.ok(
        event.data.agentRuntime.results[0].outputRefs.some(
          (r: { kind: string; id: string }) => r.kind === 'journey' && r.id === journey.id,
        ),
      );
      assert.ok(
        after.states
          .find((s) => s.actorId === f.a)
          .goals.every((g: { status: string }) => g.status !== 'fulfilled'),
      );
      // Actual persisted interval plus pure projection: no fake new scene event is written.
      const later = {
        ...event,
        id: randomUUID(),
        type: 'scene.action_resolved',
        data: { sceneId: f.sceneId },
      };
      const delta = committedAwarenessDelta(after.world, later, { scene: after.scene });
      assert.ok(
        !delta.positions.some((p) => p.subject.kind === 'actor' && p.subject.actorId === f.a),
        'closed actual interval cannot pull the actor back',
      );
      const clock = await new PostgresClockStore(db).read(f.owner, f.worldId);
      assert.equal(clock.paused, false);
      const realNow = new Date(
        Date.parse(clock.lastTickAt) +
          Math.ceil(
            (Date.parse(journey.plannedArrivalAt) - Date.parse(clock.storyNow)) / clock.speed,
          ),
      ).toISOString();
      const arrived = await commitDueAgentArrival(db, f.owner, {
        worldId: f.worldId,
        engineEpoch: 2,
        expectedWorldVersion: after.world.version,
        realNow,
      });
      assert.equal(arrived.status, 'arrived');
      assert.equal(m.calls, 1, 'actual arrival uses no second model');
      const arrivedState = await physical(f);
      const finalJourney = (
        await admin.query('SELECT document FROM parallel_life.npc_journeys WHERE world_id=$1', [
          f.worldId,
        ])
      ).rows[0].document;
      assert.equal(finalJourney.status, 'arrived');
      assert.notEqual(finalJourney.arrival.eventId, journey.departure.eventId);
      const arrivedPosition = arrivedState.positions.find(
        (p) => p.subject.kind === 'actor' && p.subject.actorId === f.a,
      )!;
      assert.equal(arrivedPosition.status, 'at');
      assert.equal(arrivedPosition.placeId, 'park');
      assert.equal(arrivedPosition.sourceEventId, finalJourney.arrival.eventId);
      assert.deepEqual(
        arrivedState.positions.filter((p) => p.subject.kind === 'player'),
        before.positions.filter((p) => p.subject.kind === 'player'),
      );
      assert.deepEqual(arrivedState.world.appointments, before.world.appointments);
      assert.deepEqual(
        arrivedState.states,
        after.states,
        'arrival does not rewrite goals, responsibilities or player decisions',
      );
      assert.deepEqual(arrivedState.knowledge, before.knowledge);
      assert.deepEqual(
        arrivedState.scene,
        after.scene,
        'arrival never reopens the old presence interval',
      );
      assert.ok(
        Date.parse(arrivedState.world.time) < Date.parse(before.world.appointments[0]!.at),
        'the normal clock continuation did not jump through the existing future appointment',
      );
    },
  );
  await t.test(
    'same private command replay performs no second call or duplicate departure',
    async () => {
      const f = await fixture(),
        m = model(departure),
        service = npcAgentServices(db, () => m.value),
        command = await privateCommand(f);
      const first = await service.sendMessageIfEnabled(f.owner, command);
      const before = await physical(f),
        n = await counts(f);
      const replay = await service.sendMessageIfEnabled(f.owner, command);
      assert.deepEqual(replay, first);
      assert.equal(m.calls, 1);
      assert.deepEqual(await physical(f), before);
      assert.deepEqual(await counts(f), n);
    },
  );
  await t.test(
    'afterCommit failure rolls back departure, own projection and scene interval, then protected raw resumes without another model call',
    async () => {
      const f = await fixture(),
        admission = await directAdmission(f),
        before = await physical(f),
        n = await counts(f),
        m = model(departure);
      const failing = new PostgresNpcAgentKernel(db, worlds, async () => {
        throw Error('SYNTHETIC_AFTER_COMMIT_FAILURE');
      });
      await assert.rejects(
        runNpcAgent(
          { attempts: store, model: new NpcAgentModel(m.value), kernel: failing },
          f.owner,
          admission.claim,
          admission.snapshot,
        ),
        /SYNTHETIC_AFTER_COMMIT_FAILURE/,
      );
      const saved = (await store.lookup(f.owner, f.worldId, admission.claim.commandId))!;
      assert.equal(saved.status, 'response_received');
      assert.equal(m.calls, 1);
      assert.deepEqual(await physical(f), before);
      assert.deepEqual(await counts(f), n);
      const raw = await store.readResponse(f.owner, saved);
      assert.equal(raw.found, true);
      await runNpcAgent(
        {
          attempts: store,
          model: new NpcAgentModel(m.value),
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        f.owner,
        saved,
        null,
      );
      assert.equal(m.calls, 1);
      assert.deepEqual(
        await store.readResponse(
          f.owner,
          (await store.lookup(f.owner, f.worldId, saved.commandId))!,
        ),
        raw,
      );
      assert.equal(
        Number(
          (
            await admin.query(
              'SELECT count(*) n FROM parallel_life.npc_journeys WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n,
        ),
        1,
      );
    },
  );
  await t.test(
    'known unavailable route records a failed capability and retains only independent speech',
    async () => {
      const f = await fixture(),
        before = await physical(f),
        m = model((p) => departure(p, 'missing_route'));
      assert.equal(
        (
          await npcAgentServices(db, () => m.value).sendMessageIfEnabled(
            f.owner,
            await privateCommand(f),
          )
        )?.status,
        'committed',
      );
      assert.equal(m.calls, 1);
      const after = await physical(f);
      assert.deepEqual(after.positions, before.positions);
      assert.deepEqual(after.scene, before.scene);
      assert.deepEqual(after.knowledge, before.knowledge);
      assert.equal(
        Number(
          (
            await admin.query(
              'SELECT count(*) n FROM parallel_life.npc_journeys WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n,
        ),
        0,
      );
      const results = (
        await admin.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1',
          [f.worldId],
        )
      ).rows;
      assert.equal(results.length, 1);
      assert.equal(results[0].document.outcome, 'failed');
      assert.ok(after.world.messages.some((msg) => msg.text === 'I have my own plans.'));
      assert.ok(!after.world.messages.some((msg) => msg.text === 'I am setting off.'));
    },
  );
  await t.test(
    'forgetting the accepted origin source before commit rejects movement at the final provenance fence',
    async () => {
      const f = await fixture(),
        before = await physical(f),
        n = await counts(f);
      let forgotten = false;
      const m = model(async (p) => {
        const proposal = departure(p);
        const source = p.worldContext.selfPosition.sourceId!;
        // Existing forgotten-source metadata fixture, not a claim of testing a production forget API.
        await admin.query(
          "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Synthetic forgotten origin metadata',$5,'agent_inference',$6,'forgotten')",
          [randomUUID(), f.owner, f.a, f.worldId, randomUUID(), JSON.stringify([source])],
        );
        forgotten = true;
        return proposal;
      });
      const command = await privateCommand(f);
      await assert.rejects(
        npcAgentServices(db, () => m.value).sendMessageIfEnabled(f.owner, command),
        { code: 'VERSION_CONFLICT' },
      );
      assert.equal(m.calls, 1);
      assert.equal(forgotten, true, 'the actual revocation fixture must execute before rejection');
      assert.equal((await store.lookup(f.owner, f.worldId, command.id))!.status, 'stale_discarded');
      assert.deepEqual(await physical(f), before);
      assert.deepEqual(await counts(f), n);
    },
  );
  await t.test(
    'unknown transport never manufactures travel and retry cannot call the model again',
    async () => {
      const f = await fixture(),
        before = await physical(f),
        n = await counts(f);
      let calls = 0;
      const value: TextModel = {
        async complete() {
          calls++;
          throw Error('SYNTHETIC_UNCERTAIN_TRANSPORT');
        },
      };
      const service = npcAgentServices(db, () => value),
        command = await privateCommand(f);
      await assert.rejects(service.sendMessageIfEnabled(f.owner, command));
      assert.equal(
        (await store.lookup(f.owner, f.worldId, command.id))!.status,
        'unknown_after_send',
      );
      await assert.rejects(service.sendMessageIfEnabled(f.owner, command));
      assert.equal(calls, 1);
      assert.deepEqual(await physical(f), before);
      assert.deepEqual(await counts(f), n);
    },
  );
});
