import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
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
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import {
  readAgendaInitializeGrantsInTransaction,
  agendaInitializeCommandId,
  agendaInitializeInputText,
} from '../../src/modules/world/infrastructure/actor-agenda-initialization-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  readOwnAgendaReviewWorkInTransaction,
  ownAgendaReviewInputText,
  DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
} from '../../src/modules/world/infrastructure/own-agenda-review-authority.ts';
import { readOwnAgendaReviewEvidenceInTransaction } from '../../src/modules/world/infrastructure/own-agenda-review-repository.ts';
import { ownAgendaReviewWindow } from '../../src/modules/world/application/own-agenda-review-policy.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { recordStreamSegmentError } from '../../src/modules/world/infrastructure/npc-stream-segment-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

test('only a later complete player turn renews a failed agenda basis', async (t) => {
  const cfg = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db);
  const config = structuredClone(DEFAULT_OWN_AGENDA_RUNTIME_CONFIG);
  // Fast test clock only: same nonzero exponential policy and authority, production constants untouched.
  Object.assign(config.policy, { storyGapMs: 1, realGapMs: 250, maxRealGapMs: 2000 });
  const store = new PostgresAgentRuntimeRepository(db, config);
  const fixtures: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    for (const f of fixtures) await clocks.setClock(f.owner, f.worldId, { paused: true });
    await db.close();
    await admin.end();
  });
  async function fixture(waiting = false, withOtherActor = false) {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId: string = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Isolated bounded agenda review fixture',
      time: '2026-10-19T00:00:00.000Z',
      actors: [
        {
          id: actorId,
          name: '独立测试人物',
          persona: '有本人生活安排，可安静等待，不重复请求玩家',
        },
        ...(withOtherActor
          ? [{ id: randomUUID(), name: '另一人物', persona: '有自己的生活。' }]
          : []),
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
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
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await clocks.write(owner, worldId, {
      storyNow: world.time,
      speed: 12,
      paused: false,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const f = { owner, worldId, actorId, world, waiting, calls: 0 };
    fixtures.push(f);
    const grant = (
      await db.transaction(owner, (sql) =>
        readAgendaInitializeGrantsInTransaction(sql, owner, {
          worldId,
          engineEpoch: 2,
          worldVersion: 0,
        }),
      )
    ).find((g) => g.actorId === actorId)!;
    assert.ok(grant);
    await perform(
      f,
      agendaInitializeInputText(grant),
      agendaInitializeCommandId(worldId, grant.candidateId),
      false,
    );
    return f;
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function perform(
    f: F,
    text: string,
    commandId: string,
    review: boolean,
    mode: 'quiet' | 'unknown' | 'invalid' = 'quiet',
    origin: 'wake' | 'player' = 'wake',
    priorReceipt?: import('../../src/modules/world/domain/agent-runtime.ts').AgentInputReceipt,
  ) {
    const world = await worlds.get({ userId: f.owner }, f.worldId),
      clock = await clocks.read(f.owner, f.worldId);
    const storyAt = projectStoryTime(clock, new Date().toISOString());
    const inputHash =
      priorReceipt?.inputHash ??
      (origin === 'player'
        ? hash(JSON.stringify([f.worldId, f.actorId, text]))
        : review
          ? hash(JSON.stringify([f.worldId, f.actorId, JSON.parse(text).grantId, text]))
          : hash(JSON.stringify([f.worldId, f.actorId, JSON.parse(text).candidateId, text])));
    const { receipt } = priorReceipt
      ? { receipt: priorReceipt }
      : await store.accept(f.owner, {
          id: randomUUID(),
          worldId: f.worldId,
          commandId,
          inputHash,
          channel: 'private',
          threadId: f.actorId,
          recipientActorId: f.actorId,
          expectedWorldVersion: world.version,
          receivedAt: new Date().toISOString(),
          storyAt,
          origin,
          text,
        });
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
    const snapshot = (
      await readPrivateAgentSnapshot(db, f.owner, world, f.actorId, receipt, storyAt, state)
    ).snapshot;
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.actorId,
      commandId,
      inputReceiptId: receipt.id,
      inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + (mode === 'unknown' ? 800 : 240000)).toISOString(),
    };
    const deps = {
      attempts: store,
      kernel: new PostgresNpcAgentKernel(db, worlds),
      model: new NpcAgentModel({
        async complete(messages) {
          f.calls++;
          if (mode === 'unknown') throw Error('SYNTHETIC_LOST_RESPONSE');
          if (mode === 'invalid') return '{invalid';
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content),
            ref = p.wireCatalog.inputSourceRef;
          return JSON.stringify({
            protocol: 'npc-wire-v16',
            statements:
              origin === 'player'
                ? [{ text: '收到，我先想想。', dependsOnActionIds: [], requestsPlayerReply: false }]
                : f.waiting && !review
                  ? [
                      {
                        text: '关于旧安排，等你方便再告诉我。',
                        dependsOnActionIds: [],
                        requestsPlayerReply: true,
                        questionForResponsibilityId: null,
                      },
                    ]
                  : [],
            executions: [],
            changes: {
              ...(review
                ? {
                    agendaReview: {
                      decision: 'quiet',
                      reason: '本人暂时安静，不重复询问玩家',
                      basisSourceIds: [ref],
                    },
                  }
                : {}),
              continuation: {
                decision: f.waiting ? 'await_response' : 'no_current_intent',
                reason: '保留本人状态，不强迫玩家答复',
                sourceIds: [ref],
                planIds: [],
                questionIds:
                  review && f.waiting
                    ? (p.state.questions ?? [])
                        .filter((q: { status: string }) => q.status === 'open')
                        .map((q: { id: string }) => q.id)
                    : [],
                conditions: [],
              },
            },
          });
        },
      }),
    };
    return { result: await runNpcAgent(deps, f.owner, claim, snapshot), claim, snapshot, deps };
  }
  async function evidence(f: F) {
    return db.transaction(f.owner, (sql) =>
      readOwnAgendaReviewEvidenceInTransaction(sql, f.owner, {
        worldId: f.worldId,
        actorId: f.actorId,
        engineEpoch: 2,
        definitionRef: agentDefinitionRef(f.world, f.actorId),
      }),
    );
  }
  async function work(f: F, override = config) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return db.transaction(f.owner, (sql) =>
      readOwnAgendaReviewWorkInTransaction(sql, f.owner, {
        worldId: f.worldId,
        actorId: f.actorId,
        worldVersion: world.version,
        config: override,
        hasPriorityWork: false,
      }),
    );
  }
  async function due(f: F) {
    const e = await evidence(f);
    const window = ownAgendaReviewWindow(e.anchor!, config.policy, e.quietStreak);
    await sleep(Math.max(0, Date.parse(window.nextReviewRealAt) - Date.now() + 15));
  }
  async function failed(f: F, mode: 'invalid' | 'unknown' = 'invalid') {
    await due(f);
    const grant = await work(f);
    assert.ok(grant);
    await assert.rejects(
      perform(f, ownAgendaReviewInputText(grant.grant), grant.commandId, true, mode),
    );
    const attempt = (await store.lookup(f.owner, f.worldId, grant.commandId))!;
    assert.equal((await evidence(f)).paidContinuationBases.length, 1);
    return { grant, attempt };
  }
  const row = async (id: string) =>
    (await admin.query('SELECT * FROM parallel_life.agent_attempts WHERE id=$1', [id])).rows[0];
  const player = (
    f: F,
    receipt?: import('../../src/modules/world/domain/agent-runtime.ts').AgentInputReceipt,
  ) =>
    perform(
      f,
      '我现在想和你聊件新事情。',
      receipt?.commandId ?? randomUUID(),
      false,
      'quiet',
      'player',
      receipt,
    );

  await t.test(
    'new complete player turn opens a new family without changing the old failed request',
    async () => {
      const f = await fixture();
      const old = await failed(f);
      const before = await row(old.attempt.id);
      const done = await player(f);
      const e = await evidence(f);
      assert.equal(e.paidContinuationBases.length, 0);
      assert.equal(e.anchor!.attemptId, done.claim.id);
      await due(f);
      const next = await work(f);
      assert.ok(next);
      assert.notEqual(next.grant.grantId, old.grant.grant.grantId);
      assert.equal(next.grant.anchorAttemptId, done.claim.id);
      assert.deepEqual(await row(old.attempt.id), before);
      await perform(f, ownAgendaReviewInputText(next.grant), next.commandId, true);
      assert.deepEqual(await row(old.attempt.id), before);
    },
  );

  await t.test('time and a later complete quiet wake do not renew a failed basis', async () => {
    const f = await fixture();
    await failed(f);
    await due(f);
    assert.equal(await work(f), null);
    await perform(
      f,
      JSON.stringify({
        type: 'npc_own_condition_ready',
        candidateId: 'independent-context',
        source: 'actor_local',
        basisSourceIds: [],
      }),
      randomUUID(),
      false,
    );
    assert.equal((await evidence(f)).paidContinuationBases.length, 1);
    await due(f);
    assert.equal(await work(f), null);
  });

  await t.test('another actor player conversation does not renew this actor basis', async () => {
    const f = await fixture(false, true);
    await failed(f);
    await player({ ...f, actorId: f.world.actors[1]!.id });
    assert.equal((await evidence(f)).paidContinuationBases.length, 1);
    await due(f);
    assert.equal(await work(f), null);
  });

  await t.test('interrupted player presentation cannot renew the basis', async () => {
    const f = await fixture();
    await failed(f);
    const done = await player(f);
    const completed = (await store.lookup(f.owner, f.worldId, done.claim.commandId))!;
    await recordStreamSegmentError(db, f.owner, {
      attempt: completed,
      segmentIndex: 0,
      text: '合成未完成片段',
    });
    assert.equal((await evidence(f)).paidContinuationBases.length, 1);
    await due(f);
    assert.equal(await work(f), null);
  });

  await t.test(
    'a player input accepted before the failed call cannot renew it by finishing late',
    async () => {
      const f = await fixture();
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const text = '我现在想和你聊件新事情。';
      const { receipt } = await store.accept(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: hash(JSON.stringify([f.worldId, f.actorId, text])),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: world.version,
        receivedAt: new Date().toISOString(),
        storyAt: world.time,
        origin: 'player',
        text,
      });
      await failed(f);
      await player(f, receipt);
      assert.equal((await evidence(f)).paidContinuationBases.length, 1);
      await due(f);
      assert.equal(await work(f), null);
    },
  );

  await t.test(
    'unknown is not repurchased; new input uses original expired-call retirement',
    async () => {
      const f = await fixture();
      const old = await failed(f, 'unknown');
      const before = await row(old.attempt.id);
      assert.equal(await work(f), null);
      await sleep(850);
      const done = await player(f);
      const after = await row(old.attempt.id);
      assert.equal(after.status, 'stale_discarded');
      for (const key of [
        'id',
        'command_id',
        'input_receipt_id',
        'input_hash',
        'sent_at',
        'response',
        'response_hash',
        'event_id',
        'expected_world_version',
        'expected_actor_revision',
      ])
        assert.deepEqual(after[key], before[key]);
      assert.equal((await evidence(f)).paidContinuationBases.length, 0);
      await due(f);
      const next = await work(f);
      assert.ok(next);
      assert.equal(next.grant.anchorAttemptId, done.claim.id);
      assert.notEqual(next.commandId, old.grant.commandId);
    },
  );
});
