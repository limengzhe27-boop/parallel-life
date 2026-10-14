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
import {
  readPublicationSocial,
  readPublicationActorModules,
} from '../../src/modules/settings/infrastructure/publication-social-repository.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';

const start = '2026-10-14T08:00:00.000Z';
const phrase = '你照看的这个孩子是我的儿子。';
const bytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGGkAAAAASUVORK5CYII=',
  'base64',
);
// Only object storage is a declared local fixture; SQL, compilation, bindings and reads are real.
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

test('real PostgreSQL: visible post set and private image reads share time, confirmation and immutable owner-bound edition', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.PUBLICATION_MOMENTS_TEST_PORT ?? '55566'));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const role = 'pl_moments26_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${cfg.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const pub = new PostgresDatabase(
    `postgresql://${role}:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await pub.close();
    await app.close();
    await admin.end();
  });
  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,false,true)',
    [staff, '合成朋友圈验收，不发布'],
  );
  const repository = new PublicationRepository(pub);
  const worlds = new PublicationWorldRepository(pub, compiler);
  const uploader = new PublicationMediaRepository(pub, store);
  const reader = new PublicationMediaRepository(app, store);
  const example = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(example)![1]!);
  base.world.startAt = start;
  base.phone = { messages: [], moments: [], notes: [], album: [], invitations: [] };
  base.media = [];
  base.candidates = [];
  base.history = [];
  base.relationships = [];
  base.initialKnowledge = [];
  base.protagonist.knownFactKeys = [];
  delete base.openingEventKey;
  delete base.timeline;
  delete base.conditions;
  for (const a of base.actors) {
    a.knownAtStart = true;
    delete a.publicCard.avatarMediaKey;
  }
  const shu = base.actors[0].key,
    liu = base.actors[1].key;
  base.actors[0].name = '舒雅婷';
  base.actors[1].name = '刘胜男';
  base.actors[1].publicCard.momentsVisibility = 'three_days';
  const original = await repository.create(staff, {
    commandId: randomUUID(),
    title: '合成朋友圈权限测试',
    content: base,
  });
  const images = [];
  for (let i = 0; i < 9; i++) {
    const asset = await uploader.begin(staff, original.id, {
      mimeType: 'image/png',
      byteLength: bytes.length,
    });
    await uploader.finalize(staff, original.id, asset.assetId);
    images.push({
      id: asset.assetId,
      url: `/api/v1/publisher/works/${original.id}/media/${asset.assetId}`,
    });
  }
  base.phone.moments = [
    {
      key: 'public_photos',
      actorKey: shu,
      text: '三张照片',
      at: '2026-10-13T08:00:00.000Z',
      images: images.slice(0, 3).map((a) => a.url),
    },
    {
      key: 'locked_child',
      actorKey: shu,
      text: 'LOCKED_CHILD_BODY_26',
      at: '2022-05-11T04:00:00.000Z',
      images: [images[3]!.url],
      visibility: { kind: 'after_statement', actorKey: shu, statement: phrase },
    },
    {
      key: 'recent',
      actorKey: liu,
      text: '近期',
      at: '2026-10-13T08:00:00.000Z',
      images: [images[4]!.url],
    },
    {
      key: 'boundary',
      actorKey: liu,
      text: '刚好72小时',
      at: '2026-10-11T08:00:00.000Z',
      images: [images[5]!.url],
    },
    {
      key: 'expired',
      actorKey: liu,
      text: 'EXPIRED_BODY_26',
      at: '2026-10-11T07:59:59.999Z',
      images: [images[6]!.url],
    },
    {
      key: 'legacy',
      actorKey: shu,
      text: '旧单图',
      at: '2026-10-10T04:00:00.000Z',
      image: images[7]!.url,
    },
  ];
  const saved = await repository.save(staff, original.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    title: original.title,
    content: base,
  });
  const trial = await worlds.startTrial(staff, original.id, {
    commandId: randomUUID(),
    draftVersion: saved.draftVersion,
    contentHash: saved.draft.contentHash,
  });
  const session = await worlds.trialSession(staff, trial.trialId!);
  const owner = session.ownerId,
    wid = session.worldId;
  await admin.query(
    'UPDATE parallel_life.world_clock SET story_now=$2,paused=true WHERE world_id=$1',
    [wid, start],
  );
  const social = () => readPublicationSocial(app, owner, wid);
  const first = await social();
  assert.equal(first.moments.length, 4);
  assert.equal(first.moments.find((m) => m.key === 'public_photos')!.images!.length, 3);
  assert.equal(first.moments.find((m) => m.key === 'legacy')!.images!.length, 1);
  assert.ok(!JSON.stringify(first).includes('LOCKED_CHILD_BODY_26'));
  assert.ok(!JSON.stringify(first).includes('EXPIRED_BODY_26'));
  assert.ok(!JSON.stringify(first).includes('/publisher/'));
  assert.ok(!JSON.stringify(first).includes(phrase));
  assert.equal(
    first.profiles!.find(
      (p) => p.actorId === first.moments.find((m) => m.key === 'recent')!.actorId,
    )!.momentsVisibility,
    'three_days',
  );
  await reader.playerAsset(owner, wid, images[0]!.id);
  await reader.playerAsset(owner, wid, images[5]!.id);
  for (const index of [3, 6, 8])
    await assert.rejects(reader.playerAsset(owner, wid, images[index]!.id), { code: 'NOT_FOUND' });
  const outsider = randomUUID();
  assert.deepEqual(await readPublicationSocial(app, outsider, wid), { moments: [] });
  await assert.rejects(reader.playerAsset(outsider, wid, images[0]!.id), { code: 'NOT_FOUND' });
  await assert.rejects(
    app.transaction(owner, (sql) =>
      sql.query('SELECT parallel_life.publication_moments_context($1)', [wid]),
    ),
    (e: unknown) => (e as { code: string }).code === '42501',
  );
  const shuId = first.moments.find((m) => m.key === 'public_photos')!.actorId;
  const liuId = first.moments.find((m) => m.key === 'recent')!.actorId;
  assert.ok(
    JSON.stringify(await readPublicationActorModules(app, owner, wid, shuId)).includes(phrase),
  );
  assert.ok(
    !JSON.stringify((await readPublicationActorModules(app, owner, wid, liuId)) ?? {}).includes(
      phrase,
    ),
  );

  // Explicit synthetic committed source events; no provider or AI success is being simulated.
  const message = async (
    text: string,
    actorId = shuId,
    role = 'assistant',
    at = start,
    status = 'succeeded',
  ) => {
    const eventId = randomUUID(),
      commandId = randomUUID(),
      messageId = randomUUID();
    await admin.query('BEGIN');
    try {
      const current = (
        await admin.query('SELECT version,state FROM parallel_life.worlds WHERE id=$1', [wid])
      ).rows[0];
      const version = Number(current.version) + 1;
      const nextState = { ...current.state, version };
      await admin.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [commandId, wid, owner, version - 1, 'a'.repeat(64), { fixture: true }],
      );
      await admin.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,now())',
        [eventId, wid, owner, version, commandId, { storyAt: start, fixture: true }],
      );
      await admin.query(
        'UPDATE parallel_life.commands SET status=$3,result_event_id=$4,result_state=$5 WHERE id=$1 AND world_id=$2',
        [
          commandId,
          wid,
          status,
          status === 'succeeded' ? eventId : null,
          status === 'succeeded' ? nextState : null,
        ],
      );
      await admin.query(
        'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
        [
          messageId,
          wid,
          owner,
          actorId,
          { id: messageId, actorId, role, text, at, sourceEventId: eventId },
        ],
      );
      await admin.query(
        "UPDATE parallel_life.worlds SET version=$2,state=jsonb_set(state,'{version}',to_jsonb($2::integer)) WHERE id=$1",
        [wid, version],
      );
      await admin.query('COMMIT');
    } catch (e) {
      await admin.query('ROLLBACK');
      throw e;
    }
  };
  for (const input of [
    [phrase, shuId, 'user', start, 'succeeded'],
    [phrase, liuId, 'assistant', start, 'succeeded'],
    [`她说“${phrase}”`, shuId, 'assistant', start, 'succeeded'],
    ['你照看的这个孩子不是我的儿子。', shuId, 'assistant', start, 'succeeded'],
    [phrase, shuId, 'assistant', '2026-10-14T09:00:00.000Z', 'succeeded'],
    [phrase, shuId, 'assistant', start, 'failed'],
  ]) {
    await message(...(input as [string, string, string, string, string]));
    assert.ok(!(await social()).moments.some((m) => m.key === 'locked_child'));
  }

  // Mutating the author draft does not unlock or rewrite an existing immutable trial edition.
  const later = structuredClone(base);
  delete later.phone.moments[1].visibility;
  await repository.save(staff, original.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
    title: original.title,
    content: later,
  });
  assert.ok(!(await social()).moments.some((m) => m.key === 'locked_child'));
  await message(` \n${phrase}\r\n `);
  assert.ok((await social()).moments.some((m) => m.key === 'locked_child'));
  await reader.playerAsset(owner, wid, images[3]!.id);
  await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
    wid,
    '2026-10-17T08:00:00.001Z',
  ]);
  const advanced = await social();
  assert.ok(!advanced.moments.some((m) => m.actorId === liuId));
  await assert.rejects(reader.playerAsset(owner, wid, images[4]!.id), { code: 'NOT_FOUND' });
  assert.ok(advanced.moments.some((m) => m.key === 'locked_child'));
  const foreign = await repository.create(staff, {
    commandId: randomUUID(),
    title: '其他作品',
    content: base,
  });
  await assert.rejects(
    admin.query('SELECT parallel_life.publication_media_assert_content($1,$2::jsonb)', [
      foreign.id,
      base,
    ]),
    (e: unknown) => (e as { code: string }).code === '23514',
  );
  const pending = await uploader.begin(staff, original.id, {
    mimeType: 'image/png',
    byteLength: bytes.length,
  });
  const notReady = structuredClone(base);
  notReady.phone.moments[0].images = [
    `/api/v1/publisher/works/${original.id}/media/${pending.assetId}`,
  ];
  await assert.rejects(
    admin.query('SELECT parallel_life.publication_media_assert_content($1,$2::jsonb)', [
      original.id,
      notReady,
    ]),
    (e: unknown) => (e as { code: string }).code === '23514',
  );

  const groupPhrase = '这个孩子是我亲生的儿子。';
  base.phone.moments.push({
    key: 'group_identity',
    actorKey: shu,
    text: 'GROUP_CHILD_BODY_26',
    at: '2022-05-11T04:00:00.000Z',
    images: [images[8]!.url],
    visibility: { kind: 'after_statement', actorKey: shu, statement: groupPhrase },
  });
  const sceneDraft = await repository.save(staff, original.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 2,
    title: original.title,
    content: base,
  });
  const sceneTrial = await worlds.startTrial(staff, original.id, {
    commandId: randomUUID(),
    draftVersion: sceneDraft.draftVersion,
    contentHash: sceneDraft.draft.contentHash,
  });
  const sceneOwner = (await worlds.trialSession(staff, sceneTrial.trialId!)).ownerId;
  const sceneWorld = sceneTrial.worldId;
  assert.notEqual(sceneWorld, wid);
  await admin.query(
    'UPDATE parallel_life.world_clock SET story_now=$2,paused=true WHERE world_id=$1',
    [sceneWorld, start],
  );
  const sceneSocial = () => readPublicationSocial(app, sceneOwner, sceneWorld);
  assert.ok(
    !(await sceneSocial()).moments.some((m) => m.key === 'locked_child'),
    'another world confirmation cannot unlock this world',
  );
  const sceneShu = (await sceneSocial()).moments.find((m) => m.key === 'public_photos')!.actorId;
  const sceneId = randomUUID();
  let sessionCreated = false;
  const sceneLine = async (observableTo: { kind: string }[], text = phrase, actorId = sceneShu) => {
    await admin.query('BEGIN');
    try {
      const current = (
        await admin.query('SELECT version,state FROM parallel_life.worlds WHERE id=$1', [
          sceneWorld,
        ])
      ).rows[0];
      const version = Number(current.version) + 1,
        eventId = randomUUID(),
        commandId = randomUUID();
      const nextState = { ...current.state, version };
      await admin.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [commandId, sceneWorld, sceneOwner, version - 1, 'b'.repeat(64), { fixture: true }],
      );
      await admin.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,now())',
        [eventId, sceneWorld, sceneOwner, version, commandId, { storyAt: start, fixture: true }],
      );
      await admin.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE id=$1 AND world_id=$2",
        [commandId, sceneWorld, eventId, nextState],
      );
      if (!sessionCreated)
        await admin.query(
          'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
          [sceneId, sceneWorld, sceneOwner, eventId, { fixture: true }],
        );
      const id = randomUUID();
      await admin.query(
        "INSERT INTO parallel_life.scene_items(id,world_id,owner_id,scene_id,source_event_id,kind,document) VALUES($1,$2,$3,$4,$5,'entry',$6)",
        [
          id,
          sceneWorld,
          sceneOwner,
          sceneId,
          eventId,
          {
            id,
            kind: 'dialogue',
            speaker: { kind: 'actor', actorId },
            text,
            observableTo,
            sourceEventId: eventId,
            sourceVersion: version,
          },
        ],
      );
      await admin.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        sceneWorld,
        version,
        nextState,
      ]);
      await admin.query('COMMIT');
      sessionCreated = true;
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
  };
  await sceneLine([]);
  assert.ok(
    !(await sceneSocial()).moments.some((m) => m.key === 'locked_child'),
    'an unheard scene line cannot unlock',
  );
  await sceneLine([{ kind: 'player' }], `她说“${phrase}”`);
  assert.ok(!(await sceneSocial()).moments.some((m) => m.key === 'locked_child'));
  await assert.rejects(reader.playerAsset(sceneOwner, sceneWorld, images[3]!.id), {
    code: 'NOT_FOUND',
  });
  await sceneLine([{ kind: 'player' }]);
  assert.ok((await sceneSocial()).moments.some((m) => m.key === 'locked_child'));
  await reader.playerAsset(sceneOwner, sceneWorld, images[3]!.id);
  const groups = new PostgresGroupRepository(app);
  const version = async () =>
    Number(
      (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [sceneWorld]))
        .rows[0].version,
    );
  await admin.query(
    'UPDATE parallel_life.world_clock SET paused=false,last_tick_at=now() WHERE world_id=$1',
    [sceneWorld],
  );
  await groups.create(sceneOwner, {
    worldId: sceneWorld,
    commandId: randomUUID(),
    expectedVersion: await version(),
    title: '合成身份群聊',
    actorIds: [sceneShu],
  });
  const groupId = (
    await admin.query('SELECT id FROM parallel_life.world_groups WHERE world_id=$1', [sceneWorld])
  ).rows[0].id;
  await groups.membership(sceneOwner, {
    worldId: sceneWorld,
    groupId,
    commandId: randomUUID(),
    expectedVersion: await version(),
    participant: { kind: 'player' },
    action: 'leave',
  });
  await admin.query(
    'UPDATE parallel_life.world_clock SET paused=true,story_now=$2 WHERE world_id=$1',
    [sceneWorld, start],
  );
  const groupLine = async () => {
    await admin.query('BEGIN');
    try {
      const current = (
        await admin.query('SELECT version,state FROM parallel_life.worlds WHERE id=$1', [
          sceneWorld,
        ])
      ).rows[0];
      const ver = Number(current.version) + 1,
        eventId = randomUUID(),
        commandId = randomUUID(),
        messageId = randomUUID();
      const nextState = { ...current.state, version: ver };
      await admin.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [commandId, sceneWorld, sceneOwner, ver - 1, 'c'.repeat(64), { fixture: true }],
      );
      const event = {
        id: eventId,
        worldId: sceneWorld,
        ownerId: sceneOwner,
        commandId,
        version: ver,
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        storyAt: start,
        type: 'group.turn_resolved',
        data: { groupId, replies: [{ actorId: sceneShu, text: groupPhrase, messageId }] },
      };
      await admin.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,now())',
        [eventId, sceneWorld, sceneOwner, ver, commandId, event],
      );
      await admin.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE id=$1 AND world_id=$2",
        [commandId, sceneWorld, eventId, nextState],
      );
      const document = {
        id: messageId,
        ownerId: sceneOwner,
        worldId: sceneWorld,
        conversationId: groupId,
        sourceEventId: eventId,
        sourceVersion: ver,
        sender: { kind: 'actor', actorId: sceneShu },
        text: groupPhrase,
        media: [],
      };
      await admin.query(
        'INSERT INTO parallel_life.world_group_messages(id,world_id,owner_id,group_id,source_event_id,source_version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [messageId, sceneWorld, sceneOwner, groupId, eventId, ver, document],
      );
      await admin.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        sceneWorld,
        ver,
        nextState,
      ]);
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
  };
  await groupLine();
  assert.ok(
    !(await sceneSocial()).moments.some((m) => m.key === 'group_identity'),
    'confirmation while player is out of group is not heard',
  );
  await assert.rejects(reader.playerAsset(sceneOwner, sceneWorld, images[8]!.id), {
    code: 'NOT_FOUND',
  });
  await admin.query(
    'UPDATE parallel_life.world_clock SET paused=false,last_tick_at=now() WHERE world_id=$1',
    [sceneWorld],
  );
  await groups.membership(sceneOwner, {
    worldId: sceneWorld,
    groupId,
    commandId: randomUUID(),
    expectedVersion: await version(),
    participant: { kind: 'player' },
    action: 'join',
  });
  await admin.query(
    'UPDATE parallel_life.world_clock SET paused=true,story_now=$2 WHERE world_id=$1',
    [sceneWorld, start],
  );
  assert.ok(
    !(await sceneSocial()).moments.some((m) => m.key === 'group_identity'),
    'joining later does not retroactively hear old group confirmation',
  );
  await groupLine();
  assert.ok((await sceneSocial()).moments.some((m) => m.key === 'group_identity'));
  await reader.playerAsset(sceneOwner, sceneWorld, images[8]!.id);
});
