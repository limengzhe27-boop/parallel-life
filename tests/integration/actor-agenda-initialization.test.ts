import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { migrateLegacyWorldInTransaction } from '../../src/modules/world/infrastructure/legacy-world-migration.ts';
import { readAgentPhoneEntryProbe } from '../../src/modules/world/infrastructure/agent-phone-entry-probe.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import {
  readAgendaInitializeGrantsInTransaction,
  agendaInitializeCommandId,
  agendaInitializeInputText,
} from '../../src/modules/world/infrastructure/actor-agenda-initialization-repository.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
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
test('agenda_initialize actual original advance/attempt/kernel flow, real PG synthetic models only', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENDA_INITIALIZATION_TEST_PORT ?? 55629));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    attempts = new PostgresAgentRuntimeRepository(db);
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  async function fixture(count = 2, admitted = true, legacy = false) {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic autonomous agenda',
      time: '2026-10-19T00:00:00.000Z',
      actors: ['a', 'b'].slice(0, count).map((id) => ({
        id,
        name: id,
        persona:
          id === 'a'
            ? 'Prefers quiet independent work'
            : 'Likes planning but respects personal boundaries',
      })),
      facts:
        count === 1
          ? []
          : [
              {
                id: 'private-b',
                text: 'B_PRIVATE_NOT_FOR_A',
                kind: 'canonical',
                visibility: { kind: 'actors', actorIds: ['b'] },
                sourceEventId: 'genesis:' + worldId,
              },
            ],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      if (legacy) {
        await migrateLegacyWorldInTransaction(sql, owner, { worldId });
        return;
      }
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
      if (admitted)
        await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await clocks.setClock(owner, worldId, { paused: false, speed: 0 });
    return { owner, worldId, world };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  const grants = (f: F) =>
    db.transaction(f.owner, async (sql) => {
      const w = await worlds.get({ userId: f.owner }, f.worldId);
      return readAgendaInitializeGrantsInTransaction(sql, f.owner, {
        worldId: f.worldId,
        engineEpoch: 2,
        worldVersion: w.version,
      });
    });
  function harness(f: F, hook?: (payload: any) => Promise<unknown>) {
    const calls: any[] = [];
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        calls.push(p);
        if (p.promptVersion.startsWith('director-'))
          return JSON.stringify({
            mode: 'quiet',
            selectedCandidateIds: [],
            deferred: p.candidates.map((c: any) => ({
              candidateId: c.id,
              reason: 'Independent personal planning may proceed without presentation.',
            })),
            nudges: [],
            opportunities: [],
            audit: {
              reason: 'No global intervention required.',
              basisSourceIds: ['genesis:' + f.worldId],
            },
          });
        const intent = JSON.parse(p.input.text);
        assert.equal(intent.type, 'npc_agenda_initialize');
        assert.equal(p.input.origin, 'wake');
        if (p.state.actorId === 'a') assert.doesNotMatch(JSON.stringify(p), /B_PRIVATE_NOT_FOR_A/);
        assert.equal(db.pool.totalCount, db.pool.idleCount);
        const custom = await hook?.(p);
        return JSON.stringify(custom ?? quiet());
      },
    };
    return {
      service: npcAgentAdvanceServices(
        db,
        () => model,
        new PostgresDirectorSnapshotRepository(db),
        { maxActors: 1 },
      ),
      calls,
      npc: () => calls.filter((p) => p.promptVersion.startsWith('npc-agent-')),
    };
  }
  await t.test(
    'two empty actors each receive one bounded opportunity; quiet consumes without fake messages',
    async () => {
      const f = await fixture(),
        h = harness(f);
      const initial = await grants(f);
      assert.equal(initial.length, 2);
      const first = await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(first?.played, 0);
      assert.equal(h.npc().length, 1);
      const second = await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(second?.played, 0);
      assert.equal(h.npc().length, 2);
      assert.equal(new Set(h.npc().map((p) => p.state.actorId)).size, 2);
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(h.npc().length, 2);
      assert.equal((await grants(f)).length, 0);
      const stored = (
        await admin.query('SELECT status FROM parallel_life.agent_attempts WHERE world_id=$1', [
          f.worldId,
        ])
      ).rows;
      assert.deepEqual(
        stored.map((r) => r.status),
        ['committed', 'committed'],
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n,
        0,
      );
      for (const a of f.world.actors) {
        const s = await attempts.read(f.owner, { worldId: f.worldId, actorId: a.id });
        assert.equal(s!.goals.length, 0);
        assert.equal(s!.plans.length, 0);
      }
    },
  );
  await t.test('unknown is fenced without rebuy; other actor can still initialize', async () => {
    const f = await fixture();
    let thrown = false;
    const h = harness(f, async () => {
      if (!thrown) {
        thrown = true;
        throw Error('SYNTHETIC_UNKNOWN_TRANSPORT');
      }
    });
    await assert.rejects(h.service.advanceIfEnabled(f.owner, f.worldId), /SYNTHETIC_UNKNOWN/);
    const unknown = h.npc()[0].state.actorId;
    await h.service.advanceIfEnabled(f.owner, f.worldId);
    await h.service.advanceIfEnabled(f.owner, f.worldId);
    assert.equal(h.npc().filter((p) => p.state.actorId === unknown).length, 1);
    assert.equal(h.npc().length, 2);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM parallel_life.agent_attempts WHERE world_id=$1 AND status='unknown_after_send'",
          [f.worldId],
        )
      ).rows[0].n,
      1,
    );
  });
  await t.test('parallel requests cannot buy the same actor initialization twice', async () => {
    const f = await fixture(1);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    const h = harness(f, async () => {
      entered();
      await gate;
    });
    const first = h.service.advanceIfEnabled(f.owner, f.worldId);
    await started;
    const second = await Promise.allSettled([h.service.advanceIfEnabled(f.owner, f.worldId)]);
    release();
    await first;
    assert.equal(h.npc().length, 1);
    assert.ok(['fulfilled', 'rejected'].includes(second[0]!.status));
    await h.service.advanceIfEnabled(f.owner, f.worldId);
    assert.equal(h.npc().length, 1);
  });
  await t.test(
    'manual pause, missing admission and changed definition do not create an opportunity',
    async () => {
      const paused = await fixture(1),
        h = harness(paused);
      await clocks.setClock(paused.owner, paused.worldId, { paused: true });
      await h.service.advanceIfEnabled(paused.owner, paused.worldId);
      assert.equal(h.calls.length, 0);
      const unadmitted = await fixture(1, false);
      assert.deepEqual(await grants(unadmitted), []);
      const changed = await fixture(1);
      await admin.query('BEGIN');
      await admin.query(
        "SELECT set_config('app.agent_engine_epoch','2',true),set_config('app.agent_world_id',$1,true)",
        [changed.worldId],
      );
      await admin.query(
        "UPDATE parallel_life.worlds SET state=jsonb_set(state,'{actors,0,persona}',to_jsonb('changed definition'::text)) WHERE id=$1",
        [changed.worldId],
      );
      await admin.query('COMMIT');
      assert.deepEqual(await grants(changed), []);
    },
  );
  await t.test(
    'forged input/owner/definition cannot obtain planning permission; existing goal never overwritten',
    async () => {
      const f = await fixture(1),
        g = (await grants(f))[0]!;
      const text = agendaInitializeInputText(g),
        commandId = agendaInitializeCommandId(f.worldId, g.candidateId);
      const receipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId,
        inputHash: createHash('sha256').update(text).digest('hex'),
        channel: 'private' as const,
        threadId: 'a',
        recipientActorId: 'a',
        expectedWorldVersion: 0,
        receivedAt: new Date().toISOString(),
        storyAt: f.world.time,
        origin: 'wake' as const,
        text,
      };
      await assert.rejects(
        attempts.accept(f.owner, { ...receipt, text: text.replace(g.definitionRef, 'forged') }),
        /INVALID_COMMAND/,
      );
      const foreign = randomUUID();
      await new IdentityRepository(db).ensureGuest(foreign);
      await assert.rejects(attempts.accept(foreign, receipt), /NOT_FOUND/);
      await admin.query(
        "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{goals}', $2::jsonb) WHERE world_id=$1",
        [
          f.worldId,
          JSON.stringify([
            {
              id: 'existing',
              summary: 'Existing real goal',
              status: 'active',
              sourceIds: ['definition:' + g.definitionRef],
              resultIds: [],
            },
          ]),
        ],
      );
      assert.deepEqual(await grants(f), []);
      await assert.rejects(attempts.accept(f.owner, receipt), /INVALID_COMMAND/);
    },
  );
  await t.test(
    'legacy migration gets lazy permission without replaying genesis; original service persists an explicit waiting plan',
    async () => {
      const f = await fixture(1, true, true);
      assert.equal(
        (
          await admin.query(
            'SELECT kind FROM parallel_life.agent_narrative_admissions WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].kind,
        'legacy_migration',
      );
      const before = await worlds.get({ userId: f.owner }, f.worldId);
      const initial = (await grants(f))[0]!;
      const h = harness(f, async (p) => ({
        ...quiet(),
        goals: [
          {
            id: 'personal-goal',
            summary: 'Consider own schedule',
            status: 'active',
            resultIds: [],
            sourceIds: [p.input.sourceId],
          },
        ],
        plans: [
          {
            id: 'personal-plan',
            goalId: 'personal-goal',
            summary: 'Wait for relevant information rather than invent a deadline',
            sourceIds: [p.input.sourceId],
            nextStep: {
              kind: 'wait',
              conditions: [],
              missing: ['Need relevant real scheduling information.'],
            },
          },
        ],
      }));
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(h.npc().length, 1);
      const s = await attempts.read(f.owner, { worldId: f.worldId, actorId: 'a' });
      assert.equal(s!.goals[0]!.id, 'personal-goal');
      assert.equal(s!.plans[0]!.status, 'waiting');
      assert.equal(s!.plans[0]!.nextActionId, null);
      const after = await worlds.get({ userId: f.owner }, f.worldId);
      assert.deepEqual(after.messages, before.messages);
      assert.equal((await grants(f)).length, 0);
      assert.equal(after.time, before.time);
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(h.npc().length, 1);
      assert.ok(
        h.calls
          .filter((p) => p.promptVersion.startsWith('director-'))
          .every((p) => p.evaluationCause?.kind !== 'bootstrap'),
      );
      assert.equal(initial.definitionRef, s!.definitionRef);
    },
  );
  await t.test(
    'phone continuation uses the same unconsumed grants then becomes quiet after committed evaluations',
    async () => {
      const f = await fixture(2, true, true),
        h = harness(f);
      await new PostgresClockActivityRepository(db).update(f.owner, f.worldId, {
        clientId: randomUUID(),
        sequence: 1,
        mode: 'browsing',
        resume: true,
      });
      const probe = () =>
        db.transaction(f.owner, async (sql) => {
          const w = await worlds.get({ userId: f.owner }, f.worldId);
          return readAgentPhoneEntryProbe(sql, f.owner, {
            worldId: f.worldId,
            engineEpoch: 2,
            worldVersion: w.version,
            storyAt: w.time,
          });
        });
      const first = await probe();
      assert.equal(first.status, 'ready');
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      const remaining = await probe();
      assert.equal(remaining.status, 'ready');
      assert.notDeepEqual(first, remaining);
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      const done = await probe();
      assert.notDeepEqual(done, remaining);
      assert.equal((await grants(f)).length, 0);
    },
  );
  await t.test(
    'pre-send revalidation rejects a now-existing agenda without calling a model',
    async () => {
      const f = await fixture(1),
        g = (await grants(f))[0]!;
      const text = agendaInitializeInputText(g),
        commandId = agendaInitializeCommandId(f.worldId, g.candidateId);
      const accepted = await attempts.accept(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        commandId,
        inputHash: createHash('sha256').update(text).digest('hex'),
        channel: 'private',
        threadId: 'a',
        recipientActorId: 'a',
        expectedWorldVersion: 0,
        receivedAt: new Date().toISOString(),
        storyAt: f.world.time,
        origin: 'wake',
        text,
      });
      const state = (await attempts.read(f.owner, { worldId: f.worldId, actorId: 'a' }))!;
      const snapshot = (
        await readPrivateAgentSnapshot(
          db,
          f.owner,
          f.world,
          'a',
          accepted.receipt,
          f.world.time,
          state,
        )
      ).snapshot;
      await admin.query(
        "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{goals}', $2::jsonb) WHERE world_id=$1",
        [
          f.worldId,
          JSON.stringify([
            {
              id: 'intervening',
              summary: 'A newly established agenda',
              status: 'active',
              sourceIds: ['definition:' + g.definitionRef],
              resultIds: [],
            },
          ]),
        ],
      );
      let calls = 0;
      await assert.rejects(
        runNpcAgent(
          {
            attempts,
            model: {
              async decide() {
                calls++;
                return quiet();
              },
            },
            kernel: {
              parse() {
                throw Error('unreachable');
              },
              async commit() {
                throw Error('unreachable');
              },
            },
          },
          f.owner,
          {
            id: randomUUID(),
            worldId: f.worldId,
            actorId: 'a',
            commandId,
            inputReceiptId: accepted.receipt.id,
            engineEpoch: 2,
            expectedWorldVersion: 0,
            expectedActorRevision: 0,
            inputHash: accepted.receipt.inputHash,
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 240000).toISOString(),
          },
          snapshot,
        ),
        /VERSION_CONFLICT/,
      );
      assert.equal(calls, 0);
      assert.equal(
        (await attempts.lookup(f.owner, f.worldId, commandId))?.status,
        'stale_discarded',
      );
    },
  );
  await t.test(
    'known invalid paid output remains a failed slot, never a new planning purchase',
    async () => {
      const f = await fixture(1, true, true),
        h = harness(f, async () => ({ ...quiet(), plans: [{ invalid: 'not a plan' }] }));
      await assert.rejects(h.service.advanceIfEnabled(f.owner, f.worldId));
      assert.equal(h.npc().length, 1);
      assert.equal(
        (
          await admin.query('SELECT status FROM parallel_life.agent_attempts WHERE world_id=$1', [
            f.worldId,
          ])
        ).rows[0].status,
        'invalid_output',
      );
      await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(h.npc().length, 1);
      assert.deepEqual(await grants(f), []);
    },
  );
  for (const crossVersion of [false, true])
    await t.test(
      `proven zero-send initialization recovers at ${crossVersion ? 'new' : 'same'} CAS without reset`,
      async () => {
        const f = await fixture(1, true, true),
          g = (await grants(f))[0]!,
          text = agendaInitializeInputText(g),
          commandId = agendaInitializeCommandId(f.worldId, g.candidateId);
        const inputHash = createHash('sha256')
          .update(JSON.stringify([f.worldId, 'a', g.candidateId, text]))
          .digest('hex');
        const { receipt } = await attempts.accept(f.owner, {
          id: randomUUID(),
          worldId: f.worldId,
          commandId,
          inputHash,
          channel: 'private',
          threadId: 'a',
          recipientActorId: 'a',
          expectedWorldVersion: 0,
          receivedAt: new Date().toISOString(),
          storyAt: f.world.time,
          origin: 'wake',
          text,
        });
        const state = (await attempts.read(f.owner, { worldId: f.worldId, actorId: 'a' }))!;
        const snapshot = (
          await readPrivateAgentSnapshot(db, f.owner, f.world, 'a', receipt, f.world.time, state)
        ).snapshot;
        const controller = new AbortController();
        controller.abort(Error('SYNTHETIC_CANCEL_BEFORE_SEND'));
        await assert.rejects(
          runNpcAgent(
            {
              attempts,
              model: {
                async decide() {
                  throw Error('must not send');
                },
              },
              kernel: {
                parse() {
                  throw Error('unreachable');
                },
                async commit() {
                  throw Error('unreachable');
                },
              },
            },
            f.owner,
            {
              id: randomUUID(),
              worldId: f.worldId,
              actorId: 'a',
              commandId,
              inputReceiptId: receipt.id,
              engineEpoch: 2,
              expectedWorldVersion: 0,
              expectedActorRevision: 0,
              inputHash,
              token: randomUUID(),
              leaseUntil: new Date(Date.now() + 240000).toISOString(),
            },
            snapshot,
            controller.signal,
          ),
          /SYNTHETIC_CANCEL/,
        );
        const cancelled = (await attempts.lookup(f.owner, f.worldId, commandId))!;
        assert.equal(cancelled.status, 'cancelled_before_send');
        assert.equal((await grants(f)).length, 1);
        if (crossVersion)
          await worlds.saveNote(
            { userId: f.owner },
            {
              commandId: randomUUID(),
              worldId: f.worldId,
              title: 'Unrelated note',
              text: 'No NPC decision or invented action.',
              expectedVersion: 0,
            },
          );
        const continuation = (await grants(f))[0]!;
        assert.ok(continuation);
        assert.equal(continuation.candidateId === g.candidateId, !crossVersion);
        const h = harness(f);
        await h.service.advanceIfEnabled(f.owner, f.worldId);
        assert.equal(h.npc().length, 1);
        const committed = (await attempts.lookup(
          f.owner,
          f.worldId,
          agendaInitializeCommandId(f.worldId, continuation.candidateId),
        ))!;
        assert.equal(committed.id === cancelled.id, !crossVersion);
        if (crossVersion)
          assert.equal(
            (await attempts.lookup(f.owner, f.worldId, commandId))!.status,
            'cancelled_before_send',
          );
        assert.equal(committed.status, 'committed');
        assert.deepEqual(await grants(f), []);
      },
    );
});
