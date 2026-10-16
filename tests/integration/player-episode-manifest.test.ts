import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { WorldDirectorAgentModel } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { ModelMessage } from '../../src/modules/ai/application/ports.ts';
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import {
  createEpisodeRequestsInTransaction,
  readPendingEpisodeRequestsInTransaction,
} from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { forgetMemoryInStore } from '../../src/modules/memory/infrastructure/memory-store.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { readNativeAgentSnapshot } from '../../src/modules/world/infrastructure/agent-channel-snapshot.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { MemoryRepository } from '../../src/modules/memory/infrastructure/memory-repository.ts';
import type { AgentInputReceipt } from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentAttemptStore } from '../../src/modules/world/application/agent-runtime-ports.ts';
test('player chat considers a server-bound pending episode without extra NPC calls', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.PLAYER_EPISODE_MANIFEST_TEST_PORT ?? 55576));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  class LocalPublisher extends PostgresDatabase {
    override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
      return super.transaction(owner, async (sql) => {
        await sql.query('SET LOCAL ROLE pl_publisher');
        return run(sql);
      });
    }
  }
  const pub = new LocalPublisher(
    `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await app.close();
      await pub.close();
      await admin.end();
    }
  });
  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, 'Only local authored eligibility SQL fixtures'],
  );
  // Reviewer evidence must be stable across check/publish. No provider, no production review claim.
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_AUTHORED_SEMANTIC_WAKE_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: reviewReceipt },
      };
    },
  });
  const compiler: PublicationWorldCompilerPort = {
    prepare(input) {
      const r = compilePublicationGenesis({
        ...input,
        originKind: input.originKind === 'trial' ? 'trial' : 'published',
        newId: randomUUID,
      });
      assert.equal(r.status, 'compiled');
      if (r.status !== 'compiled') throw Error('EXPLICIT_FIXTURE_COMPILER_FAILED');
      return {
        world: r.world,
        opening: r.opening,
        seed: {
          id: input.seedId,
          createdAt: new Date().toISOString(),
          source: {
            kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
            ...input.origin,
          },
          identity: r.opening.identity,
          situation: r.opening.situation,
          setting: r.opening.setting,
          experienceNote: r.opening.experienceNote,
        },
      };
    },
  };
  const published = new PublicationWorldRepository(app, compiler),
    worlds = new PostgresWorldRepository(app);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  const time = (h: number, m = 0, s = 0) =>
    `2026-10-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
  base.world.startAt = time(9);
  const secret = 'ACTOR_A_ONLY_TYPED_SUGGESTION_74';
  const prohibited = [
    'GLOBAL_SCRIPT_SECRET_74',
    'GLOBAL_EDITORIAL_SECRET_74',
    'GLOBAL_SCENE_SECRET_74',
    'GLOBAL_DESCRIPTION_SECRET_74',
    'GLOBAL_AUDIT_SECRET_74',
  ];
  const clocks = new PostgresClockStore(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app),
    actors = new PostgresAgentRuntimeRepository(app),
    kernel = new PostgresNpcAgentKernel(app, worlds);
  async function fixture(
    kind:
      | 'message'
      | 'invitation'
      | 'hidden_invitation'
      | 'multi_invitation'
      | 'editorial'
      | 'improvised'
      | 'known' = 'message',
  ) {
    const content = structuredClone(base);
    content.history = [];
    content.initialKnowledge = [];
    const intent = ['invitation', 'hidden_invitation', 'multi_invitation'].includes(kind)
      ? {
          kind: 'offer_invitation',
          actorKeys:
            kind === 'multi_invitation'
              ? content.actors.map((a: { key: string }) => a.key)
              : [content.actors[0].key],
          placeKey: kind === 'hidden_invitation' ? 'hidden' : 'shop',
          title: 'LOCAL_INVITATION_74',
          earliestAt: '2026-10-13T09:00:00.000Z',
        }
      : kind === 'message'
        ? { kind: 'offer_message', actorKey: content.actors[0].key, text: secret }
        : { kind: 'editorial_only' };
    content.candidates = [
      {
        key: 'typed_offer',
        kind: 'candidate',
        title: 'Local typed author offer',
        editorialIntent: prohibited[1],
        script: prohibited[0],
        sceneText: prohibited[2],
        actorKeys: content.actors.map((a: { key: string }) => a.key),
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent,
      },
    ];
    if (kind === 'invitation' || kind === 'hidden_invitation')
      content.candidates[0].actorKeys = [content.actors[0].key];
    content.candidates.push({
      ...content.candidates[0],
      key: 'opening',
      intent: { kind: 'director_event' },
      actorKeys: [],
    });
    content.openingEventKey = 'opening';
    if (kind === 'hidden_invitation') {
      content.places.push({
        key: 'hidden',
        name: 'HIDDEN_PLACE_SENTINEL_74',
        description: 'Unrevealed',
        knownAtStart: false,
      });
      content.candidates[0].placeKey = 'hidden';
    }
    const parsed = PublishedWorldContentSchema.parse(content);
    const work = await stableWorks.create(staff, {
      commandId: randomUUID(),
      title: 'Explicit local actor intent fixture',
      content: parsed,
    });
    const check = await stableWorks.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
    });
    assert.equal(check.status, 'ready');
    await stableWorks.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: check.id,
    });
    const owner = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    const { worldId: id } = await published.startPublished(owner, work.id, {
      commandId: randomUUID(),
      publicationVersion: 1,
    });
    owned.push({ owner, id });
    const world = await worlds.get({ userId: owner }, id);
    await app.transaction(owner, async (sql) => {
      for (const a of world.actors) {
        const initial = emptyActorAgentState(
          { worldId: id, actorId: a.id },
          agentDefinitionRef(world, a.id),
          0,
        );
        if (kind === 'known')
          initial.goals.push({
            id: 'existing_goal',
            summary: 'MY_EXISTING_GOAL_' + a.id,
            status: 'active',
            sourceIds: ['definition:' + initial.definitionRef],
            resultIds: [],
          });
        await initializeActorAgentStateInTransaction(sql, owner, initial);
      }
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
    });
    await clocks.write(owner, id, {
      storyNow: world.time,
      paused: false,
      speed: 0,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const snapshot = await snapshots.read(owner, {
      worldId: id,
      engineEpoch: 2,
      worldVersion: 0,
      candidates: [],
      blockers: [],
    });
    let calls = 0;
    const decision = await runDirectorAgent(
      {
        attempts: directors,
        parse: parseDirectorDecision,
        model: new WorldDirectorAgentModel({
          async complete(messages) {
            calls++;
            const p = JSON.parse(messages[1]!.content);
            const m = p.authoredMaterials.materials.find(
              (m: { ref: { nodeKey: string } }) => m.ref.nodeKey === 'typed_offer',
            );
            return JSON.stringify({
              mode: 'bounded_opportunity',
              selectedCandidateIds: [],
              deferred: [],
              nudges: [],
              opportunities: [
                {
                  id: randomUUID(),
                  title: 'Local opportunity',
                  description: prohibited[3],
                  playerImpact: 'Optional',
                  participantActorIds:
                    kind === 'invitation' || kind === 'hidden_invitation'
                      ? [world.actors[0]!.id]
                      : world.actors.map((a) => a.id),
                  placeIds: [],
                  activity: 'conversation',
                  basisSourceIds: ['improvised', 'known'].includes(kind)
                    ? [`genesis:${id}`]
                    : [m.sourceId],
                  ...(['improvised', 'known'].includes(kind)
                    ? {}
                    : { authoredEventKey: 'typed_offer' }),
                  ...(kind === 'known'
                    ? {
                        actorTopics: world.actors.map((a) => ({
                          actorId: a.id,
                          refs: p.actorKnownTopics
                            .filter((topic: { actorId: string }) => topic.actorId === a.id)
                            .map((topic: { id: string; contentHash: string }) => ({
                              id: topic.id,
                              contentHash: topic.contentHash,
                            })),
                        })),
                      }
                    : {}),
                },
              ],
              audit: { reason: prohibited[4], basisSourceIds: [] },
            });
          },
        }),
      },
      owner,
      {
        id: randomUUID(),
        worldId: id,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: 0,
        inputHash: directorSnapshotInputHash(snapshot),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    assert.equal(calls, 1);
    const requests = await app.transaction(owner, (sql) =>
      createEpisodeRequestsInTransaction(sql, owner, { worldId: id, engineEpoch: 2, decision }),
    );
    assert.equal(requests.length, kind === 'invitation' || kind === 'hidden_invitation' ? 1 : 2);
    return { owner, id, world, requests };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Manifest = {
    schemaVersion: 1;
    requestId: string;
    episodeId: string;
    actorId: string;
    engineEpoch: number;
    createdAtVersion: number;
    requestRevision: 0;
    sourceId: string;
    contentHash: string;
  };
  const requestState = async (f: Fixture) =>
    (
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'SELECT status,input_receipt_id,receipt_id FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND id=$2',
          [f.id, f.requests[0]!.id],
        ),
      )
    ).rows[0];
  const plain = () => ({
    statements: [{ text: 'I heard your actual question.', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  });
  const command = async (f: Fixture, text: string, actorId = f.requests[0]!.actorId) => ({
    id: randomUUID(),
    worldId: f.id,
    actorId,
    expectedVersion: (await worlds.get({ userId: f.owner }, f.id)).version,
    text,
  });
  function verifyManifest(f: Fixture, p: any): Manifest {
    assert.equal(p.input.origin, 'player');
    assert.equal(p.channel.kind, 'private');
    const m = p.episodeManifest as Manifest;
    assert.ok(m);
    assert.equal(m.schemaVersion, 1);
    assert.equal(m.requestRevision, 0);
    assert.equal(m.engineEpoch, 2);
    assert.equal(m.requestId, f.requests[0]!.id);
    assert.equal(m.episodeId, f.requests[0]!.episodeId);
    assert.equal(m.actorId, f.requests[0]!.actorId);
    assert.equal(m.createdAtVersion, f.requests[0]!.createdAtVersion);
    assert.match(m.contentHash, /^[a-f0-9]{64}$/);
    assert.ok(p.observations.some((o: any) => o.sourceId === m.sourceId));
    for (const sentinel of prohibited) assert.ok(!JSON.stringify(p).includes(sentinel));
    return m;
  }
  await t.test(
    'ordinary player input and explicit actor choice share one NPC call and original receipt',
    async () => {
      const f = await fixture('invitation'),
        c = await command(f, '请先回答我的问题，再考虑你自己的安排。');
      let calls = 0;
      let inputId = '';
      const service = npcAgentServices(app, () => ({
        async complete(messages) {
          calls++;
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          assert.equal(p.input.text, c.text);
          inputId = p.input.sourceId;
          const manifest = verifyManifest(f, p);
          return JSON.stringify({
            ...plain(),
            episodeDecision: {
              requestId: manifest.requestId,
              choice: 'engage',
              reason: 'My own considered decision',
              sourceIds: [p.input.sourceId, manifest.sourceId],
            },
          });
        },
      }));
      const result = await service.sendMessageIfEnabled(f.owner, c);
      assert.equal(result?.status, 'committed');
      assert.equal(calls, 1);
      const r = await requestState(f);
      assert.equal(r.status, 'consumed');
      assert.equal(r.input_receipt_id, inputId);
      assert.ok(r.receipt_id);
      const saved = (
        await app.transaction(f.owner, (sql) =>
          sql.query(
            'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND id=$2',
            [f.id, inputId],
          ),
        )
      ).rows[0].document;
      assert.equal(saved.origin, 'player');
      assert.equal(saved.text, c.text);
      const receipt = (
        await app.transaction(f.owner, (sql) =>
          sql.query(
            'SELECT choice,input_receipt_id FROM parallel_life.agent_episode_receipts WHERE world_id=$1 AND request_id=$2',
            [f.id, f.requests[0]!.id],
          ),
        )
      ).rows;
      assert.equal(receipt.length, 1);
      assert.equal(receipt[0].choice, 'engage');
      assert.equal(receipt[0].input_receipt_id, inputId);
      await service.sendMessageIfEnabled(f.owner, c);
      assert.equal(calls, 1, 'committed replay cannot purchase another NPC reply');
    },
  );
  await t.test(
    'omitted event decision preserves pending, prevents background recontact, and allows new player turn',
    async () => {
      const f = await fixture('invitation');
      let calls = 0;
      let manifestId = '';
      const service = npcAgentServices(app, () => ({
        async complete(messages) {
          calls++;
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          const manifest = verifyManifest(f, p);
          manifestId = manifest.requestId;
          return JSON.stringify(plain());
        },
      }));
      const first = await command(f, '今天天气怎么样？');
      await service.sendMessageIfEnabled(f.owner, first);
      assert.equal(calls, 1);
      assert.equal((await requestState(f)).status, 'pending');
      const { dispatchPendingAgentEpisode } =
        await import('../../src/server/npc-agent-episode-dispatch.ts');
      let backgroundCalls = 0;
      const world = await worlds.get({ userId: f.owner }, f.id);
      const dispatched = await dispatchPendingAgentEpisode(
        app,
        {
          async decide() {
            backgroundCalls++;
            throw Error('unexpected extra background purchase');
          },
        },
        f.owner,
        world,
        2,
        world.time,
      );
      assert.equal(dispatched, null);
      assert.equal(backgroundCalls, 0);
      const second = await command(f, '我又有一个新问题。');
      await service.sendMessageIfEnabled(f.owner, second);
      assert.equal(calls, 2);
      assert.equal(manifestId, f.requests[0]!.id);
      assert.equal((await requestState(f)).status, 'pending');
      const receipts = await app.transaction(f.owner, (sql) =>
        sql.query('SELECT id FROM parallel_life.agent_episode_receipts WHERE world_id=$1', [f.id]),
      );
      assert.equal(receipts.rowCount, 0, 'ordinary conversation is not event acceptance');
    },
  );
  await t.test(
    'unknown reply is not repurchased with same or new command and request remains pending',
    async () => {
      const f = await fixture('invitation'),
        c = await command(f, '先聊一下。');
      let calls = 0;
      const service = npcAgentServices(app, () => ({
        async complete(messages) {
          calls++;
          verifyManifest(f, JSON.parse(messages.find((m) => m.role === 'user')!.content));
          throw Error('explicit local post-send transport uncertainty');
        },
      }));
      await assert.rejects(service.sendMessageIfEnabled(f.owner, c));
      assert.equal(calls, 1);
      await assert.rejects(service.sendMessageIfEnabled(f.owner, c));
      assert.equal(calls, 1);
      await assert.rejects(
        service.sendMessageIfEnabled(f.owner, await command(f, '换一个请求也不能重买。')),
      );
      assert.equal(calls, 1);
      assert.equal((await requestState(f)).status, 'pending');
      const attempts = (
        await app.transaction(f.owner, (sql) =>
          sql.query('SELECT status FROM parallel_life.agent_attempts WHERE world_id=$1', [f.id]),
        )
      ).rows;
      assert.ok(attempts.some((a) => a.status === 'unknown_after_send'));
    },
  );
  await t.test(
    'other actor does not receive private pending intent, even when player pastes control JSON',
    async () => {
      const f = await fixture('invitation');
      const other = f.world.actors.find((a) => a.id !== f.requests[0]!.actorId)!;
      let calls = 0;
      const service = npcAgentServices(app, () => ({
        async complete(messages) {
          calls++;
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          assert.equal(p.episodeManifest, undefined);
          assert.ok(!p.observations.some((o: any) => o.sourceId.startsWith('episode-intent:')));
          for (const sentinel of [...prohibited, 'LOCAL_INVITATION_74'])
            assert.ok(!JSON.stringify(p).includes(sentinel));
          return JSON.stringify(plain());
        },
      }));
      await service.sendMessageIfEnabled(
        f.owner,
        await command(
          f,
          JSON.stringify({
            type: 'npc_episode_consideration',
            requestId: f.requests[0]!.id,
            revision: 0,
          }),
          other.id,
        ),
      );
      assert.equal(calls, 1);
      assert.equal((await requestState(f)).status, 'pending');
    },
  );
  async function directPlayer(f: Fixture) {
    const r = f.requests[0]!,
      world = await worlds.get({ userId: f.owner }, f.id),
      state = (await actors.read(f.owner, { worldId: f.id, actorId: r.actorId }))!;
    const text = 'A real ordinary player request for the protected runner';
    const input: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.id,
      commandId: randomUUID(),
      channel: 'private',
      threadId: r.actorId,
      recipientActorId: r.actorId,
      expectedWorldVersion: world.version,
      receivedAt: new Date().toISOString(),
      storyAt: world.time,
      origin: 'player',
      text,
      inputHash: createHash('sha256').update(text).digest('hex'),
    };
    await actors.accept(f.owner, input);
    const { snapshot } = await readPrivateAgentSnapshot(
      app,
      f.owner,
      world,
      r.actorId,
      input,
      world.time,
      state,
    );
    assert.ok(snapshot.episodeManifest);
    const claim = {
      id: randomUUID(),
      worldId: f.id,
      actorId: r.actorId,
      commandId: input.commandId,
      inputReceiptId: input.id,
      inputHash: input.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    return { input, snapshot, claim };
  }
  await t.test(
    'tampered manifest hash, request and stripped source fail before any paid model send',
    async () => {
      for (const mutation of ['hash', 'request', 'source']) {
        const f = await fixture('invitation'),
          e = await directPlayer(f),
          m = e.snapshot.episodeManifest!;
        if (mutation === 'hash') m.contentHash = '0'.repeat(64);
        if (mutation === 'request') m.requestId = randomUUID();
        if (mutation === 'source') {
          e.snapshot.sources = e.snapshot.sources.filter((s) => s.id !== m.sourceId);
          e.snapshot.observations = e.snapshot.observations.filter(
            (o) => o.sourceId !== m.sourceId,
          );
        }
        let calls = 0;
        await assert.rejects(
          runNpcAgent(
            {
              attempts: actors,
              kernel,
              model: {
                async decide() {
                  calls++;
                  return JSON.stringify(plain());
                },
              },
            },
            f.owner,
            e.claim,
            e.snapshot,
          ),
        );
        assert.equal(calls, 0, mutation + ' must fail before the model');
        const attempts = (
          await app.transaction(f.owner, (sql) =>
            sql.query(
              'SELECT sent_at,response_hash FROM parallel_life.agent_attempts WHERE world_id=$1',
              [f.id],
            ),
          )
        ).rows;
        assert.ok(attempts.every((a) => a.sent_at === null && a.response_hash === null));
        assert.equal((await requestState(f)).status, 'pending');
      }
    },
  );
  await t.test(
    'received player response recovers its original manifest and consumes without a second model call',
    async () => {
      const f = await fixture('invitation'),
        e = await directPlayer(f),
        m = e.snapshot.episodeManifest!;
      let calls = 0;
      const local = {
        async decide() {
          calls++;
          return JSON.stringify({
            ...plain(),
            episodeDecision: {
              requestId: m.requestId,
              choice: 'engage',
              reason: 'My own decision from the original player frame',
              sourceIds: [e.input.id, m.sourceId],
            },
          });
        },
      };
      const failure = new PostgresNpcAgentKernel(app, worlds, async () => {
        throw Error('explicit local transaction storage failure');
      });
      await assert.rejects(
        runNpcAgent(
          { attempts: actors, kernel: failure, model: local },
          f.owner,
          e.claim,
          e.snapshot,
        ),
      );
      assert.equal(calls, 1);
      assert.equal(
        (await actors.lookup(f.owner, f.id, e.input.commandId))?.status,
        'response_received',
      );
      assert.equal((await requestState(f)).status, 'pending');
      await runNpcAgent({ attempts: actors, kernel, model: local }, f.owner, e.claim, null);
      assert.equal(calls, 1);
      assert.equal((await requestState(f)).status, 'consumed');
      assert.equal((await requestState(f)).input_receipt_id, e.input.id);
    },
  );
});
