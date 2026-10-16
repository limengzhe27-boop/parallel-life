import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
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
test('author-scoped event outcome commits from the real invitation response', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.EPISODE_OUTCOME_TEST_PORT ?? 55564));
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
    completionScope = false,
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
    if (completionScope)
      content.candidates[0].direction = {
        mode: 'optional',
        progress: {
          completion: {
            scope: 'invitation_response',
            mode: 'all',
            criteria: [{ key: 'answer', kind: 'invitation_response', response: 'accepted' }],
          },
        },
      };
    content.candidates.push({
      ...content.candidates[0],
      key: 'following',
      intent: { kind: 'editorial_only' },
      prerequisites: [{ kind: 'after_committed_node', nodeKey: 'typed_offer' }],
    });
    if (kind === 'invitation' || kind === 'hidden_invitation')
      content.candidates[0].actorKeys = [content.actors[0].key];
    content.candidates.push({
      ...content.candidates[0],
      key: 'opening',
      intent: { kind: 'director_event' },
      actorKeys: [],
    });
    delete content.candidates.find((n: { key: string }) => n.key === 'following').direction;
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
  for (const scoped of [false, true])
    await t.test(
      scoped
        ? 'explicit conversation objective resolves atomically and unlocks the dependent event'
        : 'an invitation acceptance alone never resolves an unscoped story',
      async () => {
        const f = await fixture('invitation', scoped);
        const service = npcAgentServices(app, () => ({
          async complete(messages) {
            const p = JSON.parse(messages[1]!.content),
              m = verifyManifest(f, p),
              basis = [p.input.sourceId, m.sourceId];
            return JSON.stringify({
              statements: [{ text: 'Would you like to meet?', dependsOnActionIds: ['invite'] }],
              goals: [
                {
                  id: 'offer',
                  summary: 'Ask about a possible meeting',
                  status: 'active',
                  sourceIds: basis,
                  resultIds: [],
                },
              ],
              plans: [],
              actions: [
                {
                  id: 'invite',
                  goalId: 'offer',
                  capability: 'appointment.propose',
                  targetIds: [],
                  parameters: {
                    title: 'ACTUAL_OUTCOME_INVITATION',
                    at: new Date(Date.parse(p.storyAt) + 3600000).toISOString(),
                  },
                  preconditions: [],
                  dependsOnActionIds: [],
                  handlesResponsibilityIds: [],
                  sourceIds: basis,
                  status: 'proposed',
                },
              ],
              responsibilities: [],
              decisions: [],
              episodeDecision: {
                requestId: m.requestId,
                choice: 'engage',
                reason: 'My own invitation',
                sourceIds: basis,
              },
            });
          },
        }));
        const c = await command(f, 'Tell me what you would like to arrange.');
        assert.equal((await service.sendMessageIfEnabled(f.owner, c))?.status, 'committed');
        let world = await worlds.get({ userId: f.owner }, f.id);
        const appointment = world.appointments.find(
          (a) => a.title === 'ACTUAL_OUTCOME_INVITATION',
        )!;
        assert.ok(appointment);
        const getOutcome = () =>
          app.transaction(f.owner, (sql) =>
            sql.query('SELECT * FROM parallel_life.agent_episode_outcomes WHERE world_id=$1', [
              f.id,
            ]),
          );
        assert.equal((await getOutcome()).rows.length, 0);
        const reply = {
          commandId: randomUUID(),
          worldId: f.id,
          id: appointment.id,
          expectedVersion: world.version,
          operation: 'accept' as const,
        };
        if (scoped) {
          await admin.query(
            `CREATE FUNCTION parallel_life.test100_outcome_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST100_ATOMIC_ABORT' USING ERRCODE='23514'; END $$`,
          );
          await admin.query(
            `CREATE TRIGGER test100_outcome_abort BEFORE UPDATE ON parallel_life.shared_episodes FOR EACH ROW WHEN (NEW.world_id='${f.id}' AND NEW.document->>'status'='resolved') EXECUTE FUNCTION parallel_life.test100_outcome_abort()`,
          );
          try {
            await assert.rejects(worlds.respondToInvitation({ userId: f.owner }, reply), {
              code: '23514',
            });
            assert.equal((await getOutcome()).rows.length, 0);
            const unchanged = await worlds.get({ userId: f.owner }, f.id);
            assert.equal(unchanged.version, world.version);
            assert.equal(
              unchanged.appointments.find((a) => a.id === appointment.id)!.status,
              'proposed',
            );
          } finally {
            await admin.query(
              'DROP TRIGGER test100_outcome_abort ON parallel_life.shared_episodes',
            );
            await admin.query('DROP FUNCTION parallel_life.test100_outcome_abort()');
          }
        }
        await worlds.respondToInvitation({ userId: f.owner }, reply);
        const outcomes = (await getOutcome()).rows;
        assert.equal(outcomes.length, scoped ? 1 : 0);
        world = await worlds.get({ userId: f.owner }, f.id);
        const director = await snapshots.read(f.owner, {
          worldId: f.id,
          engineEpoch: 2,
          worldVersion: world.version,
          candidates: [],
          blockers: [],
        });
        const ep = director.episodes.find((e) => e.id === f.requests[0]!.episodeId)!;
        assert.equal(ep.status, scoped ? 'resolved' : 'active');
        if (scoped)
          assert.ok(
            director.observations.some(
              (o) =>
                o.sourceId.startsWith('episode-outcome:') &&
                o.kind === 'result' &&
                o.knownByActorIds.length === 0,
            ),
          );
        assert.equal(
          director.authoredEligibility!.find((e) => e.nodeKey === 'following')!.status,
          scoped ? 'eligible' : 'blocked',
        );
        assert.ok(
          (await actors.read(f.owner, {
            worldId: f.id,
            actorId: f.requests[0]!.actorId,
          }))!.goals.every((g) => g.status !== 'fulfilled'),
        );
        await worlds.respondToInvitation({ userId: f.owner }, reply);
        assert.equal((await getOutcome()).rows.length, scoped ? 1 : 0);
        // The reply becomes an actor wake before the future appointment, through the original engine.
        let answerCalls = 0;
        const wakeIds: string[] = [];
        const advance = npcAgentAdvanceServices(
          app,
          () => ({
            async complete(messages) {
              const p = JSON.parse(messages[1]!.content);
              if (Array.isArray(p.candidates)) {
                const selected = p.candidates.find((c: { id: string }) =>
                  c.id.startsWith('episode-answer:'),
                );
                return JSON.stringify({
                  mode: selected ? 'coordinate' : 'quiet',
                  selectedCandidateIds: selected ? [selected.id] : [],
                  deferred: p.candidates
                    .filter((c: { id: string }) => c.id !== selected?.id)
                    .map((c: { id: string }) => ({
                      candidateId: c.id,
                      reason: 'Only process actual invitation answer',
                    })),
                  nudges: [],
                  opportunities: [],
                  audit: { reason: 'Controlled result follow-up fixture', basisSourceIds: [] },
                });
              }
              const wakeId = JSON.parse(p.input.text).candidateId ?? JSON.parse(p.input.text).type;
              wakeIds.push(wakeId);
              if (wakeId.startsWith('episode-answer:')) answerCalls++;
              assert.ok(
                p.episodeResults.some((r: { kind: string }) => r.kind === 'invitation_accepted'),
              );
              return JSON.stringify({
                statements: [],
                goals: [],
                plans: [],
                actions: [],
                responsibilities: [],
                decisions: [],
              });
            },
          }),
          snapshots,
        );
        await advance.advanceIfEnabled(f.owner, f.id);
        assert.equal(answerCalls, 1, JSON.stringify(wakeIds));
        await advance.advanceIfEnabled(f.owner, f.id);
        assert.equal(answerCalls, 1, JSON.stringify(wakeIds));

        if (scoped) {
          const r = outcomes[0];
          await assert.rejects(
            app.transaction(f.owner, (sql) =>
              sql.query(
                `INSERT INTO parallel_life.agent_episode_outcomes
       (world_id,owner_id,id,episode_id,engine_epoch,node_key,source_origin,node_document,policy,evidence_ids,source_event_id,world_version,story_at,scope,outcome)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'invitation_response','committed')`,
                [
                  r.world_id,
                  f.owner,
                  randomUUID(),
                  r.episode_id,
                  r.engine_epoch,
                  r.node_key,
                  r.source_origin,
                  r.node_document,
                  r.policy,
                  JSON.stringify(['forged']),
                  r.source_event_id,
                  r.world_version,
                  r.story_at,
                ],
              ),
            ),
            { code: '23514' },
          );
          assert.equal((await getOutcome()).rows.length, 1);
        }
      },
    );
});
