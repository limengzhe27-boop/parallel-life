import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { DraftRepository } from '../../src/modules/discovery/infrastructure/draft-repository.ts';
import { SeedRepository } from '../../src/modules/discovery/infrastructure/seed-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';

async function fixture() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
  const owner = randomUUID(),
    other = randomUUID(),
    direction = randomUUID(),
    photo = randomUUID(),
    second = randomUUID(),
    personId = randomUUID(),
    eventId = randomUUID();
  const identity = new IdentityRepository(db);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  const profiles = new ProfileRepository(db);
  let profile = await profiles.edit(owner, {
    expectedVersion: 0,
    operation: { kind: 'set-fact', category: 'wish', value: '想拍自己的电影' },
  });
  for (const id of [photo, second])
    await admin.query(
      "INSERT INTO parallel_life.assets(id,owner_id,storage_key,mime_type,byte_length,width,height,origin,status) VALUES($1,$2,$3,'image/jpeg',10,10,10,'upload','ready')",
      [id, owner, `qa-${id}`],
    );
  for (const id of [photo, second])
    profile = await profiles.edit(owner, {
      expectedVersion: profile.version,
      operation: { kind: 'add-reference-photo', assetId: id },
    });
  profile = await profiles.edit(owner, {
    expectedVersion: profile.version,
    operation: {
      kind: 'set-person',
      person: { id: personId, name: '测试同学', relationship: '朋友', assetId: second },
    },
  });
  profile = await profiles.edit(owner, {
    expectedVersion: profile.version,
    operation: {
      kind: 'set-event',
      event: { id: eventId, title: '2020年选择了设计专业', date: '2020', feeling: null },
    },
  });
  const story = {
    title: '导演的人生',
    premise: '当年选择电影',
    opening: '第一部短片开拍前',
    tradeoff: '创作与收入的取舍',
  };
  await db.transaction(owner, (sql) =>
    sql.query(
      'INSERT INTO parallel_life.discoveries(profile_id,owner_id,version,profile_version,document) VALUES($1,$2,1,$3,$4)',
      [
        profile.id,
        owner,
        profile.version,
        {
          brief: '不带入的私人讨论',
          directions: [{ id: direction, ...story, reason: '不带入的推荐理由', sources: [] }],
        },
      ],
    ),
  );
  const repo = new DraftRepository(db),
    prepare = { commandId: randomUUID(), directionId: direction, discoveryVersion: 1 };
  return {
    admin,
    db,
    repo,
    profiles,
    owner,
    other,
    profile,
    photo,
    second,
    personId,
    eventId,
    prepare,
    story,
    cleanup: async () => {
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
      await admin.end();
    },
  };
}
test('life drafts persist edits and explicit references; confirm races and crash recovery share one seed/world', async () => {
  const f = await fixture();
  try {
    const draft = await f.repo.prepare(f.owner, f.prepare);
    assert.deepEqual(draft.setup, { identity: '', place: '', tone: '' });
    assert.deepEqual(draft.selection, {
      factIds: [],
      eventIds: [],
      personIds: [],
      assetIds: [],
      portraitAssetId: null,
    });
    assert.equal(
      (await f.repo.prepare(f.owner, { ...f.prepare, commandId: randomUUID() })).id,
      draft.id,
    );
    const request = {
      commandId: randomUUID(),
      expectedVersion: 0,
      expectedProfileVersion: f.profile.version,
      story: { ...draft.story, title: '我的第一部电影' },
      setup: { identity: '独立电影导演', place: '杭州', tone: '热闹但不总是顺利' },
      selection: {
        factIds: [f.profile.facts[0]!.id],
        eventIds: [f.eventId],
        personIds: [f.personId],
        assetIds: [f.photo],
        portraitAssetId: f.photo,
      },
    };
    const saved = await f.repo.save(f.owner, draft.id, request);
    assert.deepEqual(await new DraftRepository(f.db).get(f.owner, draft.id), saved);
    assert.equal((await f.repo.save(f.owner, draft.id, request)).version, 1);
    await assert.rejects(
      f.repo.save(f.owner, draft.id, {
        ...request,
        story: { ...request.story, title: '不同请求' },
      }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    const confirms = await Promise.all(
      [1, 2].map(() =>
        f.repo.confirm(f.owner, draft.id, {
          commandId: randomUUID(),
          expectedVersion: saved.version,
          expectedProfileVersion: f.profile.version,
        }),
      ),
    );
    assert.equal(confirms[0]!.seedId, confirms[1]!.seedId);
    const seeds = new SeedRepository(f.db),
      seed = await seeds.get(f.owner, confirms[0]!.seedId!);
    assert.equal(seed.story.title, '我的第一部电影');
    assert.deepEqual(seed.setup, request.setup);
    assert.deepEqual(seed.assets, [{ assetId: f.photo, revision: 1 }]);
    assert.equal(
      seed.people[0]!.assetId,
      null,
      'selecting a person does not authorize their photo',
    );
    assert.deepEqual(seed.events, [
      { eventId: f.eventId, title: '2020年选择了设计专业', date: '2020' },
    ]);
    assert.equal(JSON.stringify(seed).includes('不带入'), false);
    assert.equal((await seeds.list(f.owner)).length, 1);
    const builds = new BuildRepository(f.db);
    const first = await builds.create(f.owner, { commandId: randomUUID(), seedId: seed.id });
    const resumed = await new BuildRepository(f.db).create(f.owner, {
      commandId: randomUUID(),
      seedId: seed.id,
    });
    assert.equal(first.worldId, resumed.worldId);
    assert.equal(first.task!.id, resumed.task!.id);
    await assert.rejects(
      f.repo.save(f.owner, draft.id, { ...request, commandId: randomUUID(), expectedVersion: 2 }),
      { code: 'INVALID_STATE' },
    );
    await assert.rejects(
      f.admin.query('UPDATE parallel_life.life_drafts SET document=document WHERE id=$1', [
        draft.id,
      ]),
      { code: '23514' },
    );
  } finally {
    await f.cleanup();
  }
});
test('draft ownership, stale versions, changed profiles and photos are rejected without partial seeds', async () => {
  const f = await fixture();
  try {
    const draft = await f.repo.prepare(f.owner, f.prepare);
    await assert.rejects(f.repo.get(f.other, draft.id), { code: 'NOT_FOUND' });
    assert.deepEqual(await f.repo.list(f.other), []);
    const request = {
      commandId: randomUUID(),
      expectedVersion: 0,
      expectedProfileVersion: f.profile.version,
      story: draft.story,
      selection: { ...draft.selection, assetIds: [f.photo], portraitAssetId: f.photo },
    };
    await assert.rejects(f.repo.save(f.other, draft.id, request), { code: 'NOT_FOUND' });
    await assert.rejects(
      f.repo.save(f.owner, draft.id, {
        ...request,
        selection: { ...request.selection, assetIds: [randomUUID()], portraitAssetId: null },
      }),
      { code: 'INVALID_INPUT' },
    );
    const saved = await f.repo.save(f.owner, draft.id, request);
    assert.deepEqual(
      saved.setup,
      { identity: '', place: '', tone: '' },
      'old clients stay compatible',
    );
    await assert.rejects(f.repo.save(f.owner, draft.id, { ...request, commandId: randomUUID() }), {
      code: 'VERSION_CONFLICT',
    });
    await f.admin.query('UPDATE parallel_life.assets SET revision=revision+1 WHERE id=$1', [
      f.photo,
    ]);
    await assert.rejects(
      f.repo.confirm(f.owner, draft.id, {
        commandId: randomUUID(),
        expectedVersion: saved.version,
        expectedProfileVersion: f.profile.version,
      }),
      { code: 'VERSION_CONFLICT' },
    );
    assert.equal((await new SeedRepository(f.db).list(f.owner)).length, 0);
    const profile = await f.profiles.edit(f.owner, {
      expectedVersion: f.profile.version,
      operation: { kind: 'set-fact', category: 'interest', value: '也喜欢摄影' },
    });
    await assert.rejects(
      f.repo.save(f.owner, draft.id, {
        ...request,
        commandId: randomUUID(),
        expectedVersion: saved.version,
      }),
      { code: 'VERSION_CONFLICT' },
    );
    const revised = await f.repo.save(f.owner, draft.id, {
      ...request,
      commandId: randomUUID(),
      expectedVersion: saved.version,
      expectedProfileVersion: profile.version,
    });
    assert.equal(revised.assets[0]!.revision, 2);
    const confirmation = {
      commandId: randomUUID(),
      expectedVersion: revised.version,
      expectedProfileVersion: profile.version,
    };
    const confirmed = await f.repo.confirm(f.owner, draft.id, confirmation);
    assert.deepEqual(await f.repo.confirm(f.owner, draft.id, confirmation), confirmed);
    await assert.rejects(f.repo.confirm(f.other, draft.id, confirmation), { code: 'NOT_FOUND' });
  } finally {
    await f.cleanup();
  }
});
