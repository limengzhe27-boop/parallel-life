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
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import {
  publicationActorReference,
  publicationPlaceReference,
  ownGeneratedPortraitReference,
  sourceSceneReference,
} from '../../src/modules/media/infrastructure/world-media-reference.ts';
import { PostgresCharacterVisualAnchorRepository } from '../../src/modules/media/infrastructure/character-reference-resolver.ts';
import sharp from 'sharp';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { CURRENT_NPC_WIRE_PROTOCOL } from '../../src/modules/world/infrastructure/npc-model-protocol.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { PostgresOutbox } from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';
import { createMediaPipelineHandler } from '../../src/modules/media/infrastructure/media-pipeline-handler.ts';
import { MediaPipelineService } from '../../src/modules/media/infrastructure/media-pipeline-service.ts';
import {
  YibuMediaProviderAdapter,
  GROK_IMAGE_MODEL,
} from '../../src/modules/media/infrastructure/yibu-media-provider-adapter.ts';
import type { MediaProviderAdapter } from '../../src/modules/media/application/provider-ports.ts';
import { fileURLToPath } from 'node:url';
import { appendFile } from 'node:fs/promises';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';

test('published NPC references come from exact immutable actor mapping with real owner isolation', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.GROK_IMAGE_TEST_PORT ?? 55651));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  class Publisher extends PostgresDatabase {
    override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
      return super.transaction(owner, async (sql) => {
        await sql.query('SET LOCAL ROLE pl_publisher');
        return run(sql);
      });
    }
  }
  const pub = new Publisher(
    `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds: string[] = [];
  t.after(async () => {
    await admin.query(
      'UPDATE parallel_life.world_clock SET paused=true WHERE world_id=ANY($1::text[])',
      [worlds],
    );
    await app.close();
    await pub.close();
    await admin.end();
  });
  const staff = randomUUID(),
    owner = randomUUID(),
    stranger = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, 'Synthetic media reference QA'],
  );
  for (const who of [owner, stranger]) await new IdentityRepository(app).ensureGuest(who);
  const source = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(source)![1]!);
  delete content.timeline;
  delete content.conditions;
  delete content.openingEventKey;
  content.candidates = [];
  content.actors[0].publicCard.avatarMediaKey = 'avatar_a';
  content.actors[1].publicCard.avatarMediaKey = 'avatar_b';
  content.media = [
    ['avatar_a', 'laowang'],
    ['avatar_b', 'qingqing'],
  ].map(([key, art]) => ({
    key,
    asset: { namespace: 'publication', key: art, revision: 1 },
    use: 'avatar',
    depiction: 'generated_image',
    label: key,
    visibility: { kind: 'world' },
  }));
  const reviewReceiptId = randomUUID();
  const review: PublicationReviewPort = {
    async review({ content }) {
      return {
        reviewerVersion: 'synthetic_media_reference',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: reviewReceiptId },
      };
    },
  };
  const works = new PublicationRepository(pub, review);
  const work = await works.create(staff, {
    commandId: randomUUID(),
    title: 'Synthetic reference QA',
    content: PublishedWorldContentSchema.parse(content),
  });
  const sceneAsset = randomUUID();
  const sourcePicture = await sharp(
    await readFile(
      process.env.GROK_SCENE_REFERENCE_PATH ??
        new URL('../../public/art/meadow-door.webp', import.meta.url),
    ),
  )
    .jpeg()
    .toBuffer();
  const disk = new PrivateDiskStore(
    fileURLToPath(new URL('../../.local/grok-reference-test-assets/', import.meta.url)),
  );
  const sourceKey = 'works/' + work.id + '/' + sceneAsset + '.jpg';
  await disk.put(sourceKey, sourcePicture);
  await admin.query(
    `INSERT INTO parallel_life.publication_media_assets(id,work_id,created_by,storage_key,kind,mime_type,declared_bytes,status,byte_length,confirmed_at) VALUES($1,$2,$3,$4,'image','image/jpeg',$5,'ready',$5,now())`,
    [sceneAsset, work.id, staff, sourceKey, sourcePicture.length],
  );
  content.places[0].sceneImage = { assetId: sceneAsset };
  await works.save(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    content: PublishedWorldContentSchema.parse(content),
  });
  const check = await works.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
  });
  assert.equal(check.status, 'ready');
  await works.publish(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
    expectedMetadataVersion: 0,
    checkId: check.id,
  });
  const world = await new PublicationWorldRepository(app, publicationWorldCompiler).startPublished(
    owner,
    work.id,
    { commandId: randomUUID(), publicationVersion: 1 },
  );
  worlds.push(world.worldId);
  const state = (
    await app.transaction(
      owner,
      async (sql) =>
        (await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [world.worldId]))
          .rows[0],
    )
  ).state;
  const placeRef = await app.transaction(owner, (sql) =>
    publicationPlaceReference(sql, world.worldId, 'shop'),
  );
  assert.equal(placeRef?.assetId, sceneAsset);
  assert.equal(
    await app.transaction(stranger, (sql) => publicationPlaceReference(sql, world.worldId, 'shop')),
    null,
  );
  assert.equal(
    await app.transaction(owner, (sql) => publicationPlaceReference(sql, world.worldId, 'unknown')),
    null,
  );
  const refs = await Promise.all(
    state.actors.map((actor: { id: string }) =>
      app.transaction(owner, (sql) =>
        publicationActorReference(sql, world.worldId, owner, actor.id),
      ),
    ),
  );
  assert.deepEqual(refs.map((ref) => ref?.assetId).sort(), [
    'publication-art:laowang:1',
    'publication-art:qingqing:1',
  ]);
  assert.equal(
    await app.transaction(stranger, (sql) =>
      publicationActorReference(sql, world.worldId, stranger, state.actors[0].id),
    ),
    null,
  );
  assert.equal(
    await app.transaction(owner, (sql) =>
      publicationActorReference(sql, world.worldId, owner, randomUUID()),
    ),
    null,
  );
  const anchor = await new PostgresCharacterVisualAnchorRepository(app).findActorVisualAnchor(
    world.worldId,
    state.actors[0].id,
    owner,
  );
  assert.equal(anchor?.referenceAssetId, refs[0]?.assetId);
  assert.equal(anchor?.isPlayer, false);
  await app.transaction(owner, async (sql) => {
    for (const actor of state.actors)
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState(
          { worldId: world.worldId, actorId: actor.id },
          agentDefinitionRef(state, actor.id),
          0,
        ),
      );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId: world.worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
  });
  const kind = process.env.GROK_LIVE_IMAGE_CASE ?? 'controlled_person';
  const portraitCase = kind.endsWith('person');
  const model = {
    async *streamComplete() {
      yield await model.complete();
    },
    async complete() {
      return JSON.stringify({
        protocol: CURRENT_NPC_WIRE_PROTOCOL,
        statements: [{ text: '我拍一张发你。', dependsOnActionIds: [] }],
        executions: [
          {
            ref: 'action_1',
            action: {
              capability: 'media.generate_image',
              parameters: {
                purpose: portraitCase ? 'portrait' : 'scene',
                sceneDescription:
                  kind === 'person'
                    ? '同一人物在咖啡馆喝咖啡的写实近照，严格保持参考人物的五官、发际线、黑色短发、肤色和年龄，穿深蓝衬衫。'
                    : '沿用参考图的同一家咖啡馆，保持窗框布局、木桌、白色咖啡杯和窗外树木的位置，只把时间改成日落暖光，无人，无文字。',
              },
            },
          },
        ],
        changes: null,
      });
    },
  };
  const services = npcAgentServices(app, () => model);
  const command = {
    id: randomUUID(),
    worldId: world.worldId,
    actorId: state.actors[0].id,
    expectedVersion: 0,
    text: '拍一张现在的照片给我。',
  };
  const reply = await services.sendMessageIfEnabled(owner, command);
  assert.equal(reply?.status, 'committed');
  const request = (
    await admin.query(
      'SELECT id,document FROM parallel_life.world_media_requests WHERE world_id=$1',
      [world.worldId],
    )
  ).rows[0];
  assert.ok(request);
  for (const who of [owner, stranger]) {
    const reference = await app.transaction(who, (sql) =>
      sourceSceneReference(sql, world.worldId, who, request.document.sourceEventId),
    );
    assert.equal(reference, null, 'a private photo request never guesses a scene/place reference');
  }
  let providerCalls = 0;
  const live = ['person', 'scene'].includes(kind);
  const real = new YibuMediaProviderAdapter({
    apiKey: process.env.YIBU_API_KEY,
    baseUrl: process.env.YIBU_BASE_URL,
    model: GROK_IMAGE_MODEL,
  });
  const provider: MediaProviderAdapter = {
    providerName: live ? 'yibu' : 'controlled',
    async submitImage(params) {
      providerCalls++;
      assert.ok(params.referenceImageBytes?.length);
      if (live) {
        if (!process.env.YIBU_API_KEY || process.env.YIBU_API_KEY === '[SENSITIVE]')
          throw Error('LIVE_KEY_MISSING');
        if (!process.env.GROK_LIVE_LEDGER_PATH) throw Error('LIVE_LEDGER_REQUIRED');
        const prior = await readFile(process.env.GROK_LIVE_LEDGER_PATH, 'utf8').catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') return '';
            throw e;
          },
        );
        if (prior.split('\n').some((line) => line && JSON.parse(line).case === kind))
          throw Error('LIVE_CASE_ALREADY_ATTEMPTED');
        await appendFile(
          process.env.GROK_LIVE_LEDGER_PATH,
          JSON.stringify({
            case: kind,
            worldId: world.worldId,
            requestId: request.id,
            stage: 'sent',
            at: new Date().toISOString(),
            referenceAsset: portraitCase ? anchor?.referenceAssetId : sceneAsset,
          }) + '\n',
        );
        try {
          return await real.submitImage(params);
        } catch (error) {
          const e = error as { code?: string; httpStatus?: number };
          await appendFile(
            process.env.GROK_LIVE_LEDGER_PATH!,
            JSON.stringify({
              case: kind,
              stage: e.code === 'STATUS_UNKNOWN' ? 'unknown' : 'failed',
              code: e.code,
              httpStatus: e.httpStatus,
              at: new Date().toISOString(),
            }) + '\n',
          );
          throw error;
        }
      }
      return {
        providerTaskId: randomUUID(),
        status: 'succeeded',
        provider: 'controlled',
        model: 'controlled',
        outputBase64: sourcePicture.toString('base64'),
      };
    },
    async submitVideo() {
      throw Error('not a video test');
    },
    async queryStatus(id) {
      return real.queryStatus(id);
    },
    async cancel(id) {
      return real.cancel(id);
    },
  };
  const pipeline = new MediaPipelineService({
    providerAdapter: provider,
    assetStore: disk,
    visualAnchorRepo: new PostgresCharacterVisualAnchorRepository(app),
    referenceAssetReader: async (assetId, who, context) => {
      assert.equal(who, owner);
      assert.equal(context?.worldId, world.worldId);
      const selected = await app.transaction(owner, (sql) =>
        publicationActorReference(sql, world.worldId, owner, context!.actorId!),
      );
      assert.equal(selected?.assetId, assetId);
      assert.ok(selected?.art);
      return {
        bytes: await readFile(new URL('../../public' + selected.art.url, import.meta.url)),
        mimeType: 'image/webp',
      };
    },
  });
  const dispatched = await dispatchOutbox(
    new PostgresOutbox(app).ports(owner, {
      worldId: world.worldId,
      eventId: request.document.sourceEventId,
    }),
  );
  assert.equal(dispatched.submitted, 1);
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(() => queue.close());
  const lease = (await queue.claimForOwner(dispatched.taskIds[0]!, owner, ['media']))!;
  assert.ok(lease);
  const handler = createMediaPipelineHandler(queue, pipeline);
  await handler(lease);
  const ready = (
    await admin.query('SELECT document FROM parallel_life.world_media_requests WHERE id=$1', [
      request.id,
    ])
  ).rows[0].document;
  assert.equal(ready.status, 'ready');
  if (portraitCase) {
    const stored = await app.transaction(owner, (sql) =>
      ownGeneratedPortraitReference(sql, world.worldId, owner, state.actors[0].id),
    );
    assert.equal(stored?.assetId, ready.assetId);
    assert.equal(
      await app.transaction(stranger, (sql) =>
        ownGeneratedPortraitReference(sql, world.worldId, stranger, state.actors[0].id),
      ),
      null,
    );
    assert.equal(
      await app.transaction(owner, (sql) =>
        ownGeneratedPortraitReference(sql, world.worldId, owner, state.actors[1].id),
      ),
      null,
    );
  }
  assert.equal(ready.referenceAssetId, portraitCase ? anchor!.referenceAssetId : sceneAsset);
  const asset = (
    await admin.query('SELECT storage_key,mime_type FROM parallel_life.assets WHERE id=$1', [
      ready.assetId,
    ])
  ).rows[0];
  assert.ok(asset);
  assert.ok((await disk.get(asset.storage_key)).length);
  await assert.rejects(handler(lease), { code: 'NOT_FOUND' });
  assert.equal(providerCalls, 1, 'finished lease cannot make a second provider request');
  assert.equal(await queue.claimForOwner(dispatched.taskIds[0]!, owner, ['media']), null);
  if (live)
    await appendFile(
      process.env.GROK_LIVE_LEDGER_PATH!,
      JSON.stringify({
        case: kind,
        worldId: world.worldId,
        requestId: request.id,
        stage: 'ready',
        assetId: ready.assetId,
        storageKey: asset.storage_key,
        at: new Date().toISOString(),
      }) + '\n',
    );
});
