import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActorAdvanceBlocked,
  AgentAdvanceDeferred,
  actorAdvanceFailureScope,
  advanceReadStale,
  agentAdvanceBatchPolicy,
  retryAdvanceReadOnce,
  runAgentAdvanceBatch,
} from '../src/modules/world/application/agent-advance-batch.ts';
const result = (v: number, actor?: string) => ({
  storyNow: '2026-10-19T00:00:00Z',
  played: actor ? 1 : 0,
  folded: 0,
  summary: null,
  actors: actor ? [actor] : [],
  changed: true,
  worldVersion: v,
});
test('one batch evaluates distinct actors and quiet is persisted work, not a presented message', async () => {
  let version = 0;
  const seen: string[] = [];
  const r = await runAgentAdvanceBatch(async (c) => {
    const actor = ['a', 'b', 'c'].find((a) => !c.handledActorIds.has(a))!;
    seen.push(actor);
    c.actorStarted(actor);
    c.modelStarted();
    return result(++version, actor === 'a' ? undefined : actor);
  }, agentAdvanceBatchPolicy());
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(r?.worldVersion, 3);
  assert.equal(r?.played, 2);
  assert.deepEqual(r?.actors, ['b', 'c']);
});
test('unknown paid result fences its actor, not another actor, and is never retried', async () => {
  const seen: string[] = [];
  const r = await runAgentAdvanceBatch(
    async (c) => {
      const actor = c.handledActorIds.has('a') ? 'b' : 'a';
      seen.push(actor);
      c.actorStarted(actor);
      c.modelStarted();
      if (actor === 'a') throw new ActorAdvanceBlocked(Error('uncertain'), 'unknown_after_send');
      return result(1, actor);
    },
    agentAdvanceBatchPolicy({ maxActors: 2 }),
  );
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(r?.actors, ['b']);
});
test('model budget and work count are separate, and no running request is aborted at the elapsed boundary', async () => {
  let now = 0,
    calls = 0;
  const r = await runAgentAdvanceBatch(
    async (c) => {
      c.actorStarted('a');
      c.modelStarted();
      calls++;
      now = 60_000;
      return result(1, 'a');
    },
    agentAdvanceBatchPolicy(),
    () => now,
  );
  assert.equal(calls, 1);
  assert.equal(r?.played, 1);
  calls = 0;
  await runAgentAdvanceBatch(
    async (c) => {
      c.actorStarted(String(calls));
      c.modelStarted();
      calls++;
      return result(calls);
    },
    agentAdvanceBatchPolicy({ maxModelCalls: 2 }),
  );
  assert.equal(calls, 2);
});
test('stable no-work stays free and a global authorization error is never swallowed', async () => {
  let n = 0;
  await runAgentAdvanceBatch(async () => {
    n++;
    return { ...result(0), changed: false };
  }, agentAdvanceBatchPolicy());
  assert.equal(n, 1);
  await assert.rejects(
    runAgentAdvanceBatch(async (c) => {
      c.actorStarted('a');
      throw Object.assign(Error('denied'), { code: 'NOT_FOUND' });
    }, agentAdvanceBatchPolicy()),
    { code: 'NOT_FOUND' },
  );
  assert.throws(() => agentAdvanceBatchPolicy({ maxActors: 99 }), /INVALID_AGENT_BATCH_POLICY/);
});

test('a shared provider outage stops new model work without turning an actor unknown into a retry', async () => {
  let calls = 0;
  const original = Object.assign(Error('upstream'), {
    code: 'UPSTREAM_FAILED',
    stage: 'response',
    httpStatus: 500,
  });
  await assert.rejects(
    runAgentAdvanceBatch(async (c) => {
      c.actorStarted('a');
      c.modelStarted();
      calls++;
      throw new ActorAdvanceBlocked(
        original,
        'unknown_after_send',
        actorAdvanceFailureScope(original),
      );
    }, agentAdvanceBatchPolicy()),
    original,
  );
  assert.equal(calls, 1);
});

test('committed prefix survives a later authoritative Director pending fence; no fresh global attempt', async () => {
  let calls = 0;
  const r = await runAgentAdvanceBatch(async (c) => {
    if (calls++)
      throw new AgentAdvanceDeferred(Object.assign(Error('pending'), { code: 'UNKNOWN' }));
    c.actorStarted('a');
    c.modelStarted();
    return result(1, 'a');
  }, agentAdvanceBatchPolicy());
  assert.equal(r?.worldVersion, 1);
  assert.deepEqual(r?.actors, ['a']);
  assert.equal(calls, 2);
});

