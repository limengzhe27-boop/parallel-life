import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { ApprovedSeedSchema } from '../../src/contracts/seeds.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import { worldAppData } from '../../src/features/phone/world-app-data.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';

// Synthetic model outputs and pixels test real PostgreSQL persistence, never supplier AI success.
test('genesis links persist atomically, keep original assets and replay invitation decisions by version', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    other = randomUUID(),
    dir = await mkdtemp(path.join(tmpdir(), 'pl-boot-p-'));
  const builds = new BuildRepository(db),
    worlds = new PostgresWorldRepository(db),
    records = new PostgresPlayerRecords(db);
  const assets = new AssetRepository(db, new PrivateDiskStore(dir));
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const bytes = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#227755' },
    })
      .png()
      .toBuffer();
    const photo = await assets.upload(owner, bytes),
      unselected = await assets.upload(owner, bytes);
    const people = [0, 1].map((i) => ({
      id: randomUUID(),
      name: 'Synthetic ' + i,
      relationship: 'friend',
      assetId: photo.id,
    }));
    const profiles = new ProfileRepository(db);
    let profile = await profiles.get(owner);
    for (const person of people)
      profile = await profiles.edit(owner, {
        expectedVersion: profile.version,
        operation: { kind: 'set-person', person },
      });
    async function create(withPeople = true) {
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: 1,
        directionId: randomUUID(),
        story: {
          title: 'Synthetic source-linked workshop',
          premise: 'Organize parts together',
          opening: 'Consider a proposed appointment',
          tradeoff: 'Limited space',
        },
        facts: [],
        people: withPeople ? people : [],
        personRoles: withPeople ? people.map((p) => ({ personId: p.id, role: 'friend' })) : [],
        assets: withPeople ? [{ assetId: photo.id, revision: photo.revision }] : [],
        portraitAssetId: null,
      });
      await db.transaction(owner, (s) =>
        s.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [seed.id, owner, profile.id, randomUUID(), 'explicit-p-fixture', seed],
        ),
      );
      const request = { seedId: seed.id, commandId: randomUUID() },
        build = await builds.create(owner, request),
        lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
      assert(lease);
      return { seed, request, build, lease };
    }
    async function execute(f: Awaited<ReturnType<typeof create>>, bad = '', abort = false) {
      let calls = 0;
      const controller = new AbortController();
      const planner = new WorldPlanner(
        {
          async complete(messages) {
            calls++;
            const input = JSON.parse(messages[1]!.content);
            if (calls === 1)
              return JSON.stringify({
                identity: 'Workshop owner',
                setting: 'Local workshop',
                actors: ['a', 'b', 'c', 'd'].map((key, i) => ({
                  key,
                  name: people[i]?.name ?? key,
                  relationship: 'friend',
                  persona: 'HIDDEN_PRIVATE_' + key,
                  ...(f.seed.people[i] ? { sourcePersonId: f.seed.people[i]!.id } : {}),
                })),
                messages: [{ actorKey: 'a', text: 'Ready to discuss?' }],
                notes: [{ title: 'Private', text: 'HIDDEN_NOTE' }],
              });
            const groups = input.cast.map((a: { actorIndex: number }) => ({
              actorIndex: a.actorIndex,
              messages: [
                {
                  minutesBeforeStart: 1440 + a.actorIndex,
                  ...(a.actorIndex === 0
                    ? bad === 'quote'
                      ? { text: 'Old private 0', connection: { quote: 'Not in source' } }
                      : {
                          invitation: {
                            slotId: 'next_morning',
                            body:
                              bad === 'date'
                                ? '周末一起整理配件，愿意来吗？'
                                : '一起整理配件，你愿意来吗？',
                            ...(bad === 'state' ? { status: 'confirmed' } : {}),
                          },
                        }
                    : {
                        text: 'Old private ' + a.actorIndex,
                        ...(a.actorIndex === 1 && f.seed.people.length
                          ? { connection: { quote: 'Old private 1' } }
                          : {}),
                      }),
                },
              ],
            }));
            if (abort) controller.abort();
            return JSON.stringify({ groups });
          },
        },
        { historyEnabled: true, historyMode: 'two-step', historyLinksEnabled: bad !== 'disabled' },
      );
      await buildHandler(queue, planner, 'explicit-fixture')(f.lease, controller.signal);
      return calls;
    }
    await t.test(
      'shared selected image is a reference for two private sources, no unselected image leaks',
      async () => {
        const f = await create();
        assert.equal(await execute(f), 2);
        const state = await worlds.get({ userId: owner }, f.build.worldId),
          phone = await builds.phone(owner, state.id),
          data = worldAppData(phone),
          r = await records.read(owner, state.id);
        assert.equal(phone.historyLinks!.length, 2);
        assert.equal(phone.photos!.length, 1);
        assert(phone.historyLinks!.every((e) => e.photoIds[0] === photo.id));
        assert(!JSON.stringify(phone).includes(unselected.id));
        assert.equal(phone.photos![0]!.date, photo.createdAt);
        assert.equal(phone.photos![0]!.revision, photo.revision);
        assert.equal(r.history.filter((x) => x.kind === 'history_message').length, 2);
        assert.equal(r.current[0]!.state, 'proposed');
        assert.equal(data.photos[0]!.links!.length, 2);
        assert.equal(data.invitations[0]!.links!.length, 2);
        assert(!JSON.stringify(phone).includes('HIDDEN_'));
        assert(!JSON.stringify(r).includes('HIDDEN_'));
        const first = phone.historyLinks![0]!,
          second = phone.historyLinks![1]!;
        assert.equal(actorContext(state, second.actorId, 'parts').appointments.length, 0);
        assert.equal(
          actorContext(state, first.actorId, 'parts', [], new Set([first.messageId])).appointments
            .length,
          0,
        );
        await assert.rejects(builds.phone(other, state.id));
        await assert.rejects(records.read(other, state.id));
        assert.equal((await builds.create(owner, f.request)).worldId, state.id);
        const snapshot = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [state.id],
          )
        ).rows[0].state;
        const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
          before = hash(snapshot);
        const id = state.appointments[0]!.id,
          accept = {
            commandId: randomUUID(),
            worldId: state.id,
            id,
            expectedVersion: 0,
            operation: 'accept' as const,
          };
        const accepted = await worlds.respondToInvitation({ userId: owner }, accept);
        assert.equal(accepted.appointments[0]!.status, 'confirmed');
        await worlds.respondToInvitation(
          { userId: owner },
          {
            commandId: randomUUID(),
            worldId: state.id,
            id,
            expectedVersion: 1,
            operation: 'reschedule',
            at: new Date(Date.parse(state.appointments[0]!.at) + 60000).toISOString(),
          },
        );
        await worlds.respondToInvitation(
          { userId: owner },
          {
            commandId: randomUUID(),
            worldId: state.id,
            id,
            expectedVersion: 2,
            operation: 'cancel',
          },
        );
        const old = await worlds.respondToInvitation({ userId: owner }, accept);
        assert.equal(old.version, 1);
        assert.equal(old.appointments[0]!.status, 'confirmed');
        assert.equal((await worlds.get({ userId: owner }, state.id)).appointments.length, 1);
        const latest = await records.read(owner, state.id),
          record = latest.history.find((x) => x.kind === 'invitation')!;
        assert.equal(record.state, 'cancelled');
        assert.equal(record.source.kind, 'world_event');
        assert.equal(record.origin!.kind, 'world_genesis');
        const events = (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
            [state.id],
          )
        ).rows.map((r) => r.payload);
        const replay = replayWorldHistory(snapshot, events, events.length);
        assert.equal(replay.world.appointments[0]!.status, 'cancelled');
        assert.equal(replay.world.mediaRequests.length, 0);
        assert.equal(
          hash(
            (
              await admin.query(
                'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
                [state.id],
              )
            ).rows[0].state,
          ),
          before,
        );
        await assert.rejects(
          admin.query("UPDATE parallel_life.assets SET status='failed' WHERE id=$1", [photo.id]),
          { code: '23514' },
        );
        for (const person of people)
          profile = await profiles.edit(owner, {
            expectedVersion: profile.version,
            operation: { kind: 'set-person', person: { ...person, assetId: null } },
          });
        assert(
          (await builds.phone(owner, state.id)).historyLinks!.every(
            (e) => e.photoIds[0] === photo.id,
          ),
        );
        await admin.query("UPDATE parallel_life.assets SET status='failed' WHERE id=$1", [
          photo.id,
        ]);
        assert(
          (await builds.phone(owner, state.id)).historyLinks!.every((e) => e.photoIds.length === 0),
        );
        assert(
          (await records.read(owner, state.id)).history
            .filter((x) => x.kind === 'history_message')
            .every((x) => !x.relatedLinks!.some((l) => l.app === 'photos')),
        );
        await admin.query("UPDATE parallel_life.assets SET status='ready' WHERE id=$1", [photo.id]);
      },
    );
    await t.test(
      'same owner second world has independent genesis IDs and no photos when not selected',
      async () => {
        const f = await create(false);
        assert.equal(await execute(f), 2);
        const phone = await builds.phone(owner, f.build.worldId);
        assert.equal(phone.photos!.length, 0);
        assert.equal(phone.historyLinks!.length, 1);
        assert.equal(phone.historyLinks![0]!.source.worldId, f.build.worldId);
        assert.equal(phone.historyLinks![0]!.photoIds.length, 0);
        assert.equal((await records.read(owner, f.build.worldId)).current.length, 1);
      },
    );
    await t.test(
      'invalid quote/date/state and cancelled second stage cannot persist a half-world',
      async () => {
        for (const bad of ['quote', 'date', 'state', 'abort', 'disabled']) {
          const f = await create(false);
          await assert.rejects(execute(f, bad, bad === 'abort'));
          const row = (
            await admin.query(
              'SELECT (SELECT count(*) FROM parallel_life.worlds WHERE id=$1)::int AS worlds,(SELECT count(*) FROM parallel_life.world_initial_snapshots WHERE world_id=$1)::int AS initial',
              [f.build.worldId],
            )
          ).rows[0];
          assert.deepEqual(row, { worlds: 0, initial: 0 });
          assert.equal(
            (await builds.list(owner)).find((b) => b.worldId === f.build.worldId)!.ready,
            false,
          );
        }
      },
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
