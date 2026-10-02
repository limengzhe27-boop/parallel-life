import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { SettingDraftRepository } from '../../src/modules/settings/infrastructure/setting-draft-repository.ts';
import { LifeSettingContentSchema } from '../../src/contracts/life-settings.ts';
import { settingContent } from '../fixtures/life-setting.ts';

async function fixture() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    other = randomUUID();
  const identity = new IdentityRepository(db);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  return {
    admin,
    db,
    owner,
    other,
    repo: new SettingDraftRepository(db),
    content: LifeSettingContentSchema.parse(settingContent()),
    cleanup: async () => {
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
      await admin.end();
    },
  };
}
test('private setting revisions survive retries, concurrent edits and repository restart without overwriting history', async () => {
  const f = await fixture();
  try {
    const input = { commandId: randomUUID(), content: f.content };
    const created = await f.repo.create(f.owner, input);
    assert.deepEqual(await f.repo.create(f.owner, input), created);
    const changed = { ...f.content, story: { ...f.content.story, title: '第二个标题' } };
    const save = { commandId: randomUUID(), expectedVersion: 0, content: changed };
    const saved = await f.repo.save(f.owner, created.id, save);
    assert.equal(saved.version, 1);
    assert.deepEqual(await new SettingDraftRepository(f.db).get(f.owner, created.id), saved);
    assert.deepEqual(await f.repo.get(f.owner, created.id, 0), created);
    assert.deepEqual(
      await f.repo.create(f.owner, input),
      created,
      'retry returns its original revision, not latest',
    );
    assert.deepEqual(await f.repo.save(f.owner, created.id, save), saved);
    await assert.rejects(f.repo.save(f.owner, created.id, { ...save, content: f.content }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(f.repo.save(f.owner, created.id, { ...save, commandId: randomUUID() }), {
      code: 'VERSION_CONFLICT',
    });
    const races = await Promise.allSettled(
      [1, 2].map(() =>
        f.repo.save(f.owner, created.id, {
          commandId: randomUUID(),
          expectedVersion: 1,
          content: f.content,
        }),
      ),
    );
    assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = races.find((r) => r.status === 'rejected');
    assert.equal(loser?.status === 'rejected' && loser.reason.code, 'VERSION_CONFLICT');
    assert.equal((await f.repo.get(f.owner, created.id)).version, 2);
    await assert.rejects(
      f.admin.query(
        'DELETE FROM parallel_life.setting_draft_revisions WHERE draft_id=$1 AND version=0',
        [created.id],
      ),
      { code: '23514' },
    );
    assert.deepEqual(await f.repo.create(f.owner, input), created);
    assert.equal((await f.repo.list(f.owner))[0]!.version, 2);
    const rows = await f.admin.query(
      'SELECT count(*)::int AS n FROM parallel_life.setting_draft_revisions WHERE draft_id=$1',
      [created.id],
    );
    assert.equal(rows.rows[0].n, 3);
    const receipts = await f.admin.query(
      'SELECT count(*)::int AS n FROM parallel_life.setting_draft_receipts WHERE draft_id=$1',
      [created.id],
    );
    assert.equal(receipts.rows[0].n, 3);
  } finally {
    await f.cleanup();
  }
});
test('setting drafts remain private and do not mutate profiles; revisions and ownership have database guards', async () => {
  const f = await fixture();
  try {
    const before = await f.admin.query(
      'SELECT document FROM parallel_life.profiles WHERE owner_id=$1',
      [f.owner],
    );
    const created = await f.repo.create(f.owner, { commandId: randomUUID(), content: f.content });
    assert.deepEqual(await f.repo.list(f.other), []);
    await assert.rejects(f.repo.get(f.other, created.id), { code: 'NOT_FOUND' });
    await assert.rejects(f.repo.get(f.other, created.id, 0), { code: 'NOT_FOUND' });
    await assert.rejects(
      f.repo.save(f.other, created.id, {
        commandId: randomUUID(),
        expectedVersion: 0,
        content: f.content,
      }),
      { code: 'NOT_FOUND' },
    );
    for (const table of ['setting_drafts', 'setting_draft_revisions', 'setting_draft_receipts']) {
      const rows = await f.db.transaction(f.other, (sql) =>
        sql.query(`SELECT * FROM parallel_life.${table}`),
      );
      assert.equal(rows.rowCount, 0);
    }
    await assert.rejects(
      f.db.transaction(f.other, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.setting_draft_revisions(draft_id,owner_id,version,content) VALUES($1,$2,1,$3)',
          [created.id, f.owner, f.content],
        ),
      ),
      { code: '42501' },
    );
    await assert.rejects(
      f.db.transaction(f.owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.setting_draft_revisions SET content=content WHERE draft_id=$1',
          [created.id],
        ),
      ),
      { code: '42501' },
    );
    await assert.rejects(
      f.admin.query(
        'UPDATE parallel_life.setting_draft_revisions SET content=content WHERE draft_id=$1',
        [created.id],
      ),
      { code: '23514' },
    );
    await assert.rejects(
      f.db.transaction(f.owner, (sql) =>
        sql.query('UPDATE parallel_life.setting_drafts SET version=9 WHERE id=$1', [created.id]),
      ),
      { code: '23514' },
    );
    await assert.rejects(
      f.db.transaction(f.owner, (sql) =>
        sql.query('UPDATE parallel_life.setting_drafts SET version=1 WHERE id=$1', [created.id]),
      ),
      { code: '23503' },
    );
    const after = await f.admin.query(
      'SELECT document FROM parallel_life.profiles WHERE owner_id=$1',
      [f.owner],
    );
    assert.deepEqual(after.rows, before.rows);
    const other = await f.repo.create(f.other, { commandId: randomUUID(), content: f.content });
    assert.notEqual(other.id, created.id);
  } finally {
    await f.cleanup();
  }
});
test('setting creation rejects private payload fields before writing any draft', async () => {
  const f = await fixture();
  try {
    await assert.rejects(async () =>
      f.repo.create(f.owner, {
        commandId: randomUUID(),
        content: { ...f.content, profile: { birthday: '2000-01-01' } } as typeof f.content,
      }),
    );
    assert.deepEqual(await f.repo.list(f.owner), []);
    for (const role of ['pl_worker', 'public']) {
      const result = await f.admin.query(
        "SELECT has_table_privilege($1,'parallel_life.setting_drafts','SELECT') AS allowed",
        [role],
      );
      assert.equal(result.rows[0].allowed, false);
    }
  } finally {
    await f.cleanup();
  }
});

