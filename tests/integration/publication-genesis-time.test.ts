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
import {
  PublicationRepository,
  type PublicationReviewPort,
} from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { publicationWorldCompiler } from '../../src/server/publication-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';

test('real PG authored genesis times support actual note saves in trial and published worlds; zero models', async (t) => {
  const cfg = await localConfig();
  assert.equal(
    cfg.port,
    Number(process.env.PUBLICATION_GENESIS_TIME_TEST_PORT ?? 55565),
    'Only the assigned local database is allowed',
  );
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
  const generated: string[] = [];
  t.after(async () => {
    try {
      await admin.query(
        'UPDATE parallel_life.world_clock SET paused=true WHERE world_id=ANY($1::text[])',
        [generated],
      );
    } finally {
      await app.close();
      await pub.close();
      await admin.end();
    }
  });
  // This explicit fixture review permits local synthetic publication only. It is not model evidence.
  const receiptId = randomUUID();
  const review: PublicationReviewPort = {
    async review({ content }) {
      return {
        reviewerVersion: 'explicit_local_timestamp_fixture',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId },
      };
    },
  };
  const works = new PublicationRepository(pub, review);
  const runtime = new PostgresWorldRepository(app);
  for (const startAt of [
    '2026-10-12T09:00:00Z',
    '2026-10-12T09:00:00.123Z',
    '2026-10-12T09:00:00.9999999Z',
  ]) {
    await t.test(startAt, async () => {
      const staff = randomUUID(),
        owner = randomUUID();
      await new IdentityRepository(app).ensureGuest(owner);
      await admin.query(
        'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
        [staff, 'Local timestamp fixture'],
      );
      const raw = await readFile(
        new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
        'utf8',
      );
      const c = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
      c.world.startAt = startAt;
      delete c.timeline;
      delete c.conditions;
      delete c.openingEventKey;
      c.candidates = [];
      c.phone.messages = [
        {
          key: 'old',
          actorKey: c.actors[0].key,
          speaker: 'actor',
          origin: 'history',
          text: 'Local authored history',
          at: '2026-10-11T09:00:00Z',
        },
        {
          key: 'old_player',
          actorKey: c.actors[0].key,
          speaker: 'player',
          origin: 'history',
          text: 'Local authored player history',
          at: '2026-10-11T09:00:01.9999999Z',
        },
      ];
      c.phone.invitations = [
        {
          key: 'invite',
          actorKeys: [c.actors[0].key],
          placeKey: c.places[0].key,
          messageKey: 'old',
          title: 'Local proposed appointment',
          at: '2026-10-13T09:00:00.123456Z',
          status: 'proposed',
        },
      ];
      const content = PublishedWorldContentSchema.parse(c);
      const work = await works.create(staff, {
        commandId: randomUUID(),
        title: 'Synthetic timestamp fixture',
        content,
      });
      const before = (await works.get(staff, work.id)).draft;
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
      const trialRepo = new PublicationWorldRepository(pub, publicationWorldCompiler);
      const trial = await trialRepo.startTrial(staff, work.id, {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: before.contentHash,
      });
      const trialSession = await trialRepo.trialSession(staff, trial.trialId!);
      const published = await new PublicationWorldRepository(
        app,
        publicationWorldCompiler,
      ).startPublished(owner, work.id, { commandId: randomUUID(), publicationVersion: 1 });
      for (const session of [trialSession, { ownerId: owner, worldId: published.worldId }]) {
        generated.push(session.worldId);
        const state = await runtime.get({ userId: session.ownerId }, session.worldId);
        // Save before asserting shape: the pre-fix failure must exercise the actual write path.
        const saved = await runtime.saveNote(
          { userId: session.ownerId },
          {
            worldId: session.worldId,
            commandId: randomUUID(),
            expectedVersion: 0,
            title: 'Local note',
            text: 'Persisted after authored genesis',
          },
        );
        assert.equal(state.time, new Date(startAt).toISOString());
        assert.equal(Date.parse(state.time), Date.parse(startAt));
        assert.equal(state.messageHistory?.startAt, state.time);
        assert.equal(state.messages[0]!.at, '2026-10-11T09:00:00.000Z');
        assert.equal(state.messages[1]!.at, '2026-10-11T09:00:01.999Z');
        assert.equal(state.messages[1]!.role, 'user');
        assert.equal(state.appointments[0]!.at, '2026-10-13T09:00:00.123Z');
        const refreshed = await runtime.get({ userId: session.ownerId }, session.worldId);
        assert.equal(
          refreshed.notes?.find((n) => n.id === saved.note.id)?.text,
          'Persisted after authored genesis',
        );
        assert.equal(refreshed.time, state.time);
      }
      const after = (await works.get(staff, work.id)).draft;
      assert.equal(after.contentHash, before.contentHash);
      assert.deepEqual(after.content, before.content);
      assert.deepEqual(after.content, content);
      for (const field of ['time', 'messageHistory', 'message'] as const) {
        const tamperedOwner = randomUUID();
        await new IdentityRepository(app).ensureGuest(tamperedOwner);
        const tampered = new PublicationWorldRepository(app, {
          async prepare(input) {
            const prepared = (await publicationWorldCompiler.prepare(input)) as {
              world: WorldState;
            };
            const wrong = new Date(Date.parse(startAt) + 1000).toISOString();
            if (field === 'time') prepared.world.time = wrong;
            else if (field === 'messageHistory') prepared.world.messageHistory!.startAt = wrong;
            else prepared.world.messages[0]!.at = '2026-10-11T09:00:01.000Z';
            return prepared;
          },
        });
        await assert.rejects(
          tampered.startPublished(tamperedOwner, work.id, {
            commandId: randomUUID(),
            publicationVersion: 1,
          }),
          { code: 'INVALID_STATE' },
          `A changed ${field} instant must still be rejected`,
        );
      }
    });
  }
});
