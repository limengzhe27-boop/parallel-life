import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { AdvanceOperationRepository } from '../../src/modules/world/infrastructure/advance-operation-repository.ts';
import { agentAdvanceOperations } from '../../src/server/agent-advance-operations.ts';
import { AdvanceOperationReceiptSchema } from '../../src/contracts/advance-operation.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('advance original operation: idempotent start, exact protected recovery, unknown and owner isolation', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.ADVANCE_RECOVERY_TEST_PORT ?? 55587));
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
    stranger = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);
  await new IdentityRepository(db).ensureGuest(stranger);
  const state: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: 'Synthetic operation recovery',
    time: new Date().toISOString(),
    actors: [{ id: actorId, name: 'Test', persona: 'Fictional participant' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  await new PostgresWorldRepository(db).initialize({ userId: owner }, state);
  await db.transaction(owner, async (sql) => {
    await initializeActorAgentStateInTransaction(
      sql,
      owner,
      emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(state, actorId), 0),
    );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
    await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
  });
  const ops = new AdvanceOperationRepository(db),
    attempts = new PostgresAgentRuntimeRepository(db);
  let advances = 0;
  const service = agentAdvanceOperations(db, async () => {
    advances++;
    return { storyNow: state.time, played: 0, folded: 0, summary: null, actors: [] };
  });
  const id = randomUUID();
  const starts = await Promise.all([
    service.perform(owner, worldId, id, 'start'),
    service.perform(owner, worldId, id, 'start'),
  ]);
  assert.equal(advances, 1);
  starts.forEach((r) => AdvanceOperationReceiptSchema.parse(r));
  assert.equal((await service.perform(owner, worldId, id, 'lookup')).status, 'complete');
  await service.perform(owner, worldId, id, 'recover');
  assert.equal(advances, 1);
  await assert.rejects(() => service.perform(stranger, worldId, id, 'lookup'), {
    code: 'NOT_FOUND',
  });
  await db.transaction(stranger, async (sql) =>
    assert.equal(
      (
        await sql.query('SELECT * FROM parallel_life.agent_advance_operations WHERE world_id=$1', [
          worldId,
        ])
      ).rowCount,
      0,
    ),
  );
  const pendingId = randomUUID(),
    commandId = randomUUID();
  await ops.start(owner, worldId, pendingId);
  await ops.track(owner, worldId, pendingId, { kind: 'npc', commandId });
  const receipt = (
    await attempts.accept(owner, {
      id: randomUUID(),
      worldId,
      commandId,
      inputHash: 'a'.repeat(64),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 0,
      origin: 'player',
      text: 'Synthetic original message',
      receivedAt: state.time,
      storyAt: state.time,
    })
  ).receipt;
  const actor = await attempts.read(owner, { worldId, actorId });
  assert(actor);
  const snapshot = (
    await readPrivateAgentSnapshot(db, owner, state, actorId, receipt, state.time, actor)
  ).snapshot;
  let attempt = (
    await attempts.claim(owner, {
      id: randomUUID(),
      worldId,
      actorId,
      commandId,
      inputReceiptId: receipt.id,
      engineEpoch: 2,
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      inputHash: receipt.inputHash,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    })
  ).attempt;
  attempt = await attempts.mark(owner, attempt, 'request_sent');
  await ops.finish(owner, worldId, pendingId, undefined, new Error('transport lost'));
  assert.equal((await service.perform(owner, worldId, pendingId, 'recover')).status, 'unknown');
  assert.equal(advances, 1);
  await attempts.saveResponse(owner, attempt, {
    kind: 'npc_agent_completion',
    schemaVersion: 1,
    snapshot,
    response: JSON.stringify({
      statements: [{ text: 'Protected original reply.', dependsOnActionIds: [] }],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    }),
  });
  assert.equal((await service.perform(owner, worldId, pendingId, 'lookup')).status, 'recoverable');
  assert.equal((await service.perform(owner, worldId, pendingId, 'recover')).status, 'complete');
  assert.equal((await service.perform(owner, worldId, pendingId, 'recover')).status, 'complete');
  assert.equal(advances, 1);
  const messages = await admin.query(
    'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
    [worldId],
  );
  assert.equal(messages.rows[0].n, 2);
  const failedId = randomUUID();
  await ops.start(owner, worldId, failedId);
  await ops.finish(
    owner,
    worldId,
    failedId,
    undefined,
    Object.assign(Error('invalid'), { code: 'INVALID_AGENT_PROPOSAL' }),
  );
  assert.equal((await service.perform(owner, worldId, failedId, 'start')).status, 'failed');
  assert.equal(advances, 1);
});
