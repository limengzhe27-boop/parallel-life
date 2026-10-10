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
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';

// Independent real PostgreSQL audit. Model completions/pixels are explicit synthetic fixtures.
test('R-Q normalized source persistence, consent versions, asset authority and atomic failure', async (t) => {
  const c = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
  const owner = randomUUID(),
    other = randomUUID(),
    dir = await mkdtemp(path.join(tmpdir(), 'boot01rq-'));
  const assets = new AssetRepository(db, new PrivateDiskStore(dir)),
    profiles = new ProfileRepository(db),
    builds = new BuildRepository(db),
    worlds = new PostgresWorldRepository(db),
    records = new PostgresPlayerRecords(db);
  try {
    for (const id of [owner, other]) await new IdentityRepository(db).ensureGuest(id);
    const bytes = await sharp({
      create: { width: 80, height: 96, channels: 3, background: '#607f96' },
    })
      .png()
      .toBuffer();
    const photo = await assets.upload(owner, bytes),
      unselected = await assets.upload(owner, bytes);
    const people = [
      { id: randomUUID(), name: '同名朋友', relationship: '同事', assetId: photo.id },
      { id: randomUUID(), name: '同名朋友', relationship: '同事', assetId: null },
    ];
    let profile = await profiles.get(owner);
    for (const person of people)
      profile = await profiles.edit(owner, {
        expectedVersion: profile.version,
        operation: { kind: 'set-person', person },
      });
    const profileBefore = JSON.stringify(profile);
    async function prepare(selected = true) {
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: 1,
        directionId: randomUUID(),
        story: {
          title: 'R Q explicit fixture',
          premise: 'A workshop appointment',
          opening: 'Some equipment remains to be sorted',
          tradeoff: 'Limited time',
        },
        facts: [],
        people: selected ? people : [],
        personRoles: selected ? people.map((p) => ({ personId: p.id, role: '同事' })) : [],
        assets: selected ? [{ assetId: photo.id, revision: photo.revision }] : [],
        portraitAssetId: null,
      });
      await db.transaction(owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [seed.id, owner, profile.id, randomUUID(), 'rq-explicit-fixture', seed],
        ),
      );
      const request = { seedId: seed.id, commandId: randomUUID() },
        build = await builds.create(owner, request),
        lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
      assert(lease);
      return { seed, request, build, lease };
    }
    async function execute(
      f: Awaited<ReturnType<typeof prepare>>,
      mode = 'linked',
      race?: () => Promise<void>,
    ) {
      let calls = 0;
      const model = {
        async complete(messages: { content: string }[]) {
          calls++;
          if (calls === 1)
            return JSON.stringify({
              identity: '合成修车铺成员',
              setting: '合成工作室',
              actors: ['a', 'b', 'c'].map((key, i) => ({
                key,
                name: i < 2 ? '同名朋友' : '第三人',
                relationship: '同事',
                persona: 'HIDDEN_PERSONA_' + key,
                ...(f.seed.people[i] ? { sourcePersonId: f.seed.people[i]!.id } : {}),
              })),
              messages: [{ actorKey: 'a', text: 'CURRENT_ONLY' }],
              notes: [{ title: 'Private', text: 'HIDDEN_NOTE' }],
            });
          const input = JSON.parse(messages[1]!.content);
          assert(!JSON.stringify(input).includes('HIDDEN_'));
          if (race) await race();
          const groups = [...input.cast].reverse().map((a: { actorIndex: number }) => ({
            actorIndex: a.actorIndex,
            messages:
              a.actorIndex === 0 && mode !== 'zero' && mode !== 'legacy'
                ? [
                    {
                      minutesBeforeStart: 1440,
                      invitation: {
                        slotId: mode === 'bad-slot' ? 'weekend' : 'next_morning',
                        body:
                          mode === 'bad-body'
                            ? '周末一起整理配件'
                            : '来铺子一起整理配件，你有空吗？',
                      },
                    },
                    {
                      minutesBeforeStart: 2880,
                      invitation: { slotId: 'next_morning', body: '一起去步道检查相机，可以吗？' },
                    },
                  ]
                : [
                    {
                      text: 'PRIVATE_OLD_' + a.actorIndex,
                      minutesBeforeStart: 4320 + a.actorIndex,
                    },
                  ],
          }));
          return JSON.stringify({ groups });
        },
      };
      await buildHandler(
        queue,
        new WorldPlanner(model, {
          historyEnabled: true,
          historyMode: 'two-step',
          historyLinksEnabled: mode !== 'legacy',
        }),
        'rq-explicit-fixture',
      )(f.lease, new AbortController().signal);
      return calls;
    }
    const f = await prepare();
    assert.equal(await execute(f), 2);
    const state = await worlds.get({ userId: owner }, f.build.worldId),
      phone = await builds.phone(owner, state.id),
      links = phone.historyLinks!,
      r = await records.read(owner, state.id);
    await t.test(
      'R09/R10/R11 two same-actor same-slot proposals retain separate source IDs and no private spread',
      async () => {
        assert.equal(links.length, 2);
        assert.equal(links[0]!.actorId, links[1]!.actorId);
        assert.notEqual(links[0]!.messageId, links[1]!.messageId);
        assert.notEqual(links[0]!.invitationId, links[1]!.invitationId);
        assert.equal(state.appointments.length, 2);
        assert.equal(state.appointments[0]!.at, state.appointments[1]!.at);
        assert(state.appointments.every((a) => a.status === 'proposed' && !a.responseAt));
        for (const link of links) {
          const m = state.messages.find((m) => m.id === link.messageId)!;
          assert.equal(m.initialRead, true);
          assert.equal(link.source.at, m.at);
          assert(Date.parse(m.at) < Date.parse(state.time));
          assert(link.source.worldId === state.id);
          assert.deepEqual(link.photoIds, [photo.id]);
          const ap = state.appointments.find((a) => a.id === link.invitationId)!;
          assert.equal(ap.sourceMessageId, m.id);
          assert.equal(ap.title, m.text);
          assert(Date.parse(ap.at) > Date.parse(state.time));
          assert.equal(new Date(Date.parse(ap.at) + 8 * 3600000).getUTCHours(), 10);
        }
        assert.equal(state.messages.filter((m) => m.initialRead === false).length, 1);
        assert.equal(state.messages.filter((m) => m.role === 'user').length, 0);
        assert.equal(r.history.filter((x) => x.kind === 'history_message').length, 2);
        assert.equal(r.current.length, 2);
        assert.equal(phone.actors[0]!.name, phone.actors[1]!.name);
        assert.notEqual(phone.actors[0]!.id, phone.actors[1]!.id);
        assert.equal(actorContext(state, state.actors[1]!.id).appointments.length, 0);
        assert(
          !JSON.stringify(actorContext(state, state.actors[1]!.id)).includes(
            state.appointments[0]!.title,
          ),
        );
        for (const link of links)
          assert.equal(
            actorContext(state, link.actorId, '', [], new Set([link.messageId])).appointments
              .length,
            1,
          );
        assert(!JSON.stringify(phone).includes('HIDDEN_'));
        assert(!JSON.stringify(r).includes('HIDDEN_'));
        assert.equal(JSON.stringify(await profiles.get(owner)), profileBefore);
        const initial = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [state.id],
          )
        ).rows[0].state;
        for (const field of ['slotId', 'body', 'invitation'])
          assert(!JSON.stringify(initial).includes('"' + field + '":'));
      },
    );
    await t.test(
      'R13 actual commands replay original consent version without merging the other proposal',
      async () => {
        const initial = (
            await admin.query(
              'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
              [state.id],
            )
          ).rows[0].state,
          hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
          before = hash(initial),
          id = state.appointments[0]!.id;
        const command = {
          worldId: state.id,
          id,
          commandId: randomUUID(),
          expectedVersion: 0,
          operation: 'accept' as const,
        };
        await worlds.respondToInvitation({ userId: owner }, command);
        await worlds.respondToInvitation(
          { userId: owner },
          {
            ...command,
            commandId: randomUUID(),
            expectedVersion: 1,
            operation: 'reschedule',
            at: new Date(Date.parse(state.appointments[0]!.at) + 3600000).toISOString(),
          },
        );
        await worlds.respondToInvitation(
          { userId: owner },
          { ...command, commandId: randomUUID(), expectedVersion: 2, operation: 'cancel' },
        );
        const old = await worlds.respondToInvitation({ userId: owner }, command);
        assert.equal(old.version, 1);
        assert.equal(old.appointments.find((a) => a.id === id)!.status, 'confirmed');
        const events = (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
            [state.id],
          )
        ).rows.map((r) => r.payload);
        assert.equal(events.length, 3);
        for (const [v, status] of ['proposed', 'confirmed', 'proposed', 'cancelled'].entries()) {
          const replay = replayWorldHistory(initial, events, v).world;
          assert.equal(replay.appointments.length, 2);
          assert.equal(replay.appointments.find((a) => a.id === id)!.status, status);
          assert.equal(replay.appointments.find((a) => a.id !== id)!.status, 'proposed');
        }
        const result = await records.read(owner, state.id),
          resolved = result.history.find((x) => x.kind === 'invitation')!;
        assert.equal(resolved.state, 'cancelled');
        assert.equal(resolved.source.kind, 'world_event');
        assert.equal(resolved.origin!.messageId, state.appointments[0]!.sourceMessageId);
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
        assert.equal((await builds.create(owner, f.request)).worldId, state.id);
      },
    );
    await t.test(
      'R03/R14 honest zero/N worlds and true private image authority remain isolated',
      async () => {
        assert.equal(phone.photos!.length, 1);
        assert.equal(phone.photos![0]!.date, photo.createdAt);
        assert.equal(
          (
            await sharp(
              await assets.readForWorld(owner, state.id, photo.id, photo.revision),
            ).metadata()
          ).width,
          80,
        );
        await assert.rejects(
          assets.readForWorld(owner, state.id, unselected.id, unselected.revision),
        );
        await assert.rejects(assets.readForWorld(other, state.id, photo.id, photo.revision));
        await assert.rejects(assets.readForWorld(owner, state.id, photo.id, photo.revision + 1));
        await assert.rejects(records.read(other, state.id));
        for (const mode of ['zero', 'legacy']) {
          const z = await prepare(false);
          await execute(z, mode);
          const p = await builds.phone(owner, z.build.worldId);
          assert.equal(p.historyLinks, undefined);
          assert.equal(p.invitations!.length, 0);
          assert.equal(p.photos!.length, 0);
          assert.equal(p.messages.filter((m) => m.initialRead === true).length, 3);
          assert.equal((await records.read(owner, p.id)).history.length, 0);
          await assert.rejects(assets.readForWorld(owner, p.id, photo.id, photo.revision));
        }
      },
    );
    await t.test(
      'R12 malformed slots/bodies, lost lease and changed asset authority leave no half-world',
      async () => {
        async function empty(worldId: string) {
          const counts = (
            await admin.query(
              'SELECT (SELECT count(*) FROM parallel_life.worlds WHERE id=$1)::int w,(SELECT count(*) FROM parallel_life.world_initial_snapshots WHERE world_id=$1)::int i,(SELECT count(*) FROM parallel_life.world_person_bindings WHERE world_id=$1)::int b,(SELECT count(*) FROM parallel_life.world_messages WHERE world_id=$1)::int m,(SELECT count(*) FROM parallel_life.world_events WHERE world_id=$1)::int e,(SELECT count(*) FROM parallel_life.outbox_jobs WHERE world_id=$1)::int o',
              [worldId],
            )
          ).rows[0];
          assert.deepEqual(counts, { w: 0, i: 0, b: 0, m: 0, e: 0, o: 0 });
        }
        for (const mode of ['bad-slot', 'bad-body']) {
          const bad = await prepare(false);
          await assert.rejects(execute(bad, mode));
          await empty(bad.build.worldId);
        }
        const lease = await prepare(false);
        await admin.query(
          "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1 AND owner_id=$2",
          [lease.lease.id, owner],
        );
        await assert.rejects(execute(lease));
        await empty(lease.build.worldId);
        const race = await prepare();
        let changed = false;
        await assert.rejects(
          execute(race, 'linked', async () => {
            if (changed) return;
            changed = true;
            for (const person of people)
              profile = await profiles.edit(owner, {
                expectedVersion: profile.version,
                operation: { kind: 'set-person', person: { ...person, assetId: null } },
              });
            await admin.query("UPDATE parallel_life.assets SET status='failed' WHERE id=$1", [
              photo.id,
            ]);
          }),
        );
        await empty(race.build.worldId);
        await admin.query("UPDATE parallel_life.assets SET status='ready' WHERE id=$1", [photo.id]);
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
