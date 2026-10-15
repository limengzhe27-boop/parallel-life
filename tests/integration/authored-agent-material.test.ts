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
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  readAuthoredAgentMaterialCatalog,
  readAuthoredAgentMaterialByKey,
} from '../../src/modules/world/infrastructure/authored-agent-material-repository.ts';
import type { AuthoredAgentMaterialCatalog } from '../../src/modules/world/domain/authored-agent-material.ts';

test('actual bound publication author materials: one caller SQL client, no old initialization or model', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AUTHORED_MATERIAL_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
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
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await app.close();
      await pub.close();
      await worker.close();
      await admin.end();
    }
  });
  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, 'Only local authored material SQL fixtures'],
  );
  // Reviewer evidence must be stable across check/publish. No provider, no production review claim.
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_AUTHORED_MATERIAL_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: reviewReceipt },
      };
    },
  });
  const compiler: PublicationWorldCompilerPort = {
    prepare(input) {
      const r = compilePublicationGenesis({
        ...input,
        originKind: input.originKind === 'trial' ? 'trial' : 'published',
        newId: randomUUID,
      });
      assert.equal(r.status, 'compiled');
      if (r.status !== 'compiled') throw Error('EXPLICIT_FIXTURE_COMPILER_FAILED');
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
  const trials = new PublicationWorldRepository(pub, compiler),
    published = new PublicationWorldRepository(app, compiler),
    worlds = new PostgresWorldRepository(app);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  base.world.startAt = new Date(base.world.startAt).toISOString();
  delete base.timeline;
  delete base.conditions;
  const manuscript = '  开场原文\n保留空格、标点和第二段。\n' + '长稿不是已发生结果。'.repeat(300);
  base.candidates = [
    {
      key: 'start',
      kind: 'candidate',
      title: '合成开场原题',
      editorialIntent: '合成编导意图，与script分别保留。',
      script: manuscript,
      actorKeys: base.actors.map((a: { key: string }) => a.key),
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event' },
    },
    {
      key: 'later',
      kind: 'candidate',
      title: '后续原题',
      editorialIntent: '原稿可选前提',
      actorKeys: [],
      prerequisites: [{ kind: 'after_presented_node', nodeKey: 'start' }],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event' },
    },
  ];
  base.openingEventKey = 'start';
  const content = PublishedWorldContentSchema.parse(base);
  const work = await stableWorks.create(staff, {
    commandId: randomUUID(),
    title: 'Only local authored material fixture',
    content,
  });
  async function migrateWorld(owner: string, id: string) {
    owned.push({ owner, id });
    const world = await worlds.get({ userId: owner }, id);
    await app.transaction(owner, async (sql) => {
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId: id, actorId: a.id },
            agentDefinitionRef(world, a.id),
            world.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: world.version,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    return { owner, id };
  }
  const created = await trials.startTrial(staff, work.id, {
    commandId: randomUUID(),
    draftVersion: 0,
    contentHash: (await stableWorks.get(staff, work.id)).draft.contentHash,
  });
  const session = await trials.trialSession(staff, created.trialId!);
  const f = await migrateWorld(session.ownerId, session.worldId);
  const request = { worldId: f.id, expectedEngineEpoch: 2, expectedWorldVersion: 0 };
  async function counts() {
    const tables = [
      'publication_story_plans',
      'publication_story_nodes',
      'publication_story_progress',
      'publication_story_receipts',
      'publication_opening_batches',
      'publication_opening_deliveries',
      'world_events',
      'agent_input_receipts',
      'agent_attempts',
      'director_runtime_attempts',
    ];
    const out: Record<string, number> = {};
    for (const table of tables)
      out[table] = Number(
        (
          await admin.query(
            `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`,
            [f.id],
          )
        ).rows[0].n,
      );
    return out;
  }
  async function read() {
    const r = await app.transaction(f.owner, (sql) =>
      readAuthoredAgentMaterialCatalog(sql, f.owner, request),
    );
    assert.equal(r.status, 'complete');
    if (r.status !== 'complete') throw Error('Expected full fixture catalog');
    return r.catalog;
  }
  let original: AuthoredAgentMaterialCatalog;
  await t.test(
    'real 58 source in RR READ ONLY preserves full raw text and exact contact IDs, without ledger initialization',
    async () => {
      const before = await counts(),
        sql = await app.pool.connect();
      try {
        await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await sql.query("SELECT set_config('app.user_id',$1,true)", [f.owner]);
        const r = await readAuthoredAgentMaterialCatalog(sql, f.owner, request);
        assert.equal(r.status, 'complete');
        if (r.status !== 'complete') throw Error('Expected complete');
        original = r.catalog;
        await sql.query('COMMIT');
      } catch (e) {
        await sql.query('ROLLBACK');
        throw e;
      } finally {
        sql.release();
      }
      assert.equal(original!.scope, 'director_only');
      assert.equal(original!.source!.origin.publicationVersion, 0);
      assert.equal(original!.materials.length, 2);
      assert.equal(original!.materials[0]!.node.script, manuscript);
      assert.equal(
        original!.materials[0]!.node.editorialIntent,
        content.candidates[0]!.editorialIntent,
      );
      assert.deepEqual(original!.materials[0]!.node.prerequisites, []);
      assert.equal(original!.materials[0]!.role, 'opening');
      const world = await worlds.get({ userId: f.owner }, f.id);
      assert.deepEqual(
        original!.materials[0]!.participantRefs.map((a) => a.actorId).sort(),
        world.actors.map((a) => a.id).sort(),
      );
      assert.deepEqual(await counts(), before);
      assert.equal(before.publication_story_plans, 0);
    },
  );
  await t.test(
    'small catalog budget explicitly returns index only; frozen key+node hash retrieves complete evidence',
    async () => {
      const before = await counts(),
        r = await app.transaction(f.owner, (sql) =>
          readAuthoredAgentMaterialCatalog(sql, f.owner, { ...request, maxBytes: 700 }),
        );
      assert.equal(r.status, 'index_only');
      if (r.status !== 'index_only') throw Error('Expected index');
      assert.ok(r.requiredBytes > r.maxBytes);
      assert.equal(r.index.length, 2);
      assert.equal('node' in r.index[0]!, false);
      assert.equal(JSON.stringify(r).includes(manuscript), false);
      const ref = r.index[0]!.ref;
      const full = await app.transaction(f.owner, (sql) =>
        readAuthoredAgentMaterialByKey(sql, f.owner, { ...request, ref, maxBytes: 100000 }),
      );
      assert.equal(full!.status, 'complete');
      if (!full || full.status !== 'complete') throw Error('Expected full original key');
      assert.equal(full.material.node.script, manuscript);
      const over = await app.transaction(f.owner, (sql) =>
        readAuthoredAgentMaterialByKey(sql, f.owner, { ...request, ref, maxBytes: 1 }),
      );
      assert.equal(over!.status, 'over_budget');
      assert.equal('material' in over!, false);
      assert.deepEqual(await counts(), before);
    },
  );
  await t.test(
    'wrong source, exact node hash, missing key, world version and epoch are rejected or explicitly absent',
    async () => {
      const c = await read(),
        ref = c.materials[0]!.ref;
      const badSource = { ...ref.source, origin: { ...ref.source.origin, draftVersion: 99 } };
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          readAuthoredAgentMaterialCatalog(sql, f.owner, { ...request, expectedSource: badSource }),
        ),
        { code: 'AUTHORED_MATERIAL_SOURCE_CONFLICT' },
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          readAuthoredAgentMaterialByKey(sql, f.owner, {
            ...request,
            ref: { ...ref, nodeHash: 'b'.repeat(64) },
          }),
        ),
        { code: 'AUTHORED_MATERIAL_NODE_CONFLICT' },
      );
      assert.equal(
        await app.transaction(f.owner, (sql) =>
          readAuthoredAgentMaterialByKey(sql, f.owner, {
            ...request,
            ref: { ...ref, nodeKey: 'absent' },
          }),
        ),
        null,
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          readAuthoredAgentMaterialCatalog(sql, f.owner, { ...request, expectedWorldVersion: 1 }),
        ),
        { code: 'VERSION_CONFLICT' },
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          readAuthoredAgentMaterialCatalog(sql, f.owner, { ...request, expectedEngineEpoch: 3 }),
        ),
        { code: 'ENGINE_EPOCH_CONFLICT' },
      );
    },
  );
  await t.test(
    'another owner and worker cannot read private author source, direct binding table remains denied',
    async () => {
      const foreign = randomUUID();
      await new IdentityRepository(app).ensureGuest(foreign);
      await assert.rejects(
        app.transaction(foreign, (sql) => readAuthoredAgentMaterialCatalog(sql, foreign, request)),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        worker.transaction(f.owner, (sql) =>
          readAuthoredAgentMaterialCatalog(sql, f.owner, request),
        ),
        { code: '42501' },
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          sql.query('SELECT * FROM parallel_life.publication_world_bindings WHERE world_id=$1', [
            f.id,
          ]),
        ),
        { code: '42501' },
      );
    },
  );
  await t.test(
    'published binding is read through actual 58 source with exact nonzero publication version',
    async () => {
      const check = await stableWorks.check(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
      });
      assert.equal(check.status, 'ready');
      await stableWorks.publish(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
        expectedMetadataVersion: 0,
        checkId: check.id,
      });
      const owner = randomUUID();
      await new IdentityRepository(app).ensureGuest(owner);
      const result = await published.startPublished(owner, work.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      });
      const p = await migrateWorld(owner, result.worldId);
      const r = await app.transaction(owner, (sql) =>
        readAuthoredAgentMaterialCatalog(sql, owner, {
          worldId: p.id,
          expectedEngineEpoch: 2,
          expectedWorldVersion: 0,
        }),
      );
      assert.equal(r.status, 'complete');
      if (r.status !== 'complete') throw Error('Expected published catalog');
      assert.equal(r.catalog.source!.origin.publicationVersion, 1);
      assert.equal(r.catalog.materials[0]!.node.script, manuscript);
      assert.notEqual(r.catalog.source!.worldId, original!.source!.worldId);
    },
  );
  await t.test(
    'editing current draft leaves existing bound trial source/ref/text frozen',
    async () => {
      const before = await read(),
        updated = structuredClone(content);
      updated.candidates[0]!.script = '只有新修订应看到的原稿';
      await stableWorks.save(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
        content: updated,
      });
      const after = await read();
      assert.deepEqual(after, before);
      assert.equal(after.source!.origin.draftVersion, 0);
      const detail = await stableWorks.get(staff, work.id),
        next = await trials.startTrial(staff, work.id, {
          commandId: randomUUID(),
          draftVersion: 1,
          contentHash: detail.draft.contentHash,
        }),
        binding = await trials.trialSession(staff, next.trialId!);
      await migrateWorld(binding.ownerId, binding.worldId);
      const nextRequest = {
        worldId: binding.worldId,
        expectedEngineEpoch: 2,
        expectedWorldVersion: 0,
      };
      const r = await app.transaction(binding.ownerId, (sql) =>
        readAuthoredAgentMaterialCatalog(sql, binding.ownerId, nextRequest),
      );
      assert.equal(r.status, 'complete');
      if (r.status !== 'complete') throw Error('Expected new revision');
      assert.equal(r.catalog.source!.origin.draftVersion, 1);
      assert.equal(r.catalog.materials[0]!.node.script, updated.candidates[0]!.script);
      await assert.rejects(
        app.transaction(binding.ownerId, (sql) =>
          readAuthoredAgentMaterialByKey(sql, binding.ownerId, {
            ...nextRequest,
            ref: original!.materials[0]!.ref,
          }),
        ),
        { code: 'AUTHORED_MATERIAL_SOURCE_CONFLICT' },
      );
    },
  );
  await t.test('world without publication source is an honest empty catalog', async () => {
    const owner = randomUUID(),
      id = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    await worlds.initialize(
      { userId: owner },
      {
        schemaVersion: 1,
        id,
        ownerId: owner,
        title: 'Only local no-source world',
        version: 0,
        time: '2026-10-15T08:00:00Z',
        actors: [],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );
    await migrateWorld(owner, id);
    const r = await app.transaction(owner, (sql) =>
      readAuthoredAgentMaterialCatalog(sql, owner, {
        worldId: id,
        expectedEngineEpoch: 2,
        expectedWorldVersion: 0,
      }),
    );
    assert.equal(r.status, 'complete');
    if (r.status !== 'complete') throw Error('Expected explicit empty');
    assert.equal(r.catalog.source, null);
    assert.deepEqual(r.catalog.materials, []);
  });
  await t.test(
    'after actual native note advances world, outdated expected frame is refused',
    async () => {
      await worlds.saveNote(
        { userId: f.owner },
        {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          title: '真实确定性世界命令',
          text: '不是模型对白',
        },
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) => readAuthoredAgentMaterialCatalog(sql, f.owner, request)),
        { code: 'VERSION_CONFLICT' },
      );
      const r = await app.transaction(f.owner, (sql) =>
        readAuthoredAgentMaterialCatalog(sql, f.owner, {
          ...request,
          expectedWorldVersion: 1,
          expectedSource: original!.source!,
        }),
      );
      assert.equal(r.status, 'complete');
    },
  );
});
