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
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
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
import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { readPendingEpisodeRequestsInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { readAuthoredEligibilityInTransaction } from '../../src/modules/world/infrastructure/authored-event-eligibility-repository.ts';
import { readEpisodeOutcomeProgress } from '../../src/modules/world/infrastructure/episode-outcome-repository.ts';
import { deriveAuthoredStageProgress } from '../../src/modules/world/domain/authored-stage-progress.ts';

test('actual native scoped whole-event outcome unlocks an explicitly authored stage, synthetic model only', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AUTHORED_STAGE_TEST_PORT ?? 55634));
  assert.ok(cfg.port >= 1024 && cfg.port <= 65535);
  const admin = await adminClient('parallel_life_test');
  assert.equal(
    (await admin.query('SELECT current_database() db,inet_server_port() port')).rows[0].port,
    cfg.port,
  );
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
  const worlds = new PostgresWorldRepository(app),
    clocks = new PostgresClockStore(app);
  const snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app);
  const attempts = new PostgresAgentRuntimeRepository(app);
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
  const staff = randomUUID(),
    reviewReceipt = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, 'Synthetic authored stage PG fixture'],
  );
  const works = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_SYNTHETIC_STAGE_TEST',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: reviewReceipt },
      };
    },
  });
  const compiler: PublicationWorldCompilerPort = {
    prepare(input) {
      const result = compilePublicationGenesis({
        ...input,
        originKind: input.originKind === 'trial' ? 'trial' : 'published',
        newId: randomUUID,
      });
      assert.equal(result.status, 'compiled');
      if (result.status !== 'compiled') throw Error('STAGE_FIXTURE_COMPILE_FAILED');
      return {
        world: result.world,
        opening: result.opening,
        seed: {
          id: input.seedId,
          createdAt: new Date().toISOString(),
          source: {
            kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
            ...input.origin,
          },
          identity: result.opening.identity,
          situation: result.opening.situation,
          setting: result.opening.setting,
          experienceNote: result.opening.experienceNote,
        },
      };
    },
  };
  const published = new PublicationWorldRepository(app, compiler);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  const timeline = (stageKey: string) => ({
    stageKey,
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
  });
  async function fixture(
    options: { completion?: boolean; response?: 'accepted' | 'declined'; stageRule?: boolean } = {},
  ) {
    const content = structuredClone(base);
    content.history = [];
    content.initialKnowledge = [];
    const at = new Date(Date.parse(content.world.startAt) + 3600000).toISOString();
    content.timeline = {
      initialStageKey: 'first',
      stages: [
        {
          key: 'first',
          title: '明确询问安排',
          order: 0,
          afterStageKeys: [],
          ...(options.stageRule === false
            ? {}
            : {
                completion: {
                  mode: 'all',
                  criteria: [{ nodeKey: 'offer', outcomes: ['committed'] }],
                },
              }),
        },
        { key: 'later', title: '回应之后的新机会', order: 1, afterStageKeys: ['first'] },
      ],
    };
    content.candidates = [
      {
        key: 'offer',
        kind: 'candidate',
        title: '询问安排',
        editorialIntent: '只询问是否愿意，玩家自由选择。',
        actorKeys: [content.actors[0].key],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        timeline: timeline('first'),
        intent: {
          kind: 'offer_invitation',
          actorKeys: [content.actors[0].key],
          placeKey: 'shop',
          title: 'PG_STAGE_INVITATION',
          earliestAt: at,
        },
        ...(options.completion === false
          ? {}
          : {
              direction: {
                mode: 'optional',
                progress: {
                  completion: {
                    scope: 'invitation_response',
                    mode: 'all',
                    criteria: [
                      {
                        key: 'response',
                        kind: 'invitation_response',
                        response: options.response ?? 'accepted',
                      },
                    ],
                  },
                },
              },
            }),
      },
      {
        key: 'follow',
        kind: 'candidate',
        title: '后续事项',
        editorialIntent: '前一个明确目标真的达成以后才获得资格。',
        actorKeys: [content.actors[0].key],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        timeline: timeline('later'),
        intent: { kind: 'director_event' },
      },
    ];
    if (options.completion === false) delete content.timeline.stages[0].completion;
    delete content.openingEventKey;
    const parsed = PublishedWorldContentSchema.parse(content);
    const work = await works.create(staff, {
      commandId: randomUUID(),
      title: 'Stage progression synthetic fixture',
      content: parsed,
    });
    const checked = await works.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
    });
    assert.equal(checked.status, 'ready');
    await works.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: checked.id,
    });
    const owner = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    const { worldId: id } = await published.startPublished(
      owner,
      work.id,
      { commandId: randomUUID(), publicationVersion: 1 },
      { agentRuntime: true },
    );
    owned.push({ owner, id });
    await clocks.write(owner, id, {
      storyNow: parsed.world.startAt,
      lastTickAt: new Date().toISOString(),
      paused: false,
      speed: 0,
      missedBeats: 0,
      summary: null,
    });
    const world = await worlds.get({ userId: owner }, id);
    const snapshot = await snapshots.read(owner, {
      worldId: id,
      engineEpoch: 2,
      worldVersion: world.version,
      candidates: [],
      blockers: [],
    });
    let calls = 0;
    await runDirectorAgent(
      {
        attempts: directors,
        parse: parseDirectorDecision,
        model: new WorldDirectorAgentModel({
          async complete(messages) {
            calls++;
            const p = JSON.parse(messages[1]!.content);
            const material = p.authoredMaterials.materials.find(
              (m: { ref: { nodeKey: string } }) => m.ref.nodeKey === 'offer',
            );
            return JSON.stringify({
              mode: 'bounded_opportunity',
              selectedCandidateIds: [],
              deferred: [],
              nudges: [],
              opportunities: [
                {
                  id: randomUUID(),
                  title: '询问安排机会',
                  description: '人物可自行决定怎样邀请。',
                  playerImpact: '可以拒绝。',
                  participantActorIds: [world.actors[0]!.id],
                  placeIds: [],
                  activity: 'conversation',
                  basisSourceIds: [material.sourceId],
                  authoredEventKey: 'offer',
                },
              ],
              audit: { reason: '合成数据库协议验收', basisSourceIds: [] },
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
        expectedWorldVersion: world.version,
        inputHash: directorSnapshotInputHash(snapshot),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    assert.equal(calls, 1);
    const requests = await app.transaction(owner, (sql) =>
      readPendingEpisodeRequestsInTransaction(sql, owner, { worldId: id, engineEpoch: 2 }),
    );
    assert.equal(requests.length, 1);
    return { owner, id, world, request: requests[0]!, work, parsed, at };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function view(f: F, owner = f.owner) {
    const world = await worlds.get({ userId: f.owner }, f.id);
    return app.transaction(owner, (sql) =>
      readAuthoredEligibilityInTransaction(sql, owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: world.version,
        storyAt: world.time,
      }),
    );
  }
  async function invite(f: F) {
    const actor = (await attempts.read(f.owner, { worldId: f.id, actorId: f.request.actorId }))!;
    const text = JSON.stringify({
      type: 'npc_episode_consideration',
      requestId: f.request.id,
      revision: 0,
      activity: f.request.activity,
      placeOptionIds: [],
      basisSourceIds: [`definition:${actor.definitionRef}`],
    });
    const commandId = randomUUID();
    const { receipt } = await attempts.accept(f.owner, {
      id: randomUUID(),
      worldId: f.id,
      commandId,
      inputHash: createHash('sha256').update(text).digest('hex'),
      channel: 'private',
      threadId: actor.actorId,
      recipientActorId: actor.actorId,
      expectedWorldVersion: f.world.version,
      receivedAt: new Date().toISOString(),
      storyAt: f.world.time,
      origin: 'coordination',
      text,
    });
    const snapshot = (
      await readPrivateAgentSnapshot(
        app,
        f.owner,
        f.world,
        actor.actorId,
        receipt,
        f.world.time,
        actor,
      )
    ).snapshot;
    const episode = snapshot.sources.find((s) => s.id.startsWith('episode-intent:'));
    assert.ok(episode);
    const basis = [snapshot.input.sourceId, episode.id];
    let calls = 0;
    const claim = {
      id: randomUUID(),
      worldId: f.id,
      actorId: actor.actorId,
      commandId,
      inputReceiptId: receipt.id,
      engineEpoch: 2,
      expectedWorldVersion: f.world.version,
      expectedActorRevision: actor.revision,
      inputHash: receipt.inputHash,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    await runNpcAgent(
      {
        attempts,
        kernel: new PostgresNpcAgentKernel(app, worlds),
        model: {
          async decide() {
            calls++;
            return {
              statements: [{ text: '愿意一起商量一下安排吗？', dependsOnActionIds: ['invite'] }],
              goals: [
                {
                  id: 'offer',
                  summary: '询问一次安排',
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
                  parameters: { title: 'PG_STAGE_INVITATION', at: f.at },
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
                requestId: f.request.id,
                choice: 'engage',
                reason: '本人选择发起询问。',
                sourceIds: basis,
              },
            };
          },
        },
      },
      f.owner,
      claim,
      snapshot,
    );
    assert.equal(calls, 1);
    const world = await worlds.get({ userId: f.owner }, f.id);
    const appointment = world.appointments.find((a) => a.title === 'PG_STAGE_INVITATION');
    assert.ok(appointment);
    return { world, appointment };
  }

  await t.test(
    'proposed, presented and actual invitation action are insufficient; actual accepted whole result unlocks next stage and replays',
    async () => {
      const f = await fixture();
      const initial = await view(f);
      assert.equal(initial.eligibility.find((e) => e.ref.nodeKey === 'follow')!.status, 'blocked');
      const { world, appointment } = await invite(f);
      const presented = await view(f);
      assert.equal(
        presented.eligibility.find((e) => e.ref.nodeKey === 'follow')!.status,
        'blocked',
      );
      assert.equal(
        (
          await app.transaction(f.owner, (sql) =>
            readEpisodeOutcomeProgress(sql, f.owner, presented.catalog),
          )
        ).length,
        0,
      );
      const command = {
        commandId: randomUUID(),
        worldId: f.id,
        id: appointment.id,
        expectedVersion: world.version,
        operation: 'accept' as const,
      };
      await worlds.respondToInvitation({ userId: f.owner }, command);
      const completed = await view(f);
      const progress = await app.transaction(f.owner, (sql) =>
        readEpisodeOutcomeProgress(sql, f.owner, completed.catalog),
      );
      assert.equal(progress.length, 1);
      assert.deepEqual(
        progress.map((p) => (p.kind === 'resolved' ? p.outcome : null)),
        ['committed'],
      );
      const stages = deriveAuthoredStageProgress(completed.catalog, progress);
      assert.equal(stages.length, 1);
      assert.equal(stages[0]!.sourceId, progress[0]!.sourceId);
      const next = completed.eligibility.find((e) => e.ref.nodeKey === 'follow')!;
      assert.equal(next.status, 'eligible');
      assert.deepEqual(next.basisSourceIds, [progress[0]!.sourceId]);
      const currentWorld = await worlds.get({ userId: f.owner }, f.id);
      const director = await snapshots.read(f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: currentWorld.version,
        candidates: [],
        blockers: [],
      });
      assert.equal(
        director.authoredEligibility!.find((e) => e.nodeKey === 'follow')!.status,
        'eligible',
      );
      assert.equal(director.evaluationCause?.kind, 'authored_eligibility');
      assert.ok(
        director.evaluationCause?.kind === 'authored_eligibility' &&
          director.evaluationCause.qualifications.some((q) => q.nodeKey === 'follow'),
      );
      const rows = await app.transaction(f.owner, (sql) =>
        sql.query(
          'SELECT r.*,ep.document episode FROM parallel_life.agent_episode_outcomes r JOIN parallel_life.shared_episodes ep ON ep.world_id=r.world_id AND ep.owner_id=r.owner_id AND ep.id=r.episode_id WHERE r.world_id=$1',
          [f.id],
        ),
      );
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].episode.status, 'resolved');
      await worlds.respondToInvitation({ userId: f.owner }, command);
      const replay = await view(f);
      assert.deepEqual(
        replay.eligibility.find((e) => e.ref.nodeKey === 'follow'),
        next,
      );
      const other = randomUUID();
      await new IdentityRepository(app).ensureGuest(other);
      await assert.rejects(view(f, other), { code: 'NOT_FOUND' });
      assert.equal(
        (
          await app.transaction(other, (sql) =>
            sql.query('SELECT id FROM parallel_life.agent_episode_outcomes WHERE world_id=$1', [
              f.id,
            ]),
          )
        ).rows.length,
        0,
      );
      const unchanged = await works.get(staff, f.work.id);
      assert.equal(unchanged.draftVersion, f.work.draftVersion);
      assert.deepEqual(unchanged.draft.content, f.parsed);
    },
  );
  await t.test(
    'declining an acceptance-only whole objective leaves the next stage blocked',
    async () => {
      const f = await fixture();
      const { world, appointment } = await invite(f);
      await worlds.respondToInvitation(
        { userId: f.owner },
        {
          commandId: randomUUID(),
          worldId: f.id,
          id: appointment.id,
          expectedVersion: world.version,
          operation: 'cancel',
        },
      );
      const current = await view(f);
      assert.equal(current.eligibility.find((e) => e.ref.nodeKey === 'follow')!.status, 'blocked');
      assert.deepEqual(
        await app.transaction(f.owner, (sql) =>
          readEpisodeOutcomeProgress(sql, f.owner, current.catalog),
        ),
        [],
      );
    },
  );
  await t.test(
    'old missing stage rule remains blocked after a real whole-event completion',
    async () => {
      const f = await fixture({ stageRule: false });
      const { world, appointment } = await invite(f);
      await worlds.respondToInvitation(
        { userId: f.owner },
        {
          commandId: randomUUID(),
          worldId: f.id,
          id: appointment.id,
          expectedVersion: world.version,
          operation: 'accept',
        },
      );
      const current = await view(f);
      const progress = await app.transaction(f.owner, (sql) =>
        readEpisodeOutcomeProgress(sql, f.owner, current.catalog),
      );
      assert.equal(progress.length, 1);
      assert.deepEqual(deriveAuthoredStageProgress(current.catalog, progress), []);
      assert.equal(current.eligibility.find((e) => e.ref.nodeKey === 'follow')!.status, 'blocked');
    },
  );
  await t.test(
    'an explicitly authored declined-response whole objective can legitimately finish its own stage',
    async () => {
      const f = await fixture({ response: 'declined' });
      const { world, appointment } = await invite(f);
      await worlds.respondToInvitation(
        { userId: f.owner },
        {
          commandId: randomUUID(),
          worldId: f.id,
          id: appointment.id,
          expectedVersion: world.version,
          operation: 'cancel',
        },
      );
      const current = await view(f);
      assert.equal(current.eligibility.find((e) => e.ref.nodeKey === 'follow')!.status, 'eligible');
      assert.equal(
        (await worlds.get({ userId: f.owner }, f.id)).appointments.find(
          (a) => a.id === appointment.id,
        )!.status,
        'cancelled',
      );
    },
  );
});
