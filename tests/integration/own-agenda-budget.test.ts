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
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import type { AgentAttempt } from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import {
  readOwnAgendaBudgetInTransaction,
  reserveOwnAgendaBudgetInTransaction,
  OwnAgendaBudgetError,
  type OwnAgendaBudgetPolicy,
} from '../../src/modules/world/infrastructure/own-agenda-budget-repository.ts';

const at = '2026-10-19T10:00:01.000Z';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const policy = (owner = 10, world = 10, actor = 10): OwnAgendaBudgetPolicy => ({
  owner: { limit: owner, windowSeconds: 60 },
  world: { limit: world, windowSeconds: 60 },
  actor: { limit: actor, windowSeconds: 60 },
});

test('own-agenda three-tier budget: real PostgreSQL/RLS/transactions, no model or runtime-wiring claim', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55634);
  const admin = await adminClient('parallel_life_test');
  assert.equal((await admin.query('SELECT inet_server_port() port')).rows[0].port, 55634);
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    store = new PostgresAgentRuntimeRepository(db);
  const all: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    for (const f of all) await clocks.setClock(f.owner, f.worldId, { paused: true });
    await db.close();
    await admin.end();
  });
  async function fixture(owner = randomUUID()) {
    const worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic budget fixture',
      time: at,
      actors: [
        { id: 'a', name: 'A', persona: 'Independent' },
        { id: 'b', name: 'B', persona: 'Reserved' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    all.push({ owner, worldId });
    return { owner, worldId };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function claim(f: F, actorId = 'a') {
    const commandId = randomUUID(),
      text = 'Explicit synthetic budget-only wake; no provider call';
    const { receipt } = await store.accept(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      commandId,
      inputHash: hash(text),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 0,
      receivedAt: at,
      storyAt: at,
      origin: 'wake',
      text,
    });
    return (
      await store.claim(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        actorId,
        commandId,
        inputReceiptId: receipt.id,
        inputHash: receipt.inputHash,
        engineEpoch: 2,
        expectedWorldVersion: 0,
        expectedActorRevision: 0,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      })
    ).attempt;
  }
  const counters = (owner: string) =>
    db.transaction(owner, async (sql) =>
      (
        await sql.query(
          'SELECT bucket,window_start,count FROM parallel_life.rate_limits WHERE owner_id=$1 ORDER BY bucket',
          [owner],
        )
      ).rows.map((r) => ({ ...r, window_start: r.window_start.toISOString() })),
    );
  const read = (f: F, p = policy(), now = at, actor = 'a') =>
    db.transaction(f.owner, (sql) =>
      readOwnAgendaBudgetInTransaction(sql, f.owner, f.worldId, actor, p, now),
    );
  async function markSent(sql: SqlClient, a: AgentAttempt) {
    // Tests the original table's send transition in the caller TX. Full public mark/holder wiring belongs to root.
    const r = await sql.query(
      "UPDATE parallel_life.agent_attempts SET status='request_sent',sent_at=clock_timestamp() WHERE id=$1 AND token=$2 AND status='reserved' RETURNING id",
      [a.id, a.token],
    );
    assert.equal(r.rowCount, 1);
  }
  async function sent(f: F, a: AgentAttempt, p = policy(), now = at) {
    return db.transaction(f.owner, async (sql) => {
      const r = await reserveOwnAgendaBudgetInTransaction(
        sql,
        f.owner,
        f.worldId,
        a.actorId,
        p,
        now,
        a.id,
      );
      assert.equal(r.status, 'reserved');
      await markSent(sql, a);
      return r;
    });
  }
  async function settleSynthetic(f: F, a: AgentAttempt) {
    const current = (await store.lookup(f.owner, f.worldId, a.commandId))!;
    const received = await store.saveResponse(f.owner, current, {
      syntheticBudgetTest: true,
      noProvider: true,
    });
    await store.mark(f.owner, received, 'invalid_output');
  }
  function proxy(
    sql: SqlClient,
    onQuery: (text: string, args: unknown[]) => Promise<unknown> | undefined,
  ): SqlClient {
    return new Proxy(sql, {
      get(target, property) {
        if (property !== 'query') return Reflect.get(target, property);
        return (...args: unknown[]) =>
          onQuery(String(args[0]), args) ?? Reflect.apply(target.query, target, args);
      },
    });
  }
  const code = (value: string) => (e: unknown) =>
    e instanceof OwnAgendaBudgetError && e.code === value;

  await t.test(
    'read uses actual owner/world/actor auth and read-only SQL, no counter initialization',
    async () => {
      const f = await fixture(),
        foreign = await fixture();
      const value = await db.transaction(f.owner, async (sql) => {
        await sql.query('SET TRANSACTION READ ONLY');
        return readOwnAgendaBudgetInTransaction(
          proxy(sql, (text) => {
            assert.match(text, /^SELECT /);
            return undefined;
          }),
          f.owner,
          f.worldId,
          'a',
          policy(3, 4, 5),
          at,
        );
      });
      assert.deepEqual(value, {
        owner: { remaining: 3, nextWindowRealAt: '2026-10-19T10:01:00.000Z' },
        world: { remaining: 4, nextWindowRealAt: '2026-10-19T10:01:00.000Z' },
        actor: { remaining: 5, nextWindowRealAt: '2026-10-19T10:01:00.000Z' },
      });
      assert.deepEqual(await counters(f.owner), []);
      await assert.rejects(
        db.transaction(foreign.owner, (sql) =>
          readOwnAgendaBudgetInTransaction(sql, f.owner, f.worldId, 'a', policy(), at),
        ),
        /NOT_FOUND/,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          readOwnAgendaBudgetInTransaction(sql, f.owner, foreign.worldId, 'a', policy(), at),
        ),
        /NOT_FOUND/,
      );
      await assert.rejects(
        read(f, policy(), at, 'missing'),
        code('INVALID_OWN_AGENDA_BUDGET_SCOPE'),
      );
      const before = await counters(f.owner);
      for (const p of [
        { ...policy(), owner: { limit: 0, windowSeconds: 60 } },
        { ...policy(), actor: { limit: 2, windowSeconds: 0 } },
        { ...policy(), world: { limit: 1.5, windowSeconds: 60 } },
        { ...policy(), owner: { limit: 2147483648, windowSeconds: 60 } },
        { ...policy(), extra: true },
      ])
        await assert.rejects(
          read(f, p as OwnAgendaBudgetPolicy),
          code('INVALID_OWN_AGENDA_BUDGET_POLICY'),
        );
      await assert.rejects(
        read(f, policy(), '2026-02-30T10:00:00.000Z'),
        code('INVALID_OWN_AGENDA_BUDGET_TIME'),
      );
      assert.deepEqual(await counters(f.owner), before);
    },
  );
  await t.test(
    'three counters and send marker commit together; already-sent and foreign attempts cannot spend',
    async () => {
      const f = await fixture(),
        a = await claim(f);
      const r = await sent(f, a, policy(3, 4, 5));
      assert.equal(r.status, 'reserved');
      if (r.status !== 'reserved') throw Error('unreachable');
      assert.deepEqual(
        [r.budgets.owner.remaining, r.budgets.world.remaining, r.budgets.actor.remaining],
        [2, 3, 4],
      );
      const rows = await counters(f.owner);
      assert.equal(rows.length, 3);
      assert.ok(rows.every((r) => r.count === 1));
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          reserveOwnAgendaBudgetInTransaction(sql, f.owner, f.worldId, 'a', policy(), at, a.id),
        ),
        code('OWN_AGENDA_BUDGET_ATTEMPT_NOT_RESERVED'),
      );
      const other = await fixture(f.owner),
        b = await claim(other);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          reserveOwnAgendaBudgetInTransaction(sql, f.owner, f.worldId, 'a', policy(), at, b.id),
        ),
        code('OWN_AGENDA_BUDGET_ATTEMPT_NOT_RESERVED'),
      );
      assert.deepEqual(await counters(f.owner), rows);
    },
  );
  await t.test(
    'concurrent callers of the same attempt cannot reserve again after the first send transition',
    async () => {
      const f = await fixture(),
        a = await claim(f);
      const results = await Promise.allSettled([sent(f, a), sent(f, a)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const failed = results.find((r) => r.status === 'rejected');
      assert.ok(failed && failed.status === 'rejected');
      assert.ok(failed.reason instanceof OwnAgendaBudgetError);
      assert.equal(failed.reason.code, 'OWN_AGENDA_BUDGET_ATTEMPT_NOT_RESERVED');
      assert.ok((await counters(f.owner)).every((row) => row.count === 1));
    },
  );
  await t.test(
    'outer send transaction failure rolls back every bucket and the send marker',
    async () => {
      const f = await fixture(),
        a = await claim(f),
        failure = Error('synthetic outer storage failure');
      await assert.rejects(
        db.transaction(f.owner, async (sql) => {
          const r = await reserveOwnAgendaBudgetInTransaction(
            sql,
            f.owner,
            f.worldId,
            'a',
            policy(),
            at,
            a.id,
          );
          assert.equal(r.status, 'reserved');
          await markSent(sql, a);
          throw failure;
        }),
        (e) => e === failure,
      );
      assert.deepEqual(await counters(f.owner), []);
      assert.equal((await store.lookup(f.owner, f.worldId, a.commandId))!.status, 'reserved');
    },
  );
  for (const exhausted of ['owner', 'world', 'actor'] as const)
    await t.test(
      `${exhausted} exhaustion rolls back ALL this-call reservations and permits same-TX zero-send cancellation`,
      async () => {
        const f = await fixture(),
          p = policy(
            exhausted === 'owner' ? 1 : 5,
            exhausted === 'world' ? 1 : 5,
            exhausted === 'actor' ? 1 : 5,
          ),
          first = await claim(f);
        await sent(f, first, p);
        await settleSynthetic(f, first);
        const a = await claim(f),
          before = await counters(f.owner);
        const r = await db.transaction(f.owner, async (sql) => {
          const result = await reserveOwnAgendaBudgetInTransaction(
            sql,
            f.owner,
            f.worldId,
            'a',
            p,
            at,
            a.id,
          );
          assert.equal(result.status, 'budget_wait');
          await sql.query(
            "UPDATE parallel_life.agent_attempts SET status='cancelled_before_send' WHERE id=$1 AND status='reserved'",
            [a.id],
          );
          assert.equal((await sql.query('SELECT 42 answer')).rows[0].answer, 42);
          return result;
        });
        assert.equal(r.status, 'budget_wait');
        if (r.status !== 'budget_wait') throw Error('unreachable');
        assert.deepEqual(r.exhausted, [exhausted]);
        assert.equal(r.nextCheckRealAt, '2026-10-19T10:01:00.000Z');
        assert.deepEqual(await counters(f.owner), before);
        const stored = (
          await admin.query(
            'SELECT status,sent_at,response,response_hash,event_id FROM parallel_life.agent_attempts WHERE id=$1',
            [a.id],
          )
        ).rows[0];
        assert.deepEqual(stored, {
          status: 'cancelled_before_send',
          sent_at: null,
          response: null,
          response_hash: null,
          event_id: null,
        });
        assert.equal(
          (await read(f, p, '2026-10-19T10:01:01.000Z'))[exhausted].remaining,
          p[exhausted].limit,
        );
        // Existing cancelled identity resumes only through the original exact-CAS recovery.
        const recovered = await store.claim(f.owner, a);
        assert.equal(recovered.replay, false);
        assert.equal(recovered.attempt.id, a.id);
        assert.notEqual(recovered.attempt.token, a.token);
        await sent(f, recovered.attempt, p, '2026-10-19T10:01:01.000Z');
        assert.ok(
          (await counters(f.owner)).every(
            (row) => row.count === 1 && row.window_start === '2026-10-19T10:01:00.000Z',
          ),
        );
      },
    );
  await t.test(
    'independent window lengths and stable namespace survive limit/policy-object changes',
    async () => {
      const f = await fixture(),
        a = await claim(f),
        p = {
          owner: { limit: 4, windowSeconds: 3600 },
          world: { limit: 3, windowSeconds: 300 },
          actor: { limit: 2, windowSeconds: 60 },
        };
      await sent(f, a, p);
      const rows = await counters(f.owner);
      assert.ok(rows.every((row) => /^npc-own-agenda:(owner|world|actor):v1/.test(row.bucket)));
      const r = await read(
        f,
        { owner: { ...p.owner, limit: 5 }, world: p.world, actor: p.actor },
        '2026-10-19T10:01:01.000Z',
      );
      assert.equal(r.owner.remaining, 4);
      assert.equal(r.world.remaining, 2);
      assert.equal(r.actor.remaining, 2);
      assert.equal(r.owner.nextWindowRealAt, '2026-10-19T11:00:00.000Z');
      assert.equal(r.world.nextWindowRealAt, '2026-10-19T10:05:00.000Z');
      assert.deepEqual(await counters(f.owner), rows);
    },
  );
  await t.test(
    'concurrent distinct worlds share owner cap; a losing reservation creates no world/actor counters',
    async () => {
      const a = await fixture(),
        b = await fixture(a.owner),
        aa = await claim(a),
        ba = await claim(b),
        p = policy(1, 5, 5);
      const results = await Promise.all(
        [
          [a, aa],
          [b, ba],
        ].map(async ([f, v]) => {
          const scope = f as F,
            attempt = v as AgentAttempt;
          return db.transaction(scope.owner, async (sql) => {
            const r = await reserveOwnAgendaBudgetInTransaction(
              sql,
              scope.owner,
              scope.worldId,
              'a',
              p,
              at,
              attempt.id,
            );
            if (r.status === 'reserved') await markSent(sql, attempt);
            else
              await sql.query(
                "UPDATE parallel_life.agent_attempts SET status='cancelled_before_send' WHERE id=$1",
                [attempt.id],
              );
            return r;
          });
        }),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), ['budget_wait', 'reserved']);
      const rows = await counters(a.owner);
      assert.equal(rows.length, 3);
      assert.ok(rows.every((r) => r.count === 1));
    },
  );
  await t.test('actor and world buckets are isolated while owner remains shared', async () => {
    const f = await fixture(),
      secondWorld = await fixture(f.owner),
      a = await claim(f, 'a');
    await sent(f, a, policy(10, 5, 1));
    const b = await claim(f, 'b');
    await sent(f, b, policy(10, 5, 1));
    const other = await claim(secondWorld, 'a');
    await sent(secondWorld, other, policy(10, 5, 1));
    const same = await read(f, policy(10, 5, 1), at, 'b'),
      foreign = await read(secondWorld, policy(10, 5, 1));
    assert.equal(same.owner.remaining, 7);
    assert.equal(same.world.remaining, 3);
    assert.equal(same.actor.remaining, 0);
    assert.equal(foreign.owner.remaining, 7);
    assert.equal(foreign.world.remaining, 4);
    assert.equal(foreign.actor.remaining, 0);
    assert.equal((await counters(f.owner)).length, 6);
  });
  await t.test('late old transaction cannot rewind any newer window or reset its cap', async () => {
    const f = await fixture(),
      p = policy(2, 2, 2);
    let release!: () => void, begun!: () => void;
    const ready = new Promise<void>((r) => {
        begun = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    let oldAttempt!: AgentAttempt;
    const old = db.transaction(f.owner, async (sql) => {
      await sql.query('SELECT now()');
      begun();
      await gate;
      const r = await reserveOwnAgendaBudgetInTransaction(
        sql,
        f.owner,
        f.worldId,
        'a',
        p,
        at,
        oldAttempt.id,
      );
      assert.equal(r.status, 'reserved');
      await markSent(sql, oldAttempt);
      return r;
    });
    await ready;
    try {
      const newer = await claim(f);
      await sent(f, newer, p, '2026-10-19T10:01:01.000Z');
      await settleSynthetic(f, newer);
      oldAttempt = await claim(f);
    } finally {
      release();
    }
    await old;
    const rows = await counters(f.owner);
    assert.ok(rows.every((r) => r.count === 2 && r.window_start === '2026-10-19T10:01:00.000Z'));
    await settleSynthetic(f, oldAttempt);
    const third = await claim(f);
    const result = await db.transaction(f.owner, (sql) =>
      reserveOwnAgendaBudgetInTransaction(sql, f.owner, f.worldId, 'a', p, at, third.id),
    );
    assert.equal(result.status, 'budget_wait');
    assert.deepEqual(await counters(f.owner), rows);
    if (result.status === 'budget_wait')
      assert.equal(result.nextCheckRealAt, '2026-10-19T10:02:00.000Z');
  });
  await t.test(
    'actual SQL failure rolls back partial writes, preserves original error, and leaves caller transaction usable',
    async () => {
      const f = await fixture(),
        a = await claim(f);
      let original: unknown;
      await db.transaction(f.owner, async (sql) => {
        const wrapped = proxy(sql, (text, args) => {
          if (
            text.startsWith('INSERT INTO parallel_life.rate_limits') &&
            String((args[1] as unknown[])[1]).includes(':world:')
          )
            return sql.query('SELECT 1/0').catch((e) => {
              original = e;
              throw e;
            });
          return undefined;
        });
        await assert.rejects(
          reserveOwnAgendaBudgetInTransaction(wrapped, f.owner, f.worldId, 'a', policy(), at, a.id),
          (e) => e === original && (e as any).code === '22012',
        );
        assert.equal((await sql.query('SELECT 42 answer')).rows[0].answer, 42);
      });
      assert.deepEqual(await counters(f.owner), []);
    },
  );
  await t.test(
    'rollback failure is never reported as budget_wait or silently replaces primary error',
    async () => {
      const f = await fixture(),
        a = await claim(f),
        primary = Error('injected primary'),
        cleanup = Error('injected cleanup');
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          reserveOwnAgendaBudgetInTransaction(
            proxy(sql, (text, args) => {
              if (
                text.startsWith('INSERT INTO parallel_life.rate_limits') &&
                String((args[1] as unknown[])[1]).includes(':world:')
              )
                return Promise.reject(primary);
              if (text.startsWith('ROLLBACK TO SAVEPOINT')) return Promise.reject(cleanup);
              return undefined;
            }),
            f.owner,
            f.worldId,
            'a',
            policy(),
            at,
            a.id,
          ),
        ),
        (e: unknown) =>
          e instanceof AggregateError &&
          e.cause === primary &&
          e.errors[0] === primary &&
          e.errors[1] === cleanup,
      );
      assert.deepEqual(await counters(f.owner), []);
    },
  );
});
