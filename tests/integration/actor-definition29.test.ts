import { readAuthoredReconsiderationEvidence } from '../../src/modules/world/infrastructure/authored-reconsideration-evidence.ts';
import { authoredReconsiderationEvidence } from '../../src/modules/world/domain/authored-reconsideration.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresActorDefinitionRepository } from '../../src/modules/world/infrastructure/actor-definition-repository.ts';
import { readActorDefinitionSources } from '../../src/modules/world/infrastructure/actor-definition-sources.ts';
import { readDirectorActorDirectionMaterials } from '../../src/modules/world/infrastructure/director-actor-direction-materials.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { applyWorldHistoryEvent } from '../../src/modules/world/domain/world-history.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('owner definition correction preserves identity/history/progress and certifies both old and current sources', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  const owner = randomUUID(),
    otherOwner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID(),
    b = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);
  await new IdentityRepository(db).ensureGuest(otherOwner);
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    title: 'Synthetic definition correction',
    version: 0,
    time: '2026-11-03T04:00:00.000Z',
    actors: [
      {
        id: actorId,
        name: 'A',
        persona: JSON.stringify({ voice: 'Reserved', boundaries: 'Private' }),
        relationship: 'Longtime friend',
      },
      { id: b, name: 'B', persona: 'Unchanged' },
    ],
    messages: [],
    facts: [],
    appointments: [],
    mediaRequests: [],
    notes: [],
  };
  const worlds = new PostgresWorldRepository(db),
    attempts = new PostgresAgentRuntimeRepository(db),
    repo = new PostgresActorDefinitionRepository(db);
  await worlds.initialize({ userId: owner }, world);
  const ref = agentDefinitionRef(world, actorId),
    original = emptyActorAgentState({ worldId, actorId }, ref, 0);
  original.goals = [
    {
      id: 'old_goal',
      summary: 'An existing personal aim',
      status: 'active',
      sourceIds: [`definition:${ref}`],
      resultIds: [],
    },
  ];
  original.plans = [
    {
      id: 'old_plan',
      goalId: 'old_goal',
      summary: 'Preserve this ongoing plan',
      status: 'active',
      sourceIds: [`definition:${ref}`],
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: [],
    },
  ];
  await db.transaction(owner, async (sql) => {
    await initializeActorAgentStateInTransaction(sql, owner, original);
    await initializeActorAgentStateInTransaction(
      sql,
      owner,
      emptyActorAgentState({ worldId, actorId: b }, agentDefinitionRef(world, b), 0),
    );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
  });
  await new PostgresClockStore(db).setClock(owner, worldId, { paused: false, speed: 0 });
  const receipt = (
    await attempts.accept(owner, {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(worldId).digest('hex'),
      expectedWorldVersion: 0,
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      origin: 'player',
      text: 'Synthetic old input',
      receivedAt: new Date().toISOString(),
      storyAt: world.time,
    })
  ).receipt;
  const snapshot = (
    await readPrivateAgentSnapshot(db, owner, world, actorId, receipt, world.time, original)
  ).snapshot;
  const claim = (
    await attempts.claim(owner, {
      id: randomUUID(),
      worldId,
      actorId,
      commandId: receipt.commandId,
      inputReceiptId: receipt.id,
      inputHash: receipt.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    })
  ).attempt;
  const sent = await attempts.mark(owner, claim, 'request_sent');
  const paid = await attempts.saveResponse(owner, sent, {
    kind: 'npc_agent_completion',
    schemaVersion: 1,
    snapshot,
    response: JSON.stringify({
      protocol: 'npc-wire-v16',
      statements: [{ text: 'A pre-correction reply', dependsOnActionIds: [] }],
      executions: [],
      changes: null,
    }),
  });
  const input = {
    worldId,
    actorId,
    commandId: randomUUID(),
    expectedWorldVersion: 0,
    expectedDefinitionRef: ref,
    modules: {
      traits: '修正内向敏锐的人格，保留“本人边界”\n允许自然表达',
      relationships: 'Childhood friend, not somebody else',
    },
    reason: 'Owner verified module attribution correction',
  };
  await assert.rejects(repo.revise(otherOwner, input), { code: 'NOT_FOUND' });
  const event = await repo.revise(owner, input);
  assert.equal(event.version, 1);
  assert.deepEqual(await repo.revise(owner, input), event);
  const current = await worlds.get({ userId: owner }, worldId),
    state = (await attempts.read(owner, { worldId, actorId }))!;
  assert.equal(current.id, world.id);
  assert.deepEqual(
    current.actors.map((a) => a.id),
    world.actors.map((a) => a.id),
  );
  assert.deepEqual(current.actors[1], world.actors[1]);
  assert.deepEqual(current.messages, world.messages);
  assert.deepEqual(
    {
      ...state,
      definitionRef: original.definitionRef,
      revision: original.revision,
      projectedWorldVersion: original.projectedWorldVersion,
    },
    original,
  );
  assert.equal(state.definitionRef, event.data.definitionRef);
  assert.deepEqual(applyWorldHistoryEvent(world, event).state, current);
  const fresh = (
    await readPrivateAgentSnapshot(db, owner, current, actorId, null, current.time, state)
  ).snapshot;
  assert.equal(JSON.parse(fresh.actor.persona).modules.traits, input.modules.traits);
  assert.equal(fresh.viewState.goals[0]!.id, 'old_goal');
  assert.ok(fresh.sources.some((s) => s.id === `definition:${ref}`));
  const latest = fresh.sources.find((s) => s.id === `definition:${event.data.definitionRef}`)!;
  assert.equal(latest.worldVersion, 1);
  const defs = await db.transaction(owner, (sql) =>
    readActorDefinitionSources(sql, owner, worldId, actorId, 1),
  );
  assert.equal(defs.length, 2);
  const direction = await db.transaction(owner, (sql) =>
    readDirectorActorDirectionMaterials(sql, worldId, [actorId, b]),
  );
  assert.equal(direction.find((d) => d.actorId === actorId)!.modules.traits, input.modules.traits);
  assert.ok(!direction.some((d) => d.actorId === b));
  const initial = (
    await admin.query('SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
      worldId,
    ])
  ).rows[0].state;
  assert.deepEqual(initial, world);
  const reasons = (
    await admin.query(
      'SELECT document FROM parallel_life.director_pending_reasons WHERE world_id=$1',
      [worldId],
    )
  ).rows;
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].document.kind, 'cross_impact');
  const evidence = await db.transaction(owner, (sql) =>
    readAuthoredReconsiderationEvidence(sql, owner, worldId, 1),
  );
  assert.deepEqual(
    evidence,
    await db.transaction(owner, (sql) =>
      readAuthoredReconsiderationEvidence(sql, owner, worldId, 1),
    ),
  );
  assert.equal(evidence.filter((e) => e.eventId === event.id).length, 1);
  assert.equal(authoredReconsiderationEvidence([actorId], evidence, 1).length, 1);
  assert.deepEqual(authoredReconsiderationEvidence([b], evidence, 1), []);
  assert.ok(
    evidence.filter((e) => e.eventId === event.id).every((e) => !e.placeId && !e.subjectKind),
  );
  const privacy = (
    await admin.query(
      'SELECT count(*)::int n FROM parallel_life.actor_position_knowledge WHERE world_id=$1',
      [worldId],
    )
  ).rows[0].n;
  assert.equal(privacy, 0);
  const matching = await db.transaction(owner, (sql) =>
    sql.query(
      'SELECT parallel_life.actor_definition_source_matches($1,$2,$3,$4,0) AS old,parallel_life.actor_definition_source_matches($1,$2,$3,$5,0) AS future,parallel_life.actor_definition_source_matches($1,$2,$6,$4,1) AS other',
      [worldId, owner, actorId, ref, event.data.definitionRef, b],
    ),
  );
  assert.deepEqual(matching.rows[0], { old: true, future: false, other: false });

  let modelCalls = 0;
  await assert.rejects(
    runNpcAgent(
      {
        attempts,
        model: {
          async decide() {
            modelCalls++;
            throw Error('must not buy');
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      owner,
      paid,
      null,
    ),
  );
  assert.equal(modelCalls, 0);
  assert.equal((await attempts.lookup(owner, worldId, paid.commandId))!.status, 'stale_discarded');
  assert.deepEqual((await worlds.get({ userId: owner }, worldId)).messages, []);
  await assert.rejects(repo.revise(owner, { ...input, commandId: randomUUID() }), {
    code: 'VERSION_CONFLICT',
  });
  await assert.rejects(
    admin.query(
      'UPDATE parallel_life.world_events SET payload=payload WHERE world_id=$1 AND id=$2',
      [worldId, event.id],
    ),
    /IMMUTABLE_ACTOR_DEFINITION_REVISION/,
  );
});