test('reserved call survives database preparation crossing elapsed boundary', async () => {
  let clock = 0;
  let calls = 0;
  await runAgentAdvanceBatch(
    async (c) => {
      const reservation = c.reserveModel();
      assert.ok(reservation);
      try {
        clock = 60_000;
        assert.equal(c.canStartModel(), false);
        c.modelStarted();
        calls++;
        return result(1, 'a');
      } finally {
        reservation.release();
      }
    },
    agentAdvanceBatchPolicy(),
    () => clock,
  );
  assert.equal(calls, 1);
});

test('unconsumed reservation releases quota, consumed quota cannot be released', async () => {
  await runAgentAdvanceBatch(
    async (c) => {
      const unused = c.reserveModel();
      assert.ok(unused);
      assert.equal(c.canStartModel(), false);
      unused.release();
      assert.equal(c.canStartModel(), true);
      const used = c.reserveModel();
      assert.ok(used);
      c.modelStarted();
      used.release();
      assert.equal(c.reserveModel(), null);
      assert.throws(() => c.modelStarted(), /AGENT_BATCH_BUDGET/);
      return result(1, 'a');
    },
    agentAdvanceBatchPolicy({ maxModelCalls: 1 }),
  );
});

test('simultaneous reservations cannot exceed model-call cap', async () => {
  await runAgentAdvanceBatch(
    async (c) => {
      const first = c.reserveModel();
      const second = c.reserveModel();
      assert.ok(first);
      assert.ok(second);
      assert.equal(c.reserveModel(), null);
      c.modelStarted();
      first.release();
      assert.equal(c.reserveModel(), null);
      second.release();
      assert.ok(c.reserveModel());
      return result(1, 'a');
    },
    agentAdvanceBatchPolicy({ maxModelCalls: 2, maxSteps: 1 }),
  );
});

test('one batch coordinates once while independent actors continue', async () => {
  let directors = 0,
    actors = 0;
  await runAgentAdvanceBatch(async (c) => {
    if (c.beginDirectorAssessment()) directors++;
    c.actorStarted(String(actors++));
    return result(actors);
  }, agentAdvanceBatchPolicy());
  assert.equal(directors, 1);
  assert.equal(actors, 3);
});

test('a protected paid frame yields the batch without losing its committed prefix', async () => {
  let steps = 0;
  const r = await runAgentAdvanceBatch(async (c) => {
    steps++;
    if (steps === 1) {
      c.actorStarted('a');
      return result(1, 'a');
    }
    c.modelStarted();
    c.yieldAfterStep();
    return { ...result(1), changed: false };
  }, agentAdvanceBatchPolicy());
  assert.equal(steps, 2);
  assert.equal(r?.worldVersion, 1);
  assert.equal(r?.played, 1);
  assert.deepEqual(r?.actors, ['a']);
});

test('a stale pre-read retries once, while a real version conflict is never retried', async () => {
  let calls = 0,
    retries = 0;
  const value = await retryAdvanceReadOnce(
    async () => {
      calls++;
      if (calls === 1) throw advanceReadStale();
      return 'ok';
    },
    () => retries++,
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
  assert.equal(retries, 1);

  calls = 0;
  await assert.rejects(
    retryAdvanceReadOnce(async () => {
      calls++;
      throw advanceReadStale();
    }),
    { code: 'ADVANCE_READ_STALE' },
  );
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    retryAdvanceReadOnce(async () => {
      calls++;
      throw Object.assign(Error('world moved at commit'), { code: 'VERSION_CONFLICT' });
    }),
    { code: 'VERSION_CONFLICT' },
  );
  assert.equal(calls, 1);
});

test('a proven actor preflight cancellation preserves other actors without buying or retrying that request', async () => {
  const seen: string[] = [];
  let paid = 0;
  const r = await runAgentAdvanceBatch(
    async (c) => {
      const actor = c.handledActorIds.has('a') ? 'b' : 'a';
      seen.push(actor);
      c.actorStarted(actor);
      if (actor === 'a')
        throw new ActorAdvanceBlocked(Error('NPC_AGENT_SNAPSHOT_LIMIT'), 'cancelled_before_send');
      c.modelStarted();
      paid++;
      return result(1, actor);
    },
    agentAdvanceBatchPolicy({ maxActors: 2 }),
  );
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(paid, 1);
  assert.deepEqual(r?.actors, ['b']);
});
