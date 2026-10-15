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
test('actual bound author intents reach only their actor through protected NPC delivery', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.ACTOR_EPISODE_INTENT_TEST_PORT ?? 55505));
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
      | 'improvised' = 'message',
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
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId: id, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
        );
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
                  basisSourceIds: kind === 'improvised' ? [`genesis:${id}`] : [m.sourceId],
                  ...(kind === 'improvised' ? {} : { authoredEventKey: 'typed_offer' }),
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
  async function execution(f: Fixture, index = 0) {
    const r = f.requests[index]!;
    const world = await worlds.get({ userId: f.owner }, f.id),
      state = (await actors.read(f.owner, { worldId: f.id, actorId: r.actorId }))!;
    const text = JSON.stringify({
      type: 'npc_episode_consideration',
      requestId: r.id,
      revision: 0,
      activity: r.activity,
      placeOptionIds: [],
      basisSourceIds: [`definition:${state.definitionRef}`],
    });
    const input: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.id,
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
    const source = `episode-intent:${r.id}`;
    const proposal = {
      statements: [],
      goals: [
        {
          id: 'own_choice_74',
          summary: 'OWN_ACTOR_STRATEGY_74',
          status: 'active',
          sourceIds: [source],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
      episodeDecision: {
        requestId: r.id,
        choice: 'engage',
        reason: 'My own considered choice',
        sourceIds: [input.id, source],
      },
    };
    return { snapshot, claim, proposal, source, input, r };
  }
  type Execution = Awaited<ReturnType<typeof execution>>;
  const code = (expected: string) => (error: unknown) =>
    !!error && typeof error === 'object' && 'code' in error && error.code === expected;
  async function attempt(f: Fixture, e: Execution) {
    return (
      await admin.query('SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 AND id=$2', [
        f.id,
        e.claim.id,
      ])
    ).rows[0];
  }
  async function counts(f: Fixture) {
    const out: Record<string, unknown> = {};
    for (const table of [
      'world_events',
      'world_messages',
      'agent_episode_receipts',
      'agent_action_results',
      'actor_agent_states',
      'commands',
      'agent_episode_requests',
      'shared_episodes',
    ])
      out[table] = (
        await admin.query(
          `SELECT to_jsonb(x) AS row FROM parallel_life.${table} x WHERE world_id=$1 ORDER BY to_jsonb(x)::text`,
          [f.id],
        )
      ).rows;
    out.world = (
      await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [f.id])
    ).rows;
    return out;
  }
  function run(
    f: Fixture,
    e: Execution,
    complete: (messages: ModelMessage[]) => Promise<string>,
    store: AgentAttemptStore = actors,
  ) {
    return runNpcAgent(
      { attempts: store, kernel, model: new NpcAgentModel({ complete }) },
      f.owner,
      e.claim,
      e.snapshot,
    );
  }
  await t.test(
    'real bound message is addressed only to A; participant B never receives A intent or Director prose',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]);
      const a = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!,
        b = es.find((e) => !e.snapshot.sources.some((s) => s.id === e.source))!;
      assert.ok(a);
      assert.ok(b);
      assert.match(JSON.stringify(a.snapshot.observations), new RegExp(secret));
      assert.doesNotMatch(JSON.stringify(b.snapshot), new RegExp(secret));
      for (const e of es)
        for (const p of prohibited) assert.equal(JSON.stringify(e.snapshot).includes(p), false);
      let paid = 0;
      await run(f, a, async (messages) => {
        paid++;
        const body = messages[1]!.content;
        assert.ok(body.includes(secret));
        for (const p of prohibited) assert.equal(body.includes(p), false);
        return JSON.stringify(a.proposal);
      });
      assert.equal(paid, 1);
      const world = await worlds.get({ userId: f.owner }, f.id),
        state = (await actors.read(f.owner, { worldId: f.id, actorId: a.r.actorId }))!;
      const later = (
        await readPrivateAgentSnapshot(app, f.owner, world, a.r.actorId, null, world.time, state)
      ).snapshot;
      assert.ok(later.viewState.goals.some((g) => g.summary === 'OWN_ACTOR_STRATEGY_74'));
      assert.ok(later.sources.some((s) => s.id === a.source && s.usage === 'private_strategy'));
      assert.equal(JSON.stringify(later.observations).includes(secret), false);
      assert.equal((await attempt(f, a)).status, 'committed');
    },
  );
  await t.test(
    'actual advance dispatches durable requests into protected actor model and retains authored intent privacy',
    async () => {
      const f = await fixture();
      let npcCalls = 0;
      const service = npcAgentAdvanceServices(
        app,
        () => ({
          async complete(messages) {
            const p = JSON.parse(messages[1]!.content);
            assert.ok(p.input, 'pending delivery must run NPC rather than repurchase Director');
            npcCalls++;
            const text = messages[1]!.content;
            for (const forbidden of prohibited) assert.equal(text.includes(forbidden), false);
            const input = JSON.parse(p.input.text);
            assert.equal(input.type, 'npc_episode_consideration');
            const source = p.sources.find((s: { id: string }) =>
              s.id.startsWith('episode-intent:'),
            );
            if (source) assert.ok(text.includes(secret));
            else assert.equal(text.includes(secret), false);
            return JSON.stringify({
              statements: [],
              goals: [],
              plans: [],
              actions: [],
              responsibilities: [],
              decisions: [],
              episodeDecision: {
                requestId: input.requestId,
                choice: 'quiet',
                reason: 'Independent quiet choice',
                sourceIds: [p.input.sourceId],
              },
            });
          },
        }),
        snapshots,
      );
      await service.advanceIfEnabled(f.owner, f.id);
      await service.advanceIfEnabled(f.owner, f.id);
      assert.equal(npcCalls, 2);
      const pending = await app.transaction(f.owner, (sql) =>
        readPendingEpisodeRequestsInTransaction(sql, f.owner, { worldId: f.id, engineEpoch: 2 }),
      );
      assert.equal(pending.length, 0);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_episode_receipts WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'own committed intent strategy enters actual group snapshot without original suggestion or global prose',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
      await run(f, e, async () => JSON.stringify(e.proposal));
      const groups = new PostgresGroupRepository(app);
      let world = await worlds.get({ userId: f.owner }, f.id);
      const g = await groups.create(f.owner, {
        worldId: f.id,
        commandId: randomUUID(),
        expectedVersion: world.version,
        title: 'Local intent strategy group',
        actorIds: f.world.actors.map((a) => a.id),
      });
      world = await worlds.get({ userId: f.owner }, f.id);
      const commandId = randomUUID(),
        sent = await groups.send(f.owner, {
          worldId: f.id,
          commandId,
          expectedVersion: world.version,
          groupId: g.groupId,
          text: 'What are your own plans?',
        });
      try {
        const input = (
          await admin.query(
            'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
            [f.id, commandId],
          )
        ).rows[0].document as AgentInputReceipt;
        world = await worlds.get({ userId: f.owner }, f.id);
        const state = (await actors.read(f.owner, { worldId: f.id, actorId: e.r.actorId }))!,
          snapshot = await readNativeAgentSnapshot(
            app,
            f.owner,
            world,
            e.r.actorId,
            input,
            world.time,
            state,
          );
        assert.ok(snapshot.viewState.goals.some((g) => g.summary === 'OWN_ACTOR_STRATEGY_74'));
        assert.ok(
          snapshot.sources.some((s) => s.id === e.source && s.usage === 'private_strategy'),
        );
        let paid = 0;
        const native = {
          ...e,
          snapshot,
          claim: {
            ...e.claim,
            id: randomUUID(),
            commandId: randomUUID(),
            inputReceiptId: input.id,
            inputHash: input.inputHash,
            expectedWorldVersion: world.version,
            expectedActorRevision: state.revision,
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 120000).toISOString(),
          },
        };
        const result = await run(f, native, async (messages) => {
          paid++;
          assert.equal(messages[1]!.content.includes(secret), false);
          for (const forbidden of prohibited)
            assert.equal(messages[1]!.content.includes(forbidden), false);
          return JSON.stringify({
            statements: [{ text: 'I will choose my own next step.', dependsOnActionIds: [] }],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          });
        });
        assert.ok(result.eventId);
        assert.ok(result.state.goals.some((g) => g.summary === 'OWN_ACTOR_STRATEGY_74'));
        assert.equal(paid, 1);
      } finally {
        await new TaskRepository(app).cancel(f.owner, sent.task.id);
      }
    },
  );
  await t.test(
    'single actor invitation uses actual known place and preserves earliestAt without inventing a deadline',
    async () => {
      const f = await fixture('invitation'),
        e = await execution(f);
      const o = e.snapshot.observations.find((o) => o.sourceId === e.source)!;
      assert.ok(o);
      assert.equal(o.kind, 'plan');
      const d = JSON.parse(o.text.slice(o.text.indexOf('{')));
      assert.equal(d.kind, 'invitation_suggestion');
      assert.equal(d.earliestAt, '2026-10-13T09:00:00.000Z');
      assert.ok(d.placeId);
      assert.ok(d.placeName);
      assert.equal('deadline' in d, false);
      assert.equal('expiresAt' in d, false);
      const result = await run(f, e, async () => JSON.stringify(e.proposal));
      assert.ok(result.eventId);
    },
  );
  for (const kind of ['hidden_invitation'] as const)
    await t.test(`${kind} never infers a supported addressed invitation`, async () => {
      const f = await fixture(kind);
      for (let i = 0; i < f.requests.length; i++) {
        const e = await execution(f, i);
        assert.equal(
          e.snapshot.sources.some((s) => s.id.startsWith('episode-intent:')),
          false,
        );
        assert.equal(JSON.stringify(e.snapshot).includes('LOCAL_INVITATION_74'), false);
        assert.equal(JSON.stringify(e.snapshot).includes('HIDDEN_PLACE_SENTINEL_74'), false);
      }
    });
  await t.test(
    'actual publication compiler refuses multi actor invitation instead of inferring a single actor',
    async () => {
      await assert.rejects(fixture('multi_invitation'), code('INVALID_STATE'));
    },
  );
  for (const kind of ['editorial', 'improvised'] as const)
    await t.test(`${kind} request does not disclose global prose`, async () => {
      const f = await fixture(kind),
        e = await execution(f);
      assert.equal(
        e.snapshot.sources.some((s) => s.id.startsWith('episode-intent:')),
        false,
      );
      for (const p of prohibited) assert.equal(JSON.stringify(e.snapshot).includes(p), false);
    });
  for (const mutation of [
    'hash',
    'actor',
    'request',
    'body',
    'fact',
    'private_strategy',
    'state',
  ] as const)
    await t.test(
      `pre-send authoritative gate rejects ${mutation} tampering with zero model calls`,
      async () => {
        const f = await fixture(),
          es = await Promise.all([execution(f, 0), execution(f, 1)]),
          e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
        const s = e.snapshot.sources.find((s) => s.id === e.source)!,
          o = e.snapshot.observations.find((o) => o.sourceId === e.source)!;
        if (mutation === 'hash') s.contentHash = '0'.repeat(64);
        if (mutation === 'actor') {
          const foreign = `episode-intent:${es.find((v) => v !== e)!.r.id}`;
          s.id = foreign;
          o.sourceId = foreign;
        }
        if (mutation === 'request') s.recordId = randomUUID();
        if (mutation === 'body') o.text = 'MALICIOUS_REPLACEMENT';
        if (mutation === 'fact') o.kind = 'fact';
        if (mutation === 'private_strategy') {
          s.usage = 'private_strategy';
          o.text = '此来源支持本人已保存的目标、计划或决定；原私聊不在本次上下文中。';
        }
        if (mutation === 'state')
          e.snapshot.state.goals.push({
            id: 'forged',
            summary: 'forged',
            status: 'active',
            sourceIds: [e.source],
            resultIds: [],
          });
        let paid = 0;
        const before = await counts(f);
        await assert.rejects(
          run(f, e, async () => {
            paid++;
            return JSON.stringify(e.proposal);
          }),
          code('AGENT_REVISION_CONFLICT'),
        );
        assert.equal(paid, 0);
        const a = await attempt(f, e);
        assert.equal(a.sent_at, null);
        assert.equal(a.response_hash, null);
        assert.equal(a.status, 'stale_discarded');
        assert.deepEqual(await counts(f), before);
      },
    );
  for (const mutation of ['remove_all', 'remove_observation', 'replace_type'] as const)
    await t.test(`mandatory author gate rejects ${mutation} before payment`, async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
      e.snapshot.observations = e.snapshot.observations.filter((o) => o.sourceId !== e.source);
      if (mutation !== 'remove_observation')
        e.snapshot.sources = e.snapshot.sources.filter((s) => s.id !== e.source);
      if (mutation === 'replace_type')
        e.snapshot.input.text = JSON.stringify({
          type: 'npc_own_condition_ready',
          basisSourceIds: [e.input.id],
        });
      let paid = 0;
      const before = await counts(f);
      await assert.rejects(
        run(f, e, async () => {
          paid++;
          return JSON.stringify(e.proposal);
        }),
        code(mutation === 'replace_type' ? 'INPUT_SCOPE_FORBIDDEN' : 'AGENT_REVISION_CONFLICT'),
      );
      assert.equal(paid, 0);
      assert.equal((await attempt(f, e)).sent_at, null);
      assert.deepEqual(await counts(f), before);
    });
  await t.test(
    'direct ordinary request_sent cannot bypass canonical episode receipt source gate',
    async () => {
      const f = await fixture(),
        e = await execution(f);
      const { attempt: a } = await actors.claim(f.owner, e.claim);
      await assert.rejects(actors.mark(f.owner, a, 'request_sent'), code('INPUT_SCOPE_FORBIDDEN'));
      const row = await attempt(f, e);
      assert.equal(row.status, 'reserved');
      assert.equal(row.sent_at, null);
      assert.equal(row.response_hash, null);
      await actors.mark(f.owner, a, 'cancelled_before_send');
    },
  );
  await t.test(
    'owner RLS and worker permissions cannot send another actor intent; canonical rows remain unsent',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!,
        { attempt: a } = await actors.claim(f.owner, e.claim),
        stranger = randomUUID();
      await new IdentityRepository(app).ensureGuest(stranger);
      await assert.rejects(
        actors.markRequestSentWithSources(stranger, a, e.snapshot),
        code('NOT_FOUND'),
      );
      const worker = new PostgresDatabase(
        `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      );
      try {
        await assert.rejects(
          new PostgresAgentRuntimeRepository(worker).markRequestSentWithSources(
            f.owner,
            a,
            e.snapshot,
          ),
          code('NOT_FOUND'),
        );
      } finally {
        await worker.close();
      }
      const row = await attempt(f, e);
      assert.equal(row.sent_at, null);
      assert.equal(row.response_hash, null);
      await actors.mark(f.owner, a, 'cancelled_before_send');
    },
  );
  await t.test(
    'another actually committed actor receipt invalidates the old world frame before an author intent is paid',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!,
        other = es.find((v) => v !== e)!;
      const p = {
        ...other.proposal,
        goals: [],
        episodeDecision: {
          ...other.proposal.episodeDecision,
          choice: 'quiet',
          sourceIds: [other.input.id],
        },
      };
      await run(f, other, async () => JSON.stringify(p));
      let paid = 0;
      const before = await counts(f);
      await assert.rejects(
        run(f, e, async () => {
          paid++;
          return JSON.stringify(e.proposal);
        }),
        code('VERSION_CONFLICT'),
      );
      assert.equal(paid, 0);
      assert.equal(await attempt(f, e), undefined);
      assert.deepEqual(await counts(f), before);
    },
  );
  await t.test(
    'a store without source gate cannot send; protected author source cannot be trimmed for budget',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
      const noGate: AgentAttemptStore = {
        lookup: actors.lookup.bind(actors),
        claim: actors.claim.bind(actors),
        mark: actors.mark.bind(actors),
        saveResponse: actors.saveResponse.bind(actors),
        readResponse: actors.readResponse.bind(actors),
      };
      let paid = 0;
      await assert.rejects(
        run(
          f,
          e,
          async () => {
            paid++;
            return '{}';
          },
          noGate,
        ),
        code('INPUT_SCOPE_FORBIDDEN'),
      );
      assert.equal(paid, 0);
      assert.equal((await attempt(f, e)).sent_at, null);
      const f2 = await fixture(),
        es2 = await Promise.all([execution(f2, 0), execution(f2, 1)]),
        e2 = es2.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
      e2.snapshot.observations.find((o) => o.sourceId === e2.source)!.text += 'x'.repeat(40000);
      await assert.rejects(
        run(f2, e2, async () => {
          paid++;
          return '{}';
        }),
        /NPC_AGENT_SNAPSHOT_LIMIT/,
      );
      assert.equal(paid, 0);
      assert.equal(await attempt(f2, e2), undefined);
    },
  );
  await t.test(
    'actual forget while paid response is in flight rejects final commit and stable identity cannot buy again',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
      let paid = 0;
      const before = await counts(f);
      await assert.rejects(
        run(f, e, async () => {
          paid++;
          const memory = await new MemoryRepository(app).create(f.owner, {
            id: randomUUID(),
            ownerId: f.owner,
            scopeType: 'character',
            scopeId: e.r.actorId,
            branchId: f.id,
            characterId: e.r.actorId,
            text: 'Own optional suggestion belief',
            key: 'intent_74',
            kind: 'belief',
            sourceType: 'agent_inference',
            sourceIds: [e.source],
            status: 'active',
            importance: 5,
            createdAt: new Date().toISOString(),
          });
          await app.transaction(f.owner, (sql) =>
            forgetMemoryInStore(sql, {
              ownerId: f.owner,
              targetMemoryId: memory.id,
              playerVisibleOnly: false,
            }),
          );
          return JSON.stringify(e.proposal);
        }),
        code('AGENT_REVISION_CONFLICT'),
      );
      assert.equal(paid, 1);
      const a = await attempt(f, e);
      assert.equal(a.status, 'stale_discarded');
      assert.ok(a.sent_at);
      assert.ok(a.response_hash);
      assert.deepEqual(await counts(f), before);
      await assert.rejects(
        run(f, e, async () => {
          paid++;
          return '{}';
        }),
        code('ATTEMPT_STALE'),
      );
      assert.equal(paid, 1);
    },
  );
  await t.test(
    'unknown paid transport remains fenced under original command without actor progress',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
      let paid = 0;
      const before = await counts(f);
      await assert.rejects(
        run(f, e, async () => {
          paid++;
          throw Error('EXPLICIT_LOCAL_TRANSPORT_UNKNOWN');
        }),
        /EXPLICIT_LOCAL_TRANSPORT_UNKNOWN/,
      );
      assert.equal((await attempt(f, e)).status, 'unknown_after_send');
      assert.deepEqual(await counts(f), before);
      await assert.rejects(
        run(f, e, async () => {
          paid++;
          return '{}';
        }),
        code('ATTEMPT_UNKNOWN'),
      );
      assert.equal(paid, 1);
    },
  );
  for (const prior of ['consumed', 'paid_invalid'] as const)
    await t.test(
      `${prior} request cannot be renamed to buy another author-intent response`,
      async () => {
        const f = await fixture(),
          es = await Promise.all([execution(f, 0), execution(f, 1)]),
          first = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!,
          index = f.requests.findIndex((r) => r.id === first.r.id);
        let paid = 0;
        if (prior === 'consumed')
          await run(f, first, async () => {
            paid++;
            return JSON.stringify(first.proposal);
          });
        else
          await assert.rejects(
            run(f, first, async () => {
              paid++;
              return 'EXPLICIT_LOCAL_INVALID_JSON';
            }),
            code('INVALID_AGENT_PROPOSAL'),
          );
        const original = await attempt(f, first);
        assert.ok(original.sent_at);
        assert.ok(original.response_hash);
        assert.equal(original.status, prior === 'consumed' ? 'committed' : 'invalid_output');
        const row = (
          await admin.query(
            'SELECT status,input_receipt_id FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND id=$2',
            [f.id, first.r.id],
          )
        ).rows[0];
        assert.equal(row.status, prior === 'consumed' ? 'consumed' : 'pending');
        const renamed = await execution(f, index),
          before = await counts(f);
        await assert.rejects(
          run(f, renamed, async () => {
            paid++;
            return JSON.stringify(renamed.proposal);
          }),
          code('INPUT_SCOPE_FORBIDDEN'),
        );
        assert.equal(paid, 1);
        const denied = await attempt(f, renamed);
        assert.equal(denied.sent_at, null);
        assert.equal(denied.response_hash, null);
        assert.deepEqual(await counts(f), before);
        assert.equal((await attempt(f, first)).response_hash, original.response_hash);
      },
    );
  await t.test(
    'late actual SQL receipt failure rolls back everything and recovers saved raw without second model request',
    async () => {
      const f = await fixture(),
        es = await Promise.all([execution(f, 0), execution(f, 1)]),
        e = es.find((e) => e.snapshot.sources.some((s) => s.id === e.source))!;
      let paid = 0;
      const before = await counts(f),
        name = `intent74_${randomUUID().replaceAll('-', '')}`;
      await admin.query(
        `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'EXPLICIT_LOCAL_LATE_RECEIPT'; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.agent_episode_receipts FOR EACH ROW WHEN (NEW.world_id='${f.id}') EXECUTE FUNCTION parallel_life.${name}()`,
      );
      try {
        await assert.rejects(
          run(f, e, async () => {
            paid++;
            return JSON.stringify(e.proposal);
          }),
          /EXPLICIT_LOCAL_LATE_RECEIPT/,
        );
        assert.equal((await attempt(f, e)).status, 'response_received');
        assert.deepEqual(await counts(f), before);
      } finally {
        await admin.query(`DROP TRIGGER ${name} ON parallel_life.agent_episode_receipts`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
      }
      const raw = (await attempt(f, e)).response_hash;
      const receipt = await run(f, e, async () => {
        paid++;
        return '{}';
      });
      assert.ok(receipt.eventId);
      assert.equal(paid, 1);
      assert.equal((await attempt(f, e)).response_hash, raw);
      assert.equal((await attempt(f, e)).status, 'committed');
      await run(f, e, async () => {
        paid++;
        return '{}';
      });
      assert.equal(paid, 1);
    },
  );
});
