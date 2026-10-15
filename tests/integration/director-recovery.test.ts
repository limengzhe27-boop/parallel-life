import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  recoverDirectorAgent,
  runDirectorAgent,
} from '../../src/modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

// Actual SQL/snapshot/application/parser/transactions; every model response is explicitly synthetic.
test('director protected response recovery: actual world slot and native world changes', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_RECOVERY_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    store = new PostgresDirectorRuntimeRepository(db),
    reader = new PostgresDirectorSnapshotRepository(db);
  const owned: { id: string; owner: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await db.close();
      await admin.end();
    }
  });
  const at = '2026-10-15T08:00:00.000Z';
  async function fixture(timed = false) {
    const owner = randomUUID(),
      id = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    owned.push({ id, owner });
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Explicit protected director recovery SQL fixture',
      time: at,
      actors: [
        { id: a, name: 'A', persona: '虚构人物A' },
        { id: b, name: 'B', persona: '虚构人物B' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    const states = world.actors.map((actor) =>
      emptyActorAgentState(
        { worldId: id, actorId: actor.id },
        agentDefinitionRef(world, actor.id),
        0,
      ),
    );
    if (timed)
      states[0]!.responsibilities.push({
        id: 'timed',
        revision: 0,
        subject: { kind: 'request', id: 'fixture-request' },
        summary: '明确的测试时限',
        status: 'open',
        waitingOn: 'self',
        sourceIds: ['clock-fixture'],
        deadline: { at: '2026-10-15T08:01:00.000Z', sourceId: 'clock-fixture' },
        nextCheck: [],
      });
    await db.transaction(owner, async (sql) => {
      for (const s of states) await initializeActorAgentStateInTransaction(sql, owner, s);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, a, b };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function snapshot(f: Fixture): Promise<DirectorSnapshot> {
    const world = await worlds.get({ userId: f.owner }, f.id);
    return reader.read(f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: world.version,
      candidates: [],
      blockers: [],
    });
  }
  function claim(s: DirectorSnapshot, duration = 60000) {
    return {
      id: randomUUID(),
      worldId: s.worldId,
      commandId: randomUUID(),
      engineEpoch: s.engineEpoch,
      expectedWorldVersion: s.worldVersion,
      inputHash: directorSnapshotInputHash(s),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + duration).toISOString(),
    };
  }
  const raw = {
    mode: 'quiet',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [],
    audit: { reason: 'Explicit mock quiet decision', basisSourceIds: [] },
  };
  async function received(f: Fixture, s: DirectorSnapshot, duration = 60000) {
    let attempt = (await store.claim(f.owner, claim(s, duration), s)).attempt;
    attempt = await store.mark(f.owner, attempt, 'request_sent');
    return store.saveResponse(f.owner, attempt, JSON.stringify(raw));
  }
  const recover = (f: Fixture, s: DirectorSnapshot) =>
    recoverDirectorAgent({ attempts: store, parse: parseDirectorDecision }, f.owner, s);
  async function row(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 ORDER BY created_at,id',
        [f.id],
      )
    ).rows[0];
  }
  async function bCommits(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.id);
    await npcAgentServices(db, () => ({
      async complete() {
        return JSON.stringify({
          statements: [{ text: '明确的合成B回复', dependsOnActionIds: [] }],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        });
      },
    })).sendMessageIfEnabled(f.owner, {
      id: randomUUID(),
      worldId: f.id,
      actorId: f.b,
      expectedVersion: world.version,
      text: '明确的合成玩家输入',
    });
  }
  async function failedCommit(f: Fixture, s: DirectorSnapshot) {
    const c = claim(s),
      guard = 'director_recovery_' + randomUUID().replaceAll('-', '');
    let calls = 0;
    await admin.query(
      `CREATE FUNCTION parallel_life.${guard}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.id}' THEN RAISE EXCEPTION 'EXPLICIT_DIRECTOR_SQL_FAILURE'; END IF; RETURN NEW; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER ${guard} BEFORE INSERT ON parallel_life.director_decisions FOR EACH ROW EXECUTE FUNCTION parallel_life.${guard}()`,
    );
    try {
      await assert.rejects(
        runDirectorAgent(
          {
            attempts: store,
            model: {
              async decide() {
                calls++;
                return JSON.stringify(raw);
              },
            },
            parse: parseDirectorDecision,
          },
          f.owner,
          c,
          s,
        ),
        /EXPLICIT_DIRECTOR_SQL_FAILURE/,
      );
    } finally {
      await admin.query(`DROP TRIGGER ${guard} ON parallel_life.director_decisions`);
      await admin.query(`DROP FUNCTION parallel_life.${guard}()`);
    }
    const attempt = (await store.lookup(f.owner, f.id, c.commandId))!;
    assert.equal(attempt.status, 'response_received');
    return { command: c, attempt, calls };
  }
  await t.test('world without pending slot is a zero-write no-op', async () => {
    const f = await fixture(),
      s = await snapshot(f);
    assert.deepEqual(await recover(f, s), { status: 'none' });
    assert.equal(await row(f), undefined);
  });
  await t.test(
    'actual decision SQL failure preserves raw; same frame recovers original command with no second model call',
    async () => {
      const f = await fixture(),
        s = await snapshot(f);
      const { command: c, calls } = await failedCommit(f, s);
      const before = await row(f);
      assert.equal(before.status, 'response_received');
      const recovered = await recover(f, await snapshot(f));
      assert.equal(recovered.status, 'recovered');
      if (recovered.status !== 'recovered') throw Error('Expected protected recovery');
      assert.equal(calls, 1);
      assert.equal(recovered.attempt.commandId, c.commandId);
      assert.equal(recovered.attempt.id, c.id);
      const after = await row(f);
      assert.equal(after.status, 'committed');
      assert.equal(after.response_hash, before.response_hash);
      assert.deepEqual(after.response, before.response);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
      const replay = await runDirectorAgent(
        {
          attempts: store,
          model: {
            async decide() {
              throw Error('MUST_NOT_REPAY');
            },
          },
          parse: parseDirectorDecision,
        },
        f.owner,
        c,
        s,
      );
      assert.equal(replay.id, recovered.decision.id);
    },
  );
  await t.test(
    'received raw followed by real NPC B commit is known stale; next coordination can claim another frame',
    async () => {
      const f = await fixture(),
        s = await snapshot(f),
        failure = await failedCommit(f, s),
        attempt = failure.attempt,
        before = await row(f);
      assert.equal(failure.calls, 1);
      await bCommits(f);
      const current = await snapshot(f);
      assert.equal(current.worldVersion, 1);
      const result = await recover(f, current);
      assert.equal(result.status, 'stale');
      if (result.status !== 'stale') throw Error('Expected stale');
      assert.equal(result.reason, 'frame_changed');
      const old = await store.lookup(f.owner, f.id, attempt.commandId);
      assert.equal(old!.status, 'stale_discarded');
      const after = await row(f);
      assert.equal(after.response_hash, before.response_hash);
      assert.deepEqual(after.response, before.response);
      let newCalls = 0;
      const decision = await runDirectorAgent(
        {
          attempts: store,
          model: {
            async decide() {
              newCalls++;
              return raw;
            },
          },
          parse: parseDirectorDecision,
        },
        f.owner,
        claim(current),
        current,
      );
      assert.equal(decision.worldVersion, 1);
      assert.equal(newCalls, 1);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await t.test(
    'B changes world between preparation and commit; original raw becomes stale without a paid fallback',
    async () => {
      const f = await fixture(),
        s = await snapshot(f);
      await received(f, s);
      const racing = Object.create(store) as typeof store;
      racing.commit = async (...args: Parameters<typeof store.commit>) => {
        await bCommits(f);
        return store.commit(...args);
      };
      const result = await recoverDirectorAgent(
        { attempts: racing, parse: parseDirectorDecision },
        f.owner,
        s,
      );
      assert.equal(result.status, 'stale');
      assert.equal((await row(f)).status, 'stale_discarded');
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.director_decisions WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  for (const state of ['reserved', 'request_sent', 'unknown_after_send'] as const)
    await t.test(
      `${state} remains blocked after B changes world, never discarded or resent`,
      async () => {
        const f = await fixture(),
          s = await snapshot(f);
        let a = (await store.claim(f.owner, claim(s), s)).attempt;
        if (state !== 'reserved') a = await store.mark(f.owner, a, 'request_sent');
        if (state === 'unknown_after_send') a = await store.mark(f.owner, a, 'unknown_after_send');
        await bCommits(f);
        const result = await recover(f, await snapshot(f));
        assert.equal(result.status, 'blocked');
        assert.equal((await row(f)).status, state);
        assert.equal((await row(f)).response_hash, null);
        await assert.rejects(store.claim(f.owner, claim(await snapshot(f)), await snapshot(f)), {
          code: 'DIRECTOR_ATTEMPT_PENDING',
        });
      },
    );
  for (const field of ['candidates', 'blockers', 'focus', 'observations', 'worldSetting'] as const)
    await t.test(
      `changed ${field} invalidates received raw without changing worldVersion`,
      async () => {
        const f = await fixture(),
          s = await snapshot(f);
        await received(f, s);
        const current = structuredClone(s);
        if (field === 'candidates')
          current.candidates.push({
            id: 'new-current-candidate',
            worldId: f.id,
            actorId: f.a,
            source: 'conversation',
            episodeId: null,
            actionId: null,
            resourceIds: [],
            channel: 'private',
            threadId: f.a,
            sourceIds: ['current-source'],
            expectedWorldVersion: 0,
            expectedActorRevision: 0,
            priority: 1,
            reason: 'A new admitted candidate',
            requiresCoordination: false,
          });
        else if (field === 'blockers')
          current.blockers.push({
            scope: { kind: 'actor', actorId: f.a },
            reason: 'waiting_condition',
            sourceId: 'current-blocker',
            reconsiderOn: [],
          });
        else if (field === 'focus')
          current.focus.push({ channel: 'private', threadId: f.a, actorIds: [f.a] });
        else if (field === 'observations')
          current.observations.push({
            sourceId: 'current-observation',
            text: 'A new trusted fictional observation',
            kind: 'fact',
            knownByActorIds: [f.a],
          });
        else current.worldSetting = 'Updated server-authorized fictional setting';
        assert.equal((await recover(f, current)).status, 'stale');
        assert.equal((await row(f)).status, 'stale_discarded');
      },
    );
  await t.test(
    'JSONB key ordering and a later instant inside the same time frame do not invalidate raw',
    async () => {
      const f = await fixture(),
        s = await snapshot(f);
      await received(f, s);
      function reordered(v: any): any {
        return Array.isArray(v)
          ? v.map(reordered)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v)
                  .reverse()
                  .map(([k, x]) => [k, reordered(x)]),
              )
            : v;
      }
      await admin.query(
        "UPDATE parallel_life.world_clock SET story_now=story_now+interval '1 second' WHERE world_id=$1",
        [f.id],
      );
      const current = reordered(await snapshot(f));
      assert.notEqual(current.storyAt, s.storyAt);
      assert.equal((await recover(f, current)).status, 'recovered');
    },
  );
  await t.test(
    'a real clock crossing an existing responsibility deadline invalidates raw even with unchanged candidates',
    async () => {
      const f = await fixture(true),
        s = await snapshot(f);
      await received(f, s);
      await admin.query(
        "UPDATE parallel_life.world_clock SET story_now='2026-10-15T08:02:00Z' WHERE world_id=$1",
        [f.id],
      );
      const current = await snapshot(f);
      assert.deepEqual(current.candidates, s.candidates);
      assert.equal((await recover(f, current)).status, 'stale');
    },
  );
  await t.test(
    'an expired known response becomes traceable stale; old command never buys another model',
    async () => {
      const f = await fixture(),
        s = await snapshot(f),
        a = await received(f, s, 300);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, Date.parse(a.leaseUntil) - Date.now() + 25)),
      );
      const result = await recover(f, s);
      assert.equal(result.status, 'stale');
      if (result.status !== 'stale') throw Error('Expected stale');
      assert.equal(result.reason, 'lease_expired');
      assert.ok((await row(f)).response_hash);
      await assert.rejects(
        runDirectorAgent(
          {
            attempts: store,
            model: {
              async decide() {
                throw Error('MUST_NOT_REPAY_EXPIRED');
              },
            },
            parse: parseDirectorDecision,
          },
          f.owner,
          a,
          s,
        ),
        { code: 'INVALID_STATE' },
      );
    },
  );
  await t.test(
    'outdated caller snapshot cannot discard raw that belongs to the current world',
    async () => {
      const f = await fixture(),
        old = await snapshot(f);
      await bCommits(f);
      const current = await snapshot(f);
      await received(f, current);
      await assert.rejects(recover(f, old), { code: 'VERSION_CONFLICT' });
      assert.equal((await row(f)).status, 'response_received');
      const other = await fixture();
      await assert.rejects(
        recoverDirectorAgent(
          { attempts: store, parse: parseDirectorDecision },
          other.owner,
          current,
        ),
        { code: 'NOT_FOUND' },
      );
      assert.equal((await row(f)).status, 'response_received');
    },
  );
  await t.test(
    'malformed known raw is classified invalid, remains stored and is never replaced with another request',
    async () => {
      const f = await fixture(),
        s = await snapshot(f);
      let a = (await store.claim(f.owner, claim(s), s)).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      await store.saveResponse(f.owner, a, { invalid: 'mock output' });
      await assert.rejects(recover(f, s), { code: 'INVALID_DIRECTOR_PROPOSAL' });
      assert.equal((await row(f)).status, 'invalid_output');
      assert.ok((await row(f)).response_hash);
    },
  );
});
