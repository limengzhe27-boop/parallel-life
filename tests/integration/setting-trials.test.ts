import { historyFixture } from '../helpers/genesis-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { SettingDraftRepository } from '../../src/modules/settings/infrastructure/setting-draft-repository.ts';
import { SettingTrialRepository } from '../../src/modules/settings/infrastructure/setting-trial-repository.ts';
import { SeedRepository } from '../../src/modules/discovery/infrastructure/seed-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { LifeSettingContentSchema } from '../../src/contracts/life-settings.ts';
import { settingContent } from '../fixtures/life-setting.ts';

async function fixture() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    other = randomUUID();
  const identity = new IdentityRepository(db);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  const profiles = new ProfileRepository(db);
  await profiles.edit(owner, {
    expectedVersion: 0,
    operation: { kind: 'set-fact', category: 'interest', value: '喜欢独自收集邮票' },
  });
  const drafts = new SettingDraftRepository(db),
    trials = new SettingTrialRepository(db),
    content = LifeSettingContentSchema.parse(settingContent());
  const draft = await drafts.create(owner, { commandId: randomUUID(), content });
  return {
    admin,
    db,
    queue,
    owner,
    other,
    drafts,
    trials,
    content,
    draft,
    cleanup: async () => {
      await queue.close();
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
      await admin.end();
    },
  };
}

test('private trial pins an owned revision, creates one queued world per command, and keeps later edits out', async () => {
  const f = await fixture();
  try {
    const input = { commandId: randomUUID(), version: 0 };
    const [a, b] = await Promise.all([
      f.trials.create(f.owner, f.draft.id, input),
      f.trials.create(f.owner, f.draft.id, input),
    ]);
    assert.equal(a.worldId, b.worldId);
    assert.equal(a.task!.id, b.task!.id);
    const seeds = new SeedRepository(f.db);
    const seed = await seeds.get(f.owner, a.seedId);
    assert.ok('source' in seed);
    assert.equal(seed.source.version, 0);
    assert.deepEqual(seed.settingContent, f.content);
    assert.deepEqual(seed.facts, []);
    assert.deepEqual(seed.people, []);
    assert.deepEqual(seed.assets, []);
    assert.equal(JSON.stringify(seed).includes('收集邮票'), false);
    assert.equal('directionId' in seed, false);
    await f.drafts.save(f.owner, f.draft.id, {
      commandId: randomUUID(),
      expectedVersion: 0,
      content: { ...f.content, story: { ...f.content.story, title: '另一个版本' } },
    });
    assert.deepEqual(await seeds.get(f.owner, a.seedId), seed);
    assert.equal((await f.trials.create(f.owner, f.draft.id, input)).worldId, a.worldId);
    await assert.rejects(f.trials.create(f.owner, f.draft.id, { ...input, version: 1 }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(
      f.trials.create(f.other, f.draft.id, { commandId: randomUUID(), version: 0 }),
      { code: 'NOT_FOUND' },
    );
    await assert.rejects(f.trials.list(f.other, f.draft.id), { code: 'NOT_FOUND' });
    await assert.rejects(
      f.trials.create(f.owner, f.draft.id, { commandId: randomUUID(), version: 99 }),
      { code: 'NOT_FOUND' },
    );
    assert.deepEqual(
      await new BuildRepository(f.db).list(f.owner),
      [],
      'trial does not pollute personal lives',
    );
    assert.deepEqual(await seeds.list(f.owner), []);
    assert.equal((await f.trials.list(f.owner, f.draft.id)).length, 1);
    const lease = await f.queue.claimForOwner(a.task!.id, f.owner, ['world-build']);
    assert.ok(lease);
    const planner = new WorldPlanner({
      async complete() {
        return JSON.stringify(
          historyFixture({
            messages: [{ actorKey: 'c_0', text: '两个场地问好了，你先看看？' }],
            notes: [{ title: '场地方案', text: '先比较预算与时间' }],
          }),
        );
      },
    });
    await buildHandler(f.queue, planner, 'fixture')(lease, new AbortController().signal);
    const phone = await new BuildRepository(f.db).phone(f.owner, a.worldId);
    assert.deepEqual(
      phone.actors.map((c) => c.name),
      f.content.characters.map((character) => character.name),
    );
    assert.equal(phone.identity, f.content.setup.identity);
    assert.equal(
      phone.messages.find((message) => message.initialRead === false)!.actorId,
      phone.actors[0]!.id,
    );
    assert.equal((await f.trials.list(f.owner, f.draft.id))[0]!.ready, true);
    const snapshot = await f.admin.query(
      'SELECT approved_seed,state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
      [a.worldId],
    );
    assert.deepEqual(snapshot.rows[0].approved_seed, seed);
    assert.deepEqual(
      snapshot.rows[0].state.actors.map((actor: { name: string }) => actor.name),
      f.content.characters.map((actor) => actor.name),
    );
    assert.equal(snapshot.rows[0].state.actorTies[0].fromActorId, phone.actors[0]!.id);
    const second = await f.trials.create(f.owner, f.draft.id, {
      commandId: randomUUID(),
      version: 0,
    });
    assert.notEqual(second.worldId, a.worldId);
  } finally {
    await f.cleanup();
  }
});

test('trial creation rolls back seed and build when queue fails; provenance cannot reference another owner', async () => {
  const f = await fixture();
  try {
    const original = f.db.transaction.bind(f.db);
    f.db.transaction = async (owner, run) =>
      original(owner, async (sql) =>
        run(
          new Proxy(sql, {
            get(target, key) {
              if (key === 'query')
                return async (...args: unknown[]) => {
                  if (String(args[0]).includes('INSERT INTO parallel_life.tasks'))
                    throw Error('INJECTED_QUEUE_FAILURE');
                  return (target.query as (...values: unknown[]) => unknown).apply(target, args);
                };
              return Reflect.get(target, key);
            },
          }),
        ),
      );
    const input = { commandId: randomUUID(), version: 0 };
    await assert.rejects(f.trials.create(f.owner, f.draft.id, input), /INJECTED_QUEUE_FAILURE/);
    f.db.transaction = original;
    assert.deepEqual(await f.trials.list(f.owner, f.draft.id), []);
    const rows = await f.admin.query(
      'SELECT count(*)::int AS n FROM parallel_life.approved_seeds WHERE owner_id=$1',
      [f.owner],
    );
    assert.equal(rows.rows[0].n, 0);
    const trial = await f.trials.create(f.owner, f.draft.id, input);
    const row = (
      await f.admin.query('SELECT * FROM parallel_life.approved_seeds WHERE id=$1', [trial.seedId])
    ).rows[0];
    const foreignProfile = (
      await f.admin.query('SELECT id FROM parallel_life.profiles WHERE owner_id=$1', [f.other])
    ).rows[0].id;
    await assert.rejects(
      f.db.transaction(f.other, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document,setting_draft_id,setting_draft_version) VALUES($1,$2,$3,$4,$5,$6,$7,0)',
          [
            randomUUID(),
            f.other,
            foreignProfile,
            randomUUID(),
            'invalid-source',
            row.document,
            f.draft.id,
          ],
        ),
      ),
      { code: '23503' },
    );
  } finally {
    await f.cleanup();
  }
});
