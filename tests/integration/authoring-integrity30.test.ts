import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import {
  PublicationRepository,
  type PublicationReviewPort,
} from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { publicationWorldCompiler } from '../../src/server/publication-runtime.ts';
import { PublisherTrialPreparation } from '../../src/features/publisher/publisher-trial-preparation.ts';
import { publicationDraft } from '../../src/features/publisher/publisher-publication-draft.ts';
import type { PublisherWork } from '../../src/contracts/world-publisher.ts';
import type { PublisherClient } from '../../src/features/publisher/publisher-client.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import { publicationPlayerPreview } from '../../src/modules/settings/domain/publication-content.ts';

// Review proof is a named local fixture, not evidence of a real model conversation.
// Repositories, compiler, admission ticket, SQL source validation and RLS are real.
const receiptId = randomUUID();
const review: PublicationReviewPort = {
  async review() {
    return {
      reviewerVersion: 'integrity30_local_review_fixture',
      runtimeCapabilities: new Set(['publication.opening.v1', 'publication.media.v1']),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId },
    };
  },
};
const code = (expected: string) => (error: unknown) => {
  assert.equal((error as { code: string }).code, expected);
  return true;
};
test('real PostgreSQL: saved author content is the sole check/trial/publication source', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.AUTHORING_INTEGRITY_TEST_PORT ?? '55570'));
  const admin = await adminClient('parallel_life_test');
  const role = 'pl_authoring_integrity30_fixture';
  let pub: PostgresDatabase | undefined;
  t.after(async () => {
    await pub?.close();
    await admin.end();
  });
  await migrate(admin);
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  pub = new PostgresDatabase(
    `postgresql://${role}:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  assert.equal(
    (await pub.pool.query('SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
      .rolbypassrls,
    false,
  );
  const staff = randomUUID(),
    other = randomUUID();
  for (const id of [staff, other])
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [id, '本地完整性验收合成人物'],
    );
  const works = new PublicationRepository(pub, review);
  const trials = new PublicationWorldRepository(pub, publicationWorldCompiler);
  const source = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const original = PublishedWorldContentSchema.parse(
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(source)![1]!),
  );
  original.relationships.push({
    key: 'secret_relation',
    from: { kind: 'player' },
    to: { kind: 'actor', actorKey: original.actors[0]!.key },
    description: 'INTEGRITY30_PRIVATE_SENTINEL',
    visibility: { kind: 'actors', actorKeys: [original.actors[0]!.key] },
  });
  const raw = structuredClone(original) as Record<string, any>;
  delete raw.work.experienceNote;
  let work = await works.create(staff, {
    commandId: randomUUID(),
    title: original.work.title,
    content: raw,
  });
  const missingWork = work;
  await t.test('check reports the actual missing field and does not mutate the draft', async () => {
    const check = await works.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: work.draftVersion,
    });
    assert.equal(check.status, 'invalid');
    assert.ok(check.issues.some((i) => i.path.join('.') === 'work.experienceNote'));
    assert.deepEqual((await works.get(staff, work.id)).draft, work.draft);
  });
  const calls: string[] = [];
  let admitted: Awaited<ReturnType<typeof trials.startTrial>> | undefined;
  let startCommand = '';
  const client = {
    async save(w: PublisherWork, draft: { title: string; content: Record<string, unknown> }) {
      calls.push('save');
      return works.save(staff, w.id, {
        commandId: randomUUID(),
        expectedDraftVersion: w.draftVersion,
        ...draft,
      });
    },
    async get(id: string) {
      return works.get(staff, id);
    },
    async check(w: PublisherWork) {
      calls.push('check');
      return works.check(staff, w.id, {
        commandId: randomUUID(),
        expectedDraftVersion: w.draftVersion,
      });
    },
    async startTrial(w: PublisherWork) {
      calls.push('start');
      startCommand = randomUUID();
      admitted = await trials.startTrial(staff, w.id, {
        commandId: startCommand,
        draftVersion: w.draftVersion,
        contentHash: w.draft.contentHash,
      });
      return admitted;
    },
    async prepareTrial() {
      throw Error('NO_MODEL_CALL_ALLOWED');
    },
    async getPreparation() {
      throw Error('NO_MODEL_RECOVERY_ALLOWED');
    },
  };
  await t.test(
    'actual UI preparation saves revision one before checking and passes unchanged SQL source guards',
    async () => {
      const preparation = new PublisherTrialPreparation(
        client as unknown as PublisherClient,
        randomUUID,
      );
      const result = await preparation.open(
        work,
        { title: work.title, content: work.draft.content },
        {
          onWork(w) {
            work = w;
          },
          onProgress() {},
          mode: 'world',
        },
      );
      assert.deepEqual(calls, ['save', 'check', 'start']);
      assert.equal(work.draftVersion, 1);
      assert.equal(result.work.draft.contentHash, work.draft.contentHash);
      assert.deepEqual(
        work.draft.content,
        publicationDraft({ title: missingWork.title, content: raw }).content,
      );
      assert.deepEqual((work.draft.content as any).relationships, original.relationships);
      assert.doesNotMatch(
        JSON.stringify(
          publicationPlayerPreview(PublishedWorldContentSchema.parse(work.draft.content)),
        ),
        /INTEGRITY30_PRIVATE_SENTINEL/,
      );
      assert.ok(admitted);
    },
  );
  await t.test(
    'trial command retries return the same persisted world and precise saved source',
    async () => {
      const repeated = await trials.startTrial(staff, work.id, {
        commandId: startCommand,
        draftVersion: work.draftVersion,
        contentHash: work.draft.contentHash,
      });
      assert.deepEqual(repeated, { ...admitted, replayed: true });
      assert.deepEqual(repeated.origin, {
        workId: work.id,
        publicationVersion: 0,
        draftVersion: work.draftVersion,
        contentHash: work.draft.contentHash,
      });
      const row = (
        await admin.query('SELECT document FROM parallel_life.approved_seeds WHERE id=$1', [
          repeated.seedId,
        ])
      ).rows[0];
      assert.deepEqual(row.document.source, { kind: 'publication_trial', ...repeated.origin });
      assert.equal(row.document.experienceNote, (work.draft.content.work as any).experienceNote);
    },
  );
  await t.test(
    'stale revision, wrong hash and revoked staff cannot create a new trial',
    async () => {
      await assert.rejects(
        trials.startTrial(staff, work.id, {
          commandId: randomUUID(),
          draftVersion: 0,
          contentHash: missingWork.draft.contentHash,
        }),
      );
      await assert.rejects(
        trials.startTrial(staff, work.id, {
          commandId: randomUUID(),
          draftVersion: work.draftVersion,
          contentHash: 'f'.repeat(64),
        }),
      );
      await admin.query('UPDATE parallel_life.publisher_principals SET active=false WHERE id=$1', [
        other,
      ]);
      await assert.rejects(
        trials.startTrial(other, work.id, {
          commandId: randomUUID(),
          draftVersion: work.draftVersion,
          contentHash: work.draft.contentHash,
        }),
      );
    },
  );
  await t.test('refresh and local publish retain exactly the checked saved revision', async () => {
    const loaded = await works.get(staff, work.id);
    assert.deepEqual(loaded.draft, work.draft);
    const check = await works.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: work.draftVersion,
    });
    assert.equal(check.status, 'ready');
    await works.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: work.draftVersion,
      expectedMetadataVersion: work.metadataVersion,
      checkId: check.id,
    });
    const version = (
      await admin.query(
        'SELECT content,content_hash FROM parallel_life.publication_versions WHERE work_id=$1 AND version=1',
        [work.id],
      )
    ).rows[0];
    assert.deepEqual(version.content, work.draft.content);
    assert.equal(version.content_hash, work.draft.contentHash);
  });
  await t.test(
    'conflicting edit cannot overwrite the saved source; invalid sender is stored intact and rejected by check',
    async () => {
      const bad = structuredClone(work.draft.content) as any;
      bad.phone.messages = [
        {
          key: 'bad_sender',
          actorKey: 'missing_actor',
          origin: 'history',
          text: '原文',
          at: bad.world.startAt,
        },
      ];
      const edited = await works.save(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: work.draftVersion,
        title: work.title,
        content: bad,
      });
      await assert.rejects(
        works.save(staff, work.id, {
          commandId: randomUUID(),
          expectedDraftVersion: work.draftVersion,
          title: work.title,
          content: work.draft.content,
        }),
        code('VERSION_CONFLICT'),
      );
      assert.deepEqual((await works.get(staff, work.id)).draft.content, bad);
      const check = await works.check(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: edited.draftVersion,
      });
      assert.equal(check.status, 'invalid');
      assert.ok(check.issues.some((i) => i.path[0] === 'phone'));
    },
  );
});
