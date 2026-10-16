import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { createEpisodeRequestsInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { projectEpisodeEvidenceInTransaction } from '../../src/modules/world/infrastructure/episode-evidence-repository.ts';
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
import { type AuthoritativePosition } from '../../src/modules/world/domain/world-awareness.ts';
import { scenePresent } from '../../src/modules/world/domain/scene-runtime.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { commitDueAgentArrival } from '../../src/modules/world/infrastructure/agent-arrival-continuation.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
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

test('episode travel and refusal milestones reach Director through actual writers (real PG, controlled models)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.EPISODE_JOURNEY_TEST_PORT ?? 55576));
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
  const snapshots = new PostgresDirectorSnapshotRepository(db);
  async function episode(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const snapshot = await snapshots.read(f.owner, {
      worldId: f.worldId,
      engineEpoch: 2,
      worldVersion: world.version,
      candidates: [],
      blockers: [],
    });
    const decision = await runDirectorAgent(
      {
        attempts: new PostgresDirectorRuntimeRepository(db),
        parse: parseDirectorDecision,
        model: new WorldDirectorAgentModel({
          async complete() {
            return JSON.stringify({
              mode: 'bounded_opportunity',
              selectedCandidateIds: [],
              deferred: [],
              nudges: [],
              opportunities: [
                {
                  id: randomUUID(),
                  title: 'Optional existing-world activity',
                  description: 'Director intent is not an action result',
                  playerImpact: 'An optional change of plans',
                  participantActorIds: [f.a],
                  placeIds: ['park'],
                  activity: 'meeting',
                  basisSourceIds: [`genesis:${f.worldId}`],
                },
              ],
              audit: { reason: 'existing place only', basisSourceIds: [] },
            });
          },
        }),
      },
      f.owner,
      {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: world.version,
        inputHash: directorSnapshotInputHash(snapshot),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    const requests = await db.transaction(f.owner, (sql) =>
      createEpisodeRequestsInTransaction(sql, f.owner, {
        worldId: f.worldId,
        engineEpoch: 2,
        decision,
      }),
    );
    assert.equal(requests.length, 1);
    return requests[0]!;
  }
  async function enact(
    f: Fixture,
    request: Awaited<ReturnType<typeof episode>>,
    mode: 'travel' | 'invite',
  ) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
    const text = JSON.stringify({
      type: 'npc_episode_consideration',
      requestId: request.id,
      revision: 0,
      activity: request.activity,
      placeOptionIds: [],
      basisSourceIds: [`definition:${state.definitionRef}`],
    });
    const input = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      inputHash: hash(text),
      channel: 'private' as const,
      threadId: f.a,
      recipientActorId: f.a,
      expectedWorldVersion: world.version,
      origin: 'coordination' as const,
      text,
      receivedAt: new Date().toISOString(),
      storyAt: world.time,
    };
    await store.accept(f.owner, input);
    const { snapshot } = await readPrivateAgentSnapshot(
      db,
      f.owner,
      world,
      f.a,
      input,
      world.time,
      state,
    );
    const p = departure(snapshot as unknown as Payload);
    p.episodeDecision = {
      requestId: request.id,
      choice: 'engage',
      reason: 'My own choice',
      sourceIds: [input.id, `definition:${state.definitionRef}`],
    };
    if (mode === 'invite') {
      p.actions[0]!.capability = 'appointment.propose';
      p.actions[0]!.parameters = {
        title: 'Episode invitation for refusal',
        at: new Date(Date.parse(world.time) + 3600000).toISOString(),
      };
      p.statements = [{ text: 'Would you like to meet?', dependsOnActionIds: ['depart'] }];
    }
    let calls = 0;
    const output = await runNpcAgent(
      {
        attempts: store,
        kernel: new PostgresNpcAgentKernel(db, worlds),
        model: {
          async decide() {
            calls++;
            return JSON.stringify(p);
          },
        },
      },
      f.owner,
      {
        id: randomUUID(),
        worldId: f.worldId,
        actorId: f.a,
        commandId: input.commandId,
        inputReceiptId: input.id,
        inputHash: input.inputHash,
        engineEpoch: 2,
        expectedWorldVersion: world.version,
        expectedActorRevision: state.revision,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    assert.equal(calls, 1);
    return output;
  }
  async function evidence(f: Fixture) {
    return (
      await db.transaction(f.owner, (sql) =>
        sql.query(
          'SELECT document FROM parallel_life.agent_episode_evidence WHERE world_id=$1 ORDER BY world_version,id',
          [f.worldId],
        ),
      )
    ).rows.map((r) => r.document);
  }
  async function observed(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return snapshots.read(f.owner, {
      worldId: f.worldId,
      engineEpoch: 2,
      worldVersion: world.version,
      candidates: [],
      blockers: [],
    });
  }
  await t.test(
    'migrated real presence → episode-caused departure → actual arrival → Director observations, no whole success',
    async () => {
      const f = await fixture(),
        r = await episode(f);
      await enact(f, r, 'travel');
      const before = await evidence(f);
      assert.deepEqual(
        before.map((x) => x.kind),
        ['travel_started'],
      );
      assert.equal(before[0].episodeId, r.episodeId);
      const journey = (
        await admin.query('SELECT document FROM parallel_life.npc_journeys WHERE world_id=$1', [
          f.worldId,
        ])
      ).rows[0].document;
      const world = await worlds.get({ userId: f.owner }, f.worldId),
        clock = await new PostgresClockStore(db).read(f.owner, f.worldId);
      assert.equal(clock.paused, false);
      const realNow = new Date(
        Date.parse(clock.lastTickAt) +
          Math.ceil(
            (Date.parse(journey.plannedArrivalAt) - Date.parse(clock.storyNow)) / clock.speed,
          ),
      ).toISOString();
      const arrival = await commitDueAgentArrival(db, f.owner, {
        worldId: f.worldId,
        engineEpoch: 2,
        expectedWorldVersion: world.version,
        realNow,
      });
      assert.equal(arrival.status, 'arrived');
      const records = await evidence(f);
      assert.deepEqual(
        records.map((x) => x.kind),
        ['travel_started', 'arrived'],
      );
      assert.equal(records[1].actionId, records[0].actionId);
      assert.equal(records[1].subject.id, journey.id);
      const s = await observed(f);
      for (const kind of ['travel_started', 'arrived'])
        assert.ok(
          s.observations.some(
            (o) => o.sourceId.startsWith('episode-result:') && o.text.includes(kind),
          ),
        );
      assert.ok(s.episodes.every((e) => e.status !== 'resolved' && e.resultIds.length === 0));
      await db.transaction(f.owner, (sql) =>
        projectEpisodeEvidenceInTransaction(sql, f.owner, f.worldId, records[1].eventId),
      );
      assert.deepEqual(await evidence(f), records);
      const pos = await positions(f);
      assert.equal(
        pos.find((p) => p.subject.kind === 'actor' && p.subject.actorId === f.a)?.placeId,
        'park',
      );
      assert.equal(pos.find((p) => p.subject.kind === 'player')?.placeId, 'room');
    },
  );
  await t.test(
    'actual player refusal is a distinct Director-visible milestone, not whole-episode completion',
    async () => {
      const f = await fixture(),
        r = await episode(f);
      await enact(f, r, 'invite');
      let world = await worlds.get({ userId: f.owner }, f.worldId);
      const invitation = world.appointments.find(
        (a) => a.title === 'Episode invitation for refusal',
      );
      assert.ok(invitation);
      await worlds.respondToInvitation(
        { userId: f.owner },
        {
          commandId: randomUUID(),
          worldId: f.worldId,
          id: invitation.id,
          expectedVersion: world.version,
          operation: 'cancel',
        },
      );
      const records = await evidence(f);
      assert.deepEqual(
        records.map((x) => x.kind),
        ['invitation_proposed', 'invitation_declined'],
      );
      assert.equal(records[1].episodeId, r.episodeId);
      const s = await observed(f);
      assert.ok(
        s.observations.some(
          (o) => o.sourceId.startsWith('episode-result:') && o.text.includes('invitation_declined'),
        ),
      );
      assert.ok(s.episodes.every((e) => e.status !== 'resolved' && e.resultIds.length === 0));
    },
  );
});
