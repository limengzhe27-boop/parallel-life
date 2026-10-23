import { readAgentPhoneEntryProbe } from '../../src/modules/world/infrastructure/agent-phone-entry-probe.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresOutbox } from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { createMediaPipelineHandler } from '../../src/modules/media/infrastructure/media-pipeline-handler.ts';
import type { MediaPipelineService } from '../../src/modules/media/infrastructure/media-pipeline-service.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('actual media completion wakes its own native actor once under a pending Director', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.ACTOR_MEDIA_WAKE_TEST_PORT ?? 55633));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  t.after(async () => {
    await queue.close();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    attempts = new PostgresAgentRuntimeRepository(db);
  async function fixture(speak = true) {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic media result world',
      time: '2026-10-15T08:00:00.000Z',
      actors: [
        { id: 'a', name: 'A', persona: 'Independent photographer' },
        { id: 'b', name: 'B', persona: 'Knows only own life' },
      ],
      messages: [],
      facts: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const actor of world.actors) {
        const initial = emptyActorAgentState(
          { worldId, actorId: actor.id },
          agentDefinitionRef(world, actor.id),
          0,
        );
        if (actor.id === 'b')
          initial.goals.push({
            id: 'b-own-history',
            summary: 'Synthetic closed history',
            status: 'withdrawn',
            sourceIds: ['definition:' + initial.definitionRef],
            resultIds: [],
          });
        await initializeActorAgentStateInTransaction(sql, owner, initial);
      }
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await new PostgresClockStore(db).setClock(owner, worldId, { paused: false, speed: 0 });
    const { receipt } = await attempts.accept(owner, {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(worldId).digest('hex'),
      channel: 'private',
      threadId: 'a',
      recipientActorId: 'a',
      expectedWorldVersion: 0,
      receivedAt: new Date().toISOString(),
      storyAt: world.time,
      origin: speak ? 'player' : 'wake',
      text: speak ? 'Would you like to take a picture?' : 'Evaluate your own scheduled media plan.',
    });
    const state = (await attempts.read(owner, { worldId, actorId: 'a' }))!,
      snapshot = (await readPrivateAgentSnapshot(db, owner, world, 'a', receipt, world.time, state))
        .snapshot;
    const proposal = {
      protocol: 'npc-wire-v3',
      consideration: null,
      mediaDecision: {
        kind: 'generate_image',
        goalSummary: 'Share one photograph',
        planSummary: 'Request one image and wait for actual result',
        parameters: {
          sceneDescription: 'An ordinary desk in this fictional world',
          purpose: 'scene',
        },
        basisSourceIds: [receipt.id],
      },
      executions: [],
      statements: speak
        ? [{ text: 'I will try taking a picture.', dependsOnActionIds: ['media:current'] }]
        : [],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    };
    const committed = await runNpcAgent(
      {
        attempts,
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      owner,
      {
        id: randomUUID(),
        worldId,
        actorId: 'a',
        commandId: receipt.commandId,
        inputReceiptId: receipt.id,
        inputHash: receipt.inputHash,
        engineEpoch: 2,
        expectedWorldVersion: 0,
        expectedActorRevision: 0,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      },
      snapshot,
    );
    const requestId = committed.results[0]!.outputRefs![0]!.id;
    return { owner, worldId, requestId, committed, world };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function dispatch(f: F) {
    const result = await dispatchOutbox(
      new PostgresOutbox(db).ports(f.owner, { worldId: f.worldId, eventId: f.committed.eventId }),
    );
    assert.equal(result.submitted, 1);
    return (await queue.claimForOwner(result.taskIds[0]!, f.owner, ['media']))!;
  }
  async function complete(f: F, deliverToChat = true) {
    const lease = await dispatch(f),
      assetId = randomUUID();
    const pipeline: Partial<MediaPipelineService> = {
      async executeImagePipeline() {
        return {
          assetId,
          storageKey: 'synthetic/' + assetId,
          mimeType: 'image/webp',
          byteLength: 128,
          width: 8,
          height: 8,
          referenceAssetIds: [],
          prompt: 'Synthetic adapter only',
          providerTaskId: 'synthetic-provider',
          deliveryDecision: { approved: deliverToChat, deliverToChat, deliverToAlbum: true },
        };
      },
    };
    await createMediaPipelineHandler(queue, pipeline as MediaPipelineService)(lease);
    return { lease, assetId };
  }

  const directors = new PostgresDirectorRuntimeRepository(db),
    snapshots = new PostgresDirectorSnapshotRepository(db),
    activity = new PostgresClockActivityRepository(db);
  async function probe(f: F) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return db.transaction(f.owner, (sql) =>
      readAgentPhoneEntryProbe(sql, f.owner, {
        worldId: f.worldId,
        engineEpoch: 2,
        worldVersion: world.version,
        storyAt: world.time,
      }),
    );
  }
  async function candidates(f: F) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const actors = await Promise.all(
      world.actors.map(async (a) => ({
        snapshot: (
          await readPrivateAgentSnapshot(
            db,
            f.owner,
            world,
            a.id,
            null,
            world.time,
            (await attempts.read(f.owner, { worldId: f.worldId, actorId: a.id }))!,
          )
        ).snapshot,
        trustedResults: [],
        appointments: [],
      })),
    );
    return (
      await Promise.all(
        createAgentScheduleSources({
          worldId: f.worldId,
          engineEpoch: 2,
          worldVersion: world.version,
          storyAt: world.time,
          actors,
          activeAttempts: [],
          consumedCandidateIds: [],
        }).map((s) => s.source.collect(f.owner, f.worldId)),
      )
    )
      .flatMap((r) => r.candidates)
      .filter((c) => c.resourceIds.some((r) => r === 'media:' + f.requestId));
  }
  async function pendingDirector(f: F) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const snapshot = await snapshots.read(f.owner, {
      worldId: f.worldId,
      engineEpoch: 2,
      worldVersion: world.version,
      candidates: [],
      blockers: [],
    });
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: randomUUID(),
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      inputHash: directorSnapshotInputHash(snapshot),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    };
    await assert.rejects(
      runDirectorAgent(
        {
          attempts: directors,
          model: {
            async decide() {
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
  function harness() {
    let npc = 0;
    const model: TextModel = {
      async complete(messages) {
        const payload = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        assert.equal(payload.replyAs?.actorId, 'a');
        const observations = [
          ...payload.observations,
          ...(payload.presentationContext?.internalContext ?? []).map(
            (entry: any) => entry.observation,
          ),
        ];
        assert.ok(
          observations.some((o: any) => {
            if (o.kind === 'own_media_completion') return true;
            try {
              return JSON.parse(o.text).kind === 'own_media_completion';
            } catch {
              return false;
            }
          }),
        );
        npc++;
        return JSON.stringify({
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
      },
    };
    return {
      service: npcAgentAdvanceServices(db, () => model, snapshots, { maxActors: 1 }),
      calls: () => npc,
    };
  }
  await t.test(
    'same-version ready gives a new cheap cue, native quiet commits once, no extra image/NPC/Director purchase on reentry',
    async () => {
      const f = await fixture();
      await activity.update(f.owner, f.worldId, {
        clientId: randomUUID(),
        sequence: 1,
        mode: 'browsing',
        resume: true,
      });
      const director = await pendingDirector(f),
        before = await probe(f),
        beforeVersion = (await worlds.get({ userId: f.owner }, f.worldId)).version;
      assert.deepEqual(await candidates(f), [], 'enqueue success is not the external result');
      await complete(f);
      assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, beforeVersion);
      const candidate = (await candidates(f))[0]!;
      assert.ok(candidate);
      assert.equal(candidate.actorId, 'a');
      assert.equal(candidate.source, 'observation');
      const ready = await probe(f);
      assert.equal(ready.status, 'ready');
      assert.notDeepEqual(
        ready,
        before,
        'actual completion, not ambient world tick, changes the pending-Director check',
      );
      assert.deepEqual(await probe(f), ready);
      const h = harness();
      const outcome = await h.service.advanceIfEnabled(f.owner, f.worldId);
      assert.equal(outcome?.played, 0);
      assert.equal(outcome?.changed, true);
      assert.equal(h.calls(), 1);
      const after = await probe(f);
      assert.deepEqual(
        after,
        before,
        'quiet removes this media completion from the cheap check; unchanged old plan remains the same cheap cue',
      );
      await h.service.advanceIfEnabled(f.owner, f.worldId).catch(() => {});
      assert.equal(h.calls(), 1, 'original semantic wake receipt prevents repurchase');
      assert.equal(
        (await directors.lookup(f.owner, f.worldId, director.commandId))!.status,
        'unknown_after_send',
      );
      const counts = (
        await admin.query(
          "SELECT (SELECT count(*)::int FROM parallel_life.director_runtime_attempts WHERE world_id=$1) directors,(SELECT count(*)::int FROM parallel_life.world_media_requests WHERE world_id=$1) media,(SELECT count(*)::int FROM parallel_life.agent_attempts WHERE world_id=$1 AND status='committed') committed",
          [f.worldId],
        )
      ).rows[0];
      assert.deepEqual(counts, { directors: 1, media: 1, committed: 2 });
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1 AND document->>'role'='assistant'",
            [f.worldId],
          )
        ).rows[0].n,
        1,
        'quiet adds no forced message',
      );
    },
  );
  await t.test(
    'unknown image is not completion; no cross-actor media cue or automatic retry',
    async () => {
      const f = await fixture();
      await activity.update(f.owner, f.worldId, {
        clientId: randomUUID(),
        sequence: 1,
        mode: 'browsing',
        resume: true,
      });
      await pendingDirector(f);
      const before = await probe(f),
        lease = await dispatch(f);
      await admin.query("UPDATE parallel_life.tasks SET status='unknown' WHERE id=$1", [lease.id]);
      assert.deepEqual(await candidates(f), []);
      assert.deepEqual(await probe(f), before);
      const h = harness();
      await h.service.advanceIfEnabled(f.owner, f.worldId).catch(() => {});
      assert.equal(h.calls(), 0);
      assert.equal(
        (await admin.query('SELECT status FROM parallel_life.tasks WHERE id=$1', [lease.id]))
          .rows[0].status,
        'unknown',
      );
    },
  );
});
