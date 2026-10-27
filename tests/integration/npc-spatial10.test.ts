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

import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';

async function checkSpatial(t: TestContext, establish: boolean) {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.NPC_SPATIAL_TEST_PORT ?? 55676));
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

  let npcCalls = 0,
    spatialCalls = 0;
  const model = {
    async complete(messages: any[]) {
      const p = JSON.parse(messages.find((m) => m.role === 'user').content);
      if (p.promptVersion?.startsWith('director-'))
        return JSON.stringify({
          protocol: 'director-wire-v15',
          openingContext: null,
          authoredChoices: {},
          candidates: p.wireCatalog.candidates.map((c: any) => ({
            ref: c.ref,
            decision: 'select',
            nudge: null,
          })),
          opportunities: [],
          audit: { reason: '只给本人有边界的空间工作权限', sourceRefs: [] },
        });
      npcCalls++;
      const input = JSON.parse(p.input.text);
      if (input.wakeCue?.includes('position.establish')) {
        spatialCalls++;
        assert.equal(input.type, 'npc_own_condition_ready');
        assert.equal(input.source, 'actor_local');
        assert.ok(p.worldContext.initialPlacement);
        assert.equal(p.worldContext.selfPosition.status, 'unknown');
        if (!establish)
          return JSON.stringify({
            protocol: 'npc-wire-v16',
            statements: [],
            executions: [],
            changes: null,
          });
        return JSON.stringify({
          protocol: 'npc-wire-v16',
          statements: [],
          executions: [
            {
              ref: 'action_1',
              action: { capability: 'position.establish', parameters: { placeId: 'cafe' } },
            },
          ],
          changes: null,
        });
      }
      return JSON.stringify({
        protocol: 'npc-wire-v16',
        statements: [],
        executions: [],
        changes: null,
      });
    },
  };
  const service = npcAgentAdvanceServices(
    db,
    () => model,
    new PostgresDirectorSnapshotRepository(db),
    { maxActors: 1 },
  );
  await service.advanceIfEnabled(owner, worldId);
  assert.equal(spatialCalls, 1);
  const rows = (
    await admin.query(
      'SELECT document,source_event_id,source_version FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
      [worldId, `actor:${actorId}`],
    )
  ).rows;
  if (establish) {
    assert.equal(rows[0].document.status, 'at');
    assert.equal(rows[0].document.placeId, 'cafe');
    assert.ok(rows[0].source_event_id);
    assert.ok(rows[0].source_version > 0);
  } else {
    assert.equal(rows[0].document.status, 'unknown');
    assert.equal(rows[0].source_version, 0);
  }
  const saved = await worlds.get({ userId: owner }, worldId);
  assert.equal(saved.messages.length, 0);
  await service.advanceIfEnabled(owner, worldId);
  assert.equal(spatialCalls, 1);
  const history = (
    await admin.query(
      "SELECT i.document FROM parallel_life.agent_input_receipts i WHERE world_id=$1 AND owner_id=$2 AND document->>'text' LIKE '%initial_position%'",
      [worldId, owner],
    )
  ).rows;
  assert.equal(history.length, 1);
  const all = (
    await admin.query(
      'SELECT document FROM parallel_life.actor_position_knowledge WHERE world_id=$1 AND owner_id=$2',
      [worldId, owner],
    )
  ).rows;
  assert.equal(all.length, 0);
}
test('initial spatial candidate travels through original advance/native wake and position kernel once', (t) =>
  checkSpatial(t, true));
test('quiet spatial assessment is paid once and does not repeat on another advance', (t) =>
  checkSpatial(t, false));
