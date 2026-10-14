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
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublicationMediaRepository,
  type PublicationMediaStore,
} from '../../src/modules/settings/infrastructure/publication-media-repository.ts';
import { readPublicationSocial } from '../../src/modules/settings/infrastructure/publication-social-repository.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';

const start = '2026-10-14T08:00:00.000Z';
const phrase = '你照看的这个孩子是我的儿子。';
const bytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGGkAAAAASUVORK5CYII=',
  'base64',
);
// Only storage is a declared fixture. Compilation, genesis commit, snapshots, receipts and reads are real.
const store: PublicationMediaStore = {
  async signUpload() {
    return { uploadUrl: 'https://storage.example/fixture', uploadToken: 'fixture' };
  },
  async inspect() {
    return { byteLength: bytes.length, mimeType: 'image/png', header: bytes };
  },
  async signRead() {
    return 'https://storage.example/read';
  },
};
const compiler: PublicationWorldCompilerPort = {
  prepare(input) {
    const result = compilePublicationGenesis({
      ...input,
      originKind: input.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(result.status, 'compiled', JSON.stringify(result));
    if (result.status !== 'compiled') throw Error('Compile failed');
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

test('real PostgreSQL: only exact owner-bound committed authored genesis history unlocks a configured moment', async (t) => {
  const cfg = await localConfig();
  assert.equal(
    cfg.port,
    Number(
      process.env.PUBLICATION_MOMENTS_TEST_PORT ??
        process.env.PUBLICATION_STORY_TEST_PORT ??
        process.env.PUBLICATION_MEDIA_TEST_PORT ??
        process.env.PUBLISHER_TEST_PORT ??
        '55566',
    ),
  );
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const role = 'pl_moments66_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      'CREATE ROLE ' +
        role +
        " LOGIN PASSWORD '" +
        cfg.appPassword +
        "' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE",
    );
  await admin.query('GRANT pl_publisher TO ' + role);
  const pub = new PostgresDatabase(
    'postgresql://' +
      role +
      ':' +
      cfg.appPassword +
      '@127.0.0.1:' +
      cfg.port +
      '/parallel_life_test',
  );
  const app = new PostgresDatabase(
    'postgresql://pl_app:' + cfg.appPassword + '@127.0.0.1:' + cfg.port + '/parallel_life_test',
  );
  t.after(async () => {
    await pub.close();
    await app.close();
    await admin.end();
  });
  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, 'explicit synthetic genesis history test'],
  );
  const repository = new PublicationRepository(pub);
  const worlds = new PublicationWorldRepository(pub, compiler);
  const uploader = new PublicationMediaRepository(pub, store);
  const reader = new PublicationMediaRepository(app, store);
  const example = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const template = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(example)![1]!);
  template.world.startAt = start;
  template.work.experienceNote = 'Explicit synthetic zero model genesis confirmation test';
  template.phone = { messages: [], moments: [], notes: [], album: [], invitations: [] };
  template.media = [];
  template.candidates = [];
  template.history = [];
  template.relationships = [];
  template.initialKnowledge = [];
  template.protagonist.knownFactKeys = [];
  delete template.openingEventKey;
  delete template.timeline;
  delete template.conditions;
  for (const actor of template.actors) {
    actor.knownAtStart = true;
    delete actor.publicCard.avatarMediaKey;
  }
  const shu = template.actors[0].key,
    liu = template.actors[1].key;
  const history = (text = phrase, actorKey = shu, speaker = 'actor', origin = 'history') => ({
    key: 'confirmation_history',
    actorKey,
    origin,
    speaker,
    text,
    at: '2026-10-14T07:00:00.000Z',
  });
  async function createCase(label: string, messages: Record<string, unknown>[]) {
    const content = structuredClone(template);
    content.phone.messages = messages;
    content.work.title = label;
    const original = await repository.create(staff, {
      commandId: randomUUID(),
      title: label,
      content,
    });
    const asset = await uploader.begin(staff, original.id, {
      mimeType: 'image/png',
      byteLength: bytes.length,
    });
    await uploader.finalize(staff, original.id, asset.assetId);
    content.phone.moments = [
      {
        key: 'child',
        actorKey: shu,
        text: 'LOCKED_CHILD_66',
        at: '2026-10-13T08:00:00.000Z',
        images: ['/api/v1/publisher/works/' + original.id + '/media/' + asset.assetId],
        visibility: { kind: 'after_statement', actorKey: shu, statement: phrase },
      },
      {
        key: 'other_statement',
        actorKey: shu,
        text: 'OTHER_RULE_NEVER_CONFIRMED_66',
        at: '2026-10-13T08:00:00.000Z',
        visibility: {
          kind: 'after_statement',
          actorKey: shu,
          statement: 'This different statement was never confirmed.',
        },
      },
    ];
    const saved = await repository.save(staff, original.id, {
      commandId: randomUUID(),
      expectedDraftVersion: original.draftVersion,
      title: label,
      content,
    });
    const trial = await worlds.startTrial(staff, original.id, {
      commandId: randomUUID(),
      draftVersion: saved.draftVersion,
      contentHash: saved.draft.contentHash,
    });
    const session = await worlds.trialSession(staff, trial.trialId!);
    return { content, saved, trial, session, asset };
  }
  const cases = [
    { label: 'no historical statement', messages: [], visible: false },
    { label: 'exact actor history', messages: [history()], visible: true },
    { label: 'trimmed complete line', messages: [history(' \t' + phrase + '\r\n')], visible: true },
    {
      label: 'player cannot impersonate confirmation',
      messages: [history(phrase, shu, 'player')],
      visible: false,
    },
    { label: 'another actor cannot confirm', messages: [history(phrase, liu)], visible: false },
    {
      label: 'quoted statement is not confirmation',
      messages: [history('她说“' + phrase + '”')],
      visible: false,
    },
    {
      label: 'negation is not confirmation',
      messages: [history('不是这样，' + phrase)],
      visible: false,
    },
    {
      label: 'unread incoming source is not preknown history',
      messages: [history(phrase, shu, 'actor', 'incoming')],
      visible: false,
    },
  ];
  let confirmed: Awaited<ReturnType<typeof createCase>> | undefined;
  for (const c of cases)
    await t.test(c.label, async () => {
      const result = await createCase(c.label, c.messages);
      const { ownerId, worldId } = result.session;
      const social = await readPublicationSocial(app, ownerId, worldId);
      assert.equal(
        social.moments.some((m) => m.key === 'child'),
        c.visible,
      );
      assert.ok(!social.moments.some((m) => m.key === 'other_statement'));
      assert.ok(!JSON.stringify(social).includes('after_statement'));
      assert.ok(!JSON.stringify(social).includes(phrase));
      if (c.visible) {
        await reader.playerAsset(ownerId, worldId, result.asset.assetId);
        const counts = (
          await admin.query(
            "SELECT (SELECT count(*) FROM parallel_life.world_messages WHERE world_id=$1) AS runtime_messages,(SELECT count(*) FROM parallel_life.world_events WHERE world_id=$1) AS events,jsonb_array_length(state->'messages') AS initial_messages FROM parallel_life.world_initial_snapshots WHERE world_id=$1",
            [worldId],
          )
        ).rows[0];
        assert.equal(Number(counts.runtime_messages), 0);
        assert.equal(Number(counts.events), 0);
        assert.equal(Number(counts.initial_messages), 1);
        if (c.label === 'exact actor history') confirmed = result;
      } else
        await assert.rejects(reader.playerAsset(ownerId, worldId, result.asset.assetId), {
          code: 'NOT_FOUND',
        });
    });
  assert.ok(confirmed);
  const positive = confirmed;
  await t.test('foreign owner and internal helper access stay closed', async () => {
    const stranger = randomUUID();
    assert.deepEqual(await readPublicationSocial(app, stranger, positive.session.worldId), {
      moments: [],
    });
    await assert.rejects(
      reader.playerAsset(stranger, positive.session.worldId, positive.asset.assetId),
      { code: 'NOT_FOUND' },
    );
    await assert.rejects(
      app.transaction(positive.session.ownerId, (sql) =>
        sql.query('SELECT parallel_life.publication_moment_genesis_confirmed($1,$2::jsonb)', [
          positive.session.worldId,
          JSON.stringify(positive.content.phone.moments[0].visibility),
        ]),
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
  });
  await t.test('future historical source is rejected before genesis commit', async () => {
    const content = structuredClone(template);
    content.phone.messages = [{ ...history(), at: '2026-10-14T09:00:00.000Z' }];
    const work = await repository.create(staff, {
      commandId: randomUUID(),
      title: 'future history rejection',
      content,
    });
    const checked = await repository.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: work.draftVersion,
    });
    assert.equal(checked.status, 'invalid');
    assert.ok(checked.issues.some((issue) => issue.code === 'future_opening_message'));
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM parallel_life.publication_world_bindings WHERE work_id=$1',
            [work.id],
          )
        ).rows[0].n,
      ),
      0,
    );
  });
  await t.test('published initialization uses its own immutable genesis receipt', async () => {
    const result = await createCase('published exact history', [history()]);
    const publishing = new PublicationRepository(pub, {
      async review(input) {
        const session = await worlds.trialSession(staff, result.trial.trialId!);
        assert.equal(session.origin.workId, input.workId);
        assert.equal(session.origin.draftVersion, input.draftVersion);
        assert.equal(session.origin.contentHash, input.contentHash);
        const compiled = compilePublicationGenesis({
          content: input.content,
          originKind: 'trial',
          origin: session.origin,
          worldId: randomUUID(),
          ownerId: randomUUID(),
          seedId: randomUUID(),
          newId: randomUUID,
        });
        assert.equal(compiled.status, 'compiled');
        return {
          reviewerVersion: 'real_genesis_and_binding_review_66',
          runtimeCapabilities: new Set(compiled.capabilities),
          media: { verified: true, manifestHash: input.contentHash },
          trial: { verified: true, receiptId: result.trial.trialId! },
        };
      },
    });
    const checked = await publishing.check(staff, result.saved.id, {
      commandId: randomUUID(),
      expectedDraftVersion: result.saved.draftVersion,
    });
    assert.equal(checked.status, 'ready');
    const published = await publishing.publish(staff, result.saved.id, {
      commandId: randomUUID(),
      expectedDraftVersion: result.saved.draftVersion,
      expectedMetadataVersion: result.saved.metadataVersion,
      checkId: checked.id,
    });
    const owner = randomUUID();
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    const player = await new PublicationWorldRepository(app, compiler).startPublished(
      owner,
      result.saved.id,
      { commandId: randomUUID(), publicationVersion: published.publicationVersion },
    );
    const social = await readPublicationSocial(app, owner, player.worldId);
    assert.ok(social.moments.some((m) => m.key === 'child'));
    assert.ok(!social.moments.some((m) => m.key === 'other_statement'));
    await reader.playerAsset(owner, player.worldId, result.asset.assetId);
  });
  await t.test('draft changes cannot alter earlier initial knowledge', async () => {
    const changed = structuredClone(positive.content);
    changed.phone.messages = [];
    const saved = await repository.save(staff, positive.saved.id, {
      commandId: randomUUID(),
      expectedDraftVersion: positive.saved.draftVersion,
      title: positive.saved.title,
      content: changed,
    });
    const next = await worlds.startTrial(staff, saved.id, {
      commandId: randomUUID(),
      draftVersion: saved.draftVersion,
      contentHash: saved.draft.contentHash,
    });
    const nextSession = await worlds.trialSession(staff, next.trialId!);
    assert.ok(
      (
        await readPublicationSocial(app, positive.session.ownerId, positive.session.worldId)
      ).moments.some((m) => m.key === 'child'),
    );
    assert.ok(
      !(await readPublicationSocial(app, nextSession.ownerId, nextSession.worldId)).moments.some(
        (m) => m.key === 'child',
      ),
    );
    await reader.playerAsset(
      positive.session.ownerId,
      positive.session.worldId,
      positive.asset.assetId,
    );
    await assert.rejects(
      reader.playerAsset(nextSession.ownerId, nextSession.worldId, positive.asset.assetId),
      { code: 'NOT_FOUND' },
    );
  });
});
