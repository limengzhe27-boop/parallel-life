import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import { MessageReceiptLookupSchema } from '../../src/contracts/message-receipt-lookup.ts';

const hash = (c: { worldId: string; expectedVersion: number; actorId: string; text: string }) =>
  createHash('sha256')
    .update(JSON.stringify([c.worldId, c.expectedVersion, c.actorId, c.text, 'private', 'player']))
    .digest('hex');
const rawReply = JSON.stringify({
  statements: [{ text: 'Original protected reply.', dependsOnActionIds: [] }],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});

test('exact private-message response recovery uses real kernel and never claims or purchases new work', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.MESSAGE_RECOVERY_TEST_PORT ?? 55662));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  let modelFactories = 0;
  const service = npcAgentServices(db, () => {
    modelFactories++;
    throw Error('MODEL_MUST_NOT_BE_CONSTRUCTED');
  });
  const store = new PostgresAgentRuntimeRepository(db);
  async function fixture(epoch2 = true) {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const state: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic recovery',
      time: new Date().toISOString(),
      actors: [
        { id: actorId, name: 'Test NPC', persona: 'A fictional participant.' },
        {
          id: randomUUID(),
          name: 'Other NPC',
          persona: 'Another independent fictional participant.',
        },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    const worlds = new PostgresWorldRepository(db);
    await worlds.initialize({ userId: owner }, state);
    if (epoch2) {
      await db.transaction(owner, async (sql) => {
        for (const actor of state.actors)
          await initializeActorAgentStateInTransaction(
            sql,
            owner,
            emptyActorAgentState(
              { worldId, actorId: actor.id },
              agentDefinitionRef(state, actor.id),
              0,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        });
        await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
      });
    }
    const command = {
      id: randomUUID(),
      worldId,
      actorId,
      expectedVersion: 0,
      text: 'A synthetic original request.',
    };
    async function accept() {
      return (
        await store.accept(owner, {
          id: randomUUID(),
          worldId,
          commandId: command.id,
          inputHash: hash(command),
          channel: 'private',
          threadId: actorId,
          recipientActorId: actorId,
          expectedWorldVersion: 0,
          origin: 'player',
          text: command.text,
          receivedAt: state.time,
          storyAt: state.time,
        })
      ).receipt;
    }
    async function reserved() {
      const receipt = await accept();
      const actor = await store.read(owner, { worldId, actorId });
      assert(actor);
      const snapshot = (
        await readPrivateAgentSnapshot(db, owner, state, actorId, receipt, state.time, actor)
      ).snapshot;
      const attempt = (
        await store.claim(owner, {
          id: randomUUID(),
          worldId,
          actorId,
          commandId: command.id,
          inputReceiptId: receipt.id,
          engineEpoch: 2,
          expectedWorldVersion: 0,
          expectedActorRevision: 0,
          inputHash: receipt.inputHash,
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 120000).toISOString(),
        })
      ).attempt;
      return { receipt, snapshot, attempt };
    }
    async function received(response = rawReply) {
      const prepared = await reserved();
      const sent = await store.mark(owner, prepared.attempt, 'request_sent');
      const attempt = await store.saveResponse(owner, sent, {
        kind: 'npc_agent_completion',
        schemaVersion: 1,
        snapshot: prepared.snapshot,
        response,
      });
      return { ...prepared, attempt };
    }
    async function counts() {
      return (
        await admin.query(
          `SELECT (SELECT count(*)::int FROM parallel_life.agent_input_receipts WHERE world_id=$1) inputs,(SELECT count(*)::int FROM parallel_life.agent_attempts WHERE world_id=$1) attempts,(SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1) events,(SELECT count(*)::int FROM parallel_life.world_messages WHERE world_id=$1) messages`,
          [worldId],
        )
      ).rows[0];
    }
    return { owner, worldId, actorId, state, worlds, command, accept, reserved, received, counts };
  }

  await t.test(
    'lookup differentiates accepted/no attempt, reserved, request sent and unknown without writes',
    async () => {
      const f = await fixture();
      await f.accept();
      assert.equal(((await service.lookupMessage(f.owner, f.command)) as any).recovery, 'pending');
      const r = await f.reserved();
      assert.equal(((await service.lookupMessage(f.owner, f.command)) as any).recovery, 'pending');
      const sent = await store.mark(f.owner, r.attempt, 'request_sent');
      const before = await f.counts();
      assert.equal(((await service.recoverMessage(f.owner, f.command)) as any).recovery, 'pending');
      const unknown = await store.mark(f.owner, sent, 'unknown_after_send');
      const rowBefore = (
        await admin.query(
          'SELECT status,response_hash,updated_at FROM parallel_life.agent_attempts WHERE id=$1',
          [unknown.id],
        )
      ).rows[0];
      assert.equal(((await service.lookupMessage(f.owner, f.command)) as any).recovery, 'unknown');
      assert.equal(((await service.recoverMessage(f.owner, f.command)) as any).recovery, 'unknown');
      const rowAfter = (
        await admin.query(
          'SELECT status,response_hash,updated_at FROM parallel_life.agent_attempts WHERE id=$1',
          [unknown.id],
        )
      ).rows[0];
      assert.deepEqual(rowAfter, rowBefore);
      assert.deepEqual(await f.counts(), before);
      assert.equal(modelFactories, 0);
    },
  );

  await t.test(
    'a protected response is committed once through the original transaction and repeated recovery is read-only',
    async () => {
      const f = await fixture();
      const r = await f.received();
      const before = (
        await admin.query(
          'SELECT response_hash,response FROM parallel_life.agent_attempts WHERE id=$1',
          [r.attempt.id],
        )
      ).rows[0];
      const lookup = await service.lookupMessage(f.owner, f.command);
      assert.equal(lookup?.status, 'unconfirmed');
      assert.equal((lookup as any).recovery, 'response_received');
      assert.deepEqual(await f.counts(), { inputs: 1, attempts: 1, events: 0, messages: 0 });
      const recovered = await service.recoverMessage(f.owner, f.command);
      assert.equal(recovered.status, 'committed');
      MessageReceiptLookupSchema.parse(recovered);
      assert.deepEqual(await service.lookupMessage(f.owner, f.command), recovered);
      assert.deepEqual(await service.recoverMessage(f.owner, f.command), recovered);
      assert.deepEqual(await f.counts(), { inputs: 1, attempts: 1, events: 1, messages: 2 });
      const after = (
        await admin.query(
          'SELECT response_hash,response FROM parallel_life.agent_attempts WHERE id=$1',
          [r.attempt.id],
        )
      ).rows[0];
      assert.deepEqual(after, before);
      const world = await f.worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(
        world.messages.filter((m) => m.role === 'assistant')[0]!.text,
        'Original protected reply.',
      );
      assert.equal(modelFactories, 0);
    },
  );

  await t.test(
    'two concurrent recoveries share the exact existing attempt and one committed event',
    async () => {
      const f = await fixture();
      await f.received();
      const receipts = await Promise.all([
        service.recoverMessage(f.owner, f.command),
        service.recoverMessage(f.owner, f.command),
      ]);
      assert.equal(receipts[0]!.status, 'committed');
      assert.deepEqual(receipts[0], receipts[1]);
      assert.deepEqual(await f.counts(), { inputs: 1, attempts: 1, events: 1, messages: 2 });
      assert.equal(modelFactories, 0);
    },
  );

  await t.test(
    'cross owner, changed command identity and guessed inputs cannot recover or create work',
    async () => {
      const f = await fixture();
      await f.received();
      const before = await f.counts();
      await assert.rejects(service.recoverMessage(randomUUID(), f.command));
      for (const patch of [
        { actorId: randomUUID() },
        { text: 'A different request.' },
        { expectedVersion: 1 },
      ])
        await assert.rejects(service.recoverMessage(f.owner, { ...f.command, ...patch }), {
          code: 'IDEMPOTENCY_CONFLICT',
        });
      await assert.rejects(service.recoverMessage(f.owner, { ...f.command, id: randomUUID() }), {
        code: 'NOT_FOUND',
      });
      await assert.rejects(service.recoverMessage(f.owner, { ...f.command, origin: 'director' }), {
        code: 'INVALID_COMMAND',
      });
      assert.deepEqual(await f.counts(), before);
      assert.equal(modelFactories, 0);
    },
  );

  await t.test(
    'cancelled and known invalid results are terminal and never resumed by recovery',
    async () => {
      const cancelled = await fixture();
      const r = await cancelled.reserved();
      await store.mark(cancelled.owner, r.attempt, 'cancelled_before_send');
      const c = await service.recoverMessage(cancelled.owner, cancelled.command);
      assert.equal(c.status, 'failed');
      if (c.status === 'failed') assert.equal(c.code, 'INVALID_STATE');
      assert.equal(
        (await store.lookup(cancelled.owner, cancelled.worldId, cancelled.command.id))!.status,
        'cancelled_before_send',
      );
      const invalid = await fixture();
      const bad = await invalid.received('not a valid response');
      const before = (
        await admin.query(
          'SELECT response_hash,response FROM parallel_life.agent_attempts WHERE id=$1',
          [bad.attempt.id],
        )
      ).rows[0];
      const failed = await service.recoverMessage(invalid.owner, invalid.command);
      assert.equal(failed.status, 'failed');
      if (failed.status === 'failed') assert.equal(failed.code, 'INVALID_AI_OUTPUT');
      assert.deepEqual(await service.recoverMessage(invalid.owner, invalid.command), failed);
      const after = (
        await admin.query(
          'SELECT response_hash,response FROM parallel_life.agent_attempts WHERE id=$1',
          [bad.attempt.id],
        )
      ).rows[0];
      assert.deepEqual(after, before);
      assert.equal(modelFactories, 0);
    },
  );

  await t.test(
    'world conflict preserves existing history and maps both send and lookup to VERSION_CONFLICT',
    async () => {
      const f = await fixture();
      await f.received();
      let controlledCalls = 0;
      const otherService = npcAgentServices(db, () => ({
        complete: async () => {
          controlledCalls++;
          return rawReply;
        },
      }));
      await otherService.sendMessageIfEnabled(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        actorId: f.state.actors[1]!.id,
        expectedVersion: 0,
        text: 'A separately committed actual turn.',
      });
      assert.equal(controlledCalls, 1);
      const receipt = await service.recoverMessage(f.owner, f.command);
      assert.equal(receipt.status, 'failed');
      if (receipt.status === 'failed') assert.equal(receipt.code, 'VERSION_CONFLICT');
      await assert.rejects(service.sendMessageIfEnabled(f.owner, f.command), {
        code: 'VERSION_CONFLICT',
      });
      assert.deepEqual(await service.lookupMessage(f.owner, f.command), receipt);
      assert.equal(
        (await f.worlds.get({ userId: f.owner }, f.worldId)).messages.filter(
          (m) => m.role === 'assistant',
        ).length,
        1,
      );
      assert.equal(modelFactories, 0);
    },
  );

  await t.test(
    'a storage failure rolls back partial execution and leaves the protected response recoverable without another model',
    async () => {
      const f = await fixture();
      const prepared = await f.received();
      let armed = true;
      const failingDb = {
        transaction: <T>(ownerId: string, run: (sql: SqlClient) => Promise<T>) =>
          db.transaction(ownerId, async (sql) => {
            const wrapped = {
              query: async (text: string, values?: unknown[]) => {
                if (armed && text.startsWith('INSERT INTO parallel_life.world_events')) {
                  armed = false;
                  throw Error('LOCAL_SYNTHETIC_STORAGE_FAILURE');
                }
                return sql.query(text, values);
              },
            } as SqlClient;
            return run(wrapped);
          }),
      } as unknown as PostgresDatabase;
      const recovering = npcAgentServices(failingDb, () => {
        modelFactories++;
        throw Error('MODEL_MUST_NOT_BE_CONSTRUCTED');
      });
      await assert.rejects(
        recovering.recoverMessage(f.owner, f.command),
        (error) => (error as any).apiCode === 'UNKNOWN',
      );
      assert.equal(
        (await store.lookup(f.owner, f.worldId, f.command.id))!.status,
        'response_received',
      );
      assert.deepEqual(await f.counts(), { inputs: 1, attempts: 1, events: 0, messages: 0 });
      assert.equal((await store.readResponse(f.owner, prepared.attempt)).found, true);
      assert.equal(
        ((await service.lookupMessage(f.owner, f.command)) as any).recovery,
        'response_received',
      );
      assert.equal((await recovering.recoverMessage(f.owner, f.command)).status, 'committed');
      assert.deepEqual(await f.counts(), { inputs: 1, attempts: 1, events: 1, messages: 2 });
      assert.equal(modelFactories, 0);
    },
  );

  await t.test(
    'old engine and missing acceptance cannot enter recovery while read-only lookup keeps null fallback',
    async () => {
      const old = await fixture(false);
      assert.equal(await service.lookupMessage(old.owner, old.command), null);
      await assert.rejects(
        service.recoverMessage(old.owner, old.command),
        (e) => (e as any).apiCode === 'INVALID_STATE',
      );
      const fresh = await fixture();
      assert.equal(await service.lookupMessage(fresh.owner, fresh.command), null);
      await assert.rejects(service.recoverMessage(fresh.owner, fresh.command), {
        code: 'NOT_FOUND',
      });
      assert.deepEqual(await fresh.counts(), { inputs: 0, attempts: 0, events: 0, messages: 0 });
      assert.equal(modelFactories, 0);
    },
  );
});
