import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

test('zero-candidate world wakes director once per durable review cadence', async () => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55432, 'local synthetic cluster only');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  try {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Director wake test',
      time: '2026-10-21T06:00:00.000Z',
      actors: [{ id: actorId, name: 'A', persona: 'An independent fictional shopkeeper' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    const worlds = new PostgresWorldRepository(db);
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(world, actorId), 0),
      );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });

    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [worldId, owner],
      ),
    );
    await new PostgresClockStore(db).setClock(owner, worldId, { paused: false, speed: 0 });
    let directorCalls = 0;
    let npcCalls = 0;
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages[1]!.content);
        if (p.promptVersion.startsWith('director-')) {
          directorCalls++;
          return JSON.stringify({
            protocol: 'director-wire-v14',
            openingContext: null,
            authoredChoices: {},
            candidates: [],
            opportunities: [],
            audit: { reason: 'No actor candidate or eligible event.', sourceRefs: [] },
          });
        }
        npcCalls++;
        throw Error('NPC_MUST_NOT_RUN_WITHOUT_A_CANDIDATE');
      },
    };
    const advance = npcAgentAdvanceServices(
      db,
      () => model,
      new PostgresDirectorSnapshotRepository(db),
    );
    const first = await advance.advanceIfEnabled(owner, worldId);
    assert.equal(npcCalls, 0);
    assert.equal(directorCalls, 1, 'director wakes with zero actor candidates');
    assert.equal(first?.played, 0);
    const attempts = (
      await admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
        [worldId],
      )
    ).rows;
    assert.equal(
      Number(attempts[0].n),
      1,
      'director cadence is derived from the existing attempt ledger',
    );
    await advance.advanceIfEnabled(owner, worldId);
    assert.equal(directorCalls, 1, 'immediate advance does not repeat the director review');
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
            [worldId],
          )
        ).rows[0].n,
      ),
      1,
    );
  } finally {
    await db.close();
    await admin.end();
  }
});