test('failed receipt write rolls back new revision and current pointer; command IDs stay owner-scoped', async () => {
  const f = await fixture();
  try {
    const commandId = randomUUID();
    const a = await f.repo.create(f.owner, { commandId, content: f.content });
    const b = await f.repo.create(f.other, { commandId, content: f.content });
    assert.notEqual(a.id, b.id);
    const original = f.db.transaction.bind(f.db);
    f.db.transaction = async (owner, run) =>
      original(owner, async (sql) => {
        const wrapped = new Proxy(sql, {
          get(target, key) {
            if (key === 'query')
              return async (...args: unknown[]) => {
                if (String(args[0]).includes('INSERT INTO parallel_life.setting_draft_receipts'))
                  throw new Error('INJECTED_RECEIPT_FAILURE');
                return (target.query as (...values: unknown[]) => unknown).apply(target, args);
              };
            return Reflect.get(target, key);
          },
        });
        return run(wrapped);
      });
    const save = { commandId: randomUUID(), expectedVersion: 0, content: f.content };
    await assert.rejects(f.repo.save(f.owner, a.id, save), /INJECTED_RECEIPT_FAILURE/);
    f.db.transaction = original;
    assert.equal((await f.repo.get(f.owner, a.id)).version, 0);
    const rows = await f.admin.query(
      'SELECT count(*)::int AS n FROM parallel_life.setting_draft_revisions WHERE draft_id=$1',
      [a.id],
    );
    assert.equal(rows.rows[0].n, 1);
    assert.equal((await f.repo.save(f.owner, a.id, save)).version, 1);
    await assert.rejects(
      f.db.transaction(f.owner, (sql) =>
        sql.query('DELETE FROM parallel_life.setting_draft_revisions WHERE draft_id=$1', [a.id]),
      ),
      { code: '42501' },
    );
  } finally {
    await f.cleanup();
  }
});

test('draft and revision quotas stop new writes but allow retrying successful commands', async () => {
  const f = await fixture();
  try {
    const first = { commandId: randomUUID(), content: f.content };
    const draft = await f.repo.create(f.owner, first);
    for (let i = 1; i < 20; i++)
      await f.repo.create(f.owner, { commandId: randomUUID(), content: f.content });
    await assert.rejects(f.repo.create(f.owner, { commandId: randomUUID(), content: f.content }), {
      code: 'RATE_LIMITED',
    });
    assert.deepEqual(await f.repo.create(f.owner, first), draft);
    let last = { commandId: randomUUID(), expectedVersion: 0, content: f.content };
    for (let i = 0; i < 99; i++) {
      last = { commandId: randomUUID(), expectedVersion: i, content: f.content };
      await f.repo.save(f.owner, draft.id, last);
    }
    await assert.rejects(
      f.repo.save(f.owner, draft.id, {
        commandId: randomUUID(),
        expectedVersion: 99,
        content: f.content,
      }),
      { code: 'RATE_LIMITED' },
    );
    assert.equal((await f.repo.save(f.owner, draft.id, last)).version, 99);
  } finally {
    await f.cleanup();
  }
});
