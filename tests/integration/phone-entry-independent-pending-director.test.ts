import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { readAgentPhoneEntryProbe } from '../../src/modules/world/infrastructure/agent-phone-entry-probe.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';
const quiet = () => ({
  protocol: 'npc-wire-v3',
  consideration: null,
  mediaDecision: { kind: 'not_requested' },
  executions: [],
  statements: [],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});
test('original phone entry can cheaply schedule independent work without retrying a pending Director', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.PHONE_PENDING_DIRECTOR_TEST_PORT ?? 55631));
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
    clocks = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db),
    store = new PostgresAgentRuntimeRepository(db),
    directors = new PostgresDirectorRuntimeRepository(db),
    snapshots = new PostgresDirectorSnapshotRepository(db);
  async function fixture(kind: 'agenda' | 'plan' | 'none' = 'agenda') {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic independent phone entry',
      time: '2026-10-19T06:00:00.000Z',
      actors: [{ id: 'a', name: 'A', persona: 'May quietly plan own life' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    const state = emptyActorAgentState(
        { worldId, actorId: 'a' },
        agentDefinitionRef(world, 'a'),
        0,
      ),
      sourceId = 'definition:' + state.definitionRef;
    if (kind !== 'agenda')
      state.goals.push({
        id: 'g',
        summary: 'Existing personal objective',
        status: kind === 'none' ? 'withdrawn' : 'active',
        sourceIds: [sourceId],
        resultIds: [],
      });
    if (kind === 'plan') {
      state.plans.push({
        id: 'p',
        goalId: 'g',
        summary: 'Consider an appointment',
        status: 'active',
        sourceIds: [sourceId],
        actionIds: ['action'],
        nextActionId: 'action',
        triggers: [],
        missingConditions: [],
      });
      state.actions.push({
        id: 'action',
        goalId: 'g',
        capability: 'appointment.propose',
        targetIds: [],
        parameters: { title: 'Meet', at: '2026-10-19T12:00:00.000Z' },
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        sourceIds: [sourceId],
        status: 'ready',
      });
    }
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, owner, state);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await clocks.setClock(owner, worldId, { paused: false, speed: 0 });
    const clientId = randomUUID();
    await activity.update(owner, worldId, {
      clientId,
      sequence: 1,
      mode: 'browsing',
      resume: true,
    });
    return { owner, worldId, world, clientId };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  const probe = (f: F) =>
    db.transaction(f.owner, async (sql) => {
      const w = await worlds.get({ userId: f.owner }, f.worldId);
      return readAgentPhoneEntryProbe(sql, f.owner, {
        worldId: f.worldId,
        engineEpoch: 2,
        worldVersion: w.version,
        storyAt: w.time,
      });
    });
  const metadata = (f: F) =>
    admin
      .query(
        'SELECT id,status,sent_at,response_hash,decision_id FROM parallel_life.director_runtime_attempts WHERE world_id=$1 ORDER BY id',
        [f.worldId],
      )
      .then((r) => r.rows);
  let directorCalls = 0;
  async function pending(
    f: F,
    status:
      | 'unknown_after_send'
      | 'reserved'
      | 'request_sent'
      | 'response_received' = 'unknown_after_send',
  ) {
    const current = await worlds.get({ userId: f.owner }, f.worldId);
    const snapshot = await snapshots.read(f.owner, {
      worldId: f.worldId,
      engineEpoch: 2,
      worldVersion: current.version,
      candidates: [],
      blockers: [],
    });
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      engineEpoch: 2,
      expectedWorldVersion: current.version,
      inputHash: directorSnapshotInputHash(snapshot),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    };
    if (status === 'unknown_after_send') {
      await assert.rejects(
        runDirectorAgent(
          {
            attempts: directors,
            model: {
              async decide() {
                directorCalls++;
                throw Error('SYNTHETIC_DIRECTOR_UNKNOWN');
              },
            },
            parse: parseDirectorDecision,
          },
          f.owner,
          claim,
          snapshot,
        ),
        /SYNTHETIC_DIRECTOR_UNKNOWN/,
      );
      return (await directors.lookup(f.owner, f.worldId, claim.commandId))!;
    }
    let a = (await directors.claim(f.owner, claim, snapshot)).attempt;
    if (status !== 'reserved') a = await directors.mark(f.owner, a, 'request_sent');
    if (status === 'response_received')
      a = await directors.saveResponse(
        f.owner,
        a,
        JSON.stringify({
          mode: 'quiet',
          selectedCandidateIds: [],
          deferred: [],
          nudges: [],
          opportunities: [],
          audit: { reason: 'Synthetic protected quiet', basisSourceIds: ['genesis:' + f.worldId] },
        }),
      );
    return a;
  }
  function harness() {
    let npcCalls = 0,
      unexpectedDirector = 0;
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.promptVersion.startsWith('director-')) {
          unexpectedDirector++;
          throw Error('DIRECTOR_MUST_NOT_RETRY');
        }
        npcCalls++;
        return JSON.stringify(quiet());
      },
    };
    return {
      service: npcAgentAdvanceServices(db, () => model, snapshots),
      npc: () => npcCalls,
      director: () => unexpectedDirector,
    };
  }
  await t.test(
    'unknown Director remains untouched while another legal NPC planning opportunity commits quiet once',
    async () => {
      const f = await fixture(),
        original = await pending(f),
        before = await metadata(f),
        paid = directorCalls,
        h = harness();
      const ready = await probe(f);
      assert.equal(ready.status, 'ready');
      assert.deepEqual(await probe(f), ready);
      const outcome = await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(outcome?.played, 0);
      assert.equal(outcome?.changed, true);
      assert.equal(h.npc(), 1);
      assert.equal(h.director(), 0);
      assert.equal(directorCalls, paid);
      const done = await probe(f);
      assert.equal(done.status, 'pending');
      assert.deepEqual(await probe(f), done);
      assert.deepEqual(await metadata(f), before);
      assert.equal(
        (await directors.lookup(f.owner, f.worldId, original.commandId))!.status,
        'unknown_after_send',
      );
      await h.service.advanceIfEnabled(f.owner, f.worldId).catch(() => {});
      assert.equal(h.npc(), 1);
      assert.equal(h.director(), 0);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'existing plan is only a stable cheap scheduler cue, and a committed wake is not repurchased',
    async () => {
      const f = await fixture('plan');
      await pending(f);
      const h = harness(),
        first = await probe(f);
      assert.equal(first.status, 'ready');
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(h.npc(), 1);
      assert.equal(h.director(), 0);
      assert.deepEqual(
        await probe(f),
        first,
        'unrelated revision/world version is not a new probe identity',
      );
      await h.service.advanceIfEnabled(f.owner, f.worldId).catch(() => {});
      assert.equal(h.npc(), 1);
      assert.equal(h.director(), 0);
    },
  );
  await t.test(
    'no independent intent gives pending; cheap checks never purchase a replacement Director',
    async () => {
      const f = await fixture('none');
      await pending(f);
      const h = harness(),
        before = await metadata(f);
      assert.equal((await probe(f)).status, 'pending');
      await h.service.advanceIfEnabled(f.owner, f.worldId).catch(() => {});
      assert.equal(h.npc(), 0);
      assert.equal(h.director(), 0);
      assert.deepEqual(await metadata(f), before);
    },
  );
  await t.test(
    'recoverable original Director raw has priority over agenda; reserved/sent allow only cheap checks',
    async () => {
      const raw = await fixture(),
        a = await pending(raw, 'response_received');
      const before = await metadata(raw),
        result = await probe(raw);
      assert.equal(result.status, 'ready');
      assert.equal(
        result.key,
        createHash('sha256')
          .update(JSON.stringify(['phone-continuation-v1', raw.worldId, 2, 'director_raw', a.id]))
          .digest('hex'),
      );
      assert.deepEqual(await metadata(raw), before);
      for (const status of ['reserved', 'request_sent'] as const) {
        const f = await fixture();
        await pending(f, status);
        const initial = await metadata(f);
        assert.equal((await probe(f)).status, 'ready');
        assert.deepEqual(await metadata(f), initial);
      }
    },
  );
  await t.test(
    'manual pause and business conversation focus retain original no-interruption guards',
    async () => {
      const f = await fixture();
      await new PostgresGroupRepository(db).create(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: 'Visible synthetic contact',
        actorIds: ['a'],
      });
      await pending(f);
      const before = await metadata(f);
      await activity.update(f.owner, f.worldId, {
        clientId: f.clientId,
        sequence: 2,
        mode: 'conversation',
        focus: { channel: 'private', threadId: 'a' },
      });
      assert.equal((await probe(f)).status, 'deferred');
      await activity.update(f.owner, f.worldId, {
        clientId: f.clientId,
        sequence: 3,
        mode: 'browsing',
        focus: null,
      });
      await clocks.setClock(f.owner, f.worldId, { paused: true });
      assert.equal((await probe(f)).status, 'deferred');
      assert.deepEqual(await metadata(f), before);
    },
  );
});
