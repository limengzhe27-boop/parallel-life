import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  admitNewAgentNarrativeInTransaction as admit,
  readDirectorBootstrapCauseInTransaction as cause,
  createEpisodeRequestsInTransaction as createRequests,
  readPendingEpisodeRequestsInTransaction as pending,
  projectEpisodeRequestInTransaction as project,
} from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentInputReceipt,
  AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentEpisodeRequest,
  EpisodeParticipationDecision,
} from '../../src/modules/world/domain/agent-narrative.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';

// Synthetic fictional worlds, actual owner-RLS repositories/kernel and explicit mock models only.
// No handmade epoch-2 event histories, participant annotations or live model requests.
test('narrative admission, actor requests and actual participation receipts', async (t) => {
  const cfg = await localConfig();
  const expected = process.env.AGENT_NARRATIVE_TEST_PORT ?? '55566';
  assert.match(expected, /^\d+$/);
  assert.ok(Number(expected) >= 1024 && Number(expected) <= 65535);
  assert.equal(cfg.port, Number(expected));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    actors = new PostgresAgentRuntimeRepository(db);
  const director = new PostgresDirectorRuntimeRepository(db),
    snapshots = new PostgresDirectorSnapshotRepository(db);
  const clocks = new PostgresClockStore(db);
  const owned: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    for (const { owner, worldId } of owned) {
      const clock = await clocks.read(owner, worldId);
      await clocks.write(owner, worldId, { ...clock, paused: true });
    }
    await db.close();
    await worker.close();
    await admin.end();
  });
  const at = '2026-10-16T00:00:00.000Z';
  async function fixture(admitted = true) {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: 'Synthetic narrative store',
      version: 0,
      time: at,
      actors: [
        { id: randomUUID(), name: '甲', persona: '自主、谨慎。拒绝后另作安排。' },
        { id: randomUUID(), name: '乙', persona: '温和且直接，尊重他人决定。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    owned.push({ owner, worldId });
    await db.transaction(owner, async (sql) => {
      for (const actor of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId: actor.id },
            agentDefinitionRef(world, actor.id),
            0,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      if (admitted) await admit(sql, owner, { worldId, engineEpoch: 2 });
    });
    return { owner, worldId, world };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const scope = (f: Fixture) => ({ worldId: f.worldId, engineEpoch: 2 });
  async function getCause(f: Fixture) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return db.transaction(f.owner, (sql) =>
      cause(sql, f.owner, { ...scope(f), worldVersion: world.version }),
    );
  }
  async function opportunity(f: Fixture) {
    const snapshot = await snapshots.read(f.owner, {
      ...scope(f),
      worldVersion: 0,
      candidates: [],
      blockers: [],
    });
    const c = await getCause(f);
    if (c) snapshot.evaluationCause = c;
    const command = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      engineEpoch: 2,
      expectedWorldVersion: 0,
      inputHash: directorSnapshotInputHash(snapshot),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    let calls = 0;
    const model = new WorldDirectorAgentModel({
      async complete() {
        calls++;
        assert.equal(db.pool.totalCount, db.pool.idleCount);
        return JSON.stringify({
          mode: 'bounded_opportunity',
          selectedCandidateIds: [],
          deferred: [],
          nudges: [],
          opportunities: [
            {
              id: randomUUID(),
              title: '讨论各自安排',
              description: 'DIRECTOR_ONLY_PRIVATE_SENTINEL',
              playerImpact: '可选择参加讨论',
              participantActorIds: f.world.actors.map((a) => a.id),
              placeIds: [],
              activity: 'conversation',
              basisSourceIds: [`genesis:${f.worldId}`],
            },
          ],
          audit: { reason: 'GLOBAL_AUDIT_SENTINEL', basisSourceIds: [`genesis:${f.worldId}`] },
        });
      },
    });
    const decision = await runDirectorAgent(
      { attempts: director, model, parse: parseDirectorDecision },
      f.owner,
      command,
      snapshot,
    );
    assert.equal(calls, 1);
    const requests = await db.transaction(f.owner, (sql) =>
      createRequests(sql, f.owner, { ...scope(f), decision }),
    );
    return { decision, requests, snapshot, command };
  }
  const listPending = (f: Fixture) =>
    db.transaction(f.owner, (sql) => pending(sql, f.owner, scope(f)));
  async function accept(
    f: Fixture,
    r: AgentEpisodeRequest,
    changes: Partial<AgentInputReceipt> = {},
    intentChanges: Record<string, unknown> = {},
  ) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const state = (await actors.read(f.owner, { worldId: f.worldId, actorId: r.actorId }))!;
    const text = JSON.stringify({
      type: 'npc_episode_consideration',
      requestId: r.id,
      revision: 0,
      activity: r.activity,
      placeOptionIds: [],
      basisSourceIds: [`definition:${state.definitionRef}`],
      ...intentChanges,
    });
    const input: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(text).digest('hex'),
      channel: 'private',
      threadId: r.actorId,
      recipientActorId: r.actorId,
      expectedWorldVersion: world.version,
      origin: 'coordination',
      text,
      receivedAt: new Date().toISOString(),
      storyAt: world.time,
      ...changes,
    };
    await actors.accept(f.owner, input);
    return input;
  }
  async function execution(
    f: Fixture,
    input: AgentInputReceipt,
    bypassReaderWith?: AgentInputReceipt,
  ) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const state = (await actors.read(f.owner, {
      worldId: f.worldId,
      actorId: input.recipientActorId!,
    }))!;
    const { snapshot } = await readPrivateAgentSnapshot(
      db,
      f.owner,
      world,
      state.actorId,
      bypassReaderWith ?? input,
      world.time,
      state,
    );
    if (bypassReaderWith) {
      // Deliberate internal bypass: product loading must reject this input earlier.
      // The actual send gate must also reject a forged caller snapshot before payment.
      snapshot.input = { sourceId: input.id, text: input.text, origin: input.origin };
      snapshot.sources = snapshot.sources.map((source) =>
        source.id === bypassReaderWith.id
          ? {
              ...source,
              id: input.id,
              recordId: input.id,
              at: input.storyAt,
              worldVersion: input.expectedWorldVersion,
            }
          : source,
      );
    }
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: state.actorId,
      commandId: input.commandId,
      inputReceiptId: input.id,
      inputHash: input.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    const requestId = (() => {
      try {
        return JSON.parse(input.text).requestId;
      } catch {
        return undefined;
      }
    })();
    const proposal = (
      choice?: EpisodeParticipationDecision['choice'],
      speak = true,
    ): AgentProposal => ({
      statements: speak ? [{ text: '我已考虑，会按自己的安排处理。', dependsOnActionIds: [] }] : [],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
      ...(choice
        ? {
            episodeDecision: {
              requestId,
              choice,
              reason: '依据当前自己的安排作出选择。',
              sourceIds: [input.id, `definition:${state.definitionRef}`],
            },
          }
        : {}),
    });
    return { snapshot, claim, proposal };
  }
  const kernel = (owner: string) =>
    new PostgresNpcAgentKernel(db, worlds, async (sql, input) => {
      await project(sql, owner, input);
    });
  async function perform(
    f: Fixture,
    r: AgentEpisodeRequest,
    choice?: EpisodeParticipationDecision['choice'],
    speak = true,
  ) {
    const input = await accept(f, r);
    const ex = await execution(f, input);
    let calls = 0;
    const deps = {
      attempts: actors,
      kernel: kernel(f.owner),
      model: {
        async decide() {
          calls++;
          return JSON.stringify(ex.proposal(choice, speak));
        },
      },
    };
    const output = await runNpcAgent(deps, f.owner, ex.claim, ex.snapshot);
    return { ...ex, input, output, calls, deps };
  }
  async function ep(f: Fixture, id: string) {
    return (
      await admin.query(
        'SELECT document FROM parallel_life.shared_episodes WHERE world_id=$1 AND id=$2',
        [f.worldId, id],
      )
    ).rows[0].document;
  }
  async function storedReceipt(f: Fixture, requestId: string) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.agent_episode_receipts WHERE world_id=$1 AND request_id=$2',
        [f.worldId, requestId],
      )
    ).rows[0];
  }
  async function counts(f: Fixture) {
    const tables = ['world_events', 'world_messages', 'commands', 'agent_episode_receipts'];
    const result: number[] = [];
    for (const table of tables)
      result.push(
        Number(
          (
            await admin.query(
              `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`,
              [f.worldId],
            )
          ).rows[0].n,
        ),
      );
    return result;
  }
  await t.test(
    'explicit genesis SQL hash is stable and readonly bootstrap does not reenroll old worlds',
    async () => {
      const f = await fixture(),
        c = await getCause(f);
      assert.ok(c);
      const hash = (
        await admin.query(
          'SELECT md5(state::text) hash FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].hash;
      assert.equal(c.genesisHash, hash);
      const first = await db.transaction(f.owner, (sql) => admit(sql, f.owner, scope(f)));
      assert.deepEqual(
        await db.transaction(f.owner, (sql) => admit(sql, f.owner, scope(f))),
        first,
      );
      assert.deepEqual(await counts(f), [0, 0, 0, 0]);
      const cursor = (
        await admin.query(
          'SELECT observed_through_version,evaluated_through_version FROM parallel_life.director_observed_states WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0];
      assert.deepEqual(cursor, { observed_through_version: 0, evaluated_through_version: 0 });
      const old = await fixture(false);
      assert.equal(await getCause(old), null);
      const r = { actorId: old.world.actors[0]!.id } as AgentEpisodeRequest;
      const input = await accept(old, r, { origin: 'player', text: '我已经开始交谈。' });
      const ex = await execution(old, input);
      await runNpcAgent(
        {
          attempts: actors,
          model: {
            async decide() {
              return JSON.stringify(ex.proposal());
            },
          },
          kernel: kernel(old.owner),
        },
        old.owner,
        ex.claim,
        ex.snapshot,
      );
      assert.equal(await getCause(old), null);
      await assert.rejects(
        db.transaction(old.owner, (sql) => admit(sql, old.owner, scope(old))),
        /INVALID_NARRATIVE_BASIS/,
      );
    },
  );
  await t.test(
    'one legitimate cause remains recoverable while reserved and is consumed after actual commit',
    async () => {
      const f = await fixture(),
        c = await getCause(f);
      const snapshot = await snapshots.read(f.owner, {
        ...scope(f),
        worldVersion: 0,
        candidates: [],
        blockers: [],
      });
      snapshot.evaluationCause = c!;
      const command = {
        id: randomUUID(),
        commandId: randomUUID(),
        ...scope(f),
        expectedWorldVersion: 0,
        inputHash: directorSnapshotInputHash(snapshot),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };
      const a = (await director.claim(f.owner, command, snapshot)).attempt;
      assert.deepEqual(await getCause(f), c);
      const sent = await director.mark(f.owner, a, 'request_sent');
      assert.deepEqual(await getCause(f), c);
      const received = await director.saveResponse(f.owner, sent, {
        mode: 'quiet',
        selectedCandidateIds: [],
        deferred: [],
        nudges: [],
        opportunities: [],
        audit: { reason: '保持安静', basisSourceIds: [] },
      });
      assert.deepEqual(await getCause(f), c);
      const completion = await director.readCompletion(f.owner, received);
      assert.ok(completion.found);
      const raw = completion.response;
      await director.commit(
        f.owner,
        received,
        snapshot,
        parseDirectorDecision(snapshot, raw, received),
      );
      assert.equal(await getCause(f), null);
      assert.deepEqual(await counts(f), [0, 0, 0, 0]);
    },
  );
  await t.test(
    'admitted bootstrap identity survives actual player turns before first director evaluation',
    async () => {
      const f = await fixture(),
        original = await getCause(f);
      for (let i = 0; i < 3; i++) {
        const actorId = f.world.actors[i % 2]!.id;
        const input = await accept(f, { actorId } as AgentEpisodeRequest, {
          origin: 'player',
          text: `真实原生合成输入 ${i}`,
        });
        const ex = await execution(f, input);
        await runNpcAgent(
          {
            attempts: actors,
            model: {
              async decide() {
                return JSON.stringify(ex.proposal());
              },
            },
            kernel: kernel(f.owner),
          },
          f.owner,
          ex.claim,
          ex.snapshot,
        );
      }
      assert.deepEqual(await getCause(f), original);
      const a = await db.transaction(f.owner, (sql) => admit(sql, f.owner, scope(f)));
      assert.equal(a.genesisHash, original?.genesisHash);
      assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, 3);
    },
  );
  await t.test(
    'requests use exact actual committed decisions, expose no global audit and replay consumed state',
    async () => {
      const f = await fixture(),
        o = await opportunity(f);
      assert.equal(o.requests.length, 2);
      assert.ok(!JSON.stringify(o.requests).includes('SENTINEL'));
      assert.deepEqual(
        await db.transaction(f.owner, (sql) =>
          createRequests(sql, f.owner, { ...scope(f), decision: o.decision }),
        ),
        o.requests,
      );
      const altered = { ...o.decision, audit: { ...o.decision.audit, reason: 'not committed' } };
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          createRequests(sql, f.owner, { ...scope(f), decision: altered }),
        ),
        /INVALID_NARRATIVE_BASIS/,
      );
      const r = o.requests[0]!,
        input = await accept(f, r);
      assert.ok(
        (await listPending(f)).every((x) => x.inputReceiptId === null && x.receiptId === null),
      );
      const ex = await execution(f, input);
      await runNpcAgent(
        {
          attempts: actors,
          model: {
            async decide() {
              return JSON.stringify(ex.proposal('quiet', false));
            },
          },
          kernel: kernel(f.owner),
        },
        f.owner,
        ex.claim,
        ex.snapshot,
      );
      const replay = await db.transaction(f.owner, (sql) =>
        createRequests(sql, f.owner, { ...scope(f), decision: o.decision }),
      );
      assert.equal(replay.find((x) => x.id === r.id)?.status, 'consumed');
    },
  );
  await t.test(
    'each NPC has an independent choice; later execution uses actual current version and exact replay',
    async () => {
      const f = await fixture(),
        o = await opportunity(f),
        [a, b] = o.requests;
      const first = await perform(f, a!, 'decline');
      assert.equal((await ep(f, a!.episodeId)).status, 'proposed');
      assert.equal((await storedReceipt(f, a!.id)).choice, 'decline');
      assert.equal((await listPending(f)).length, 1);
      const second = await perform(f, b!, 'engage');
      assert.equal(second.claim.expectedWorldVersion, 1);
      const active = await ep(f, b!.episodeId);
      assert.equal(active.status, 'active');
      assert.equal(active.revision, 1);
      assert.deepEqual(active.sourceEventIds, [second.output.eventId]);
      assert.deepEqual(active.resultIds, []);
      assert.deepEqual(active.unresolvedResponsibilityIds, []);
      const actual = await storedReceipt(f, b!.id);
      assert.equal(actual.presented_message_ids.length, 1);
      const before = await counts(f);
      await runNpcAgent(
        {
          ...second.deps,
          model: {
            async decide() {
              throw Error('must not pay again');
            },
          },
        },
        f.owner,
        second.claim,
        null,
      );
      assert.deepEqual(await counts(f), before);
      assert.deepEqual(await ep(f, b!.episodeId), active);
      const attempt = (await actors.lookup(f.owner, f.worldId, first.input.commandId))!;
      assert.equal(
        (
          await db.transaction(f.owner, (sql) =>
            project(sql, f.owner, { attempt, eventId: first.output.eventId }),
          )
        )?.choice,
        'decline',
      );
      await db.transaction(f.owner, (sql) =>
        switchAgentEngineEpochInTransaction(sql, f.owner, {
          worldId: f.worldId,
          expectedWorldVersion: 2,
          expectedEpoch: 2,
          nextEpoch: 3,
        }),
      );
      assert.equal(
        (
          await db.transaction(f.owner, (sql) =>
            project(sql, f.owner, { attempt, eventId: first.output.eventId }),
          )
        )?.choice,
        'decline',
      );
      assert.deepEqual(await counts(f), before);
      assert.deepEqual(await ep(f, b!.episodeId), active);
    },
  );
  await t.test(
    'enthusiastic prose is unassessed, quiet/deferred choices or engagement without speech cannot start an episode',
    async () => {
      for (const [choice, speak] of [
        [undefined, true],
        ['quiet', false],
        ['defer', true],
        ['need_information', true],
        ['engage', false],
      ] as const) {
        const f = await fixture(),
          o = await opportunity(f),
          r = o.requests[0]!;
        const run = await perform(f, r, choice, speak);
        const value = await storedReceipt(f, r.id);
        assert.equal(value.choice, choice ?? 'unassessed');
        if (!choice) {
          assert.equal(value.reason, null);
          assert.deepEqual(value.source_ids, []);
        }
        assert.equal(value.presented_message_ids.length, speak ? 1 : 0);
        assert.equal((await ep(f, r.episodeId)).status, 'proposed');
        assert.equal((await ep(f, r.episodeId)).revision, 0);
        assert.equal(run.calls, 1);
      }
    },
  );
  await t.test(
    'own silent decline survives the next private model context; forgotten input or actual event clips only its view',
    async () => {
      for (const forgottenAlias of ['input', 'event'] as const) {
        const f = await fixture(),
          o = await opportunity(f),
          r = o.requests[0]!,
          run = await perform(f, r, 'decline', false);
        const stored = (await actors.read(f.owner, { worldId: f.worldId, actorId: r.actorId }))!;
        const participation = {
          id: r.id,
          choice: 'decline',
          reason: '依据当前自己的安排作出选择。',
          sourceIds: [run.input.id, `definition:${stored.definitionRef}`],
          recordedAtVersion: 1,
        };
        assert.equal(run.calls, 1);
        assert.deepEqual(stored.episodeParticipations, [participation]);
        assert.equal((await storedReceipt(f, r.id)).choice, 'decline');
        assert.deepEqual(await counts(f), [1, 0, 1, 1]);
        assert.equal((await ep(f, r.episodeId)).status, 'proposed');
        const next = await accept(f, r, {
          origin: 'player',
          text: '接下来你有什么安排？',
        });
        const snapshot = (await execution(f, next)).snapshot;
        assert.deepEqual(snapshot.viewState?.episodeParticipations, [participation]);
        assert.ok(snapshot.sources.some((source) => source.id === run.input.id));
        assert.equal(snapshot.input.sourceId, next.id);
        const payload = async (value: typeof snapshot) => {
          let captured = '';
          await new NpcAgentModel({
            async complete(messages) {
              captured = messages.find((message) => message.role === 'user')!.content;
              return '{}';
            },
          }).decide(value);
          return { raw: captured, document: JSON.parse(captured) };
        };
        const before = await payload(snapshot);
        assert.deepEqual(before.document.state.episodeParticipations, [participation]);
        assert.ok(
          before.document.sources.some((source: { id: string }) => source.id === run.input.id),
        );
        assert.equal(before.raw.includes('DIRECTOR_ONLY_PRIVATE_SENTINEL'), false);
        assert.equal(before.raw.includes('GLOBAL_AUDIT_SENTINEL'), false);
        assert.deepEqual(before.document.state.decisions, []);
        const otherActor = o.requests[1]!.actorId;
        const world = await worlds.get({ userId: f.owner }, f.worldId);
        const otherState = (await actors.read(f.owner, {
          worldId: f.worldId,
          actorId: otherActor,
        }))!;
        const other = (
          await readPrivateAgentSnapshot(
            db,
            f.owner,
            world,
            otherActor,
            null,
            world.time,
            otherState,
          )
        ).snapshot;
        const otherPayload = await payload(other);
        assert.equal(otherPayload.raw.includes(participation.reason), false);
        assert.equal(otherPayload.raw.includes(run.input.id), false);
        assert.equal(otherPayload.document.state.episodeParticipations, undefined);
        // Existing forgotten-source metadata fixture, not a production forget API assertion.
        await admin.query(
          "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Synthetic forgotten participation provenance',$5,'agent_inference',$6,'forgotten')",
          [
            randomUUID(),
            f.owner,
            r.actorId,
            f.worldId,
            randomUUID(),
            JSON.stringify([forgottenAlias === 'input' ? run.input.id : run.output.eventId]),
          ],
        );
        const afterSnapshot = (await execution(f, next)).snapshot;
        const after = await payload(afterSnapshot);
        assert.deepEqual(afterSnapshot.viewState?.episodeParticipations, []);
        assert.ok(afterSnapshot.redactedStateIds?.includes(r.id));
        assert.equal(
          afterSnapshot.sources.some((source) => source.id === run.input.id),
          false,
        );
        assert.deepEqual(after.document.state.episodeParticipations, []);
        assert.equal(after.raw.includes(participation.reason), false);
        assert.deepEqual(
          (await actors.read(f.owner, { worldId: f.worldId, actorId: r.actorId }))!
            .episodeParticipations,
          [participation],
        );
        assert.equal((await storedReceipt(f, r.id)).choice, 'decline');
        assert.deepEqual(await counts(f), [1, 0, 1, 1]);
      }
    },
  );
  await t.test(
    'unknown request cannot manufacture a receipt; ordinary coordination remains ordinary',
    async () => {
      const f = await fixture(),
        o = await opportunity(f),
        r = o.requests[0]!;
      const typed = await accept(f, r, {}, { requestId: randomUUID() });
      await assert.rejects(execution(f, typed), { code: 'INPUT_SCOPE_FORBIDDEN' });
      const ex = await execution(f, typed, await accept(f, r));
      let calls = 0;
      await assert.rejects(
        runNpcAgent(
          {
            attempts: actors,
            kernel: kernel(f.owner),
            model: {
              async decide() {
                calls++;
                return JSON.stringify(ex.proposal('engage'));
              },
            },
          },
          f.owner,
          ex.claim,
          ex.snapshot,
        ),
        { code: 'INPUT_SCOPE_FORBIDDEN' },
      );
      assert.equal(calls, 0);
      assert.deepEqual(await counts(f), [0, 0, 0, 0]);
      const other = await accept(f, o.requests[1]!, {
        text: JSON.stringify({ type: 'continue_own_plan' }),
      });
      const normal = await execution(f, other);
      await runNpcAgent(
        {
          attempts: actors,
          kernel: kernel(f.owner),
          model: {
            async decide() {
              return JSON.stringify(normal.proposal());
            },
          },
        },
        f.owner,
        normal.claim,
        normal.snapshot,
      );
      assert.equal(await storedReceipt(f, o.requests[1]!.id), undefined);
      assert.equal((await listPending(f)).length, 2);
    },
  );
  await t.test(
    'late projection failure rolls back original commit and recovers the protected result without another model call',
    async () => {
      const f = await fixture(),
        o = await opportunity(f),
        r = o.requests[0]!,
        input = await accept(f, r);
      const ex = await execution(f, input);
      let calls = 0;
      const failing = new PostgresNpcAgentKernel(db, worlds, async (sql, value) => {
        await project(sql, f.owner, value);
        throw Error('SYNTHETIC_AFTER_PROJECT_FAILURE');
      });
      const model = {
        async decide() {
          calls++;
          return JSON.stringify(ex.proposal('engage'));
        },
      };
      await assert.rejects(
        runNpcAgent({ attempts: actors, kernel: failing, model }, f.owner, ex.claim, ex.snapshot),
        /SYNTHETIC_AFTER_PROJECT_FAILURE/,
      );
      assert.equal(
        (await actors.lookup(f.owner, f.worldId, input.commandId))?.status,
        'response_received',
      );
      assert.deepEqual(await counts(f), [0, 0, 0, 0]);
      assert.equal((await ep(f, r.episodeId)).status, 'proposed');
      assert.equal((await listPending(f)).find((v) => v.id === r.id)?.inputReceiptId, null);
      assert.equal(
        (await actors.read(f.owner, { worldId: f.worldId, actorId: r.actorId }))?.revision,
        0,
      );
      await runNpcAgent(
        {
          attempts: actors,
          kernel: kernel(f.owner),
          model: {
            async decide() {
              throw Error('must reuse protected response');
            },
          },
        },
        f.owner,
        ex.claim,
        null,
      );
      assert.equal(calls, 1);
      assert.equal((await ep(f, r.episodeId)).status, 'active');
      assert.equal((await storedReceipt(f, r.id)).choice, 'engage');
    },
  );
  await t.test(
    'default kernel projects an atomic receipt; readonly replay checks actual attempt lineage',
    async () => {
      const f = await fixture(),
        o = await opportunity(f),
        r = o.requests[0]!,
        input = await accept(f, r);
      const ex = await execution(f, input);
      const output = await runNpcAgent(
        {
          attempts: actors,
          kernel: new PostgresNpcAgentKernel(db, worlds),
          model: {
            async decide() {
              return JSON.stringify(ex.proposal('engage'));
            },
          },
        },
        f.owner,
        ex.claim,
        ex.snapshot,
      );
      const attempt = (await actors.lookup(f.owner, f.worldId, input.commandId))!;
      const receipt = await storedReceipt(f, r.id);
      assert.equal(receipt.choice, 'engage');
      assert.equal(receipt.source_event_id, output.eventId);
      const before = await counts(f);
      assert.equal(
        (
          await db.transaction(f.owner, (sql) =>
            project(sql, f.owner, { attempt, eventId: output.eventId }),
          )
        )?.id,
        receipt.id,
      );
      await runNpcAgent(
        {
          attempts: actors,
          kernel: new PostgresNpcAgentKernel(db, worlds),
          model: {
            async decide() {
              throw Error('must not pay');
            },
          },
        },
        f.owner,
        ex.claim,
        null,
      );
      assert.deepEqual(await counts(f), before);
      assert.equal((await ep(f, r.episodeId)).status, 'active');
      assert.deepEqual(await storedReceipt(f, r.id), receipt);
      const g = await fixture(),
        og = await opportunity(g),
        done = await perform(g, og.requests[0]!, 'engage');
      const actual = (await actors.lookup(g.owner, g.worldId, done.input.commandId))!;
      for (const changed of [
        { token: randomUUID() },
        { commandId: randomUUID() },
        { inputHash: '0'.repeat(64) },
        { expectedActorRevision: 1 },
      ])
        await assert.rejects(
          db.transaction(g.owner, (sql) =>
            project(sql, g.owner, {
              attempt: { ...actual, ...changed },
              eventId: done.output.eventId,
            }),
          ),
          /INVALID_NARRATIVE_BASIS/,
        );
    },
  );
  await t.test(
    'paid terminal bootstrap results suppress re-purchase; zero-send cancellation gets a stable successor and unknown keeps its cause',
    async () => {
      for (const status of [
        'invalid_output',
        'stale_discarded',
        'cancelled_before_send',
        'unknown_after_send',
      ] as const) {
        const f = await fixture(),
          original = await getCause(f);
        const snapshot = await snapshots.read(f.owner, {
          ...scope(f),
          worldVersion: 0,
          candidates: [],
          blockers: [],
        });
        snapshot.evaluationCause = original!;
        const command = {
          id: randomUUID(),
          commandId: randomUUID(),
          ...scope(f),
          expectedWorldVersion: 0,
          inputHash: directorSnapshotInputHash(snapshot),
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 120000).toISOString(),
        };
        let a = (await director.claim(f.owner, command, snapshot)).attempt;
        if (status === 'invalid_output' || status === 'unknown_after_send')
          a = await director.mark(f.owner, a, 'request_sent');
        if (status === 'invalid_output')
          a = await director.saveResponse(f.owner, a, { explicitInvalidMock: true });
        await director.mark(f.owner, a, status);
        const next = await getCause(f);
        if (status === 'unknown_after_send') assert.deepEqual(next, original);
        else if (status === 'invalid_output') assert.equal(next, null);
        else {
          assert.equal(next?.kind, 'bootstrap');
          assert.notEqual(next?.id, original?.id);
          assert.deepEqual(await getCause(f), next);
          const actual = (
            await admin.query(
              'SELECT sent_at,response_hash FROM parallel_life.director_runtime_attempts WHERE id=$1',
              [a.id],
            )
          ).rows[0];
          assert.equal(actual.sent_at, null);
          assert.equal(actual.response_hash, null);
        }
      }
    },
  );
  await t.test(
    'strict malformed typed bodies are rejected by preparation and the atomic send gate before any paid call or extension',
    async () => {
      for (const changed of [
        { extra: 'author prose' },
        { placeOptionIds: ['global-place'] },
        { basisSourceIds: ['authored:private'] },
        { basisSourceIds: null },
        { revision: '0' },
        { placeOptionIds: null },
      ]) {
        const f = await fixture(),
          o = await opportunity(f),
          r = o.requests[0]!;
        const input = await accept(f, r, {}, changed);
        await assert.rejects(execution(f, input), /INVALID_NARRATIVE_BASIS/);
        const ex = await execution(f, input, await accept(f, r));
        let callbacks = 0,
          calls = 0;
        const tested = new PostgresNpcAgentKernel(db, worlds, async () => {
          callbacks++;
          throw Error('MALFORMED_INPUT_REACHED_EXTENSION');
        });
        await assert.rejects(
          runNpcAgent(
            {
              attempts: actors,
              kernel: tested,
              model: {
                async decide() {
                  calls++;
                  return JSON.stringify(ex.proposal());
                },
              },
            },
            f.owner,
            ex.claim,
            ex.snapshot,
          ),
          { code: 'INPUT_SCOPE_FORBIDDEN' },
        );
        assert.equal(calls, 0);
        assert.equal(callbacks, 0);
        assert.deepEqual(await counts(f), [0, 0, 0, 0]);
        assert.equal(
          (await actors.read(f.owner, { worldId: f.worldId, actorId: r.actorId }))?.revision,
          0,
        );
        assert.equal(
          (await actors.lookup(f.owner, f.worldId, input.commandId))?.status,
          'stale_discarded',
        );
        const failed = (
          await admin.query(
            'SELECT sent_at,response_hash FROM parallel_life.agent_attempts WHERE id=$1',
            [ex.claim.id],
          )
        ).rows[0];
        assert.equal(failed.sent_at, null);
        assert.equal(failed.response_hash, null);
        assert.ok(
          (await listPending(f)).every((v) => v.inputReceiptId === null && v.receiptId === null),
        );
      }
      // The old direct-SQL extension was after product projection. It is now unreachable for
      // malformed input; this test deliberately claims the earlier real rejection boundary only.
    },
  );
  await t.test(
    'deferred SQL reference forbids committing a half receipt; proposed episode cannot be inserted active',
    async () => {
      const f = await fixture(),
        o = await opportunity(f),
        r = o.requests[0]!,
        input = await accept(f, r),
        ex = await execution(f, input);
      const trigger = `zzz_half_request_${randomUUID().replaceAll('-', '')}`;
      await admin.query(
        `CREATE FUNCTION parallel_life.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$`,
      );
      await admin.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON parallel_life.agent_episode_requests
        FOR EACH ROW WHEN (NEW.world_id='${f.worldId}') EXECUTE FUNCTION parallel_life.${trigger}()`);
      const deferred = (
        await admin.query(
          "SELECT conname FROM pg_constraint WHERE conrelid='parallel_life.agent_episode_receipts'::regclass AND condeferrable AND condeferred AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (world_id, request_id, input_receipt_id)%'",
        )
      ).rows;
      assert.equal(deferred.length, 1);
      let projectionReturned = false;
      try {
        // The normal helper sees rowCount=1, but a last BEFORE trigger retains OLD pending.
        // Only the real deferred (request,input) FK can catch that half receipt at COMMIT.
        const half = new PostgresNpcAgentKernel(db, worlds, async () => {
          projectionReturned = true;
        });
        await assert.rejects(
          runNpcAgent(
            {
              attempts: actors,
              kernel: half,
              model: {
                async decide() {
                  return JSON.stringify(ex.proposal());
                },
              },
            },
            f.owner,
            ex.claim,
            ex.snapshot,
          ),
          (error: unknown) =>
            !!error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === '23503' &&
            'constraint' in error &&
            error.constraint === deferred[0]!.conname,
        );
        assert.equal(projectionReturned, true);
      } finally {
        await admin.query(`DROP TRIGGER ${trigger} ON parallel_life.agent_episode_requests`);
        await admin.query(`DROP FUNCTION parallel_life.${trigger}()`);
      }
      assert.deepEqual(await counts(f), [0, 0, 0, 0]);
      assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, 0);
      assert.equal(
        (await actors.read(f.owner, { worldId: f.worldId, actorId: r.actorId }))?.revision,
        0,
      );
      assert.ok(
        (await listPending(f)).every(
          (value) => value.inputReceiptId === null && value.receiptId === null,
        ),
      );

      assert.equal(
        (await actors.lookup(f.owner, f.worldId, input.commandId))?.status,
        'response_received',
      );
      const document = await ep(f, r.episodeId);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            `INSERT INTO parallel_life.shared_episodes
      (world_id,owner_id,id,origin_decision_id,document) VALUES($1,$2,$3,$4,$5)`,
            [
              f.worldId,
              f.owner,
              r.episodeId,
              o.decision.id,
              { ...document, status: 'active', revision: 1, sourceEventIds: ['invented'] },
            ],
          ),
        ),
        /EPISODE_INSERT_MUST_BE_PROPOSED/,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            `UPDATE parallel_life.shared_episodes SET document=$3 WHERE world_id=$1 AND id=$2`,
            [
              f.worldId,
              r.episodeId,
              { ...document, status: 'active', revision: 1, sourceEventIds: ['invented'] },
            ],
          ),
        ),
        /EPISODE_NOT_ACTUALLY_PRESENTED/,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            `UPDATE parallel_life.agent_episode_requests SET input_receipt_id=$3 WHERE world_id=$1 AND id=$2`,
            [f.worldId, r.id, input.id],
          ),
        ),
        /EPISODE_INPUT_REQUIRES_ACTUAL_COMMIT/,
      );
      await runNpcAgent(
        {
          attempts: actors,
          kernel: kernel(f.owner),
          model: {
            async decide() {
              throw Error('reuse protected raw');
            },
          },
        },
        f.owner,
        ex.claim,
        null,
      );
      assert.equal((await storedReceipt(f, r.id)).choice, 'unassessed');
    },
  );
  await t.test(
    'player-pasted typed JSON never gains participation authority or consumes a request',
    async () => {
      const f = await fixture(),
        o = await opportunity(f),
        r = o.requests[0]!;
      const input = await accept(f, r, { origin: 'player' }),
        ex = await execution(f, input);
      await runNpcAgent(
        {
          attempts: actors,
          kernel: kernel(f.owner),
          model: {
            async decide() {
              return JSON.stringify(ex.proposal());
            },
          },
        },
        f.owner,
        ex.claim,
        ex.snapshot,
      );
      assert.equal(await storedReceipt(f, r.id), undefined);
      assert.ok((await listPending(f)).every((v) => v.inputReceiptId === null));
      assert.equal((await ep(f, r.episodeId)).status, 'proposed');
    },
  );
  await t.test(
    'foreign owner, worker and epoch fences; an unused old input cannot pin a pending request',
    async () => {
      const f = await fixture(),
        o = await opportunity(f),
        r = o.requests[0]!;
      await assert.rejects(
        db.transaction(randomUUID(), (sql) => pending(sql, f.owner, scope(f))),
        /NOT_FOUND/,
      );
      await assert.rejects(
        db.transaction(randomUUID(), (sql) => pending(sql, randomUUID(), scope(f))),
        /NOT_FOUND/,
      );
      await assert.rejects(
        worker.transaction(f.owner, (sql) => pending(sql, f.owner, scope(f))),
        /NOT_FOUND/,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) => pending(sql, f.owner, { ...scope(f), engineEpoch: 3 })),
        /INVALID_NARRATIVE_BASIS/,
      );
      const old = await accept(f, r);
      await perform(f, o.requests[1]!, 'quiet', false);
      assert.equal((await listPending(f)).find((x) => x.id === r.id)?.inputReceiptId, null);
      const fresh = await accept(f, r);
      assert.equal(fresh.expectedWorldVersion, 1);
      assert.equal(old.expectedWorldVersion, 0);
      const ex = await execution(f, fresh);
      await runNpcAgent(
        {
          attempts: actors,
          kernel: kernel(f.owner),
          model: {
            async decide() {
              return JSON.stringify(ex.proposal('quiet', false));
            },
          },
        },
        f.owner,
        ex.claim,
        ex.snapshot,
      );
      assert.equal((await storedReceipt(f, r.id)).input_receipt_id, fresh.id);
    },
  );
});
