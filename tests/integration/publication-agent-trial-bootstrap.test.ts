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
import { bootstrapPublicationAgentTrial } from '../../src/modules/world/infrastructure/publication-agent-trial-bootstrap.ts';

test('real publisher private trial initializes native runtime atomically without changing genesis', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55580, 'isolated registered PostgreSQL only');
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
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, 'Isolated trial bootstrap regression'],
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
  const repo = new PublicationRepository(pub, {
    async review() {
      throw Error('No review/model permitted');
    },
  });
  const work = await repo.create(staff, {
    commandId: randomUUID(),
    title: 'Isolated real trial regression',
    content,
  });
  const trials = new PublicationWorldRepository(pub, compiler);
  async function fresh() {
    const r = await trials.startTrial(
      staff,
      work.id,
      { commandId: randomUUID(), draftVersion: 0, contentHash: work.draft.contentHash },
      { agentRuntime: true },
    );
    const session = await trials.trialSession(staff, r.trialId!);
    return { ...r, ownerId: session.ownerId };
  }
  const trial = await fresh();
  async function image(id: string) {
    return (
      await admin.query(
        `SELECT w.version,w.state,i.state initial,c.story_now,c.paused,(SELECT count(*)::int FROM parallel_life.world_events e WHERE e.world_id=w.id) events FROM parallel_life.worlds w JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id JOIN parallel_life.world_clock c ON c.world_id=w.id WHERE w.id=$1`,
        [id],
      )
    ).rows[0];
  }
  const before = await image(trial.worldId);
  await t.test('foreign owner and old trial cannot bootstrap', async () => {
    await assert.rejects(bootstrapPublicationAgentTrial(app, randomUUID(), trial.worldId));
    const old = await trials.startTrial(staff, work.id, {
      commandId: randomUUID(),
      draftVersion: 0,
      contentHash: work.draft.contentHash,
    });
    assert.notEqual(old.worldId, trial.worldId);
    assert.notEqual(old.seedId, trial.seedId);
    const session = await trials.trialSession(staff, old.trialId!);
    assert.notEqual(session.ownerId, trial.ownerId);
    const prior = await image(old.worldId);
    await assert.rejects(bootstrapPublicationAgentTrial(app, session.ownerId, old.worldId));
    assert.deepEqual(await image(old.worldId), prior);
  });
  await t.test('unpaused fresh trial refuses initialization without writes', async () => {
    await admin.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [
      trial.worldId,
    ]);
    await assert.rejects(bootstrapPublicationAgentTrial(app, trial.ownerId, trial.worldId));
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.actor_agent_states WHERE world_id=$1',
          [trial.worldId],
        )
      ).rows[0].n,
      0,
    );
    await admin.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
      trial.worldId,
    ]);
  });
  await t.test('failure after actor initialization rolls back all writes', async () => {
    class Failing extends PostgresDatabase {
      override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
        return super.transaction(owner, async (sql) => {
          const query = sql.query.bind(sql);
          sql.query = ((text: any, ...args: any[]) => {
            if (
              typeof text === 'string' &&
              text.startsWith('INSERT INTO parallel_life.agent_narrative_admissions')
            )
              throw Error('INJECTED_ADMISSION_FAILURE');
            return (query as any)(text, ...args);
          }) as typeof sql.query;
          return run(sql);
        });
      }
    }
    const failing = new Failing(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
    try {
      await assert.rejects(
        bootstrapPublicationAgentTrial(failing, trial.ownerId, trial.worldId),
        /INJECTED/,
      );
    } finally {
      await failing.close();
    }
    const n = await admin.query(
      'SELECT count(*)::int n FROM parallel_life.actor_agent_states WHERE world_id=$1',
      [trial.worldId],
    );
    assert.equal(n.rows[0].n, 0);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
          [trial.worldId],
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(await image(trial.worldId), before);
  });
  await t.test(
    'concurrent repeats initialize once and preserve author world, clock and history',
    async () => {
      const results = await Promise.all([
        bootstrapPublicationAgentTrial(app, trial.ownerId, trial.worldId),
        bootstrapPublicationAgentTrial(app, trial.ownerId, trial.worldId),
      ]);
      assert.equal(results.filter((r) => !r.resumed).length, 1);
      assert.deepEqual(await image(trial.worldId), before);
      const actors = await admin.query(
        'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
        [trial.worldId],
      );
      assert.equal(actors.rowCount, before.state.actors.length);
      for (const a of actors.rows) {
        assert.equal(a.document.revision, 0);
        assert.deepEqual(a.document.actions, []);
      }
      assert.equal(
        (
          await admin.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].engine_epoch,
        2,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_narrative_admissions WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test('same draft reuses only native binding without a new draft or reset', async () => {
    const again = await fresh();
    assert.equal(again.worldId, trial.worldId);
    assert.equal(
      (await bootstrapPublicationAgentTrial(app, again.ownerId, again.worldId)).resumed,
      true,
    );
    assert.deepEqual(await image(trial.worldId), before);
  });
});
