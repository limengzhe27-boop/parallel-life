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
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';

test('published player agent runtime controlled entry, isolation, atomicity and privileges', async (t) => {
  const cfg = await localConfig();
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

  t.after(async () => {
    await app.close();
    await pub.close();
    await admin.end();
  });

  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, 'Published player runtime test staff'],
  );

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

  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const content = PublishedWorldContentSchema.parse(
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!),
  );

  const localReviewReceipt = randomUUID();
  const reviewer = {
    async review() {
      return {
        reviewerVersion: 'local_fixture_only',
        runtimeCapabilities: new Set(['publication.opening.v1', 'publication.media.v1']),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: localReviewReceipt },
      };
    },
  };

  const pubRepo = new PublicationRepository(pub, reviewer);
  const work = await pubRepo.create(staff, {
    commandId: randomUUID(),
    title: 'Controlled Player Runtime Test Work',
    content,
  });
  const check = await pubRepo.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: work.draftVersion,
  });
  assert.equal(check.status, 'ready');
  const published = await pubRepo.publish(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: work.draftVersion,
    expectedMetadataVersion: work.metadataVersion,
    checkId: check.id,
  });
  assert.equal(published.publicationVersion, 1);

  const appRepo = new PublicationWorldRepository(app, compiler);

  await t.test(
    'default agentRuntime: false starts world in epoch 1 without agent state',
    async () => {
      const player1 = randomUUID();
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [player1]);

      const res = await appRepo.startPublished(
        player1,
        work.id,
        { commandId: randomUUID(), publicationVersion: 1 },
        { agentRuntime: false },
      );
      assert.ok(res.worldId);
      assert.equal(res.resumed, false);
      assert.equal(res.replayed, false);

      // Verify engine_epoch in binding is 1
      const binding = (
        await admin.query(
          'SELECT engine_epoch FROM parallel_life.publication_world_bindings WHERE world_id=$1',
          [res.worldId],
        )
      ).rows[0];
      assert.equal(binding.engine_epoch, 1);

      // Verify agent_runtime_worlds does NOT have epoch 2
      const agentWorld = (
        await admin.query(
          'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
          [res.worldId],
        )
      ).rows[0];
      assert.equal(agentWorld?.engine_epoch ?? 1, 1);

      // Verify actor_agent_states is empty for this world
      const states = (
        await admin.query(
          'SELECT count(*)::int AS count FROM parallel_life.actor_agent_states WHERE world_id=$1',
          [res.worldId],
        )
      ).rows[0].count;
      assert.equal(states, 0);
    },
  );

  await t.test(
    'agentRuntime: true creates atomic epoch 2 world with all actors initialized',
    async () => {
      const player2 = randomUUID();
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [player2]);

      const res = await appRepo.startPublished(
        player2,
        work.id,
        { commandId: randomUUID(), publicationVersion: 1 },
        { agentRuntime: true },
      );
      assert.ok(res.worldId);
      assert.equal(res.resumed, false);
      assert.equal(res.replayed, false);

      // Verify binding engine_epoch is 2
      const binding = (
        await admin.query(
          'SELECT engine_epoch FROM parallel_life.publication_world_bindings WHERE world_id=$1',
          [res.worldId],
        )
      ).rows[0];
      assert.equal(binding.engine_epoch, 2);

      // Verify agent_runtime_worlds engine_epoch is 2
      const agentWorld = (
        await admin.query(
          'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
          [res.worldId, player2],
        )
      ).rows[0];
      assert.equal(agentWorld.engine_epoch, 2);

      // Verify all actors have actor_agent_states at revision 0, projectedWorldVersion 0
      const actorStates = (
        await admin.query(
          'SELECT actor_id, revision, projected_world_version FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2',
          [res.worldId, player2],
        )
      ).rows;
      assert.equal(actorStates.length, content.actors.length);
      for (const s of actorStates) {
        assert.equal(s.revision, 0);
        assert.equal(s.projected_world_version, 0);
      }

      // Verify narrative admission
      const narrative = (
        await admin.query(
          'SELECT engine_epoch FROM parallel_life.agent_narrative_admissions WHERE world_id=$1 AND owner_id=$2',
          [res.worldId, player2],
        )
      ).rows[0];
      assert.equal(narrative.engine_epoch, 2);

      // Verify world authoritative positions at version 0
      const positions = (
        await admin.query(
          'SELECT subject_key, source_version, document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2',
          [res.worldId, player2],
        )
      ).rows;
      assert.ok(positions.some((p) => p.subject_key === 'player' && p.source_version === 0));

      // Verify publication_agent_world_source proof via pl_app
      const proof = await app.transaction(
        player2,
        async (sql) =>
          (
            await sql.query('SELECT parallel_life.publication_agent_world_source($1) AS source', [
              res.worldId,
            ])
          ).rows[0].source,
      );
      assert.equal(proof.worldId, res.worldId);
      assert.equal(proof.ownerId, player2);
      assert.equal(proof.engineEpoch, 2);
      assert.equal(proof.kind, 'published_work');
      assert.equal(proof.origin.publicationVersion, 1);
    },
  );

  await t.test(
    'idempotent replay returns same result with replayed: true and no duplicate setup',
    async () => {
      const player3 = randomUUID();
      const commandId = randomUUID();
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [player3]);

      const first = await appRepo.startPublished(
        player3,
        work.id,
        { commandId, publicationVersion: 1 },
        { agentRuntime: true },
      );
      assert.equal(first.replayed, false);

      const second = await appRepo.startPublished(
        player3,
        work.id,
        { commandId, publicationVersion: 1 },
        { agentRuntime: true },
      );
      assert.equal(second.replayed, true);
      assert.equal(second.worldId, first.worldId);
      assert.equal(second.seedId, first.seedId);

      // Verify exactly one binding exists
      const bindingCount = (
        await admin.query(
          'SELECT count(*)::int AS count FROM parallel_life.publication_world_bindings WHERE owner_id=$1',
          [player3],
        )
      ).rows[0].count;
      assert.equal(bindingCount, 1);
    },
  );

  await t.test(
    'existing epoch 1 player world is not converted or touched when agentRuntime: true is requested',
    async () => {
      const player4 = randomUUID();
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [player4]);

      // First created under legacy epoch 1
      const legacy = await appRepo.startPublished(
        player4,
        work.id,
        { commandId: randomUUID(), publicationVersion: 1 },
        { agentRuntime: false },
      );
      assert.equal(legacy.resumed, false);

      // Later request with agentRuntime: true
      const later = await appRepo.startPublished(
        player4,
        work.id,
        { commandId: randomUUID(), publicationVersion: 1 },
        { agentRuntime: true },
      );
      assert.equal(later.resumed, true);
      assert.equal(later.worldId, legacy.worldId);

      // Must still be epoch 1
      const binding = (
        await admin.query(
          'SELECT engine_epoch FROM parallel_life.publication_world_bindings WHERE world_id=$1',
          [legacy.worldId],
        )
      ).rows[0];
      assert.equal(binding.engine_epoch, 1);

      // Still no actor_agent_states
      const count = (
        await admin.query(
          'SELECT count(*)::int AS count FROM parallel_life.actor_agent_states WHERE world_id=$1',
          [legacy.worldId],
        )
      ).rows[0].count;
      assert.equal(count, 0);
    },
  );

  await t.test(
    'atomicity: failure during bootstrap rolls back entire transaction without half-baked save',
    async () => {
      const player5 = randomUUID();
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [player5]);

      // Compiler that produces an invalid actor that will fail validation in DB
      const failingCompiler: PublicationWorldCompilerPort = {
        prepare(input) {
          const prep = compiler.prepare(input) as { world: { actors: unknown[] } };
          // Sabotage actors to violate check (NOT BETWEEN 1 AND 12)
          prep.world.actors = [];
          return prep;
        },
      };
      const badRepo = new PublicationWorldRepository(app, failingCompiler);

      await assert.rejects(
        badRepo.startPublished(
          player5,
          work.id,
          { commandId: randomUUID(), publicationVersion: 1 },
          { agentRuntime: true },
        ),
      );

      // Confirm nothing persisted for player5
      const worlds = (
        await admin.query(
          'SELECT count(*)::int AS count FROM parallel_life.worlds WHERE owner_id=$1',
          [player5],
        )
      ).rows[0].count;
      assert.equal(worlds, 0);

      const bindings = (
        await admin.query(
          'SELECT count(*)::int AS count FROM parallel_life.publication_world_bindings WHERE owner_id=$1',
          [player5],
        )
      ).rows[0].count;
      assert.equal(bindings, 0);
    },
  );

  await t.test(
    'multi-player state isolation between two concurrent agent runtime worlds',
    async () => {
      const pA = randomUUID();
      const pB = randomUUID();
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1), ($2)', [pA, pB]);

      const resA = await appRepo.startPublished(
        pA,
        work.id,
        { commandId: randomUUID(), publicationVersion: 1 },
        { agentRuntime: true },
      );
      const resB = await appRepo.startPublished(
        pB,
        work.id,
        { commandId: randomUUID(), publicationVersion: 1 },
        { agentRuntime: true },
      );

      assert.notEqual(resA.worldId, resB.worldId);

      // Update state in world A
      await admin.query(
        "UPDATE parallel_life.actor_agent_states SET revision=5, document=jsonb_set(document, '{revision}', '5'::jsonb) WHERE world_id=$1 AND owner_id=$2",
        [resA.worldId, pA],
      );

      // World B's revisions must remain 0
      const bStates = (
        await admin.query(
          'SELECT revision FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2',
          [resB.worldId, pB],
        )
      ).rows;
      for (const row of bStates) {
        assert.equal(row.revision, 0);
      }
    },
  );

  await t.test(
    'database privilege matrix: pl_app can access agent entry points, worker cannot, internal private',
    async () => {
      const appOkAdmit = (
        await admin.query(
          "SELECT has_function_privilege('pl_app', 'parallel_life.publication_admit_agent_published(uuid,bigint,uuid)', 'EXECUTE') AS ok",
        )
      ).rows[0].ok;
      assert.equal(appOkAdmit, true);

      const appOkSource = (
        await admin.query(
          "SELECT has_function_privilege('pl_app', 'parallel_life.publication_agent_world_source(text)', 'EXECUTE') AS ok",
        )
      ).rows[0].ok;
      assert.equal(appOkSource, true);

      const appInternalBlocked = (
        await admin.query(
          "SELECT has_function_privilege('pl_app', 'parallel_life.publication_admit_internal(text,uuid,bigint,text,uuid,integer)', 'EXECUTE') AS ok",
        )
      ).rows[0].ok;
      assert.equal(appInternalBlocked, false);

      const workerAdmitBlocked = (
        await admin.query(
          "SELECT has_function_privilege('pl_worker', 'parallel_life.publication_admit_agent_published(uuid,bigint,uuid)', 'EXECUTE') AS ok",
        )
      ).rows[0].ok;
      assert.equal(workerAdmitBlocked, false);
    },
  );
});
