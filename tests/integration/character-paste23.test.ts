import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  PublicationRepository,
  type PublicationReviewPort,
} from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  readPublicationSocial,
  readPublicationActorModules,
} from '../../src/modules/settings/infrastructure/publication-social-repository.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import {
  parseCharacterPaste,
  applyCharacterPaste,
  characterPasteImageNotes,
} from '../../src/features/publisher/publisher-character-paste.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
// No paid model: review proof is an explicit fixture; repositories, compiler, RLS, receipts and PG are real.
const reviewReceipt = randomUUID();
const review: PublicationReviewPort = {
  async review() {
    return {
      reviewerVersion: 'paste23_local_fixture_only',
      runtimeCapabilities: new Set(['publication.opening.v1', 'publication.media.v1']),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId: reviewReceipt },
    };
  },
};
const compiler: PublicationWorldCompilerPort = {
  prepare(input) {
    const r = compilePublicationGenesis({
      ...input,
      originKind: input.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(r.status, 'compiled');
    if (r.status !== 'compiled') throw Error('REAL_COMPILER_REJECTED');
    return {
      world: r.world,
      opening: r.opening,
      seed: {
        id: input.seedId,
        createdAt: new Date().toISOString(),
        source: {
          kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
          ...input.origin,
        },
        identity: r.opening.identity,
        situation: r.opening.situation,
        setting: r.opening.setting,
        experienceNote: r.opening.experienceNote,
      },
    };
  },
};
test('real PG: >4000 dimension remains exact through save/reload, private trial, publish and authorized phone reads', async (t) => {
  const config = await localConfig();
  assert.ok(Number.isInteger(config.port) && config.port > 1023 && config.port <= 65535);
  if (process.env.CHARACTER_PASTE_TEST_PORT)
    assert.equal(config.port, Number(process.env.CHARACTER_PASTE_TEST_PORT));
  const admin = await adminClient('parallel_life_test');
  const resources: PostgresDatabase[] = [];
  t.after(async () => {
    for (const d of resources) await d.close();
    await admin.end();
  });
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  resources.push(app);
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_paste23_fixture'")).rowCount)
    await admin.query(
      `CREATE ROLE pl_paste23_fixture LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_paste23_fixture');
  const pub = new PostgresDatabase(
    `postgresql://pl_paste23_fixture:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  resources.push(pub);
  const staff = randomUUID(),
    owner = randomUUID(),
    other = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '仅本地角色导入验收'],
  );
  for (const id of [owner, other]) await new IdentityRepository(app).ensureGuest(id);
  const source = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = PublishedWorldContentSchema.parse(
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(source)![1]!),
  );
  const actor = base.actors[0]!;
  actor.name = '林白语';
  actor.knownAtStart = true;
  delete actor.lifeModules;
  base.phone.messages = [];
  base.phone.moments = [];
  const long =
    '人生背景里的普通词不是边界。\n\n'.repeat(330) + '完整长文的最后一句：尾部必须保留。';
  assert.ok(long.length > 4000);
  const raw =
    '# 人物：林白语\n## 玩家可见资料\n身份：大学同学\n介绍：完整公开介绍\n## 人生背景\n' +
    long +
    '\n## 人格特质\n冷静\n## 动机与价值观\n珍惜承诺\n## 行为模式\n先听后说\n## 关系模型\n尊重边界\n## 历史聊天\n林白语：你到家了吗？\n主角：刚到。\n——隔一段时间——\n林白语：后来的事怎么样？\n## 朋友圈\n【一条动态】\n日期：2024-05-11\n文案：整理旧相册。\n图片说明：桌上的相册\n【一条动态】\n文案：下雨天。';
  const preview = parseCharacterPaste(raw, base as any, actor.key, base.world.startAt);
  assert.deepEqual(preview.issues, []);
  const imported = applyCharacterPaste(
    base as any,
    actor.key,
    preview,
    preview.fields.map((f) => f.id),
  );
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  const works = new PublicationRepository(pub, review);
  const created = await works.create(staff, {
    commandId: randomUUID(),
    title: base.work.title,
    content: base,
  });
  const saved = await works.save(staff, created.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    content: imported.content,
  });
  assert.equal(saved.draft.version, 1);
  const reloaded = await works.get(staff, created.id);
  assert.deepEqual(reloaded.draft.content, imported.content);
  assert.equal((reloaded.draft.content.actors as any[])[0].lifeModules.lifeContext, long + '\n');
  const retry = parseCharacterPaste(raw, reloaded.draft.content, actor.key, base.world.startAt);
  const repeated = applyCharacterPaste(reloaded.draft.content, actor.key, retry, []);
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.addedMessages, 0);
  assert.equal(repeated.addedMoments, 0);
  const check = await works.check(staff, created.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
  });
  assert.equal(check.status, 'ready', JSON.stringify(check));
  await works.publish(staff, created.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
    expectedMetadataVersion: 0,
    checkId: check.id,
  });
  const trials = new PublicationWorldRepository(pub, compiler);
  const trial = await trials.startTrial(staff, created.id, {
    commandId: randomUUID(),
    draftVersion: 1,
    contentHash: saved.draft.contentHash,
  });
  const trialSession = await trials.trialSession(staff, trial.trialId!);
  const published = await new PublicationWorldRepository(app, compiler).startPublished(
    owner,
    created.id,
    { commandId: randomUUID(), publicationVersion: 1 },
  );
  for (const [userId, worldId] of [
    [trialSession.ownerId, trialSession.worldId],
    [owner, published.worldId],
  ] as const) {
    const world = await new PostgresWorldRepository(app).get({ userId }, worldId);
    const lin = world.actors.find((a) => a.name === '林白语');
    assert.ok(lin);
    const modules = await readPublicationActorModules(app, userId, worldId, lin.id);
    assert.equal(modules?.lifeContext, long + '\n');
    const social = await readPublicationSocial(app, userId, worldId);
    assert.equal(social.moments.length, 2);
    assert.ok(social.moments.every((m) => !m.image && !m.images));
    assert.equal(social.moments.find((m) => m.text === '整理旧相册。')?.at.slice(0, 4), '2024');
    assert.equal(world.messages.filter((m) => m.actorId === lin.id).length, 3);
    assert.ok(JSON.stringify(world).includes('刚到。'));
    assert.ok(!JSON.stringify(social).includes('桌上的相册'));
    assert.equal(characterPasteImageNotes(reloaded.draft.content, actor.key).length, 1);
  }
  assert.deepEqual(await readPublicationSocial(app, other, published.worldId), { moments: [] });
});
