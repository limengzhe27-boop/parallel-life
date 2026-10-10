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
import { verifiedGenesisLinks } from '../../src/modules/world/domain/genesis-links.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';

// Real SQL/leases/repositories with explicit synthetic model responses and uploaded test pixels.
// No supplier calls and no assertion that these fixtures prove model storytelling quality.
test('BOOT-01P-Q independent source, privacy, lifecycle, permissions and rollback audit', async (t) => {
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    stranger = randomUUID();
  const directory = await mkdtemp(path.join(tmpdir(), 'boot01pq-'));
  const profiles = new ProfileRepository(db),
    builds = new BuildRepository(db),
    worlds = new PostgresWorldRepository(db),
    records = new PostgresPlayerRecords(db);
  const assets = new AssetRepository(db, new PrivateDiskStore(directory));
  try {
    for (const id of [owner, stranger]) await new IdentityRepository(db).ensureGuest(id);
    const pixels = await sharp({
      create: { width: 64, height: 96, channels: 3, background: '#63829a' },
    })
      .png()
      .toBuffer();
    const selected = await assets.upload(owner, pixels),
      unselected = await assets.upload(owner, pixels),
      foreign = await assets.upload(stranger, pixels);
    let profile = await profiles.get(owner);
    // Deliberately equal display names must never become identity keys.
    const people = [0, 1].map(() => ({
      id: randomUUID(),
      name: '同名朋友',
      relationship: '同事',
      assetId: selected.id,
    }));
    for (const person of people)
      profile = await profiles.edit(owner, {
        expectedVersion: profile.version,
        operation: { kind: 'set-person', person },
      });
    const profileBefore = JSON.stringify(profile);
    async function prepare(withPhotos = true) {
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: 1,
        directionId: randomUUID(),
        story: {
          title: 'Q explicit fixture',
          premise: 'A workshop plan',
          opening: 'A private invitation',
          tradeoff: 'Time is limited',
        },
        facts: [],
        people: withPhotos ? people : [],
        personRoles: withPhotos ? people.map((p) => ({ personId: p.id, role: '同事' })) : [],
        assets: withPhotos ? [{ assetId: selected.id, revision: selected.revision }] : [],
        portraitAssetId: null,
      });
      await db.transaction(owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [seed.id, owner, profile.id, randomUUID(), 'q-explicit-fixture', seed],
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
      lease = f.lease,
    ) {
      let count = 0;
      const planner = new WorldPlanner(
        {
          async complete(messages) {
            count++;
            const input = JSON.parse(messages[1]!.content);
            if (count === 1)
              return JSON.stringify({
                identity: 'Q workshop member',
                setting: 'Q workshop',
                actors: ['a', 'b', 'c'].map((key, i) => ({
                  key,
                  name: i < 2 ? '同名朋友' : '第三人',
                  relationship: '同事',
                  persona: `PRIVATE_PERSONA_${key}`,
                  ...(f.seed.people[i] ? { sourcePersonId: f.seed.people[i]!.id } : {}),
                })),
                messages: [{ actorKey: 'a', text: 'CURRENT_ONLY' }],
                notes: [{ title: 'Private', text: 'PRIVATE_NOTE_Q' }],
              });
            assert(!JSON.stringify(input).includes('PRIVATE_'));
            const local = new Date(
              Date.parse(input.storyTime.startAt) + 1440 * 60000 + 8 * 3600000,
            );
            const quote = `${local.getUTCMonth() + 1}月${local.getUTCDate()}日${local.getUTCHours()}:${String(local.getUTCMinutes()).padStart(2, '0')}一起商量场地`;
            return JSON.stringify({
              groups: [...input.cast].reverse().map((a: { actorIndex: number }) => ({
                actorIndex: a.actorIndex,
                messages: [
                  {
                    text: a.actorIndex === 0 ? quote : `PRIVATE_LETTER_${a.actorIndex}`,
                    minutesBeforeStart: 1440 + a.actorIndex,
                    ...(mode !== 'legacy' && a.actorIndex === 0
                      ? {
                          connection: {
                            quote: mode === 'bad-quote' ? 'NOT_PRESENT' : quote,
                            calendar: { minutesAfterStart: mode === 'bad-date' ? 29 : 1440 },
                            ...(mode === 'bad-role' ? { participantIds: [randomUUID()] } : {}),
                          },
                        }
                      : {}),
                  },
                ],
              })),
            });
          },
        },
        { historyEnabled: true, historyMode: 'two-step', historyLinksEnabled: mode !== 'legacy' },
      );
      await buildHandler(queue, planner, 'q-explicit-fixture')(lease, new AbortController().signal);
      return count;
    }
    const f = await prepare();
    assert.equal(await execute(f), 2);
    const state = await worlds.get({ userId: owner }, f.build.worldId),
      phone = await builds.phone(owner, state.id),
      data = worldAppData(phone),
      response = await records.read(owner, state.id);
    const link = phone.historyLinks![0]!,
      sourceMessage = state.messages.find((m) => m.id === link.messageId)!,
      invitation = state.appointments[0]!;
    await t.test(
      'P01/P03/P04 same-name source IDs, three clocks, readonly records and actor isolation',
      async () => {
        assert.equal(phone.historyLinks!.length, 1);
        assert.equal(
          response.about.some((r) => r.kind === 'history_message'),
          false,
        );
        const history = response.history.find((r) => r.kind === 'history_message')!;
        assert.equal(history.id, link.recordId);
        assert.deepEqual(history.source, link.source);
        assert.equal(sourceMessage.actorId, invitation.participantIds[0]);
        assert.equal(history.source.at, sourceMessage.at);
        assert(Date.parse(sourceMessage.at) < Date.parse(state.time));
        assert(Date.parse(invitation.at) > Date.parse(state.time));
        assert.equal(invitation.status, 'proposed');
        assert.equal(invitation.responseAt, undefined);
        assert.equal(data.invitations[0]!.origin!.at, sourceMessage.at);
        assert.equal(data.contacts[0]!.name, data.contacts[1]!.name);
        assert.notEqual(data.contacts[0]!.id, data.contacts[1]!.id);
        assert(!JSON.stringify(phone).includes('PRIVATE_PERSONA'));
        assert(!JSON.stringify(response).includes('PRIVATE_NOTE_Q'));
        const a = actorContext(state, link.actorId),
          b = actorContext(state, state.actors[1]!.id);
        assert.equal(a.appointments.length, 1);
        assert.equal(b.appointments.length, 0);
        assert(!JSON.stringify(b).includes(sourceMessage.text));
        for (const blocked of [sourceMessage.id, sourceMessage.sourceEventId])
          assert.equal(
            actorContext(state, link.actorId, '', [], new Set([blocked])).appointments.length,
            0,
          );
        assert.equal(JSON.stringify(await profiles.get(owner)), profileBefore);
        await assert.rejects(
          worlds.saveNote(
            { userId: owner },
            {
              worldId: state.id,
              commandId: randomUUID(),
              id: history.id,
              expectedVersion: 0,
              title: 'Overwrite',
              text: 'Overwrite',
            },
          ),
        );
      },
    );
    await t.test(
      'P02 domain rejection from persisted baseline; P06 actual bytes/RLS/revision/world authorization',
      async () => {
        for (const mutation of ['actor', 'message', 'world', 'current']) {
          const bad = structuredClone(state),
            entry = bad.genesisLinks!.entries[0]!;
          if (mutation === 'actor') entry.actorId = bad.actors[1]!.id;
          if (mutation === 'message') entry.messageId = randomUUID();
          if (mutation === 'world') bad.id = randomUUID();
          if (mutation === 'current') entry.messageId = bad.messages.find((m) => !m.history)!.id;
          assert.throws(() => verifiedGenesisLinks(bad), /INVALID_GENESIS_LINKS/);
        }
        const binary = await assets.readForWorld(owner, state.id, selected.id, selected.revision);
        assert.equal((await sharp(binary).metadata()).format, 'webp');
        assert.equal(phone.photos![0]!.date, selected.createdAt);
        assert.deepEqual(link.photoIds, [selected.id]);
        for (const args of [
          [owner, state.id, unselected.id, unselected.revision],
          [owner, state.id, foreign.id, foreign.revision],
          [stranger, state.id, selected.id, selected.revision],
          [owner, state.id, selected.id, selected.revision + 1],
        ] as const)
          await assert.rejects(assets.readForWorld(...args));
        await assert.rejects(records.read(stranger, state.id));
        await assert.rejects(builds.phone(stranger, state.id));
        const other = await prepare(false);
        await execute(other);
        const second = await builds.phone(owner, other.build.worldId);
        assert.equal(second.historyLinks![0]!.photoIds.length, 0);
        assert.equal(second.photos!.length, 0);
        assert.notEqual(second.historyLinks![0]!.recordId, link.recordId);
        await assert.rejects(assets.readForWorld(owner, second.id, selected.id, selected.revision));
        // Release live profile references before changing own test asset status under admin.
        for (const person of people)
          profile = await profiles.edit(owner, {
            expectedVersion: profile.version,
            operation: { kind: 'set-person', person: { ...person, assetId: null } },
          });
        for (const status of ['failed', 'deleted']) {
          await admin.query('UPDATE parallel_life.assets SET status=$2 WHERE id=$1', [
            selected.id,
            status,
          ]);
          await assert.rejects(
            assets.readForWorld(owner, state.id, selected.id, selected.revision),
          );
          assert.equal((await builds.phone(owner, state.id)).historyLinks![0]!.photoIds.length, 0);
          assert(
            !(await records.read(owner, state.id)).history
              .find((r) => r.id === link.recordId)!
              .relatedLinks!.some((l) => l.app === 'photos'),
          );
        }
        await admin.query("UPDATE parallel_life.assets SET status='ready' WHERE id=$1", [
          selected.id,
        ]);
      },
    );
    await t.test(
      'P05 accept/reschedule/cancel, old receipt, deduplication and immutable replay',
      async () => {
        const initial = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [state.id],
          )
        ).rows[0].state;
        const hash = (s: unknown) => createHash('sha256').update(JSON.stringify(s)).digest('hex'),
          before = hash(initial);
        const command = {
          worldId: state.id,
          id: invitation.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          operation: 'accept' as const,
        };
        const accepted = await worlds.respondToInvitation({ userId: owner }, command);
        assert.equal(accepted.appointments[0]!.status, 'confirmed');
        await worlds.respondToInvitation(
          { userId: owner },
          {
            ...command,
            commandId: randomUUID(),
            expectedVersion: 1,
            operation: 'reschedule',
            at: new Date(Date.parse(invitation.at) + 3600000).toISOString(),
          },
        );
        await worlds.respondToInvitation(
          { userId: owner },
          { ...command, commandId: randomUUID(), expectedVersion: 2, operation: 'cancel' },
        );
        const receipt = await worlds.respondToInvitation({ userId: owner }, command);
        assert.equal(receipt.version, 1);
        assert.equal(receipt.appointments[0]!.status, 'confirmed');
        const events = (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
            [state.id],
          )
        ).rows.map((r) => r.payload);
        assert.equal(events.length, 3);
        for (const [version, status] of [
          'proposed',
          'confirmed',
          'proposed',
          'cancelled',
        ].entries()) {
          const replay = replayWorldHistory(initial, events, version).world;
          assert.equal(replay.appointments.length, 1);
          assert.equal(replay.appointments[0]!.status, status);
          assert.equal(replay.mediaRequests.length, 0);
        }
        const latest = await records.read(owner, state.id),
          resolved = latest.history.find((r) => r.kind === 'invitation')!;
        assert.equal(resolved.state, 'cancelled');
        assert.equal(resolved.source.kind, 'world_event');
        assert.deepEqual(resolved.origin, link.source);
        assert.equal((await builds.phone(owner, state.id)).invitations!.length, 1);
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
      'P07 bad proposals and wrong lease cannot persist partial worlds; P08 N history remains unlinked',
      async () => {
        for (const mode of ['bad-quote', 'bad-date', 'bad-role', 'wrong-lease']) {
          const bad = await prepare(false);
          await assert.rejects(
            execute(
              bad,
              mode,
              mode === 'wrong-lease' ? { ...bad.lease, token: randomUUID() } : bad.lease,
            ),
          );
          const counts = (
            await admin.query(
              'SELECT (SELECT count(*) FROM parallel_life.worlds WHERE id=$1)::int AS worlds,(SELECT count(*) FROM parallel_life.world_initial_snapshots WHERE world_id=$1)::int AS initial,(SELECT count(*) FROM parallel_life.world_person_bindings WHERE world_id=$1)::int AS bindings,(SELECT count(*) FROM parallel_life.world_messages WHERE world_id=$1)::int AS messages,(SELECT count(*) FROM parallel_life.world_events WHERE world_id=$1)::int AS events',
              [bad.build.worldId],
            )
          ).rows[0];
          assert.deepEqual(counts, { worlds: 0, initial: 0, bindings: 0, messages: 0, events: 0 });
          assert.equal(
            (await builds.list(owner)).find((b) => b.worldId === bad.build.worldId)!.ready,
            false,
          );
        }
        const old = await prepare(false);
        await execute(old, 'legacy');
        const legacy = await builds.phone(owner, old.build.worldId);
        assert.equal(legacy.historyLinks, undefined);
        assert.equal(legacy.invitations!.length, 0);
        assert.equal(legacy.messages.filter((m) => m.initialRead === true).length, 3);
        assert.equal(
          (await records.read(owner, old.build.worldId)).history.some(
            (r) => r.kind === 'history_message',
          ),
          false,
        );
      },
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, stranger]]);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
