import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  emptyActorAgentState,
  type AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  applyInvitationEvent,
  type InvitationEvent,
} from '../../src/modules/world/domain/invitations.ts';
import {
  applyAgentExternalProjection,
  type ProjectedInvitationEvent,
} from '../../src/modules/world/domain/agent-external-projection.ts';
import {
  prepareExplicitInvitationProjections,
  projectExplicitInvitationDecision,
} from '../../src/modules/world/infrastructure/agent-external-event-projector.ts';
import { authorizeWorldCommandInTransaction } from '../../src/modules/world/infrastructure/world-command-uow.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
  beginAgentCommitInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import type { WorldState, Appointment } from '../../src/modules/world/domain/types.ts';
const at = '2026-10-15T08:00:00.000Z';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('external calendar decisions: actual event deltas and actor CAS commit in one player transaction', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, 55503);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await worker.close();
    await admin.end();
  });
  async function fixture(epoch = 2) {
    const owner = randomUUID(),
      foreign = randomUUID(),
      worldId = randomUUID(),
      appointmentId = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    await new IdentityRepository(app).ensureGuest(foreign);
    const appointment: Appointment = {
      id: appointmentId,
      title: '一起吃饭',
      at: '2026-10-15T10:00:00.000Z',
      participantIds: ['a', 'b'],
      sourceEventId: 'genesis',
      status: 'proposed',
    };
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'External test fixture',
      time: at,
      actors: ['a', 'b', 'c'].map((id) => ({ id, name: id, persona: id })),
      facts: [],
      messages: [],
      appointments: [appointment],
      mediaRequests: [],
    };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [worldId, owner, world.title, { ...world, appointments: [] }],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
      [worldId, owner, world, {}],
    );
    const states = ['a', 'b', 'c'].map((actorId) => {
      const s = emptyActorAgentState({ worldId, actorId }, 'def', 0);
      s.goals = [
        {
          id: `goal-${actorId}`,
          summary: '自己的安排',
          status: 'active' as const,
          sourceIds: ['authored'],
          resultIds: [],
        },
      ];
      s.responsibilities = [
        {
          id: `r-${actorId}`,
          revision: 0,
          subject: { kind: 'appointment' as const, id: appointmentId },
          summary: '等待回复',
          status: 'waiting' as const,
          waitingOn: 'player' as const,
          sourceIds: ['authored'],
          nextCheck: [],
          deadline: { at, sourceId: 'authored-reply-deadline' },
        },
      ];
      return s;
    });
    await app.transaction(owner, async (sql) => {
      for (const s of states) await initializeActorAgentStateInTransaction(sql, owner, s);
      if (epoch === 2)
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        });
    });
    return { owner, foreign, worldId, appointment, world, states };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function event(
    f: Fixture,
    operation: 'accept' | 'cancel' = 'accept',
    version = 1,
  ): ProjectedInvitationEvent {
    const commandId = randomUUID();
    return {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: f.worldId,
      commandId,
      version,
      occurredAt: at,
      storyTime: at,
      type: 'invitation.responded',
      data: {
        worldId: f.worldId,
        commandId,
        id: f.appointment.id,
        expectedVersion: version - 1,
        operation,
      },
    };
  }
  async function save(
    f: Fixture,
    e: ProjectedInvitationEvent,
    before = f.appointment,
    options: { tamper?: boolean; omit?: boolean; queued?: boolean; failAfter?: boolean } = {},
  ) {
    return app.transaction(f.owner, async (sql) => {
      await authorizeWorldCommandInTransaction(sql, f.owner, {
        worldId: f.worldId,
        expectedWorldVersion: e.version - 1,
        commandId: e.commandId,
        kind: 'invitation_respond',
      });
      const prepared = await prepareExplicitInvitationProjections(sql, f.owner, {
        event: e,
        beforeAppointment: before,
      });
      if (!options.omit) e.data.agentProjections = prepared.map((p) => p.projection);
      if (options.tamper) e.data.agentProjections![0]!.decisions[0]!.kind = 'declined';
      const { agentProjections, ...command } = e.data;
      const requestHash = hash(
        JSON.stringify([
          'invitation.responded',
          e.worldId,
          e.data.id,
          e.data.expectedVersion,
          e.data.operation,
          e.data.at ?? null,
        ]),
      );
      const next = applyInvitationEvent(
        { ...f.world, version: e.version - 1, time: e.storyTime, appointments: [before] },
        e,
      );
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [e.commandId, f.worldId, f.owner, e.version - 1, requestHash, command],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [e.id, f.worldId, f.owner, e.version, e.commandId, e, at],
      );
      await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        f.worldId,
        e.version,
        { ...next, appointments: [] },
      ]);
      if (!options.queued)
        await sql.query(
          "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
          [f.worldId, e.commandId, e.id, { ...next, appointments: [] }],
        );
      const actual = await projectExplicitInvitationDecision(sql, f.owner, {
        event: e,
        beforeAppointment: before,
      });
      if (options.failAfter) throw Error('ROLLBACK_AFTER_ACTOR_STATE');
      return { prepared, actual, next };
    });
  }
  async function read(f: Fixture, actor = 'a') {
    return (
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
          [f.worldId, actor],
        ),
      )
    ).rows[0]!.document;
  }
  await t.test(
    'actual successful accept updates only linked existing participants and has exact replayable metadata',
    async () => {
      const f = await fixture(),
        e = event(f);
      const result = await save(f, e);
      assert.deepEqual(
        result.actual.map((p) => p.actorId),
        ['a', 'b'],
      );
      for (const actor of ['a', 'b']) {
        const state = await read(f, actor);
        assert.equal(state.revision, 1);
        assert.equal(state.decisions[0].kind, 'accepted');
        assert.equal(state.decisions[0].quote, 'accept');
        assert.equal(state.responsibilities[0].waitingOn, 'self');
        assert.equal(state.responsibilities[0].deadline, undefined);
        assert.equal(state.goals[0].status, 'active');
        const projection = e.data.agentProjections!.find((p) => p.actorId === actor)!;
        assert.deepEqual(
          applyAgentExternalProjection(
            f.states.find((s) => s.actorId === actor)!,
            projection,
          ),
          state,
        );
        assert.equal(projection.source.at, at);
        assert.equal(projection.source.id, `calendar-response:${e.id}`);
      }
      assert.equal((await read(f, 'c')).revision, 0);
      assert.deepEqual((await read(f, 'c')).decisions, []);
      const stored = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [e.id])
      ).rows[0]!.payload;
      assert.deepEqual(stored.data.agentProjections, e.data.agentProjections);
      assert.equal('stateAfter' in stored.data.agentProjections[0], false);
    },
  );
  await t.test(
    'cancel after accept appends current decline without rewriting the prior acceptance',
    async () => {
      const f = await fixture();
      const first = await save(f, event(f));
      const before = first.next.appointments[0]!;
      const second = event(f, 'cancel', 2);
      await save(f, second, before);
      const state = await read(f);
      assert.deepEqual(
        state.decisions.map((d: { kind: string }) => d.kind),
        ['accepted', 'declined'],
      );
      assert.equal(state.responsibilities[0].revision, 2);
      assert.equal(state.decisions[1].responsibilityRevision, 2);
      assert.equal(state.revision, 2);
      assert.equal(state.responsibilities[0].status, 'open');
      assert.equal(state.goals[0].status, 'active');
    },
  );
  await t.test(
    'exact successful event replay does not append or overwrite later legitimate state',
    async () => {
      const f = await fixture(),
        e = event(f);
      await save(f, e);
      const before = await read(f);
      await app.transaction(f.owner, (sql) =>
        projectExplicitInvitationDecision(sql, f.owner, {
          event: e,
          beforeAppointment: f.appointment,
        }),
      );
      assert.deepEqual(await read(f), before);
    },
  );
  await t.test('no matching responsibility means no state creation or new goal', async () => {
    const f = await fixture();
    await admin.query(
      "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{responsibilities}','[]') WHERE world_id=$1 AND actor_id='b'",
      [f.worldId],
    );
    const result = await save(f, event(f));
    assert.deepEqual(
      result.actual.map((p) => p.actorId),
      ['a'],
    );
    assert.equal((await read(f, 'b')).revision, 0);
    assert.deepEqual((await read(f, 'b')).decisions, []);
  });
  await t.test('epoch1 calendar keeps actor state exactly unchanged', async () => {
    const f = await fixture(1);
    const before = await read(f);
    const result = await save(f, event(f));
    assert.deepEqual(result.actual, []);
    assert.deepEqual(await read(f), before);
  });
  await t.test(
    'forged before appointment/participants are rejected using actual canonical prior history',
    async () => {
      for (const patch of [{ title: 'forged' }, { participantIds: ['c'] }]) {
        const f = await fixture();
        await assert.rejects(
          save(f, event(f), { ...f.appointment, ...patch }),
          /CALENDAR_APPOINTMENT_MISMATCH/,
        );
        assert.equal((await read(f)).revision, 0);
      }
    },
  );
  await t.test(
    'missing/tampered metadata and queued receipts roll back world/event/state atomically',
    async () => {
      for (const options of [
        { omit: true },
        { tamper: true },
        { queued: true },
        { failAfter: true },
      ]) {
        const f = await fixture(),
          e = event(f);
        await assert.rejects(save(f, e, f.appointment, options));
        assert.equal((await read(f)).revision, 0);
        assert.equal(
          (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
            .rows[0]!.version,
          0,
        );
        assert.equal(
          (await admin.query('SELECT 1 FROM parallel_life.world_events WHERE id=$1', [e.id]))
            .rowCount,
          0,
        );
      }
    },
  );
  await t.test('cross-owner, worker and fake event payload cannot project decisions', async () => {
    const f = await fixture(),
      e = event(f);
    await save(f, e);
    await assert.rejects(
      app.transaction(f.foreign, (sql) =>
        projectExplicitInvitationDecision(sql, f.foreign, {
          event: e,
          beforeAppointment: f.appointment,
        }),
      ),
      /NOT_FOUND/,
    );
    await assert.rejects(
      worker.transaction(f.owner, (sql) =>
        projectExplicitInvitationDecision(sql, f.owner, {
          event: e,
          beforeAppointment: f.appointment,
        }),
      ),
      /NOT_FOUND|permission denied/,
    );
    await assert.rejects(
      app.transaction(f.owner, (sql) =>
        projectExplicitInvitationDecision(sql, f.owner, {
          event: { ...e, storyTime: '2026-10-15T08:01:00.000Z' },
          beforeAppointment: f.appointment,
        }),
      ),
      /CALENDAR_EVENT_NOT_COMMITTED/,
    );
  });
  await t.test(
    'active NPC attempt cannot commit against the actor/world revision before explicit calendar decision',
    async () => {
      const f = await fixture();
      const store = new PostgresAgentRuntimeRepository(app);
      const commandId = randomUUID();
      const input: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId,
        inputHash: hash('original player text'),
        channel: 'private',
        threadId: 'a',
        recipientActorId: 'a',
        expectedWorldVersion: 0,
        receivedAt: at,
        storyAt: at,
        origin: 'player',
        text: '考虑邀请',
      };
      await store.accept(f.owner, input);
      const claim = await store.claim(f.owner, {
        id: randomUUID(),
        commandId,
        inputReceiptId: input.id,
        worldId: f.worldId,
        actorId: 'a',
        engineEpoch: 2,
        expectedWorldVersion: 0,
        expectedActorRevision: 0,
        inputHash: input.inputHash,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      });
      const sent = await store.mark(f.owner, claim.attempt, 'request_sent');
      const received = await store.saveResponse(f.owner, sent, { syntheticRawResponse: true });
      const ready = await app.transaction(f.owner, (sql) =>
        beginAgentCommitInTransaction(sql, f.owner, received),
      );
      assert.equal(ready.revision, 0);
      await save(f, event(f));
      await assert.rejects(
        app.transaction(f.owner, (sql) => beginAgentCommitInTransaction(sql, f.owner, received)),
        (error: unknown) =>
          !!error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'VERSION_CONFLICT',
      );
      assert.equal((await read(f)).revision, 1);
    },
  );
});
