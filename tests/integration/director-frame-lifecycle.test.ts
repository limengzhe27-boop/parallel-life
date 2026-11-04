import { createHash } from 'node:crypto';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
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
test('director frame lifecycle uses real publication, personal plan and protected attempts', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_SEMANTIC_WAKE_TEST_PORT ?? 55505));
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
    editorialIntent: '只可考虑，不代表发生。',
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
    node('always'),
    node('a', [{ kind: 'not_before', at: time(10) }], {
      timeline: {
        stageKey: 'day',
        window: { notBefore: time(10), expiresAt: time(11) },
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    }),
    node('b', [{ kind: 'not_before', at: time(12) }]),
  ];
  base.openingEventKey = 'always';
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
    options: {
      openingKnowledge?: boolean;
      admit?: boolean;
      proof?: boolean;
      multi?: boolean;
      legacy?: boolean;
      emptyAgenda?: boolean;
      multiActorOpening?: boolean;
      periodic?: boolean;
    } = {},
  ) {
    const content = structuredClone(base);
    if (options.openingKnowledge)
      content.actors.forEach((a: any) => {
        a.lifeModules = { lifeContext: '我是小店老板，知道店内书友会的安排。' };
      });
    if (options.multiActorOpening)
      content.candidates[0].actorKeys = content.actors.map((a: any) => a.key);
    if (options.proof)
      content.candidates.push(node('fallback', [], { conditionKeys: ['alternative_evidence'] }));
    if (options.multi)
      for (const key of ['aa', 'a_b'])
        content.candidates.push(node(key, [{ kind: 'not_before', at: time(10) }]));
    if (options.periodic) content.candidates = [node('always'), node('p_a'), node('p_b')];
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
    // These older semantic-wake scenarios start with an existing character agenda.
    // No invented execution/history: an active definition-based intention, with no action or result.
    // Explicit emptyAgenda fixtures below retain the real cold-start initialization path.
    if (!options.emptyAgenda)
      await app.transaction(owner, async (sql) => {
        for (const actor of world.actors) {
          const source = `definition:${agentDefinitionRef(world, actor.id)}`;
          await sql.query(
            `UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{goals}',$3::jsonb)
            WHERE world_id=$1 AND owner_id=$2 AND actor_id=$4`,
            [
              id,
              owner,
              JSON.stringify([
                {
                  id: `fixture-existing-agenda:${actor.id}`,
                  summary: 'An existing character intention, without an action or claimed outcome.',
                  status: 'active',
                  sourceIds: [source],
                  resultIds: [],
                },
              ]),
              actor.id,
            ],
          );
        }
      });
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, world };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function at(f: Fixture, storyNow: string) {
    const clock = await clocks.read(f.owner, f.id);
    await clocks.write(f.owner, f.id, {
      ...clock,
      storyNow,
      paused: false,
      speed: 0,
      lastTickAt: new Date().toISOString(),
    });
  }
  async function snap(f: Fixture) {
    const w = await worlds.get({ userId: f.owner }, f.id);
    return snapshots.read(f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: w.version,
      candidates: [],
      blockers: [],
    });
  }
  const quiet = () => ({
    mode: 'quiet',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [],
    audit: { reason: 'Synthetic quiet', basisSourceIds: [] },
  });
  const claim = (s: DirectorSnapshot) => ({
    id: randomUUID(),
    worldId: s.worldId,
    commandId: randomUUID(),
    engineEpoch: s.engineEpoch,
    expectedWorldVersion: s.worldVersion,
    inputHash: directorSnapshotInputHash(s),
    token: randomUUID(),
    leaseUntil: new Date(Date.now() + 120000).toISOString(),
  });
  async function attempts(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 ORDER BY created_at,id',
        [f.id],
      )
    ).rows;
  }
  await t.test(
    'fully received quiet with omitted mechanical null recovers without another model call',
    async () => {
      const f = await fixture();
      const { directorWireCatalog, directorOpeningOwnerCatalog } =
        await import('../../src/modules/world/infrastructure/director-model-protocol.ts');
      const initial = await snap(f);
      await runDirectorAgent(
        {
          attempts: directors,
          parse: parseDirectorDecision,
          model: {
            async decide() {
              return JSON.stringify({
                protocol: 'director-wire-v15',
                openingContext: initial.openingContextAuthority
                  ? {
                      informationOwners: Object.fromEntries(
                        directorOpeningOwnerCatalog(initial).information.map((i) => [
                          i.ref,
                          { actorRef: null, reason: 'Public fixture' },
                        ]),
                      ),
                    }
                  : null,
                authoredChoices: Object.fromEntries(
                  directorWireCatalog(initial).events.map((e) => [
                    e.ref,
                    { kind: 'defer', reason: 'Wait' },
                  ]),
                ),
                candidates: [],
                opportunities: [],
                audit: { reason: 'Fixture', sourceRefs: [] },
              });
            },
          },
        },
        f.owner,
        claim(initial),
        initial,
      );
      const original = await snap(f);
      assert.equal(original.openingContextAuthority, undefined);
      const input = claim(original);
      let { attempt } = await directors.claim(f.owner, input, original);
      assert.equal(
        await directors.revalidateKnownHandoff(f.owner, original),
        null,
        'live unsent frame cannot be quiet recovered',
      );
      attempt = await directors.mark(f.owner, attempt, 'request_sent');
      await directors.mark(f.owner, attempt, 'unknown_after_send');
      assert.equal(
        await directors.revalidateKnownHandoff(f.owner, original),
        null,
        'unknown without raw cannot be quiet recovered',
      );
      const raw = JSON.stringify({
        protocol: 'director-wire-v15',
        candidates: [],
        authoredChoices: {},
        opportunities: [],
        audit: { reason: 'Known quiet', sourceRefs: [] },
      });
      attempt = await directors.saveResponse(f.owner, attempt, raw);
      await directors.mark(f.owner, attempt, 'invalid_output');
      const before = (await attempts(f)).find((a) => a.id === input.id)!;
      await worlds.saveNote(
        { userId: f.owner },
        {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: original.worldVersion,
          title: 'Independent note',
          text: 'Unrelated change',
        },
      );
      const current = await snap(f);
      assert(current.worldVersion > original.worldVersion);
      const decision = await directors.revalidateKnownHandoff(f.owner, current);
      assert.equal(decision?.mode, 'quiet');
      assert.deepEqual(decision?.opportunities, []);
      assert.equal((await directors.lookup(f.owner, f.id, input.commandId))!.status, 'committed');
      const after = (await attempts(f)).find((a) => a.id === input.id)!;
      assert.deepEqual(after.response, before.response);
      assert.equal(after.input_hash, before.input_hash);
      assert.deepEqual(after.sent_at, before.sent_at);
      const counts = async () =>
        (
          await admin.query(
            `SELECT (SELECT count(*) FROM parallel_life.shared_episodes WHERE world_id=$1) episodes,(SELECT count(*) FROM parallel_life.agent_episode_requests WHERE world_id=$1) requests,(SELECT count(*) FROM parallel_life.director_handoff_revalidations WHERE world_id=$1) proofs`,
            [f.id],
          )
        ).rows[0];
      assert.deepEqual(await counts(), { episodes: '0', requests: '0', proofs: '1' });
      assert.deepEqual(
        (
          await admin.query(
            'SELECT opportunity_ids FROM parallel_life.director_handoff_revalidations WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].opportunity_ids,
        [],
      );
      assert.equal(await directors.revalidateKnownHandoff(f.owner, await snap(f)), null);
      assert.deepEqual(await counts(), { episodes: '0', requests: '0', proofs: '1' });
      const badSnapshot = await snap(f),
        badInput = claim(badSnapshot);
      let bad = (await directors.claim(f.owner, badInput, badSnapshot)).attempt;
      bad = await directors.mark(f.owner, bad, 'request_sent');
      const businessMissing = JSON.parse(raw);
      delete businessMissing.candidates;
      bad = await directors.saveResponse(f.owner, bad, JSON.stringify(businessMissing));
      await directors.mark(f.owner, bad, 'invalid_output');
      assert.equal(
        await directors.revalidateKnownHandoff(f.owner, await snap(f)),
        null,
        'missing business output is not quiet',
      );
      assert.equal(
        (await directors.lookup(f.owner, f.id, badInput.commandId))!.status,
        'invalid_output',
      );
      assert.deepEqual(await counts(), { episodes: '0', requests: '0', proofs: '1' });
    },
  );
  for (const lateRaw of [false, true])
    await t.test(
      `periodic review and disjoint unknown protection (late raw: ${lateRaw})`,
      async () => {
        const f = await fixture({ periodic: true });
        const { directorWireCatalog, directorOpeningOwnerCatalog } =
          await import('../../src/modules/world/infrastructure/director-model-protocol.ts');
        let calls = 0;
        const run = async (snapshot: DirectorSnapshot, input = claim(snapshot)) => {
          const deps = {
            attempts: directors,
            parse: parseDirectorDecision,
            model: {
              async decide() {
                calls++;
                return JSON.stringify({
                  protocol: 'director-wire-v15',
                  openingContext: snapshot.openingContextAuthority
                    ? {
                        informationOwners: Object.fromEntries(
                          directorOpeningOwnerCatalog(snapshot).information.map((i) => [
                            i.ref,
                            { actorRef: null, reason: 'Public fixture' },
                          ]),
                        ),
                      }
                    : null,
                  authoredChoices: Object.fromEntries(
                    directorWireCatalog(snapshot).events.map((e) => [
                      e.ref,
                      { kind: 'defer', reason: 'Still optional, no actual action or presentation' },
                    ]),
                  ),
                  candidates: [],
                  opportunities: [],
                  audit: { reason: 'Fixture review', sourceRefs: [] },
                });
              },
            },
          };
          const result = await runDirectorAgent(deps, f.owner, input, snapshot);
          const count = calls;
          assert.deepEqual(await runDirectorAgent(deps, f.owner, input, snapshot), result);
          assert.equal(
            calls,
            count,
            'original paid request replays its decision without a new call',
          );
          return input;
        };
        const initial = await snap(f);
        assert.equal(initial.evaluationCause?.kind, 'bootstrap');
        await run(initial);
        const remaining = await snap(f);
        assert.equal(remaining.evaluationCause?.kind, 'authored_eligibility');
        const prior = await run(remaining);
        assert.equal((await snap(f)).evaluationCause, undefined);
        await admin.query(
          "UPDATE parallel_life.director_runtime_attempts SET updated_at=now()-interval '6 minutes' WHERE id=$1 AND world_id=$2",
          [prior.id, f.id],
        );
        const periodic = await snap(f);
        assert.equal(periodic.evaluationCause?.kind, 'periodic_review');
        assert.equal(
          periodic.evaluationCause.kind === 'periodic_review' &&
            periodic.evaluationCause.qualifications.length,
          3,
        );
        assert.equal(periodic.deliberationWindow!.nodeKeys.length, 2);
        assert.equal(
          periodic.deliberationWindow!.nodeKeys[0],
          'always',
          'oldest actual assessment comes first',
        );
        assert.deepEqual((await snap(f)).evaluationCause, periodic.evaluationCause);
        const original = (await attempts(f)).map((a) => ({
          id: a.id,
          response: a.response,
          sent_at: a.sent_at,
          input_hash: a.input_hash,
        }));
        const next = await run(periodic); // claim, mark request_sent, save response and commit all authenticate original frame
        assert.deepEqual(
          (await attempts(f))
            .filter((a) => a.id !== next.id)
            .map((a) => ({
              id: a.id,
              response: a.response,
              sent_at: a.sent_at,
              input_hash: a.input_hash,
            })),
          original,
        );
        const after = await snap(f);
        assert.equal(
          after.evaluationCause,
          undefined,
          'committing this period does not immediately buy another',
        );
        assert.equal(
          after.episodes.length,
          0,
          'defer is neither a presented episode nor completion',
        );
        await admin.query(
          "UPDATE parallel_life.director_runtime_attempts SET updated_at=now()-interval '6 minutes' WHERE id=$1 AND world_id=$2",
          [next.id, f.id],
        );
        const following = await snap(f);
        assert.equal(following.evaluationCause?.kind, 'periodic_review');
        const unreviewed = ['always', 'p_a', 'p_b'].find(
          (k) => !periodic.deliberationWindow!.nodeKeys.includes(k),
        );
        assert.equal(
          following.deliberationWindow!.nodeKeys[0],
          unreviewed,
          'reviewed nodes move behind the older assessment',
        );
        assert.equal(calls, 3);
        const unknownClaim = {
          ...claim(following),
          leaseUntil: new Date(Date.now() + 1200).toISOString(),
        };
        let unknownCalls = 0;
        await assert.rejects(
          runDirectorAgent(
            {
              attempts: directors,
              parse: parseDirectorDecision,
              model: {
                async decide() {
                  unknownCalls++;
                  throw Error('SYNTHETIC_TRANSPORT_UNKNOWN');
                },
              },
            },
            f.owner,
            unknownClaim,
            following,
          ),
        );
        assert.equal(
          (await directors.prepareRecovery(f.owner, await snap(f))).status,
          'blocked',
          'live unknown keeps execution fence',
        );
        await new Promise((resolve) => setTimeout(resolve, 1250));
        if (lateRaw) {
          const unknown = (await directors.lookup(f.owner, f.id, unknownClaim.commandId))!;
          await directors.saveResponse(f.owner, unknown, JSON.stringify(quiet()));
          const held = await snap(f);
          assert.equal(
            held.evaluationCause,
            undefined,
            'late raw retains original paid scope rather than authorizing disjoint purchase',
          );
          assert.deepEqual(held.deliberationWindow!.nodeKeys, []);
          assert.equal(unknownCalls, 1);
          return;
        }
        const independent = await snap(f);
        assert.equal(independent.evaluationCause?.kind, 'periodic_review');
        assert.equal(independent.deliberationWindow!.nodeKeys.length, 1);
        assert(
          independent.deliberationWindow!.nodeKeys.every(
            (key) => !following.deliberationWindow!.nodeKeys.includes(key),
          ),
        );
        const protectedRow = (await attempts(f)).find((a) => a.id === unknownClaim.id)!;
        assert.equal((await directors.prepareRecovery(f.owner, independent)).status, 'none');
        const retired = (await directors.lookup(f.owner, f.id, unknownClaim.commandId))!;
        assert.equal(retired.status, 'stale_discarded');
        await assert.rejects(
          runDirectorAgent(
            {
              attempts: directors,
              parse: parseDirectorDecision,
              model: {
                async decide() {
                  unknownCalls++;
                  return '{}';
                },
              },
            },
            f.owner,
            unknownClaim,
            following,
          ),
        );
        assert.equal(unknownCalls, 1);
        await run(independent);
        await directors.saveResponse(f.owner, retired, JSON.stringify(quiet()));
        assert.equal(
          (await directors.lookup(f.owner, f.id, unknownClaim.commandId))!.status,
          'stale_discarded',
          'late raw cannot regain execution authority',
        );
        const retained = (await attempts(f)).find((a) => a.id === unknownClaim.id)!;
        assert.equal(retained.sent_at.toISOString(), protectedRow.sent_at.toISOString());
        assert.equal(retained.input_hash, protectedRow.input_hash);
        assert.deepEqual(retained.snapshot, protectedRow.snapshot);
        assert.equal(calls, 4);
      },
    );
  for (const scenario of ['ordinary', 'opening', 'independent'])
    await t.test(
      `expired unknown ${scenario === 'independent' ? 'non-author actor' : scenario === 'opening' ? 'opening context' : 'bootstrap'} retires only for verified evidence`,
      async () => {
        const openingKnowledge = scenario === 'opening';
        const f = await fixture({ openingKnowledge });
        const originalFrame = await snap(f);
        assert.equal(originalFrame.evaluationCause?.kind, 'bootstrap');
        if (openingKnowledge) assert.ok(originalFrame.openingContextAuthority);
        const originalClaim = {
          ...claim(originalFrame),
          leaseUntil: new Date(Date.now() + 1200).toISOString(),
        };
        let calls = 0;
        await assert.rejects(
          runDirectorAgent(
            {
              attempts: directors,
              parse: parseDirectorDecision,
              model: {
                async decide() {
                  calls++;
                  throw Error('EXPLICIT_UNKNOWN_TEST');
                },
              },
            },
            f.owner,
            originalClaim,
            originalFrame,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 1250));
        const noChange = await snap(f);
        assert.notEqual(
          noChange.evaluationCause?.kind,
          'bootstrap',
          'paid bootstrap is not a new request',
        );
        assert.equal((await directors.prepareRecovery(f.owner, noChange)).status, 'blocked');
        await worlds.saveNote(
          { userId: f.owner },
          {
            worldId: f.id,
            commandId: randomUUID(),
            expectedVersion: noChange.worldVersion,
            title: 'Unrelated note',
            text: 'No narrative evidence',
          },
        );
        const noteFrame = await snap(f);
        assert.equal(
          (await directors.prepareRecovery(f.owner, noteFrame)).status,
          'blocked',
          'version alone never retires unknown',
        );
        const actorId = f.world.actors[scenario === 'independent' ? 1 : 0]!.id;
        const npcs = new PostgresAgentRuntimeRepository(app);
        const world = await worlds.get({ userId: f.owner }, f.id);
        const commandId = randomUUID(),
          text = '请考虑明天的陈列安排。';
        const { receipt } = await npcs.accept(f.owner, {
          id: randomUUID(),
          worldId: f.id,
          commandId,
          inputHash: createHash('sha256')
            .update(JSON.stringify([f.id, actorId, text]))
            .digest('hex'),
          channel: 'private',
          threadId: actorId,
          recipientActorId: actorId,
          expectedWorldVersion: world.version,
          receivedAt: new Date().toISOString(),
          storyAt: world.time,
          origin: 'player',
          text,
        });
        const snapshot = (
          await readPrivateAgentSnapshot(
            app,
            f.owner,
            world,
            actorId,
            receipt,
            world.time,
            await npcs.read(f.owner, { worldId: f.id, actorId }),
          )
        ).snapshot;
        await runNpcAgent(
          {
            attempts: npcs,
            kernel: new PostgresNpcAgentKernel(app, worlds),
            model: {
              async decide() {
                return {
                  statements: [{ text: '我会重新考虑自己的陈列安排。', dependsOnActionIds: [] }],
                  goals: [
                    {
                      id: 'new-display-goal',
                      summary: '考虑本人的新陈列安排',
                      status: 'active',
                      sourceIds: [snapshot.input.sourceId],
                      resultIds: [],
                    },
                  ],
                  plans: [
                    {
                      id: 'new-display-plan',
                      goalId: 'new-display-goal',
                      summary: '核对新陈列安排的细节',
                      status: 'blocked',
                      sourceIds: [snapshot.input.sourceId],
                      actionIds: [],
                      nextActionId: null,
                      triggers: [],
                      missingConditions: ['尚需考虑细节'],
                    },
                  ],
                  actions: [],
                  responsibilities: [],
                  decisions: [],
                };
              },
            },
          },
          f.owner,
          {
            id: randomUUID(),
            worldId: f.id,
            actorId,
            commandId,
            inputReceiptId: receipt.id,
            inputHash: receipt.inputHash,
            engineEpoch: 2,
            expectedWorldVersion: world.version,
            expectedActorRevision: snapshot.state.revision,
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 60000).toISOString(),
          },
          snapshot,
        );
        const changed = await snap(f);
        if (scenario === 'independent') assert.equal(changed.evaluationCause, undefined);
        if (scenario !== 'independent') {
          assert.ok(changed.evaluationCause);
          assert.notEqual(changed.evaluationCause.id, originalFrame.evaluationCause!.id);
        }
        assert.equal((await directors.prepareRecovery(f.owner, changed)).status, 'none');
        const retired = await directors.lookup(f.owner, f.id, originalClaim.commandId);
        assert.equal(retired!.status, 'stale_discarded');
        assert.equal(calls, 1, 'original unknown was never called again');
        const original = (await attempts(f)).find((a) => a.id === originalClaim.id)!;
        assert.equal(original.response, null);
        assert.ok(original.sent_at);
        assert.equal(original.input_hash, originalClaim.inputHash);
        assert.deepEqual(original.snapshot, JSON.parse(JSON.stringify(originalFrame)));
        // Late raw remains available as evidence but cannot acquire commit authority.
        await directors.saveResponse(f.owner, retired!, JSON.stringify(quiet()));
        assert.equal(
          (await directors.lookup(f.owner, f.id, originalClaim.commandId))!.status,
          'stale_discarded',
        );
        const next = await snap(f);
        assert.equal(next.evaluationCause?.id, changed.evaluationCause?.id);
        const result = await directors.prepareRecovery(f.owner, next);
        assert.equal(
          result.status,
          'none',
          'new semantic frame can proceed while old frame stays retired',
        );
        const nextAttempt = await directors.claim(f.owner, claim(next), next);
        assert.equal(nextAttempt.attempt.status, 'reserved');
      },
    );
});
