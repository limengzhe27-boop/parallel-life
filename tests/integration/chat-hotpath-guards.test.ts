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
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { persistAndCommitStreamSegment } from '../../src/modules/world/infrastructure/npc-stream-segment-repository.ts';

const at = '2026-10-26T09:00:00.000Z';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

test('stream metadata batching preserves early guards and serializes new input behind the world lock', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.CHAT_HOTPATH_TEST_PORT ?? 55652));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const store = new PostgresAgentRuntimeRepository(db);
  const owners: string[] = [];
  t.after(async () => {
    try {
      // Retain isolated synthetic evidence, but never leave automatic activity on.
      for (const owner of owners)
        await admin.query(
          `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats)
        SELECT id,owner_id,$2,0,true,now(),0 FROM parallel_life.worlds WHERE owner_id=$1
        ON CONFLICT(world_id) DO UPDATE SET paused=true,active_until=NULL`,
          [owner, at],
        );
    } finally {
      await db.close();
      await admin.end();
    }
  });
  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID();
    owners.push(owner);
    await new IdentityRepository(db).ensureGuest(owner);
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [
        worldId,
        owner,
        'hotpath guard fixture',
        {
          id: worldId,
          ownerId: owner,
          version: 0,
          title: 'hotpath guard fixture',
          time: at,
          actors: [{ id: actorId, name: '林岸', persona: '简短、独立' }],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
        },
      ],
    );
    const state = emptyActorAgentState({ worldId, actorId }, 'authored:hotpath', 0);
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, owner, state);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    const receipt = {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: digest('hello'),
      channel: 'private' as const,
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 0,
      receivedAt: at,
      storyAt: at,
      origin: 'player' as const,
      text: '你好',
    };
    await store.accept(owner, receipt);
    let attempt = (
      await store.claim(owner, {
        id: randomUUID(),
        worldId,
        actorId,
        commandId: receipt.commandId,
        inputReceiptId: receipt.id,
        engineEpoch: 2,
        expectedWorldVersion: 0,
        expectedActorRevision: 0,
        inputHash: receipt.inputHash,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 60000).toISOString(),
      })
    ).attempt;
    attempt = await store.mark(owner, attempt, 'request_sent');
    // Every tested guard must exit before any missing post-guard snapshot field
    // could matter; successful presentation is covered by chat-latency-stage2.
    const snapshot = { state } as AgentSnapshot;
    return { owner, worldId, actorId, state, receipt, attempt, snapshot };
  }
  async function commit(f: Awaited<ReturnType<typeof fixture>>, database = db) {
    return persistAndCommitStreamSegment(database, new PostgresWorldRepository(database), f.owner, {
      attempt: f.attempt,
      snapshot: f.snapshot,
      statement: { segmentIndex: 0, text: '我先把自己的事情安排好。', dependsOnActionIds: [] },
      unitKind: 'independent_statement',
    });
  }
  for (const reason of [
    'ENGINE_EPOCH_CONFLICT',
    'ATTEMPT_STALE',
    'AGENT_REVISION_CONFLICT',
    'INPUT_SCOPE_FORBIDDEN',
    'SUPERSEDED_BY_USER_INTERRUPT',
  ] as const) {
    const f = await fixture();
    if (reason === 'ENGINE_EPOCH_CONFLICT')
      await admin.query(
        'UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=3 WHERE world_id=$1',
        [f.worldId],
      );
    if (reason === 'ATTEMPT_STALE') f.attempt = { ...f.attempt, token: randomUUID() };
    if (reason === 'AGENT_REVISION_CONFLICT')
      await admin.query(
        "UPDATE parallel_life.actor_agent_states SET revision=revision+1,document=jsonb_set(document,'{revision}',to_jsonb(revision+1)) WHERE world_id=$1",
        [f.worldId],
      );
    if (reason === 'INPUT_SCOPE_FORBIDDEN')
      f.attempt = { ...f.attempt, inputReceiptId: randomUUID() };
    if (reason === 'SUPERSEDED_BY_USER_INTERRUPT')
      await store.accept(f.owner, {
        ...f.receipt,
        id: randomUUID(),
        commandId: randomUUID(),
        inputHash: digest('new input'),
        text: '先等等',
      });
    assert.deepEqual(await commit(f), { outcome: 'superseded', reason });
    assert.equal(
      (
        await admin.query(
          'SELECT count(*) AS n FROM parallel_life.world_events WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].n,
      '0',
    );
  }
  {
    const f = await fixture();
    await admin.query(
      'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats) VALUES($1,$2,$3,0,true,now(),0)',
      [f.worldId, f.owner, at],
    );
    await assert.rejects(commit(f), { code: 'NPC_DELIVERY_DEFERRED' });
    assert.equal(
      (
        await admin.query(
          'SELECT count(*) AS n FROM parallel_life.world_events WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].n,
      '0',
    );
  }
  {
    const f = await fixture();
    // Use an epoch mismatch to stop after the metadata read; independently prove
    // the real acceptance writer cannot insert newer input during that read.
    await admin.query(
      'UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=3 WHERE world_id=$1',
      [f.worldId],
    );
    let unlock!: () => void, locked!: () => void;
    const release = new Promise<void>((r) => (unlock = r)),
      worldLocked = new Promise<void>((r) => (locked = r));
    const gated = {
      pool: db.pool,
      close: () => db.close(),
      transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
        return db.transaction(owner, (sql) =>
          run(
            new Proxy(sql, {
              get(target, key) {
                if (key === 'query')
                  return async (...args: Parameters<SqlClient['query']>) => {
                    const result = await target.query(...args);
                    if (
                      String(args[0]).includes('SELECT version, state FROM parallel_life.worlds') &&
                      String(args[0]).includes('FOR UPDATE')
                    ) {
                      locked();
                      await release;
                    }
                    return result;
                  };
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          ),
        );
      },
    } as PostgresDatabase;
    const committing = commit(f, gated);
    await worldLocked;
    let accepted = false;
    const accepting = store
      .accept(f.owner, {
        ...f.receipt,
        id: randomUUID(),
        commandId: randomUUID(),
        inputHash: digest('concurrent'),
        text: '等一下',
      })
      .then(() => {
        accepted = true;
      });
    const switching = assert.rejects(
      db.transaction(f.owner, (sql) =>
        switchAgentEngineEpochInTransaction(sql, f.owner, {
          worldId: f.worldId,
          expectedEpoch: 3,
          nextEpoch: 4,
          expectedWorldVersion: 0,
        }),
      ),
      { code: 'ATTEMPT_PENDING' },
    );
    try {
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline) {
        blocked =
          ((
            await admin.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT version,state FROM parallel_life.worlds%'",
            )
          ).rowCount ?? 0) >= 2;
        if (blocked) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(
        blocked,
        true,
        'real input acceptance and epoch switching both wait for the held world lock',
      );
      assert.equal(accepted, false);
    } finally {
      unlock();
    }
    assert.deepEqual(await committing, { outcome: 'superseded', reason: 'ENGINE_EPOCH_CONFLICT' });
    await accepting;
    await switching;
  }
});
