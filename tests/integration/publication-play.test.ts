import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { PublicationStoryRepository } from '../../src/modules/settings/infrastructure/publication-story-repository.ts';
import {
  publicationWorldCompiler,
  publicationReview,
} from '../../src/server/publication-runtime.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresAppointmentWaitRepository } from '../../src/modules/world/infrastructure/appointment-wait-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { advancePublicationStory } from '../../src/server/publication-story-service.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';

test('local real PG authored opportunity → accepted invite → real travel → wait → sourced worker scene → restored records (synthetic proposals only)', async () => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.PUBLICATION_PLAY_TEST_PORT ?? '55476'));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_publication_play_fixture'"))
      .rowCount
  )
    await admin.query(
      `CREATE ROLE pl_publication_play_fixture LOGIN PASSWORD '${cfg.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_publication_play_fixture');
  const url = (role: string, password: string) =>
    `postgresql://${role}:${password}@127.0.0.1:${cfg.port}/parallel_life_test`;
  const app = new PostgresDatabase(url('pl_app', cfg.appPassword)),
    pub = new PostgresDatabase(url('pl_publication_play_fixture', cfg.appPassword)),
    queue = new PostgresTaskQueue(url('pl_worker', cfg.workerPassword));
  try {
    const staff = randomUUID();
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [staff, '仅本地综合合成测试'],
    );
    const raw = await readFile(
      new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
      'utf8',
    );
    const c = PublishedWorldContentSchema.parse(
      JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!),
    );
    c.world.startPlaceKey = 'home';
    c.places = [
      { key: 'home', name: '小店前厅', description: '合成测试开场地点', knownAtStart: true },
      { key: 'yard', name: '小院', description: '用于合成演绎的院子', knownAtStart: true },
    ];
    c.routes = [
      { fromPlaceKey: 'home', toPlaceKey: 'yard', minutes: 20 },
      { fromPlaceKey: 'yard', toPlaceKey: 'home', minutes: 20 },
    ];
    c.phone.invitations = [];
    for (const h of c.history) if (h.placeKey) h.placeKey = 'home';
    const at = new Date(Date.parse(c.world.startAt) + 60 * 60 * 1000).toISOString(),
      actorKey = c.actors[0]!.key;
    c.timeline = {
      initialStageKey: 'opening',
      stages: [
        { key: 'opening', title: '开始', order: 0, afterStageKeys: [] },
        { key: 'later', title: '后续', order: 1, afterStageKeys: ['opening'] },
      ],
    };
    c.candidates = [
      {
        key: 'meeting',
        kind: 'candidate',
        title: '可以见面',
        editorialIntent: 'CURRENT_ALLOWED_SCENE_INTENT',
        actorKeys: [actorKey],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: {
          kind: 'offer_invitation',
          actorKeys: [actorKey],
          placeKey: 'yard',
          title: '到小院商量摆位',
          earliestAt: at,
        },
        timeline: {
          stageKey: 'opening',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
      {
        key: 'later_message',
        kind: 'candidate',
        title: '后续',
        editorialIntent: 'FUTURE_UNDISCLOSED_SCENE_SENTINEL',
        actorKeys: [actorKey],
        prerequisites: [
          { kind: 'not_before', at: new Date(Date.parse(at) + 86400000).toISOString() },
        ],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'offer_message', actorKey, text: '未来可选来信' },
        timeline: {
          stageKey: 'later',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
    ];
    const trials = new PublicationWorldRepository(pub, publicationWorldCompiler),
      works = new PublicationRepository(
        pub,
        publicationReview((w, v, h) => trials.trialEvidence(staff, w, v, h)),
      );
    const preflight = compilePublicationGenesis({
      content: c,
      originKind: 'trial',
      origin: {
        workId: randomUUID(),
        draftVersion: 0,
        publicationVersion: 0,
        contentHash: 'a'.repeat(64),
      },
      worldId: randomUUID(),
      ownerId: randomUUID(),
      seedId: randomUUID(),
      newId: randomUUID,
    });
    assert.equal(
      preflight.status,
      'compiled',
      JSON.stringify(preflight.status === 'compiled' ? {} : preflight.issues),
    );
    const work = await works.create(staff, {
        commandId: randomUUID(),
        title: c.work.title,
        content: c,
      }),
      trial = await trials.startTrial(staff, work.id, {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: work.draft.contentHash,
      }),
      scope = await trials.trialSession(staff, trial.trialId!);
    const owner = scope.ownerId,
      world = scope.worldId,
      runtime = new PostgresWorldRepository(app),
      clock = new PostgresClockStore(app),
      story = new PublicationStoryRepository(app);
    await clock.setClock(owner, world, { paused: false });
    let calls = 0;
    await advancePublicationStory(
      {
        worlds: runtime,
        clock,
        story,
        now: () => new Date().toISOString(),
        newId: randomUUID,
        planner: {
          async propose({ context }) {
            calls++;
            return {
              schemaVersion: 1,
              effects: [
                {
                  type: 'message.received',
                  id: 'local',
                  actorId: context.actor.id,
                  text: '有空来小院商量一下摆位吗？',
                },
                {
                  type: 'appointment.proposed',
                  id: 'local_invite',
                  title: '到小院商量摆位',
                  at,
                  participantIds: [context.actor.id],
                },
              ],
            };
          },
        },
      },
      owner,
      world,
      false,
    );
    assert.equal(calls, 1);
    let state = await runtime.get({ userId: owner }, world);
    const invitation = state.appointments.find((a) => a.title === '到小院商量摆位')!;
    assert.equal(invitation.status, 'proposed');
    assert.equal(state.space!.currentPlaceId, 'home');
    state = await runtime.respondToInvitation(
      { userId: owner },
      {
        worldId: world,
        id: invitation.id,
        commandId: randomUUID(),
        expectedVersion: state.version,
        operation: 'accept',
      },
    );
    await story.progress(owner, world);
    assert.equal(state.appointments.find((a) => a.id === invitation.id)!.status, 'confirmed');
    const space = new PostgresWorldSpace(app, { list: () => [], get: () => undefined });
    const map = await space.read(owner, world),
      route = map.routes.find((r) => r.toPlaceId === 'yard')!;
    await space.travel(owner, world, {
      commandId: randomUUID(),
      expectedVersion: map.worldVersion,
      routeId: route.id,
    });
    state = await runtime.get({ userId: owner }, world);
    const wait = new PostgresAppointmentWaitRepository(app),
      input = {
        commandId: randomUUID(),
        invitationId: invitation.id,
        expectedVersion: state.version,
      };
    const receipt = await wait.wait(owner, world, input);
    assert.equal(receipt.storyNow, at);
    assert.equal(
      (await runtime.get({ userId: owner }, world)).appointments.find(
        (a) => a.id === invitation.id,
      )!.status,
      'confirmed',
    );
    const scenes = new SceneRepository(app),
      entered = await scenes.enter(owner, world, {
        commandId: randomUUID(),
        expectedVersion: receipt.version,
        appointmentId: invitation.id,
      });
    await runOne(
      {
        claim: (k) => queue.claimForOwner(entered.task!.id, owner, k),
        renew: (l) => queue.renew(l),
        finish: (l, o) => queue.finish(l, o),
      },
      {
        world: sceneTaskHandler(
          queue,
          {
            async propose(context) {
              assert.equal(
                context.currentOfferBrief?.editorialIntent,
                'CURRENT_ALLOWED_SCENE_INTENT',
              );
              assert.ok(!JSON.stringify(context.currentOfferBrief).includes('FUTURE_UNDISCLOSED'));
              return {
                location: '小院',
                narration: '院子里摆着两把椅子。',
                presentActorIds: [
                  context.world.actors.find((a) => a.id === invitation.participantIds[0])!.id,
                ],
                outcome: null,
                observation: null,
                matterTitle: null,
                matterUpdates: [],
                dialogues: [
                  { actorId: invitation.participantIds[0]!, text: '先坐吧，我们看看桌子摆哪边。' },
                ],
              };
            },
          },
          'synthetic_local_no_provider',
        ),
      },
    );
    const actual = await scenes.read(owner, world);
    assert.ok(actual.entries.some((e) => e.kind === 'dialogue'));
    const restored = await runtime.get({ userId: owner }, world);
    assert.equal(restored.appointments.find((a) => a.id === invitation.id)!.status, 'attended');
    assert.deepEqual(await wait.wait(owner, world, input), receipt);
    await new PostgresPlayerRecords(app).read(owner, world);
    assert.equal(
      (await trials.trialEvidence(staff, work.id, 0, work.draft.contentHash)).verified,
      true,
    );
    await clock.setClock(owner, world, { paused: true });
  } finally {
    await queue.close();
    await app.close();
    await pub.close();
    await admin.end();
  }
});
