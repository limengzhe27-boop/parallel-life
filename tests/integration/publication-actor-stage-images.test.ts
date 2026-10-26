import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { OFFICIAL_LIFE_PACKS } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import {
  PublicationMediaRepository,
  type PublicationMediaStore,
} from '../../src/modules/settings/infrastructure/publication-media-repository.ts';
import { readPublicationActorImages } from '../../src/modules/settings/infrastructure/publication-actor-image-repository.ts';

const store: PublicationMediaStore = {
  async signUpload() {
    throw Error('unused');
  },
  async inspect() {
    throw Error('unused');
  },
  async signRead(key) {
    return `https://private.example/${key}`;
  },
};
const catalog = {
  list: () => OFFICIAL_LIFE_PACKS,
  get: (id: string) => OFFICIAL_LIFE_PACKS.find((pack) => pack.card.id === id),
};

test('stage images bind exact ready work media, pinned contacts and revealed/live-presence actors', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.PUBLICATION_ACTOR_STAGE_TEST_PORT ?? 55671));
  const admin = await adminClient('parallel_life_test');
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await admin.end();
  });
  await migrate(admin);
  const staff = randomUUID(),
    owner = randomUUID(),
    stranger = randomUUID(),
    work = randomUUID(),
    otherWork = randomUUID();
  const ready = randomUUID(),
    later = randomUUID(),
    pending = randomUUID(),
    foreign = randomUUID(),
    video = randomUUID(),
    hidden = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '人物现场图授权样例'],
  );
  await admin.query('BEGIN');
  try {
    for (const id of [work, otherWork]) {
      await admin.query(
        'INSERT INTO parallel_life.publication_works(id,title,created_by) VALUES($1,$2,$3)',
        [id, '人物图作品', staff],
      );
      await admin.query(
        'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,0,$2,$3,$4)',
        [id, { actors: [], places: [], phone: {} }, '0'.repeat(64), staff],
      );
    }
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  for (const [id, workId, kind, mime, status] of [
    [ready, work, 'image', 'image/png', 'ready'],
    [later, work, 'image', 'image/webp', 'ready'],
    [hidden, work, 'image', 'image/png', 'ready'],
    [pending, work, 'image', 'image/png', 'pending'],
    [foreign, otherWork, 'image', 'image/png', 'ready'],
    [video, work, 'video', 'video/mp4', 'ready'],
  ]) {
    await admin.query(
      `INSERT INTO parallel_life.publication_media_assets(id,work_id,created_by,storage_key,kind,mime_type,declared_bytes,status,byte_length,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,64,$7,$8,$9)`,
      [
        id,
        workId,
        staff,
        `works/${workId}/${id}.${kind === 'video' ? 'mp4' : 'png'}`,
        kind,
        mime,
        status,
        status === 'ready' ? 64 : null,
        status === 'ready' ? new Date() : null,
      ],
    );
  }
  const actorImage = (assetId: string, known = true) => ({
    key: known ? 'known' : 'hidden',
    knownAtStart: known,
    publicCard: { stageImage: { assetId } },
  });
  const original = {
    actors: [actorImage(ready), actorImage(hidden, false)],
    places: [],
    phone: {},
  };
  const hash = 'a'.repeat(64);
  await admin.query(
    'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,1,$2,$3,$4)',
    [work, original, hash, staff],
  );
  const identity = new IdentityRepository(app);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(stranger);
  const pack = OFFICIAL_LIFE_PACKS[0]!;
  const life = new OfficialLifeRepository(app, catalog);
  const started = await life.start(owner, pack.card.id, {
    commandId: randomUUID(),
    version: pack.card.version,
  });
  const state = (
    await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [started.worldId])
  ).rows[0].state;
  const knownActor = state.actors[0].id as string,
    hiddenActor = state.actors[1].id as string;
  // Synthetic binding fixture uses real persisted official world/genesis IDs.
  // It supplies the exact pinned origin/contacts expected by the original authority reader.
  await admin.query(
    `UPDATE parallel_life.world_builds SET opening=opening||$2::jsonb WHERE world_id=$1`,
    [
      started.worldId,
      JSON.stringify({
        origin: { workId: work, publicationVersion: 0, draftVersion: 1, contentHash: hash },
        contacts: [
          { actorKey: 'known', actorId: knownActor },
          { actorKey: 'hidden', actorId: hiddenActor },
        ],
      }),
    ],
  );
  await admin.query(
    `INSERT INTO parallel_life.publication_world_bindings(id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id) VALUES($1,'trial',$2,$3,$4,$5,NULL,1,$6,$7,$8)`,
    [randomUUID(), staff, owner, staff, work, hash, started.seedId, started.worldId],
  );
  const media = new PublicationMediaRepository(app, store);
  const read = (who: string, id: string) => media.playerAsset(who, started.worldId, id);
  assert.equal((await read(owner, ready)).mime_type, 'image/png');
  await assert.rejects(read(stranger, ready), { code: 'NOT_FOUND' });
  for (const id of [later, pending, foreign, video, hidden])
    await assert.rejects(read(owner, id), { code: 'NOT_FOUND' });
  let map = await app.transaction(owner, (sql) =>
    readPublicationActorImages(sql, started.worldId, [knownActor, hiddenActor]),
  );
  assert.equal(map.get(knownActor), `/api/v1/worlds/${started.worldId}/media/${ready}`);
  assert.equal(map.has(hiddenActor), false);
  assert.equal(
    (await app.transaction(owner, (sql) => readPublicationActorImages(sql, started.worldId, [])))
      .size,
    0,
  );
  assert.equal(
    (
      await app.transaction(owner, (sql) =>
        readPublicationActorImages(sql, started.worldId, [randomUUID()]),
      )
    ).size,
    0,
  );
  // A newer saved draft cannot replace this world's immutable asset reference.
  await admin.query(
    'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,2,$2,$3,$4)',
    [work, { ...original, actors: [actorImage(later)] }, 'b'.repeat(64), staff],
  );
  assert.equal((await read(owner, ready)).mime_type, 'image/png');
  await assert.rejects(read(owner, later), { code: 'NOT_FOUND' });
  for (const id of [pending, foreign, video]) {
    await assert.rejects(
      admin.query('SELECT parallel_life.publication_actor_stage_assert_content($1,$2)', [
        work,
        { actors: [actorImage(id)] },
      ]),
      (error: unknown) => (error as { code?: string }).code === '23514',
    );
  }
  await assert.rejects(
    admin.query('SELECT parallel_life.publication_actor_stage_assert_content($1,$2)', [
      work,
      { actors: [{ publicCard: { stageImage: { assetId: 'not-an-id' } } }] },
    ]),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  // Both publication and trial-binding triggers reject an unready stage asset
  // before a broken reference can become an immutable playable source.
  const invalidContent = { actors: [actorImage(pending)], places: [], phone: {} };
  const invalidHash = 'c'.repeat(64);
  await admin.query(
    'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,3,$2,$3,$4)',
    [work, invalidContent, invalidHash, staff],
  );
  await assert.rejects(
    admin.query(
      `INSERT INTO parallel_life.publication_versions(work_id,version,draft_version,content_hash,check_id,content,card,basis,created_by) VALUES($1,1,3,$2,$3,$4,$5,'{}',$6)`,
      [
        work,
        invalidHash,
        randomUUID(),
        invalidContent,
        {
          title: '拒绝未完成图',
          hook: '测试',
          identityLabel: '测试',
          experienceNote: '测试',
          description: '测试',
        },
        staff,
      ],
    ),
    (error: unknown) =>
      (error as Error).message.includes('PUBLICATION_ACTOR_STAGE_IMAGE_NOT_READY'),
  );
  const invalidWorld = await life.start(stranger, pack.card.id, {
    commandId: randomUUID(),
    version: pack.card.version,
  });
  await assert.rejects(
    admin.query(
      `INSERT INTO parallel_life.publication_world_bindings(id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id) VALUES($1,'trial',$2,$3,$4,$5,NULL,3,$6,$7,$8)`,
      [
        randomUUID(),
        staff,
        stranger,
        staff,
        work,
        invalidHash,
        invalidWorld.seedId,
        invalidWorld.worldId,
      ],
    ),
    (error: unknown) =>
      (error as Error).message.includes('PUBLICATION_ACTOR_STAGE_IMAGE_NOT_READY'),
  );
  // Enter through the real scene entry path. Presence below is an explicit
  // projection fixture, not a claim that a model physically moved the NPC.
  const placeId = state.space.currentPlaceId;
  const scene = await new SceneRepository(app).enterPlace(owner, started.worldId, {
    commandId: randomUUID(),
    expectedVersion: 0,
    placeId,
  });
  const sceneRow = (
    await admin.query('SELECT document FROM parallel_life.scene_sessions WHERE id=$1', [
      scene.sceneId,
    ])
  ).rows[0].document;
  sceneRow.presence.push({
    participant: { kind: 'actor', actorId: hiddenActor },
    joinedVersion: scene.version,
    sourceVersion: scene.version,
    sourceEventId: sceneRow.sourceEventId,
  });
  await admin.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
    scene.sceneId,
    sceneRow,
  ]);
  map = await app.transaction(owner, (sql) =>
    readPublicationActorImages(sql, started.worldId, [hiddenActor]),
  );
  assert.equal(map.has(hiddenActor), true);
  assert.equal((await read(owner, hidden)).mime_type, 'image/png');
  sceneRow.presence.at(-1).leftVersion = scene.version + 1;
  await admin.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
    scene.sceneId,
    sceneRow,
  ]);
  // Advance only the SQL test's world version to end this explicit presence interval.
  await admin.query('BEGIN');
  await admin.query(
    "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch','2',true)",
    [started.worldId],
  );
  await admin.query('UPDATE parallel_life.worlds SET version=$2 WHERE id=$1', [
    started.worldId,
    scene.version + 1,
  ]);
  await admin.query('COMMIT');
  await assert.rejects(read(owner, hidden), { code: 'NOT_FOUND' });
  const triggers = (
    await admin.query(
      `SELECT tgname FROM pg_trigger WHERE tgname IN ('publication_actor_stage_version_guard','publication_actor_stage_binding_guard')`,
    )
  ).rows;
  assert.equal(triggers.length, 2);
});
