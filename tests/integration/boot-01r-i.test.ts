import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { ApprovedSeedSchema } from '../../src/contracts/seeds.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { historyInvitationSchedule } from '../../src/modules/world/domain/history-invitations.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';

// Real PostgreSQL / uploaded pixels, explicit synthetic model outputs; no paid provider.
test('R runtime-rendered invitations keep one immutable source and no model timing DTO in storage', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
  const owner = randomUUID(),
    dir = await mkdtemp(path.join(tmpdir(), 'pl-boot-r-'));
  const builds = new BuildRepository(db),
    worlds = new PostgresWorldRepository(db),
    records = new PostgresPlayerRecords(db);
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const photo = await new AssetRepository(db, new PrivateDiskStore(dir)).upload(
      owner,
      await sharp({ create: { width: 80, height: 80, channels: 3, background: '#227755' } })
        .png()
        .toBuffer(),
    );
    const person = {
      id: randomUUID(),
      name: 'Synthetic material friend',
      relationship: 'friend',
      assetId: photo.id,
    };
    const profiles = new ProfileRepository(db);
    let profile = await profiles.get(owner);
    profile = await profiles.edit(owner, {
      expectedVersion: profile.version,
      operation: { kind: 'set-person', person },
    });
    async function prepare() {
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: 1,
        directionId: randomUUID(),
        story: {
          title: 'R synthetic workshop',
          premise: 'Discuss parts',
          opening: 'A proposed visit',
          tradeoff: 'Small shop',
        },
        facts: [],
        people: [person],
        personRoles: [{ personId: person.id, role: '同级修车铺搭档' }],
        assets: [{ assetId: photo.id, revision: photo.revision }],
        portraitAssetId: null,
      });
      await db.transaction(owner, (s) =>
        s.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [seed.id, owner, profile.id, randomUUID(), 'explicit-r-fixture', seed],
        ),
      );
      const build = await builds.create(owner, { seedId: seed.id, commandId: randomUUID() }),
        lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
      assert(lease);
      return { build, lease };
    }
    const body = '带上那套旧配件来铺里，一起核对型号好吗？';
    function planner(mode: string) {
      let calls = 0,
        startAt = '',
        expectedText = '',
        historyInputs: string[] = [];
      const planner = new WorldPlanner(
        {
          async complete(messages) {
            calls++;
            const input = JSON.parse(messages[1]!.content);
            if (calls === 1) {
              startAt = input.storyTime.startAt;
              return JSON.stringify({
                identity: 'Workshop owner',
                setting: 'Local workshop',
                actors: [
                  {
                    key: 'person_0',
                    name: person.name,
                    relationship: '同级修车铺搭档',
                    persona: 'PRIVATE_PERSONA_R',
                  },
                  { key: 'b', name: 'Other', relationship: 'neighbor', persona: 'PRIVATE_OTHER_R' },
                  { key: 'c', name: 'Third', relationship: 'neighbor', persona: 'PRIVATE_THIRD_R' },
                ],
                messages: [{ actorKey: 'person_0', text: '配件到了，想问问你。' }],
                notes: [{ title: 'Hidden', text: 'PRIVATE_NOTE_R' }],
              });
            }
            assert.equal(input.storyTime.startAt, startAt);
            assert.equal(input.cast[0].relationship, '同级修车铺搭档');
            assert(!messages[1]!.content.includes('PRIVATE_'));
            assert.deepEqual(input.invitationSlots, historyInvitationSchedule(startAt).slots);
            historyInputs.push(messages[1]!.content);
            expectedText = historyInvitationSchedule(startAt).render({
              slotId: 'next_morning',
              body,
            }).text;
            const invitation =
              mode === 'bad-slot'
                ? { slotId: 'invented', body }
                : mode === 'bad-time'
                  ? { slotId: 'next_morning', body: '周末一起爬山吧' }
                  : mode === 'correction' && calls === 2
                    ? { slotId: 'next_morning', body: '嗯！' }
                    : { slotId: 'next_morning', body };
            return JSON.stringify({
              groups: [
                {
                  actorIndex: 2,
                  messages: [{ text: '那几件旧工具已经分开放好了', minutesBeforeStart: 1442 }],
                },
                {
                  actorIndex: 1,
                  messages: [{ text: '那批配件已经收到', minutesBeforeStart: 1441 }],
                },
                {
                  actorIndex: 0,
                  messages: [
                    mode === 'zero'
                      ? { text: '那套旧配件已经收好', minutesBeforeStart: 1440 }
                      : { minutesBeforeStart: 1440, invitation },
                  ],
                },
              ],
            });
          },
        },
        { historyEnabled: true, historyMode: 'two-step', historyLinksEnabled: true },
      );
      return {
        planner,
        get calls() {
          return calls;
        },
        get startAt() {
          return startAt;
        },
        get expectedText() {
          return expectedText;
        },
        historyInputs,
      };
    }
    function temporaryKeys(value: unknown): boolean {
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value).some(
        ([k, v]) =>
          ['invitation', 'slotId', 'body', 'invitationSlots'].includes(k) || temporaryKeys(v),
      );
    }
    await t.test(
      'corrected history uses the same T0, original person pixels, and only normalized version1 data',
      async () => {
        const f = await prepare(),
          p = planner('correction');
        await buildHandler(
          queue,
          p.planner,
          'synthetic-r-fixture',
        )(f.lease, new AbortController().signal);
        assert.equal(p.calls, 3);
        assert.equal(p.historyInputs[0], p.historyInputs[1]);
        const state = await worlds.get({ userId: owner }, f.build.worldId),
          phone = await builds.phone(owner, state.id),
          r = await records.read(owner, state.id);
        assert.equal(state.appointments.length, 1);
        const a = state.appointments[0]!,
          link = phone.historyLinks![0]!,
          source = state.messages.find((m) => m.id === link.messageId)!;
        assert.equal(source.text, p.expectedText);
        assert.equal(a.title, source.text);
        assert.equal(a.sourceMessageId, source.id);
        assert.equal(a.status, 'proposed');
        assert(Date.parse(source.at) < Date.parse(p.startAt));
        assert(Date.parse(a.at) > Date.parse(p.startAt));
        assert.deepEqual(link.photoIds, [photo.id]);
        assert.equal(phone.photos![0]!.date, photo.createdAt);
        assert.equal(phone.photos![0]!.kind, 'upload');
        assert.equal(state.mediaRequests.length, 0);
        assert.equal(r.history.find((x) => x.kind === 'history_message')!.text, source.text);
        assert.equal(
          r.history.find((x) => x.kind === 'history_message')!.source.kind,
          'world_genesis',
        );
        const other = state.actors.find((x) => !x.sourcePersonId)!;
        assert.equal(actorContext(state, other.id, '').appointments.length, 0);
        const stored = (
          await db.transaction(owner, (s) =>
            s.query(
              'SELECT i.state,b.opening FROM parallel_life.world_initial_snapshots i JOIN parallel_life.world_builds b ON b.world_id=i.world_id WHERE i.world_id=$1',
              [state.id],
            ),
          )
        ).rows[0];
        assert(!temporaryKeys(stored));
        assert.equal(stored.opening.messageHistory.version, 1);
        assert.equal(
          stored.opening.messageHistory.messages.find((m: any) => m.connection).connection.quote,
          source.text,
        );
        assert.equal(
          (await builds.list(owner)).find((x) => x.worldId === state.id)!.task!.status,
          'succeeded',
        );
      },
    );
    await t.test(
      'unknown slots and the actual P weekend contradiction fail atomically without filling an invitation',
      async () => {
        for (const mode of ['bad-slot', 'bad-time']) {
          const f = await prepare(),
            p = planner(mode);
          await assert.rejects(
            buildHandler(
              queue,
              p.planner,
              'synthetic-r-fixture',
            )(f.lease, new AbortController().signal),
          );
          assert.equal(p.calls, 3);
          await queue.finish(f.lease, {
            status: 'failed',
            errorCode: 'AI_FAILED',
            model: 'synthetic-r-fixture',
            promptVersion: p.planner.promptVersion,
          });
          const result = (
            await admin.query(
              'SELECT (SELECT count(*) FROM parallel_life.worlds WHERE id=$1)::int AS worlds,(SELECT count(*) FROM parallel_life.world_initial_snapshots WHERE world_id=$1)::int AS initial,(SELECT count(*) FROM parallel_life.world_person_bindings WHERE world_id=$1)::int AS bindings',
              [f.build.worldId],
            )
          ).rows[0];
          assert.deepEqual(result, { worlds: 0, initial: 0, bindings: 0 });
          assert.equal(
            (await builds.list(owner)).find((x) => x.worldId === f.build.worldId)!.ready,
            false,
          );
        }
      },
    );
    await t.test(
      'a valid zero-link world stays unlinked and produces no fabricated system invitation',
      async () => {
        const f = await prepare(),
          p = planner('zero');
        await buildHandler(
          queue,
          p.planner,
          'synthetic-r-fixture',
        )(f.lease, new AbortController().signal);
        assert.equal(p.calls, 2);
        const state = await worlds.get({ userId: owner }, f.build.worldId),
          phone = await builds.phone(owner, state.id);
        assert.equal(state.appointments.length, 0);
        assert.equal(phone.historyLinks?.length ?? 0, 0);
        assert.equal(state.messages.filter((m) => m.initialRead).length, 3);
        assert.equal(state.messages.filter((m) => m.initialRead === false).length, 1);
        assert.equal(state.mediaRequests.length, 0);
      },
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
