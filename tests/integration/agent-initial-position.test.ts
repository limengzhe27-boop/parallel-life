import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { parseAgentProposal } from '../../src/modules/world/infrastructure/agent-proposal-parser.ts';
import { compileNpcExecutionProposal } from '../../src/modules/world/infrastructure/npc-execution-intent.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import {
  initialPositionPolicySourceId,
  planInitialPosition,
} from '../../src/modules/world/domain/agent-initial-position.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

async function checkInitialPositionScene(t: TestContext, sceneMode: string) {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55673);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    store = new PostgresAgentRuntimeRepository(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID(),
    other = randomUUID(),
    at = '2026-10-26T04:00:00.000Z';
  await new IdentityRepository(db).ensureGuest(owner);
  const source = {
    kind: 'seed_genesis' as const,
    seedId: randomUUID(),
    snapshotVersion: 0 as const,
  };
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    title: 'Synthetic unset origin',
    version: 0,
    time: at,
    actors: [
      { id: actorId, name: 'A', persona: 'Has independent plans' },
      { id: other, name: 'B', persona: 'Private' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
    space: {
      currentPlaceId: 'home',
      positionSource: source,
      places: ['home', 'cafe'].map((id) => ({
        id,
        name: id,
        description: '',
        source,
        contactActorIds: [],
        appointmentIds: [],
      })),
      routes: [
        {
          id: 'home_cafe',
          fromPlaceId: 'home',
          toPlaceId: 'cafe',
          durationMinutes: 10,
          modeLabel: 'Walk',
          source,
        },
      ],
    },
  };
  await worlds.initialize({ userId: owner }, world);
  const unknown = {
    worldId,
    subject: { kind: 'actor' as const, actorId },
    status: 'unknown' as const,
    placeId: null,
    sourceEventId: null,
    worldVersion: 0,
    occurredAt: at,
  };
  await db.transaction(owner, async (sql) => {
    for (const id of [actorId, other])
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId: id }, agentDefinitionRef(world, id), 0),
      );
    await sql.query(
      'INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,$3,NULL,0,$4)',
      [worldId, owner, `actor:${actorId}`, unknown],
    );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
  });
  const clock = new PostgresClockStore(db);
  await clock.ensureAnchor(owner, worldId, await clock.read(owner, worldId));
  async function admission() {
    const w = await worlds.get({ userId: owner }, worldId),
      state = (await store.read(owner, { worldId, actorId }))!;
    const id = randomUUID(),
      commandId = randomUUID(),
      inputHash = createHash('sha256').update(id).digest('hex');
    const receipt = (
      await store.accept(owner, {
        id,
        worldId,
        commandId,
        inputHash,
        channel: 'private',
        threadId: actorId,
        recipientActorId: actorId,
        expectedWorldVersion: w.version,
        origin: 'wake',
        text: 'Consider your own arrangements',
        receivedAt: new Date().toISOString(),
        storyAt: w.time,
      })
    ).receipt;
    const snapshot = (await readPrivateAgentSnapshot(db, owner, w, actorId, receipt, w.time, state))
      .snapshot;
    return {
      snapshot,
      claim: {
        id: randomUUID(),
        worldId,
        actorId,
        commandId,
        inputReceiptId: id,
        inputHash,
        engineEpoch: 2,
        expectedWorldVersion: w.version,
        expectedActorRevision: state.revision,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
    };
  }
  let first = await admission();
  assert.equal(first.snapshot.worldContext?.selfPosition.status, 'unknown');
  assert.ok(first.snapshot.channel.allowedCapabilities.includes('position.establish'));
  assert.ok(!first.snapshot.channel.allowedCapabilities.includes('travel.begin'));
  assert.deepEqual(
    first.snapshot.worldContext?.initialPlacement?.places.map((p) => p.id),
    ['home', 'cafe'],
  );
  const policy = initialPositionPolicySourceId(worldId, actorId);
  const invalid = compileNpcExecutionProposal(first.snapshot, [
    {
      ref: 'action_1',
      action: { capability: 'position.establish', parameters: { placeId: 'outside' } },
    },
  ]).proposal;
  const bad = await runNpcAgent(
    {
      attempts: store,
      model: {
        async decide() {
          return JSON.stringify(invalid);
        },
      },
      kernel: new PostgresNpcAgentKernel(db, worlds),
    },
    owner,
    first.claim,
    first.snapshot,
  );
  assert.equal(bad.state.actions[0]?.status, 'failed');
  assert.equal(
    (
      await admin.query(
        'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
        [worldId, `actor:${actorId}`],
      )
    ).rows[0].document.status,
    'unknown',
  );
  let sceneId: string | undefined;
  if (sceneMode !== 'no_scene') {
    // Controlled fixture with a previously opened scene; this is not a claim
    // that position.establish travels or that its source records earlier presence.
    sceneId = randomUUID();
    const placeId = sceneMode === 'other_place' ? 'cafe' : 'home';
    const scene = {
      id: sceneId,
      ownerId: owner,
      worldId,
      title: placeId,
      placeId,
      status: 'active',
      sourceEventId: bad.eventId,
      sourceVersion: bad.state.projectedWorldVersion,
      presence: [
        {
          participant: { kind: 'player' },
          sourceEventId: bad.eventId,
          sourceVersion: bad.state.projectedWorldVersion,
          joinedVersion: bad.state.projectedWorldVersion,
        },
      ],
    };
    await admin.query(
      'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
      [sceneId, worldId, owner, bad.eventId, scene],
    );
    await admin.query(
      'INSERT INTO parallel_life.player_experiences(world_id,owner_id,current_scene_id,document) VALUES($1,$2,$3,$4)',
      [
        worldId,
        owner,
        sceneId,
        { worldId, ownerId: owner, currentSceneId: sceneId, view: { kind: 'scene', sceneId } },
      ],
    );
    await admin.query(
      "INSERT INTO parallel_life.scene_items(id,world_id,owner_id,scene_id,source_event_id,kind,document) VALUES($1,$2,$3,$4,$5,'entry',$6)",
      [
        randomUUID(),
        worldId,
        owner,
        sceneId,
        bad.eventId,
        {
          id: randomUUID(),
          ownerId: owner,
          worldId,
          sourceEventId: bad.eventId,
          sourceVersion: bad.state.projectedWorldVersion,
          observableTo: [{ kind: 'player' }],
          kind: 'time_place',
          sceneId,
          storyAt: at,
          location: placeId,
        },
      ],
    );
    const position = {
      worldId,
      subject: { kind: 'player' },
      status: sceneMode === 'unknown_player' ? 'unknown' : 'at',
      placeId:
        sceneMode === 'unknown_player' ? null : sceneMode === 'player_away' ? 'cafe' : placeId,
      sourceEventId: bad.eventId,
      worldVersion: bad.state.projectedWorldVersion,
      occurredAt: at,
    };
    await admin.query(
      "INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document) VALUES($1,$2,'player',$3,$4,$5) ON CONFLICT(world_id,subject_key) DO UPDATE SET document=excluded.document,source_event_id=excluded.source_event_id,source_version=excluded.source_version",
      [worldId, owner, bad.eventId, bad.state.projectedWorldVersion, position],
    );
  }
  first = await admission();

  const p: AgentProposal = parseAgentProposal(
    first.snapshot,
    JSON.stringify({
      protocol: 'npc-wire-v15',
      statements: [],
      executions: [
        {
          ref: 'action_1',
          action: { capability: 'position.establish', parameters: { placeId: 'home' } },
        },
      ],
      changes: null,
    }),
  );
  assert.equal(p.goals.length, 0);
  assert.equal(p.plans.length, 0);
  assert.ok(p.actions[0]!.sourceIds.includes(policy));
  const stale = await admission();
  let calls = 0;
  const execute = () =>
    runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            calls++;
            return JSON.stringify(p);
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      owner,
      first.claim,
      first.snapshot,
    );
  const out = await execute();
  assert.equal(out.state.actions.at(-1)?.status, 'succeeded');
  const row = (
    await admin.query(
      'SELECT document,source_version FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
      [worldId, `actor:${actorId}`],
    )
  ).rows[0];
  assert.equal(row.document.status, 'at');
  assert.equal(row.document.placeId, 'home');
  assert.equal(row.source_version, out.state.projectedWorldVersion);
  assert.equal(row.document.sourceEventId, out.eventId);
  const saved = await worlds.get({ userId: owner }, worldId);
  assert.equal(saved.messages.length, 0);
  assert.equal(saved.appointments.length, 0);
  assert.equal(
    (await admin.query('SELECT 1 FROM parallel_life.npc_journeys WHERE world_id=$1', [worldId]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await admin.query('SELECT 1 FROM parallel_life.actor_position_knowledge WHERE world_id=$1', [
        worldId,
      ])
    ).rowCount,
    sceneMode === 'same_place' ? 1 : 0,
  );
  if (sceneId) {
    const scene = (
      await admin.query('SELECT document FROM parallel_life.scene_sessions WHERE id=$1', [sceneId])
    ).rows[0].document;
    assert.equal(scene.presence.length, sceneMode === 'same_place' ? 2 : 1);
    if (sceneMode === 'same_place') {
      assert.deepEqual(scene.presence[1], {
        participant: { kind: 'actor', actorId },
        sourceEventId: out.eventId,
        sourceVersion: out.state.projectedWorldVersion,
        joinedVersion: out.state.projectedWorldVersion,
      });
      const knowledge = (
        await admin.query(
          'SELECT document FROM parallel_life.actor_position_knowledge WHERE world_id=$1',
          [worldId],
        )
      ).rows[0].document;
      assert.equal(knowledge.sourceKind, 'direct');
      assert.equal(knowledge.learnedAt, row.document.occurredAt);
      assert.equal(knowledge.sourceEventId, out.eventId);
      assert.deepEqual(knowledge.subject, { kind: 'player' });
    }
  }
  await execute();
  assert.equal(calls, 1);
  if (sceneId)
    assert.equal(
      (
        await admin.query('SELECT document FROM parallel_life.scene_sessions WHERE id=$1', [
          sceneId,
        ])
      ).rows[0].document.presence.length,
      sceneMode === 'same_place' ? 2 : 1,
    );
  assert.equal(
    (
      await admin.query('SELECT 1 FROM parallel_life.agent_action_results WHERE world_id=$1', [
        worldId,
      ])
    ).rowCount,
    2,
  );
  await assert.rejects(
    runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(p);
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      owner,
      stale.claim,
      stale.snapshot,
    ),
  );
  assert.equal(
    (
      await admin.query(
        'SELECT source_version FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
        [worldId, `actor:${actorId}`],
      )
    ).rows[0].source_version,
    out.state.projectedWorldVersion,
  );
  const next = await admission();
  assert.ok(!next.snapshot.channel.allowedCapabilities.includes('position.establish'));
  assert.equal(next.snapshot.worldContext?.initialPlacement, undefined);
  assert.ok(next.snapshot.channel.allowedCapabilities.includes('travel.begin'));
  assert.equal(next.snapshot.worldContext?.travelRoutes?.[0]?.id, 'home_cafe');
  const base = {
    worldId,
    actorId,
    ownPosition: unknown,
    hasJourney: false,
    placeIds: ['home'],
    placeId: 'home',
    sourceIds: [policy],
    allowedSourceIds: [policy],
  };
  assert.equal(planInitialPosition(base).status, 'ready');
  for (const bad of [
    { hasJourney: true },
    { ownPosition: row.document },
    { ownPosition: { ...unknown, subject: { kind: 'actor' as const, actorId: other } } },
    { placeId: 'outside' },
    { sourceIds: [] },
    { allowedSourceIds: [] },
  ])
    assert.equal(planInitialPosition({ ...base, ...bad }).status, 'blocked');
}

for (const sceneMode of ['no_scene', 'same_place', 'other_place', 'player_away', 'unknown_player'])
  test(`one-time unset fictional origin uses original kernel and current scene guards: ${sceneMode}`, (t) =>
    checkInitialPositionScene(t, sceneMode));
