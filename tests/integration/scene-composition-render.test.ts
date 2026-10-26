import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { projectAgentWorldChange } from '../../src/modules/world/infrastructure/world-awareness-commit.ts';
import {
  sceneEnvironmentTaskHandler,
  sceneEnvironmentCommandId,
  replaySceneEnvironment,
} from '../../src/modules/world/infrastructure/agent-scene-environment.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TaskLease } from '../../src/modules/tasks/domain/types.ts';

import sharp from 'sharp';
import { albumPhotos } from '../../src/modules/media/infrastructure/album-projection.ts';
import { worldAppData } from '../../src/features/phone/world-app-data.ts';
import { scenePhotoUrl } from '../../src/features/phone/scenes/stage-presentation.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { composeSceneReference } from '../../src/modules/media/infrastructure/scene-composition-reference.ts';
import { sourceSceneComposition } from '../../src/modules/media/infrastructure/world-media-reference.ts';
import { PostgresOutbox } from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';
import { createMediaPipelineHandler } from '../../src/modules/media/infrastructure/media-pipeline-handler.ts';
import { MediaPipelineService } from '../../src/modules/media/infrastructure/media-pipeline-service.ts';
import { PostgresCharacterVisualAnchorRepository } from '../../src/modules/media/infrastructure/character-reference-resolver.ts';
import { readSceneMediaEntries } from '../../src/modules/world/infrastructure/scene-media-projection.ts';
test('scene opening schedules one reusable render, original media worker completes it and presence changes hide stale artwork (real PG)', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const owners: string[] = [];
  t.after(async () => {
    await queue.close();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db);
  async function fixture(priorPosition = false, epoch = 2) {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actor = randomUUID(),
      contact = randomUUID();
    owners.push(owner);
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const initial: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic environment fixture',
      time: new Date().toISOString(),
      actors: [
        { id: actor, name: '甲', persona: '有独立生活。' },
        { id: contact, name: '乙', persona: '地点联系人。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        places: [
          {
            id: 'room',
            name: '虚构客厅',
            description: '甲可能会来，但这只是地点概览。',
            source,
            contactActorIds: [actor, contact],
            appointmentIds: [],
          },
        ],
        routes: [],
        currentPlaceId: 'room',
        positionSource: source,
      },
    };
    await worlds.initialize({ userId: owner }, initial);
    if (priorPosition) {
      // Synthetic historical fixture through the real epoch-1 scene writer, never a new-runtime fallback.
      const old = await scenes.enterPlace(owner, worldId, {
        commandId: randomUUID(),
        expectedVersion: 0,
        placeId: 'room',
      });
      const oldLease = (await queue.claimForOwner(old.task!.id, owner, ['world']))!;
      const version = await db.transaction(owner, (sql) =>
        commitSceneProposal(
          sql,
          owner,
          worldId,
          oldLease.input as Parameters<typeof commitSceneProposal>[3],
          {
            location: '虚构客厅',
            narration: '历史现场记录。',
            presentActorIds: [actor, contact],
            outcome: null,
            observation: null,
            matterTitle: null,
            matterUpdates: [],
            dialogues: [],
            initialMatters: [],
            stepProposals: [],
            npcActions: [],
          },
          randomUUID(),
        ),
      );
      await queue.finish(oldLease, { status: 'succeeded', resultVersion: version });
      await scenes.navigate(
        owner,
        worldId,
        old.sceneId,
        { commandId: randomUUID(), expectedVersion: version },
        true,
      );
    }
    const beforeSwitch = await worlds.get({ userId: owner }, worldId);
    if (epoch >= 2)
      await db.transaction(owner, async (sql) => {
        for (const id of [actor, contact])
          await initializeActorAgentStateInTransaction(
            sql,
            owner,
            emptyActorAgentState(
              { worldId, actorId: id },
              agentDefinitionRef(initial, id),
              beforeSwitch.version,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: beforeSwitch.version,
        });
        if (priorPosition) {
          const latest = (
            await sql.query(
              'SELECT id FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version DESC LIMIT 1',
              [worldId],
            )
          ).rows[0];
          await projectAgentWorldChange(sql, owner, worldId, latest.id);
        }
      });
    const command = {
      commandId: randomUUID(),
      expectedVersion: beforeSwitch.version,
      placeId: 'room',
    };
    const entered = await scenes.enterPlace(owner, worldId, command);
    const beforeWorld = await worlds.get({ userId: owner }, worldId),
      beforeScene = (await scenes.read(owner, worldId, entered.sceneId)).scene!;
    const lease = (await queue.claimForOwner(entered.task!.id, owner, ['world']))!;
    return {
      owner,
      worldId,
      actor,
      contact,
      initial,
      command,
      entered,
      beforeWorld,
      beforeScene,
      lease,
    };
  }

  const f = await fixture(true);
  const bytes = await sharp({
    create: { width: 96, height: 144, channels: 3, background: '#587060' },
  })
    .png()
    .toBuffer();
  const references = new Map<string, Buffer>();
  for (const actorId of [f.actor, f.contact]) {
    const assetId = randomUUID(),
      personId = randomUUID();
    references.set(assetId, bytes);
    await admin.query(
      `INSERT INTO parallel_life.assets(id,owner_id,world_id,storage_key,mime_type,byte_length,width,height,origin,status) VALUES($1,$2,NULL,$3,'image/png',$4,96,144,'upload','ready')`,
      [assetId, f.owner, 'synthetic/' + assetId, bytes.length],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_person_bindings(world_id,owner_id,person_id,actor_id,person_snapshot,asset_id,asset_revision) VALUES($1,$2,$3,$4,$5,$6,1)`,
      [
        f.worldId,
        f.owner,
        personId,
        actorId,
        { id: personId, name: actorId === f.actor ? '甲' : '乙' },
        assetId,
      ],
    );
  }
  const handler = sceneEnvironmentTaskHandler(db);
  assert.equal(await handler(f.lease, new AbortController().signal), true);
  const opened = (
    await admin.query(
      `SELECT id,payload FROM parallel_life.world_events WHERE world_id=$1 AND payload->'data'->'environment' IS NOT NULL`,
      [f.worldId],
    )
  ).rows[0];
  const render = opened.payload.data.environment.renderRequest;
  assert(render);
  assert.equal(render.purpose, 'scene');
  const data = await scenes.read(f.owner, f.worldId);
  assert.equal(data.entries.filter((x) => x.kind === 'time_place').length, 1);
  assert.equal(data.scene!.presence.filter((x) => x.participant.kind === 'actor').length, 2);
  assert.equal(data.entries.filter((x) => x.kind === 'media_reference').length, 0);
  const source = await db.transaction(f.owner, (sql) =>
    sourceSceneComposition(sql, f.worldId, f.owner, opened.id),
  );
  assert.deepEqual(new Set(source!.actorIds), new Set([f.actor, f.contact]));
  const stranger = randomUUID();
  await new IdentityRepository(db).ensureGuest(stranger);
  assert.equal(
    await db.transaction(stranger, (sql) =>
      sourceSceneComposition(sql, f.worldId, stranger, opened.id),
    ),
    null,
  );
  const prior = structuredClone(opened.payload);
  delete prior.data.environment.renderRequest;
  assert.equal(
    replaySceneEnvironment(
      f.beforeWorld,
      f.beforeScene,
      prior,
      (
        await admin.query(
          'SELECT id,version,world_id AS "worldId",owner_id AS "ownerId" FROM parallel_life.world_events WHERE world_id=$1',
          [f.worldId],
        )
      ).rows,
    ).scene.presence.length,
    3,
  );
  const invalid = structuredClone(opened.payload);
  invalid.data.environment.renderRequest.id = randomUUID();
  assert.throws(() => replaySceneEnvironment(f.beforeWorld, f.beforeScene, invalid, []));
  const dispatch = await dispatchOutbox({
    ...new PostgresOutbox(db).ports(f.owner, { worldId: f.worldId, eventId: opened.id }),
  });
  assert.equal(dispatch.submitted, 1);
  const mediaLease = (await queue.claimForOwner(dispatch.taskIds[0]!, f.owner, ['media']))!;
  assert(mediaLease);
  let calls = 0;
  const stored = new Map<string, Buffer>();
  const pipeline = new MediaPipelineService({
    providerAdapter: {
      providerName: 'controlled',
      async submitImage(p) {
        calls++;
        assert(p.referenceImageBytes);
        assert.equal(p.builtPrompt.aspectRatio, '9:16');
        assert.match(p.builtPrompt.prompt, /exactly 2 different character/);
        return {
          providerTaskId: 'controlled-1',
          status: 'succeeded',
          provider: 'controlled',
          model: 'controlled',
          outputBase64: bytes.toString('base64'),
        };
      },
      async submitVideo() {
        throw Error('unused');
      },
      async queryStatus() {
        throw Error('unused');
      },
      async cancel() {
        return false;
      },
    },
    assetStore: {
      async get(k) {
        return stored.get(k)!;
      },
      async put(k, b) {
        stored.set(k, b);
      },
      async remove(k) {
        stored.delete(k);
      },
    },
    visualAnchorRepo: new PostgresCharacterVisualAnchorRepository(db),
    sceneReferenceReader: async (world, owner, event) => {
      const scoped = await db.transaction(owner, (sql) =>
        sourceSceneComposition(sql, world, owner, event),
      );
      assert(scoped);
      return composeSceneReference({
        place: null,
        people: await Promise.all(
          scoped.actorIds.map(async (actorId) => {
            const anchor = await new PostgresCharacterVisualAnchorRepository(
              db,
            ).findActorVisualAnchor(world, actorId, owner);
            return {
              actorId,
              name: anchor!.name,
              assetId: anchor!.referenceAssetId!,
              bytes: references.get(anchor!.referenceAssetId!)!,
              mimeType: 'image/png',
            };
          }),
        ),
      });
    },
  });
  await createMediaPipelineHandler(queue, pipeline)(mediaLease, new AbortController().signal);
  assert.equal(calls, 1);
  const ready = await scenes.read(f.owner, f.worldId);
  const pictures = ready.entries.filter((e) => e.kind === 'media_reference');
  assert.equal(pictures.length, 1);
  assert.equal(pictures[0]!.sourceEventId, opened.id);
  const photos = await db.transaction(f.owner, (sql) => albumPhotos(sql, f.worldId));
  const phone = worldAppData({
    id: f.worldId,
    seedId: randomUUID(),
    title: 'fixture',
    identity: '',
    setting: '',
    time: ready.storyNow,
    actors: [],
    messages: [],
    notes: [],
    photos,
  });
  const sceneImage = pictures[0]!;
  assert.equal(sceneImage.kind, 'media_reference');
  if (sceneImage.kind !== 'media_reference') throw Error('missing ready image');
  const url = scenePhotoUrl(ready, sceneImage.media.assetId, phone.photos);
  assert(url);
  assert.match(url, /^\/api\/v1\/assets\//);
  assert.equal(new URL(url, 'http://local.invalid').searchParams.get('worldId'), f.worldId);
  const store = {
    async get(k: string) {
      return stored.get(k)!;
    },
    async put(k: string, b: Buffer) {
      stored.set(k, b);
    },
    async remove(k: string) {
      stored.delete(k);
    },
  };
  assert.deepEqual(
    await new AssetRepository(db, store).readForWorld(
      f.owner,
      f.worldId,
      sceneImage.media.assetId,
      Number(new URL(url, 'http://local.invalid').searchParams.get('revision')),
    ),
    bytes,
  );
  await assert.rejects(
    new AssetRepository(db, store).readForWorld(stranger, f.worldId, sceneImage.media.assetId, 1),
    { code: 'NOT_FOUND' },
  );

  assert.equal(
    (await scenes.read(f.owner, f.worldId)).entries.filter((e) => e.kind === 'media_reference')
      .length,
    1,
  );
  assert.equal(calls, 1);
  const count = (
    await admin.query('SELECT count(*) FROM parallel_life.world_media_requests WHERE world_id=$1', [
      f.worldId,
    ])
  ).rows[0].count;
  assert.equal(Number(count), 1);
  const changed = structuredClone(ready.scene!);
  changed.presence.find((p) => p.participant.kind === 'actor')!.leftVersion =
    ready.worldVersion + 1;
  assert.deepEqual(
    await db.transaction(f.owner, (sql) =>
      readSceneMediaEntries(sql, f.owner, f.worldId, changed, ready.worldVersion + 1),
    ),
    [],
  );
  const rejoined = structuredClone(changed);
  const who = rejoined.presence.find((p) => p.participant.kind === 'actor')!.participant;
  rejoined.presence.push({
    participant: who,
    joinedVersion: ready.worldVersion + 1,
    sourceEventId: opened.id,
    sourceVersion: ready.worldVersion + 1,
  });
  assert.deepEqual(
    await db.transaction(f.owner, (sql) =>
      readSceneMediaEntries(sql, f.owner, f.worldId, rejoined, ready.worldVersion + 1),
    ),
    [],
  );
  assert.equal(calls, 1);
});
