import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentAttempt,
  AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  beginAgentCommitInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('expired unanswered unknown relinquishes only execution ownership under a new legitimate claim (isolated real PG)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.ATTEMPT_LEASE_TEST_PORT ?? 55687));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const store = new PostgresAgentRuntimeRepository(db);
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actor = randomUUID(),
      other = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world = {
      id: worldId,
      ownerId: owner,
      title: 'Synthetic lease scope',
      version: 0,
      time: '2026-10-27T08:00:00Z',
      actors: [
        { id: actor, name: 'A', persona: 'A' },
        { id: other, name: 'B', persona: 'B' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [worldId, owner, world.title, world],
    );
    await db.transaction(owner, async (sql) => {
      for (const actorId of [actor, other])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId, actorId }, 'authored:synthetic', 0),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    return { owner, worldId, actor, other };
  }
  async function input(
    f: Awaited<ReturnType<typeof fixture>>,
    origin: 'player' | 'wake',
    actorId = f.actor,
  ) {
    const commandId = randomUUID();
    const receipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId,
      inputHash: hash(commandId),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 0,
      receivedAt: '2026-10-27T08:00:00Z',
      storyAt: '2026-10-27T08:00:00Z',
      origin,
      text:
        origin === 'player'
          ? '我还未决定。'
          : JSON.stringify({ type: 'npc_own_condition_ready', candidateId: 'synthetic-next' }),
    };
    const accepted = await store.accept(f.owner, receipt);
    return {
      id: randomUUID(),
      worldId: f.worldId,
      actorId,
      commandId,
      inputReceiptId: accepted.receipt.id,
      engineEpoch: 2,
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      inputHash: receipt.inputHash,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  async function expire(a: AgentAttempt) {
    await admin.query(
      'SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.02)',
      [a.leaseUntil],
    );
  }
  async function row(f: Awaited<ReturnType<typeof fixture>>, id: string) {
    return (
      await db.transaction(f.owner, (sql) =>
        sql.query('SELECT * FROM parallel_life.agent_attempts WHERE id=$1 AND owner_id=$2', [
          id,
          f.owner,
        ]),
      )
    ).rows[0]!;
  }
  for (const origin of ['player', 'wake'] as const)
    await t.test(
      `${origin} unknown: old command is never rebought; distinct claim frees expired slot; late raw cannot commit`,
      async () => {
        const f = await fixture(),
          oldInput = await input(f, origin);
        oldInput.leaseUntil = new Date(Date.now() + 400).toISOString();
        let old = (await store.claim(f.owner, oldInput)).attempt;
        old = await store.mark(f.owner, old, 'request_sent');
        old = await store.mark(f.owner, old, 'unknown_after_send');
        const before = await row(f, old.id);
        await expire(old);
        const replayBefore = await store.claim(f.owner, {
          ...oldInput,
          id: randomUUID(),
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        });
        assert.equal(replayBefore.replay, true);
        assert.equal(replayBefore.attempt.status, 'unknown_after_send');
        assert.equal(replayBefore.attempt.id, old.id);
        const nextInput = await input(f, 'wake');
        await assert.rejects(
          store.claim(f.owner, { ...nextInput, inputHash: hash('forged') }),
          /INVALID_INPUT/,
        );
        assert.equal(
          (await row(f, old.id)).status,
          'unknown_after_send',
          'invalid input cannot retire old execution ownership',
        );
        const next = await store.claim(f.owner, nextInput);
        assert.equal(next.replay, false);
        assert.equal(next.attempt.status, 'reserved');
        const retired = await row(f, old.id);
        assert.equal(retired.status, 'stale_discarded');
        for (const key of [
          'sent_at',
          'input_receipt_id',
          'input_hash',
          'command_id',
          'token',
          'expected_world_version',
          'expected_actor_revision',
          'lease_until',
        ])
          assert.deepEqual(retired[key], before[key], `retiring execution must preserve ${key}`);
        assert.equal(retired.response, null);
        assert.equal(retired.response_hash, null);
        const late = await store.saveResponse(f.owner, old, { raw: 'already-paid late reply' });
        assert.equal(late.status, 'stale_discarded');
        assert.deepEqual(await store.readResponse(f.owner, late), {
          found: true,
          response: { raw: 'already-paid late reply' },
        });
        await assert.rejects(
          db.transaction(f.owner, (sql) => beginAgentCommitInTransaction(sql, f.owner, late)),
          /ATTEMPT_STALE/,
        );
        const replayAfter = await store.claim(f.owner, oldInput);
        assert.equal(replayAfter.replay, true);
        assert.equal(replayAfter.attempt.id, old.id);
        assert.equal(replayAfter.attempt.status, 'stale_discarded');
        assert.equal((await row(f, next.attempt.id)).status, 'reserved');
        const totals = await db.transaction(f.owner, (sql) =>
          sql.query(
            `SELECT
      (SELECT count(*)::int FROM parallel_life.agent_attempts WHERE world_id=$1) AS attempts,
      (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1) AS events,
      (SELECT revision FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2) AS revision`,
            [f.worldId, f.actor],
          ),
        );
        assert.deepEqual(totals.rows[0], { attempts: 2, events: 0, revision: 0 });
      },
    );
  await t.test(
    'a live unknown blocks only that actor while another actor retains its slot',
    async () => {
      const f = await fixture();
      let old = (await store.claim(f.owner, await input(f, 'player'))).attempt;
      old = await store.mark(f.owner, old, 'request_sent');
      old = await store.mark(f.owner, old, 'unknown_after_send');
      await assert.rejects(store.claim(f.owner, await input(f, 'wake')), /ATTEMPT_PENDING/);
      assert.equal((await row(f, old.id)).status, 'unknown_after_send');
      const other = await store.claim(f.owner, await input(f, 'wake', f.other));
      assert.equal(other.attempt.actorId, f.other);
      assert.equal(other.attempt.status, 'reserved');
    },
  );
  await t.test(
    'expired received response and expired request_sent retain their original protection',
    async () => {
      for (const status of ['response_received', 'request_sent'] as const) {
        const f = await fixture(),
          cmd = await input(f, 'player');
        cmd.leaseUntil = new Date(Date.now() + 400).toISOString();
        let old = (await store.claim(f.owner, cmd)).attempt;
        old = await store.mark(f.owner, old, 'request_sent');
        if (status === 'response_received')
          old = await store.saveResponse(f.owner, old, { known: 'preserve without rebuying' });
        await expire(old);
        await assert.rejects(store.claim(f.owner, await input(f, 'wake')), /ATTEMPT_PENDING/);
        assert.equal((await row(f, old.id)).status, status);
      }
    },
  );
});
