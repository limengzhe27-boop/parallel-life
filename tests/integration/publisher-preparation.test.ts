import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublisherPreparationRepository } from '../../src/modules/settings/infrastructure/publisher-preparation-repository.ts';
import { preparePublisherManuscript } from '../../src/modules/settings/application/publisher-preparation.ts';

test('publisher manuscript preparation: durable admission, isolation, no repeated paid call and draft protection', async (t) => {
  const config = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const role = 'pl_preparation_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const db = new PostgresDatabase(
    `postgresql://${role}:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await app.close();
    await admin.end();
  });
  const staff = randomUUID(),
    other = randomUUID();
  for (const id of [staff, other])
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [id, '合成文稿验收'],
    );
  const works = new PublicationRepository(db),
    repo = new PublisherPreparationRepository(db);
  const work = await works.create(staff, {
    commandId: randomUUID(),
    title: '文稿整理测试',
    content: {},
  });
  const make = () => ({
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    currentContent: {},
    sources: [{ filename: '原稿.md', content: '成年角色经营一家小店。' }],
  });
  const output = {
    updatedContent: { world: { tone: '日常' } },
    summary: '本地受控测试提案',
    notes: [],
    issues: [],
  };
  let calls = 0;
  const planner = {
    async propose() {
      calls++;
      return output;
    },
  };
  const first = make();
  await t.test(
    'simultaneous replay admits once; result and original material recover, without saving a draft',
    async () => {
      const responses = await Promise.all([
        preparePublisherManuscript(repo, planner, staff, work.id, first),
        preparePublisherManuscript(repo, planner, staff, work.id, first),
      ]);
      assert.equal(calls, 1);
      assert.ok(responses.some((r) => r.status === 'succeeded'));
      assert.equal(
        (await preparePublisherManuscript(repo, planner, staff, work.id, first)).status,
        'succeeded',
      );
      assert.equal(calls, 1);
      const recovered = await repo.read(staff, work.id, first.commandId);
      assert.deepEqual(recovered?.result, output);
      assert.deepEqual(recovered?.material.sources, first.sources);
      assert.equal((await works.get(staff, work.id)).draftVersion, 0);
      assert.deepEqual((await works.get(staff, work.id)).draft.content, {});
    },
  );
  await t.test(
    'changed input with same command and stale draft are rejected before model call',
    async () => {
      await assert.rejects(
        preparePublisherManuscript(repo, planner, staff, work.id, {
          ...first,
          sources: [{ filename: '改稿.md', content: '不同' }],
        }),
        (e: any) => e.code === 'IDEMPOTENCY_CONFLICT',
      );
      await assert.rejects(
        preparePublisherManuscript(repo, planner, staff, work.id, {
          ...make(),
          expectedDraftVersion: 8,
        }),
        (e: any) => e.code === 'VERSION_CONFLICT',
      );
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'other staff, ordinary players and revoked editors cannot access private manuscript',
    async () => {
      assert.equal(await repo.read(other, work.id, first.commandId), null);
      await assert.rejects(
        app.transaction(randomUUID(), (sql) =>
          sql.query('SELECT * FROM parallel_life.publisher_preparations'),
        ),
        (e: any) => e.code === '42501',
      );
      await admin.query(
        'UPDATE parallel_life.publisher_principals SET can_edit=false WHERE id=$1',
        [staff],
      );
      await assert.rejects(
        repo.read(staff, work.id, first.commandId),
        (e: any) => e.code === 'FORBIDDEN',
      );
      await admin.query('UPDATE parallel_life.publisher_principals SET can_edit=true WHERE id=$1', [
        staff,
      ]);
    },
  );
  await t.test(
    'unknown provider response never reissues the operation; explicit new command is required',
    async () => {
      const input = make();
      let paid = 0;
      const failed = {
        async propose() {
          paid++;
          throw Object.assign(Error('private provider error'), { code: 'TIMEOUT' });
        },
      };
      const r = await preparePublisherManuscript(repo, failed, staff, work.id, input);
      assert.equal(r.status, 'unknown');
      assert.equal(r.errorCode, 'TIMEOUT');
      await preparePublisherManuscript(repo, failed, staff, work.id, input);
      assert.equal(paid, 1);
    },
  );
  await t.test(
    'abandoned in-flight call becomes unknown, not silently eligible for a retry',
    async () => {
      const input = make();
      await repo.begin(staff, work.id, input);
      // Fixture-only time passage: trigger is disabled only for this isolated admin transaction.
      await admin.query('BEGIN');
      try {
        await admin.query(
          'ALTER TABLE parallel_life.publisher_preparations DISABLE TRIGGER publisher_preparation_transition',
        );
        await admin.query(
          "UPDATE parallel_life.publisher_preparations SET created_at=now()-interval '4 minutes' WHERE principal_id=$1 AND command_id=$2",
          [staff, input.commandId],
        );
        await admin.query(
          'ALTER TABLE parallel_life.publisher_preparations ENABLE TRIGGER publisher_preparation_transition',
        );
        await admin.query('COMMIT');
      } catch (e) {
        await admin.query('ROLLBACK');
        throw e;
      }
      assert.equal((await repo.read(staff, work.id, input.commandId))?.status, 'unknown');
      await preparePublisherManuscript(repo, planner, staff, work.id, input);
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'direct role SQL cannot rewrite immutable material or a terminal result',
    async () => {
      await assert.rejects(
        db.transaction(staff, async (sql) => {
          await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [staff]);
          await sql.query(
            "UPDATE parallel_life.publisher_preparations SET status='running',result=NULL WHERE principal_id=$1 AND command_id=$2",
            [staff, first.commandId],
          );
        }),
        (e: any) => e.code === '23514',
      );
    },
  );
  await t.test('admission serializes different commands and caps hourly requests', async () => {
    const a = make(),
      b = make();
    await repo.begin(staff, work.id, a);
    await assert.rejects(repo.begin(staff, work.id, b), (e: any) => e.code === 'INVALID_STATE');
    await repo.finish(staff, work.id, a.commandId, {
      status: 'failed',
      result: null,
      errorCode: 'INVALID_RESPONSE',
    });
    for (let i = 0; i < 6; i++) {
      const input = make();
      await repo.begin(staff, work.id, input);
      await repo.finish(staff, work.id, input.commandId, {
        status: 'failed',
        result: null,
        errorCode: 'INVALID_RESPONSE',
      });
    }
    await assert.rejects(repo.begin(staff, work.id, make()), (e: any) => e.code === 'RATE_LIMITED');
  });
});
