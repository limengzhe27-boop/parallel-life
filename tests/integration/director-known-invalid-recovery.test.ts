import { revalidateDirectorHandoff } from '../../src/modules/world/domain/director-handoff-revalidation.ts';
import {
  directorWireCatalog,
  directorOpeningOwnerCatalog,
} from '../../src/modules/world/infrastructure/director-model-protocol.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { readActorStrategyBasis } from '../../src/modules/world/infrastructure/agent-source-resolver.ts';
import { migrateLegacyWorldInTransaction } from '../../src/modules/world/infrastructure/legacy-world-migration.ts';
import { readAgentPhoneEntryProbe } from '../../src/modules/world/infrastructure/agent-phone-entry-probe.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { readDirectorNarrativeWakeInTransaction } from '../../src/modules/world/infrastructure/narrative-wake-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';
test('known invalid complete authored handoff recovers via immutable revalidation receipt without model repurchase', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_KNOWN_RECOVERY_TEST_PORT ?? 55684));
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
  base.actors.forEach((actor: any, index: number) => {
    actor.lifeModules = {
      lifeContext: `ACTOR_BACKGROUND_${index}`,
      traits: `ACTOR_TRAITS_${index}`,
    };
  });
  base.places.push({
    key: 'away',
    name: '合成另一处小店',
    description: '只供实际旅行测试',
    knownAtStart: true,
  });
  base.routes = [
    { fromPlaceKey: 'shop', toPlaceKey: 'away', minutes: 5 },
    { fromPlaceKey: 'away', toPlaceKey: 'shop', minutes: 5 },
  ];
  base.history = [
    {
      key: 'anchor',
      kind: 'established_fact',
      text: '真实绑定的合成起点历史',
      occurredAt: '2026-10-11T09:00:00.000Z',
      actorKeys: [base.actors[0].key],
      visibility: { kind: 'world' },
    },
  ];
  base.initialKnowledge = [{ actorKey: base.actors[0].key, factKeys: ['anchor'] }];
  base.timeline = {
    initialStageKey: 'day',
    stages: [
      {
        key: 'day',
        title: '原稿一天',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: time(9), expiresAt: '2026-10-13T09:00:00.000Z' },
      },
    ],
  };
  base.conditions = [
    {
      key: 'alternative_evidence',
      title: '地点或既有事实',
      match: 'any',
      prerequisites: [
        { kind: 'at_place', placeKey: 'away' },
        { kind: 'history_fact', factKey: 'anchor' },
      ],
    },
  ];
  const node = (key: string, prerequisites: unknown[] = [], extra = {}) => ({
    key,
    kind: 'candidate',
    title: '合成候选_' + key,
    editorialIntent:
      'AUTHOR_GLOBAL_MANUSCRIPT_NOT_FOR_NPC. Future interaction; not an established fact.',
    actorKeys: [base.actors[0].key],
    prerequisites,
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'director_event' },
    timeline: {
      stageKey: 'day',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
    ...extra,
  });
  base.candidates = [
    node('always', [], { actorKeys: base.actors.map((actor: any) => actor.key) }),
    node('a', [{ kind: 'not_before', at: time(9) }], {
      timeline: {
        stageKey: 'day',
        window: { notBefore: time(9), expiresAt: time(11) },
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    }),
    node('b', [{ kind: 'not_before', at: time(12) }]),
  ];
  base.openingEventKey = 'always';
  base.phone.messages = base.actors.map((actor: any, index: number) => ({
    key: 'own_history_' + index,
    actorKey: actor.key,
    origin: 'history',
    speaker: 'actor',
    text: 'PRIVATE_GENESIS_HISTORY_' + index,
    at: '2026-10-11T08:00:00.000Z',
  }));

  const clocks = new PostgresClockStore(app),
    activity = new PostgresClockActivityRepository(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app),
    space = new PostgresWorldSpace(app, {
      list() {
        return [];
      },
      get() {
        return undefined;
      },
    });
  async function fixture(
    options: { admit?: boolean; proof?: boolean; multi?: boolean; legacy?: boolean } = {},
  ) {
    const content = structuredClone(base);
    if (options.proof)
      content.candidates.push(node('fallback', [], { conditionKeys: ['alternative_evidence'] }));
    if (options.multi)
      for (const key of ['aa', 'a_b'])
        content.candidates.push(node(key, [{ kind: 'not_before', at: time(10) }]));
    const parsed = PublishedWorldContentSchema.parse(content),
      work = await stableWorks.create(staff, {
        commandId: randomUUID(),
        title: 'Only local semantic wake publication',
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
    const started = await published.startPublished(owner, work.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      }),
      id = started.worldId;
    owned.push({ owner, id });
    const world = await worlds.get({ userId: owner }, id);
    await app.transaction(owner, async (sql) => {
      if (options.legacy) {
        await migrateLegacyWorldInTransaction(sql, owner, {
          worldId: id,
          expectedWorldVersion: world.version,
        });
        return;
      }
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
      if (options.admit !== false)
        await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
    });
    await clocks.setClock(owner, id, { paused: false, speed: 1 });
    const initialFrame = await snapshots.read(owner, {
      worldId: id,
      engineEpoch: 2,
      worldVersion: 0,
      candidates: [],
      blockers: [],
    });
    if (initialFrame.openingContextAuthority) {
      const catalog = directorWireCatalog(initialFrame),
        owners = directorOpeningOwnerCatalog(initialFrame);
      const raw = JSON.stringify({
        protocol: 'director-wire-v14',
        openingContext: {
          informationOwners: Object.fromEntries(
            owners.information.map((i) => [
              i.ref,
              { actorRef: null, reason: '合成设定，不额外建立人物知情' },
            ]),
          ),
        },
        authoredChoices: Object.fromEntries(
          catalog.events.map((e) => [e.ref, { kind: 'defer', reason: '先处理原始信息确认边界' }]),
        ),
        candidates: [],
        opportunities: [],
        audit: { reason: '已有来源确认，不演出未来事件', sourceRefs: [] },
      });
      const claim = {
        id: randomUUID(),
        worldId: id,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: 0,
        inputHash: directorSnapshotInputHash(initialFrame),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };
      let a = (await directors.claim(owner, claim, initialFrame)).attempt;
      a = await directors.mark(owner, a, 'request_sent');
      a = await directors.saveResponse(owner, a, raw);
      await directors.commit(owner, a, initialFrame, parseDirectorDecision(initialFrame, raw, a));
    }
    return { owner, id, world };
  }
  function rawFor(s: DirectorSnapshot) {
    const catalog = directorWireCatalog(s);
    const selected = catalog.events.find((e) => e.authoredEventKey === 'a') ?? catalog.events[0];
    assert.ok(selected, 'actual fixture must expose a genuine unassessed authored window');
    return {
      protocol: 'director-wire-v14',
      openingContext: null,
      authoredChoices: Object.fromEntries(
        catalog.events.map((e) => [
          e.ref,
          e === selected
            ? {
                kind: 'consider',
                opportunity: {
                  title: 'An authored future request',
                  description: 'Future conversation only, never an established world result.',
                  playerImpact: 'The player can decide.',
                  places: [],
                  activity: 'conversation',
                  actorTasks: Object.fromEntries(
                    catalog.actors.map((a, i) => [
                      a.ref,
                      i === 0
                        ? {
                            topic: '本人的未来安排',
                            personalObjective: '独立考虑是否参与',
                            proposedInteraction: '考虑是否提出具体可选交谈',
                          }
                        : null,
                    ]),
                  ),
                },
              }
            : { kind: 'defer', reason: '当前只处理开场事件' },
        ]),
      ),
      candidates: [],
      opportunities: [],
      audit: {
        reason: 'Use the original author opportunity and actor definitions.',
        sourceRefs: catalog.sources
          .filter((s) => s.sourceId.startsWith('definition:'))
          .map((s) => s.ref),
      },
    };
  }
  async function stored(
    f: Awaited<ReturnType<typeof fixture>>,
    raw: unknown,
    status: 'invalid_output' | 'unknown_after_send' = 'invalid_output',
  ) {
    const original = await snapshots.read(f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: 0,
      candidates: [],
      blockers: [],
    });
    const claim = {
      id: randomUUID(),
      worldId: f.id,
      commandId: randomUUID(),
      engineEpoch: 2,
      expectedWorldVersion: 0,
      inputHash: directorSnapshotInputHash(original),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    let a = (await directors.claim(f.owner, claim, original)).attempt;
    a = await directors.mark(f.owner, a, 'request_sent');
    if (status === 'unknown_after_send') a = await directors.mark(f.owner, a, status);
    else {
      a = await directors.saveResponse(f.owner, a, raw);
      a = await directors.mark(f.owner, a, 'invalid_output');
    }
    return { a, claim, original };
  }
  async function current(f: Awaited<ReturnType<typeof fixture>>) {
    const w = await worlds.get({ userId: f.owner }, f.id);
    return snapshots.read(f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: w.version,
      candidates: [],
      blockers: [],
    });
  }
  await t.test(
    'old source-directory rejection recovers the same complete raw once at current authority and keeps immutable assessed evidence',
    async () => {
      const f = await fixture();
      const s = await current(f),
        raw = JSON.stringify(rawFor(s));
      const { a, claim, original } = await stored(f, raw);
      const expected = parseDirectorDecision(original, raw, a);
      assert.ok(expected.audit.basisSourceIds.some((s) => s.startsWith('definition:')));
      await activity.update(f.owner, f.id, {
        clientId: randomUUID(),
        sequence: 1,
        mode: 'browsing',
        resume: true,
      });
      const hint = await app.transaction(f.owner, (sql) =>
        readAgentPhoneEntryProbe(sql, f.owner, {
          worldId: f.id,
          engineEpoch: 2,
          worldVersion: 0,
          storyAt: original.storyAt,
        }),
      );
      assert.equal(hint.status, 'ready');
      assert.deepEqual(
        await app.transaction(f.owner, (sql) =>
          readAgentPhoneEntryProbe(sql, f.owner, {
            worldId: f.id,
            engineEpoch: 2,
            worldVersion: 0,
            storyAt: original.storyAt,
          }),
        ),
        hint,
      );
      await assert.rejects(
        app.transaction(f.owner, async (sql) => {
          await sql.query("SELECT set_config('app.director_handoff_revalidation',$1,true)", [a.id]);
          await sql.query(
            "UPDATE parallel_life.director_runtime_attempts SET status='committed' WHERE id=$1",
            [a.id],
          );
        }),
        /INVALID_DIRECTOR_TRANSITION/,
      );
      const before = (
        await admin.query(
          'SELECT snapshot,response,response_hash,input_hash,sent_at,expected_world_version FROM parallel_life.director_runtime_attempts WHERE id=$1',
          [a.id],
        )
      ).rows[0];
      const chat = npcAgentServices(app, () => ({
        async complete() {
          return JSON.stringify({
            statements: [{ text: '我收到了，会按自己的安排考虑。', dependsOnActionIds: [] }],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          });
        },
      }));
      const intervening = await chat.sendMessageIfEnabled(f.owner, {
        id: randomUUID(),
        worldId: f.id,
        actorId: f.world.actors[0]!.id,
        expectedVersion: 0,
        text: '先确认一下你最近的安排。',
      });
      assert.equal(intervening?.status, 'committed');
      const beforeRecovery = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(beforeRecovery.version, 1);
      const c = await current(f);
      const proof = revalidateDirectorHandoff({ original, current: c, decision: expected });
      assert.equal(proof.allowed, true, JSON.stringify(proof));
      const d = await directors.revalidateKnownHandoff(f.owner, c);
      assert.ok(d);
      assert.equal(d.id, expected.id);
      assert.equal((await directors.lookup(f.owner, f.id, a.commandId))!.status, 'committed');
      assert.deepEqual(
        (
          await admin.query(
            'SELECT snapshot,response,response_hash,input_hash,sent_at,expected_world_version FROM parallel_life.director_runtime_attempts WHERE id=$1',
            [a.id],
          )
        ).rows[0],
        before,
      );
      const receipts = await admin.query(
        'SELECT * FROM parallel_life.director_handoff_revalidations WHERE world_id=$1',
        [f.id],
      );
      assert.equal(receipts.rowCount, 1);
      assert.equal(receipts.rows[0].assessed_version, 0);
      assert.equal(receipts.rows[0].applied_version, c.worldVersion);
      assert.equal(await directors.revalidateKnownHandoff(f.owner, await current(f)), null);
      const req = await admin.query(
        'SELECT status FROM parallel_life.agent_episode_requests WHERE world_id=$1',
        [f.id],
      );
      assert.equal(req.rowCount, expected.opportunities[0]!.participantActorIds.length);
      assert.ok(req.rows.every((r) => r.status === 'pending'));
      const w = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(w.version, 1);
      assert.deepEqual(w.messages, beforeRecovery.messages);
      assert.equal((await directors.readEpisodes(f.owner, f.id))[0]!.status, 'proposed');
      let calls = 0;
      const result = await runDirectorAgent(
        {
          attempts: directors,
          model: {
            async decide() {
              calls++;
              throw Error('MUST_NOT_REPURCHASE');
            },
          },
          parse: parseDirectorDecision,
        },
        f.owner,
        claim,
        original,
      );
      assert.equal(result.id, d.id);
      assert.equal(calls, 0);
      await assert.rejects(directors.revalidateKnownHandoff(randomUUID(), c));
    },
  );
  for (const kind of [
    'forged_source',
    'incomplete_json',
    'truncation_object',
    'emergent',
    'native',
    'opening_fact_review',
    'network_unknown',
  ] as const) {
    await t.test(
      kind + ': no repair, no purchase, no request, original invalid/unknown state remains',
      async () => {
        const f = await fixture();
        const s = await current(f);
        let r: any = rawFor(s),
          raw: unknown;
        if (kind === 'forged_source') r.audit.sourceRefs.push('source:99999');
        if (kind === 'emergent')
          r.opportunities = [{ id: 'unbound', origin: { kind: 'emergent', sourceRefs: [] } }];
        if (kind === 'native') {
          r.mode = 'coordinate';
          r.opportunities = [];
        }
        if (kind === 'opening_fact_review') r.openingContext = { invalid: 'not authorized' };
        raw =
          kind === 'incomplete_json'
            ? JSON.stringify(r).slice(0, -10)
            : kind === 'truncation_object'
              ? {
                  kind: 'model_output_truncated',
                  schemaVersion: 1,
                  finish_reason: 'length',
                  content: JSON.stringify(r),
                  contentCharacters: JSON.stringify(r).length,
                  usage: null,
                }
              : JSON.stringify(r);
        const { a } = await stored(
          f,
          raw,
          kind === 'network_unknown' ? 'unknown_after_send' : 'invalid_output',
        );
        const d = await directors.revalidateKnownHandoff(f.owner, await current(f));
        assert.equal(d, null);
        assert.equal(
          (await directors.lookup(f.owner, f.id, a.commandId))!.status,
          kind === 'network_unknown' ? 'unknown_after_send' : 'invalid_output',
        );
        assert.equal(
          (
            await admin.query(
              'SELECT 1 FROM parallel_life.director_handoff_revalidations WHERE world_id=$1',
              [f.id],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await admin.query(
              'SELECT 1 FROM parallel_life.agent_episode_requests WHERE world_id=$1',
              [f.id],
            )
          ).rowCount,
          0,
        );
      },
    );
  }
});
