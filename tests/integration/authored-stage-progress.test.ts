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
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
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
import {
  DIRECTOR_WIRE_PROTOCOL,
  directorWireCatalog,
} from '../../src/modules/world/infrastructure/director-model-protocol.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { validateActorEpisodeIntentSnapshotInTransaction } from '../../src/modules/world/infrastructure/actor-episode-intent-repository.ts';
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
  type FixtureOptions = {
    completion?: boolean;
    response?: 'accepted' | 'declined';
    stageRule?: boolean;
    opening?: 'authored' | 'legacy-inferred';
  };
  async function prepareFixture(options: FixtureOptions = {}) {
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
    if (options.opening === 'authored') {
      content.openingEventKey = 'follow';
      content.candidates[1].timeline = timeline('first');
      content.timeline.stages.pop();
    }
    if (options.opening === 'legacy-inferred') {
      delete content.timeline;
      for (const candidate of content.candidates) delete candidate.timeline;
    }
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
    return { owner, id, world, snapshot, work, parsed, at };
  }
  async function fixture(options: FixtureOptions = {}) {
    const prepared = await prepareFixture(options);
    const { owner, id, world, snapshot } = prepared;
    assert.equal(snapshot.authoredStory?.openingEventKey, null);
    assert.deepEqual(snapshot.deliberationWindow?.nodeKeys, ['offer']);
    let calls = 0;
    await runDirectorAgent(
      {
        attempts: directors,
        parse: parseDirectorDecision,
        model: new WorldDirectorAgentModel({
          async complete() {
            calls++;
            const catalog = directorWireCatalog(snapshot);
            const [event] = catalog.events;
            assert.ok(event);
            const actorTasks = Object.fromEntries(
              catalog.actors.map((actor) => [
                actor.ref,
                actor.actorId === world.actors[0]!.id
                  ? {
                      topic: '商量一次安排',
                      personalObjective: '了解对方是否愿意参加',
                      proposedInteraction: '询问是否愿意，尊重对方决定。',
                    }
                  : null,
              ]),
            );
            return JSON.stringify({
              protocol: DIRECTOR_WIRE_PROTOCOL,
              openingContext: null,
              candidates: [],
              authoredChoices: {
                [event.ref]: {
                  kind: 'consider',
                  opportunity: {
                    title: '询问安排机会',
                    description: '人物可自行决定怎样邀请。',
                    playerImpact: '可以拒绝。',
                    places: [],
                    activity: 'conversation',
                    actorTasks,
                    actorTopics: null,
                  },
                },
              },
              opportunities: [],
              audit: { reason: '合成数据库协议验收', sourceRefs: [] },
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
    return { ...prepared, request: requests[0]! };
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
  async function deliver(f: F, ask = false) {
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
    const observation = snapshot.observations.find((o) => o.sourceId === episode.id);
    assert.ok(observation);
    if (f.parsed.candidates[0]?.direction?.progress?.completion?.scope === 'invitation_response') {
      assert.match(observation.text, /appointment\.propose/);
      assert.ok(observation.text.includes(f.at));
      const prior = structuredClone(snapshot);
      const oldObservation = prior.observations.find((o) => o.sourceId === episode.id)!;
      oldObservation.text = observation.text.split('\n本事项的可选入场步骤')[0]!;
      await app.transaction(f.owner, (sql) =>
        validateActorEpisodeIntentSnapshotInTransaction(sql, f.owner, prior),
      );
      oldObservation.text += '\n未经授权的额外指令';
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          validateActorEpisodeIntentSnapshotInTransaction(sql, f.owner, prior),
        ),
        { code: 'AGENT_REVISION_CONFLICT' },
      );
    } else assert.doesNotMatch(observation.text, /appointment\.propose/);
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
            if (ask) {
              const responsibilityId = f.request.id + ':followup';
              return {
                statements: [
                  {
                    text: '你能告诉我进货清单上还缺哪几样吗？',
                    dependsOnActionIds: [],
                    requestsPlayerReply: true,
                    questionForResponsibilityId: responsibilityId,
                  },
                ],
                goals: [],
                plans: [],
                actions: [],
                decisions: [],
                responsibilities: [
                  {
                    id: responsibilityId,
                    subject: { kind: 'request', id: f.request.id },
                    summary: '等玩家说明进货清单缺项',
                    sourceIds: basis,
                    status: 'waiting',
                    waitingOn: 'player',
                    nextCheck: [],
                  },
                ],
                episodeDecision: {
                  requestId: f.request.id,
                  choice: 'engage',
                  reason: '先核对缺项。',
                  sourceIds: basis,
                },
              };
            }
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
    return world;
  }
  async function invite(f: F) {
    const world = await deliver(f);
    const appointment = world.appointments.find((a) => a.title === 'PG_STAGE_INVITATION');
    assert.ok(appointment);
    return { world, appointment };
  }

  await t.test('a shown non-invitation task follows the real question resolution', async () => {
    const f = await fixture({ completion: false });
    const records = new PostgresPlayerRecords(app);
    const playerTask = async () =>
      (await records.read(f.owner, f.id)).current.find((r) => r.task?.kind === 'address_request');
    assert.equal(await playerTask(), undefined);
    await deliver(f, true);
    const task = await playerTask();
    assert.ok(task);
    assert.equal(task.task?.reason, '你能告诉我进货清单上还缺哪几样吗？');
    assert.deepEqual(task.navigation, { app: 'wechat', actorId: f.request.actorId });
    for (const [text, relation] of [
      ['等一下', 'defer_answer'],
      ['还缺包装纸', 'answer'],
    ] as const) {
      const world = await worlds.get({ userId: f.owner }, f.id);
      const actor = (await attempts.read(f.owner, { worldId: f.id, actorId: f.request.actorId }))!;
      const question = actor.questions!.find((q) => q.status === 'open')!;
      const commandId = randomUUID();
      const { receipt } = await attempts.accept(f.owner, {
        id: randomUUID(),
        worldId: f.id,
        commandId,
        inputHash: createHash('sha256').update(text).digest('hex'),
        channel: 'private',
        threadId: actor.actorId,
        recipientActorId: actor.actorId,
        expectedWorldVersion: world.version,
        receivedAt: new Date().toISOString(),
        storyAt: world.time,
        origin: 'player',
        text,
      });
      const { snapshot } = await readPrivateAgentSnapshot(
        app,
        f.owner,
        world,
        actor.actorId,
        receipt,
        world.time,
        actor,
      );
      await runNpcAgent(
        {
          attempts,
          kernel: new PostgresNpcAgentKernel(app, worlds),
          model: {
            async decide() {
              return {
                statements: [{ text: '知道了。', dependsOnActionIds: [] }],
                goals: [],
                plans: [],
                actions: [],
                responsibilities: [],
                decisions: [],
                replyAssessments: [
                  { questionId: question.id, sourceId: receipt.id, quote: text, relation },
                ],
              };
            },
          },
        },
        f.owner,
        {
          id: randomUUID(),
          worldId: f.id,
          actorId: actor.actorId,
          commandId,
          inputReceiptId: receipt.id,
          engineEpoch: 2,
          expectedWorldVersion: world.version,
          expectedActorRevision: actor.revision,
          inputHash: receipt.inputHash,
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 120000).toISOString(),
        },
        snapshot,
      );
      assert.equal((await playerTask())?.id, relation === 'answer' ? undefined : task.id);
    }
  });

  for (const opening of ['authored', 'legacy-inferred'] as const) {
    await t.test(`keeps the ${opening} opening eligible`, async () => {
      const { snapshot } = await prepareFixture({ opening });
      assert.equal(snapshot.authoredStory?.openingEventKey, 'follow');
      assert.deepEqual(snapshot.deliberationWindow?.nodeKeys, ['follow']);
    });
  }

  await t.test(
    'proposed, presented and actual invitation action are insufficient; actual accepted whole result unlocks next stage and replays',
    async () => {
      const f = await fixture();
      const initial = await view(f);
      assert.equal(initial.eligibility.find((e) => e.ref.nodeKey === 'follow')!.status, 'blocked');
      const records = new PostgresPlayerRecords(app);
      assert.equal(
        (await records.read(f.owner, f.id)).current.some((r) => r.task),
        false,
      );
      const { world, appointment } = await invite(f);
      const recordId = `sys/invitation/${f.id}/${appointment.id}`;
      const pending = (await records.read(f.owner, f.id)).current.find((r) => r.id === recordId);
      assert.deepEqual(pending?.task, {
        kind: 'decide_invitation',
        recommended: true,
        reason: '愿意一起商量一下安排吗？',
      });
      assert.deepEqual(pending?.navigation, { app: 'calendar', invitationId: appointment.id });
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
      const confirmed = (await records.read(f.owner, f.id)).current.find((r) => r.id === recordId);
      assert.equal(confirmed?.task?.kind, 'attend_invitation');
      assert.equal(confirmed?.task?.recommended, true);
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
      await assert.rejects(records.read(other, f.id), { code: 'NOT_FOUND' });
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
